"""
IB Terminal — Porticus Capital
Multi-Account TWS Gateway Backend v3

Design principles:
- Current state ALWAYS comes from IB API, never from SQLite
- SQLite is append-only archive for historical log, commissions, blotter
- Market data is optional (toggle on/off), sourced from a user-chosen account
- IB handles midprice/order routing internally — local data is for display only
- All order actions go through IB API, state refreshes from IB events

Uses ib_async — the actively maintained TWS API library:
  https://github.com/ib-api-reloaded/ib_async

Requirements:
    pip install fastapi uvicorn ib_async websockets pydantic
"""

import asyncio
import json
import logging
import math
import sqlite3
from datetime import datetime, date
from typing import Dict, List, Optional, Set
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ib_async import IB, Stock, LimitOrder, MarketOrder, StopOrder, Order, Trade, util

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ib_terminal")

CONFIG_PATH = Path("config.json")
DB_PATH = Path("ib_terminal.db")


# ─── Configuration Models ────────────────────────────────

class AccountConfig(BaseModel):
    id: int
    name: str
    host: str = "127.0.0.1"
    port: int = 7496
    client_id: int = 1
    enabled: bool = True
    equity_source: str = "api"
    manual_equity: float = 0.0


class MarketDataConfig(BaseModel):
    enabled: bool = False
    source_account_id: Optional[int] = None  # which account to pull quotes from


class RiskConfig(BaseModel):
    max_leverage: float = 3.0
    max_position_pct: float = 25.0
    max_order_notional: float = 100000


class AppSettings(BaseModel):
    market_data: MarketDataConfig = MarketDataConfig()
    risk: RiskConfig = RiskConfig()


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {"accounts": [], "settings": {}}


def save_config(config: dict):
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


# ─── Request Models ───────────────────────────────────────

class OrderRequest(BaseModel):
    symbol: str
    action: str
    order_type: str
    quantity: float
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    current_price: Optional[float] = None  # reference price for calculations
    tif: str = "GTC"
    outside_rth: bool = False
    exchange: str = "SMART"
    currency: str = "USD"
    primary_exchange: str = ""
    account_ids: List[int] = []
    bracket: bool = False
    profit_target: Optional[float] = None
    stop_loss: Optional[float] = None
    round_shares: bool = True


class ProportionalOrderRequest(BaseModel):
    symbol: str
    action: str
    order_type: str
    allocation_pct: float
    current_price: float              # frontend provides the price it's using
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    tif: str = "GTC"
    outside_rth: bool = False
    exchange: str = "SMART"
    currency: str = "USD"
    primary_exchange: str = ""
    account_ids: List[int] = []
    bracket: bool = False
    profit_target: Optional[float] = None
    stop_loss: Optional[float] = None
    round_shares: bool = True


class ModifyOrderRequest(BaseModel):
    new_price: float


class ExitRequest(BaseModel):
    symbol: str
    exit_pct: float
    order_type: str = "MIDPRICE"
    account_ids: Optional[List[int]] = None
    round_shares: bool = True


class RiskWarning(BaseModel):
    level: str
    message: str
    field: str


# ─── SQLite Archive (NOT for current state) ──────────────

class AuditDB:
    """
    Append-only archive. Never used as source of truth for current state.
    Current positions/orders/equity always come from IB API.
    This stores: order history, commissions, for blotter/reporting only.
    """

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("""
            CREATE TABLE IF NOT EXISTS order_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                account_id INTEGER,
                account_name TEXT,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                order_type TEXT NOT NULL,
                shares REAL,
                filled REAL DEFAULT 0,
                price REAL,
                avg_fill_price REAL,
                notional REAL,
                tif TEXT,
                outside_rth INTEGER DEFAULT 0,
                status TEXT,
                ib_order_id INTEGER,
                commission REAL DEFAULT 0,
                realized_pnl REAL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS commissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                account_id INTEGER,
                account_name TEXT,
                symbol TEXT,
                ib_order_id INTEGER,
                exec_id TEXT,
                commission REAL,
                currency TEXT DEFAULT 'USD',
                realized_pnl REAL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        conn.close()

    def log_order(self, data: dict) -> int:
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.execute("""
            INSERT INTO order_log (date, time, account_id, account_name, symbol, action,
                order_type, shares, filled, price, avg_fill_price, notional, tif, outside_rth,
                status, ib_order_id, commission, realized_pnl)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("date", date.today().isoformat()),
            data.get("time", datetime.now().strftime("%H:%M:%S")),
            data.get("account_id"), data.get("account_name"),
            data.get("symbol"), data.get("action"), data.get("order_type"),
            data.get("shares"), data.get("filled", 0),
            data.get("price"), data.get("avg_fill_price"),
            data.get("notional"), data.get("tif"),
            1 if data.get("outside_rth") else 0,
            data.get("status"), data.get("ib_order_id"),
            data.get("commission", 0), data.get("realized_pnl", 0),
        ))
        conn.commit()
        row_id = cursor.lastrowid
        conn.close()
        return row_id

    def update_order_status(self, ib_order_id: int, account_id: int, status: str,
                            filled: float = 0, avg_fill_price: float = 0):
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("""
            UPDATE order_log SET status=?, filled=?, avg_fill_price=?
            WHERE ib_order_id=? AND account_id=?
        """, (status, filled, avg_fill_price, ib_order_id, account_id))
        conn.commit()
        conn.close()

    def log_commission(self, data: dict):
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("""
            INSERT INTO commissions (date, account_id, account_name, symbol, ib_order_id,
                exec_id, commission, currency, realized_pnl)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("date", date.today().isoformat()),
            data.get("account_id"), data.get("account_name"),
            data.get("symbol"), data.get("ib_order_id"),
            data.get("exec_id"), data.get("commission"),
            data.get("currency", "USD"), data.get("realized_pnl", 0),
        ))
        conn.execute("""
            UPDATE order_log SET commission = commission + ?, realized_pnl = ?
            WHERE ib_order_id = ? AND account_id = ?
        """, (
            data.get("commission", 0), data.get("realized_pnl", 0),
            data.get("ib_order_id"), data.get("account_id"),
        ))
        conn.commit()
        conn.close()

    def get_log(self, limit: int = 500, account_id: Optional[int] = None,
                symbol: Optional[str] = None, date_from: Optional[str] = None,
                date_to: Optional[str] = None) -> List[dict]:
        """Historical log only — NOT current state."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        query = "SELECT * FROM order_log WHERE 1=1"
        params = []
        if account_id:
            query += " AND account_id = ?"
            params.append(account_id)
        if symbol:
            query += " AND symbol = ?"
            params.append(symbol.upper())
        if date_from:
            query += " AND date >= ?"
            params.append(date_from)
        if date_to:
            query += " AND date <= ?"
            params.append(date_to)
        query += " ORDER BY date DESC, time DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def get_blotter(self, target_date: Optional[str] = None,
                    account_id: Optional[int] = None) -> dict:
        if not target_date:
            target_date = date.today().isoformat()
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row

        query = "SELECT * FROM order_log WHERE date = ?"
        params = [target_date]
        if account_id:
            query += " AND account_id = ?"
            params.append(account_id)
        rows = conn.execute(query, params).fetchall()
        orders = [dict(r) for r in rows]

        comm_query = "SELECT * FROM commissions WHERE date = ?"
        comm_params = [target_date]
        if account_id:
            comm_query += " AND account_id = ?"
            comm_params.append(account_id)
        comm_rows = conn.execute(comm_query, comm_params).fetchall()
        commissions = [dict(r) for r in comm_rows]
        conn.close()

        filled = [o for o in orders if o["status"] == "FILLED"]
        total_commission = sum(c["commission"] for c in commissions)
        total_realized = sum(c["realized_pnl"] for c in commissions if c["realized_pnl"])
        total_notional = sum(o["notional"] or 0 for o in filled)

        by_symbol = {}
        for o in filled:
            sym = o["symbol"]
            if sym not in by_symbol:
                by_symbol[sym] = {"buys": 0, "sells": 0, "buy_notional": 0,
                                  "sell_notional": 0, "commission": 0, "realized_pnl": 0}
            if o["action"] == "BUY":
                by_symbol[sym]["buys"] += o["shares"] or 0
                by_symbol[sym]["buy_notional"] += o["notional"] or 0
            else:
                by_symbol[sym]["sells"] += o["shares"] or 0
                by_symbol[sym]["sell_notional"] += o["notional"] or 0
        for c in commissions:
            sym = c["symbol"]
            if sym in by_symbol:
                by_symbol[sym]["commission"] += c["commission"] or 0
                by_symbol[sym]["realized_pnl"] += c["realized_pnl"] or 0

        by_account = {}
        for o in orders:
            aid = o["account_name"] or f"Acct {o['account_id']}"
            if aid not in by_account:
                by_account[aid] = {"orders": 0, "filled": 0, "cancelled": 0,
                                   "notional": 0, "commission": 0, "realized_pnl": 0}
            by_account[aid]["orders"] += 1
            if o["status"] == "FILLED":
                by_account[aid]["filled"] += 1
                by_account[aid]["notional"] += o["notional"] or 0
            elif o["status"] == "CANCELLED":
                by_account[aid]["cancelled"] += 1
        for c in commissions:
            aid = c["account_name"] or f"Acct {c['account_id']}"
            if aid in by_account:
                by_account[aid]["commission"] += c["commission"] or 0
                by_account[aid]["realized_pnl"] += c["realized_pnl"] or 0

        return {
            "date": target_date,
            "total_orders": len(orders),
            "filled_orders": len(filled),
            "cancelled_orders": len([o for o in orders if o["status"] == "CANCELLED"]),
            "total_notional": round(total_notional, 2),
            "total_commission": round(total_commission, 2),
            "total_realized_pnl": round(total_realized, 2),
            "net_pnl": round(total_realized - total_commission, 2),
            "by_symbol": by_symbol,
            "by_account": by_account,
            "orders": orders,
        }


# ─── Market Data (Optional, Display-Only) ────────────────

class MarketDataManager:
    """
    Optional live quotes for GUI display only.
    IB handles actual order pricing (midprice etc) internally.
    This just shows bid/ask/last in the frontend.
    Pulls from a single user-chosen account connection.
    """

    def __init__(self):
        self.enabled = False
        self.source_account_id: Optional[int] = None
        self.quotes: Dict[str, dict] = {}
        self._subscribed: Set[str] = set()

    def configure(self, enabled: bool, source_account_id: Optional[int]):
        old_enabled = self.enabled
        self.enabled = enabled
        self.source_account_id = source_account_id
        if not enabled and old_enabled:
            # Turning off — clear subscriptions
            self._unsubscribe_all()
        logger.info(f"Market data: {'ON' if enabled else 'OFF'}, source account: {source_account_id}")

    def _unsubscribe_all(self):
        if self.source_account_id and self.source_account_id in ib_accounts:
            acct = ib_accounts[self.source_account_id]
            if acct.is_connected():
                try:
                    acct.ib.reqMktData(cancel=True)
                except Exception:
                    pass
        self._subscribed.clear()
        self.quotes.clear()

    async def subscribe(self, symbol: str):
        if not self.enabled or not self.source_account_id:
            return
        if symbol in self._subscribed:
            return
        acct = ib_accounts.get(self.source_account_id)
        if not acct or not acct.is_connected():
            logger.warning(f"Market data source account {self.source_account_id} not connected")
            return
        try:
            contract = Stock(symbol.upper(), "SMART", "USD")
            acct.ib.qualifyContracts(contract)
            acct.ib.reqMktData(contract, "", False, False)
            self._subscribed.add(symbol.upper())
            logger.info(f"Market data subscribed: {symbol}")
        except Exception as e:
            logger.error(f"Market data subscribe error {symbol}: {e}")

    def update_quotes(self):
        """Pull latest tickers from source account. Called in loop."""
        if not self.enabled or not self.source_account_id:
            return
        acct = ib_accounts.get(self.source_account_id)
        if not acct or not acct.is_connected():
            return
        try:
            for ticker in acct.ib.tickers():
                if not ticker.contract:
                    continue
                sym = ticker.contract.symbol
                bid = ticker.bid if ticker.bid and ticker.bid > 0 else None
                ask = ticker.ask if ticker.ask and ticker.ask > 0 else None
                last = ticker.last if ticker.last and ticker.last > 0 else None
                mid = round((bid + ask) / 2, 4) if bid and ask else None
                self.quotes[sym] = {
                    "bid": bid, "ask": ask, "last": last, "mid": mid,
                    "volume": ticker.volume or 0,
                    "time": datetime.now().strftime("%H:%M:%S"),
                }
        except Exception as e:
            logger.error(f"Market data update error: {e}")

    def get_price(self, symbol: str) -> Optional[float]:
        q = self.quotes.get(symbol.upper())
        if not q:
            return None
        return q.get("mid") or q.get("last") or q.get("bid")


# ─── Account Connection Manager ──────────────────────────

class IBAccount:
    RECONNECT_DELAYS = [1, 2, 5, 10, 30, 60]

    def __init__(self, config: AccountConfig, audit_db: AuditDB):
        self.config = config
        self.ib = IB()
        self.connected = False
        self.equity = 0.0
        self.cash = 0.0
        self.buying_power = 0.0
        self.margin_used = 0.0
        self.positions: Dict[str, dict] = {}
        self.open_orders: Dict[int, dict] = {}
        self.audit_db = audit_db
        self._reconnect_attempt = 0
        self._reconnect_task: Optional[asyncio.Task] = None
        self._should_reconnect = True

    async def connect(self) -> bool:
        self._should_reconnect = True
        try:
            await self.ib.connectAsync(
                host=self.config.host, port=self.config.port,
                clientId=self.config.client_id, timeout=10,
            )
            self.connected = True
            self._reconnect_attempt = 0
            logger.info(f"[{self.config.name}] Connected {self.config.host}:{self.config.port}")

            self.ib.disconnectedEvent += self._on_disconnect
            self.ib.orderStatusEvent += self._on_order_status
            self.ib.newOrderEvent += self._on_new_order
            self.ib.cancelOrderEvent += self._on_cancel_order
            self.ib.pnlSingleEvent += self._on_pnl_single
            self.ib.accountValueEvent += self._on_account_value
            self.ib.positionEvent += self._on_position
            self.ib.commissionReportEvent += self._on_commission_report
            self.ib.errorEvent += self._on_error

            # Only request auto-bind if clientId is 0 (IB requirement)
            if self.config.client_id == 0:
                self.ib.reqAutoOpenOrders(True)
            self.ib.reqAccountUpdates()
            # Give IB time to send account data before first refresh
            await asyncio.sleep(2)
            await self._refresh_all()

            asyncio.ensure_future(manager.broadcast({
                "type": "alert", "level": "info",
                "message": f"{self.config.name} connected",
                "account_id": self.config.id, "sound": "connect",
            }))
            return True
        except Exception as e:
            self.connected = False
            logger.error(f"[{self.config.name}] Connection failed: {e}")
            self._schedule_reconnect()
            return False

    async def disconnect(self):
        self._should_reconnect = False
        if self._reconnect_task:
            self._reconnect_task.cancel()
        try:
            if self.ib.isConnected():
                self.ib.disconnect()
            self.connected = False
        except Exception as e:
            logger.error(f"[{self.config.name}] Disconnect error: {e}")

    def _on_disconnect(self):
        self.connected = False
        logger.warning(f"[{self.config.name}] Connection lost!")
        asyncio.ensure_future(manager.broadcast({
            "type": "alert", "level": "critical",
            "message": f"{self.config.name} disconnected!",
            "account_id": self.config.id, "sound": "disconnect",
        }))
        if self._should_reconnect:
            self._schedule_reconnect()

    def _schedule_reconnect(self):
        delay_idx = min(self._reconnect_attempt, len(self.RECONNECT_DELAYS) - 1)
        delay = self.RECONNECT_DELAYS[delay_idx]
        self._reconnect_attempt += 1
        logger.info(f"[{self.config.name}] Reconnecting in {delay}s (attempt {self._reconnect_attempt})")

        async def _do_reconnect():
            await asyncio.sleep(delay)
            if self._should_reconnect and not self.is_connected():
                self.ib = IB()
                await self.connect()

        self._reconnect_task = asyncio.ensure_future(_do_reconnect())

    def is_connected(self) -> bool:
        return self.ib.isConnected() if self.ib else False

    async def _refresh_all(self):
        if not self.is_connected():
            return
        await self._refresh_account_data()
        await self._refresh_positions()
        await self._refresh_orders()

    async def _refresh_account_data(self):
        try:
            # accountValues() is populated by reqAccountUpdates() which we call on connect
            for item in self.ib.accountValues():
                if item.tag == "NetLiquidation" and item.currency == "USD":
                    self.equity = float(item.value)
                elif item.tag == "TotalCashValue" and item.currency == "USD":
                    self.cash = float(item.value)
                elif item.tag == "BuyingPower":
                    self.buying_power = float(item.value)
                elif item.tag == "MaintMarginReq" and item.currency == "USD":
                    self.margin_used = float(item.value)
        except Exception as e:
            logger.error(f"[{self.config.name}] Account refresh error: {e}")

    async def _refresh_positions(self):
        try:
            self.positions = {}
            # Use portfolio() for the richest data — includes market price, P&L
            portfolio_items = self.ib.portfolio()
            portfolio_by_conid = {}
            for item in portfolio_items:
                portfolio_by_conid[item.contract.conId] = item

            all_pos = self.ib.reqPositions()
            my_pos = [p for p in all_pos
                      if abs(p.position) > 0.001
                      and p.contract.secType == "STK"]
            logger.info(f"[{self.config.name}] Refreshed {len(my_pos)} stock positions from IB ({len(all_pos)} total, {len(portfolio_items)} portfolio items)")
            for pos in my_pos:
                sym = pos.contract.symbol
                cur = pos.contract.currency or "USD"
                pex = pos.contract.primaryExchange or ""
                
                # Try to get primaryExchange from portfolio item (richer data)
                pf = portfolio_by_conid.get(pos.contract.conId)
                if not pex and pf and pf.contract.primaryExchange:
                    pex = pf.contract.primaryExchange
                
                # If still empty, try qualifying the contract
                if not pex and pos.contract.conId:
                    try:
                        qualified = self.ib.qualifyContracts(pos.contract)
                        if qualified and qualified[0].primaryExchange:
                            pex = qualified[0].primaryExchange
                    except:
                        pass

                key = f"{sym}:{cur}" if cur != "USD" else sym

                mkt_price = 0
                upnl = 0.0
                rpnl = 0.0
                if pf:
                    mkt_price = pf.marketPrice or 0
                    upnl = pf.unrealizedPNL or 0.0
                    rpnl = pf.realizedPNL or 0.0

                self.positions[key] = {
                    "symbol": sym, "key": key, "currency": cur,
                    "primary_exchange": pex, "con_id": pos.contract.conId,
                    "shares": pos.position, "avg_cost": pos.avgCost,
                    "account_id": self.config.id,
                    "current_price": mkt_price,
                    "unrealized_pnl": upnl,
                    "realized_pnl": rpnl,
                }
                self.ib.reqPnlSingle(account=pos.account, modelCode="", conId=pos.contract.conId)
                if market_data.enabled:
                    await market_data.subscribe(sym)
        except Exception as e:
            logger.error(f"[{self.config.name}] Position refresh error: {e}")

    async def _refresh_orders(self):
        try:
            self.open_orders = {}
            # trades() includes all orders — open, filled, cancelled — from all clients
            for trade in self.ib.trades():
                status = trade.orderStatus.status
                # Only keep active/working orders in open_orders
                if status in ("Submitted", "PreSubmitted", "PendingSubmit", "PendingCancel"):
                    self.open_orders[trade.order.orderId] = self._trade_to_dict(trade)
            # Also request any open orders placed from TWS/other API clients
            # Only works with clientId=0, and only when connected
            if self.is_connected() and self.config.client_id == 0:
                self.ib.reqAllOpenOrders()
                await asyncio.sleep(0.3)
                # Re-scan after reqAllOpenOrders populates
                for trade in self.ib.openTrades():
                    if trade.order.orderId not in self.open_orders:
                        self.open_orders[trade.order.orderId] = self._trade_to_dict(trade)
        except Exception as e:
            logger.error(f"[{self.config.name}] Order refresh error: {e}")

    # ─── IB Events (these are the source of truth for current state) ──

    def _on_order_status(self, trade: Trade):
        oid = trade.order.orderId
        data = self._trade_to_dict(trade)
        old_status = self.open_orders.get(oid, {}).get("status")
        self.open_orders[oid] = data

        # Archive to SQLite (historical record only)
        self.audit_db.update_order_status(oid, self.config.id, data["status"],
                                          data["filled"], data["avg_fill_price"])

        sound = None
        if data["status"] == "FILLED" and old_status != "FILLED":
            sound = "fill"
        elif data["filled"] > 0 and old_status not in ("PARTIAL", "FILLED"):
            sound = "partial_fill"

        asyncio.ensure_future(manager.broadcast({
            "type": "order_update", "account_id": self.config.id,
            "account_name": self.config.name, "order": data, "sound": sound,
        }))

    def _on_new_order(self, trade: Trade):
        self.open_orders[trade.order.orderId] = self._trade_to_dict(trade)

    def _on_cancel_order(self, trade: Trade):
        oid = trade.order.orderId
        if oid in self.open_orders:
            self.open_orders[oid]["status"] = "CANCELLED"

    def _on_pnl_single(self, entry):
        sym = entry.contract.symbol if entry.contract else "UNKNOWN"
        cur = entry.contract.currency if entry.contract else "USD"
        # Try compound key first, then plain symbol
        key = f"{sym}:{cur}" if cur and cur != "USD" else sym
        pos = self.positions.get(key) or self.positions.get(sym)
        if pos:
            pos["unrealized_pnl"] = entry.unrealizedPnL or 0.0
            pos["realized_pnl"] = entry.realizedPnL or 0.0
            # Calculate current price from market value
            if entry.position and entry.value:
                pos["current_price"] = abs(entry.value / entry.position)
            elif entry.position and entry.unrealizedPnL is not None:
                # Fallback: price = avgCost + unrealizedPnL / shares
                avg = pos.get("avg_cost", 0)
                if avg and entry.position:
                    pos["current_price"] = avg + (entry.unrealizedPnL / entry.position)

            # P&L threshold alert
            upnl = entry.unrealizedPnL or 0
            if upnl < -1000:
                asyncio.ensure_future(manager.broadcast({
                    "type": "alert", "level": "warning",
                    "message": f"{self.config.name}: {sym} P&L ${upnl:.0f}",
                    "account_id": self.config.id, "sound": "pnl_alert",
                }))

    def _on_account_value(self, value):
        # Accept USD, BASE, or empty string (some tags don't have currency)
        cur = getattr(value, 'currency', '') or ''
        is_base = cur in ("USD", "BASE", "")
        if value.tag == "NetLiquidation" and is_base:
            try: self.equity = float(value.value)
            except: pass
        elif value.tag == "TotalCashValue" and is_base:
            try: self.cash = float(value.value)
            except: pass
        elif value.tag == "BuyingPower":
            try: self.buying_power = float(value.value)
            except: pass
        elif value.tag == "MaintMarginReq" and is_base:
            try: self.margin_used = float(value.value)
            except: pass

    def _on_position(self, position):
        # Only track stock positions
        if position.contract.secType != "STK":
            return
        sym = position.contract.symbol
        cur = position.contract.currency or "USD"
        pex = position.contract.primaryExchange or ""
        key = f"{sym}:{cur}" if cur != "USD" else sym
        # Remove position if flat
        if abs(position.position) < 0.001:
            self.positions.pop(key, None)
            return
        existing = self.positions.get(key, {})
        self.positions[key] = {
            "symbol": sym, "key": key, "currency": cur,
            "primary_exchange": pex, "con_id": position.contract.conId,
            "shares": position.position, "avg_cost": position.avgCost,
            "account_id": self.config.id,
            "current_price": existing.get("current_price", 0),
            "unrealized_pnl": existing.get("unrealized_pnl", 0),
            "realized_pnl": existing.get("realized_pnl", 0),
        }

    def _on_commission_report(self, trade: Trade, fill, report):
        rpnl = report.realizedPNL if report.realizedPNL != 1.7976931348623157e+308 else 0
        self.audit_db.log_commission({
            "account_id": self.config.id, "account_name": self.config.name,
            "symbol": trade.contract.symbol, "ib_order_id": trade.order.orderId,
            "exec_id": report.execId, "commission": report.commission,
            "currency": report.currency, "realized_pnl": rpnl,
        })
        # Broadcast fill to frontend (catches TWS-placed orders too)
        asyncio.ensure_future(manager.broadcast({
            "type": "order_update",
            "data": {
                "id": f"FILL-{trade.order.orderId}-{fill.execution.execId[:8] if fill and fill.execution else 'x'}",
                "date": datetime.now().strftime("%Y-%m-%d"),
                "time": datetime.now().strftime("%H:%M:%S"),
                "account": self.config.name,
                "symbol": trade.contract.symbol,
                "action": trade.order.action,
                "type": trade.order.orderType,
                "shares": float(fill.execution.shares) if fill and fill.execution else float(trade.order.totalQuantity),
                "price": float(fill.execution.price) if fill and fill.execution else float(trade.orderStatus.avgFillPrice or 0),
                "tif": trade.order.tif,
                "outsideRth": trade.order.outsideRth,
                "status": "FILLED",
                "realizedPnl": rpnl,
                "source": "TWS" if trade.order.orderId > 0 and trade.order.orderId not in self.open_orders else "API",
            },
        }))

    def _on_error(self, reqId, errorCode, errorString, contract):
        # Skip common info messages and known non-errors
        if errorCode in {2104, 2106, 2158, 2119, 2108, 321}:
            if errorCode == 321:
                logger.debug(f"[{self.config.name}] IB 321 (clientId≠0, auto-bind skipped)")
            return
        level = "warning" if errorCode < 1000 else "info"
        if errorCode in {200, 201, 202, 321, 322, 502, 504, 1100, 1101, 1102}:
            level = "critical"
        logger.warning(f"[{self.config.name}] IB Error {errorCode}: {errorString}")
        asyncio.ensure_future(manager.broadcast({
            "type": "alert", "level": level,
            "message": f"[{self.config.name}] IB {errorCode}: {errorString}",
            "account_id": self.config.id,
        }))

    # ─── Order Actions ────────────────────────────────────

    async def place_order(self, contract, order: Order) -> Optional[Trade]:
        try:
            # Qualify contract before placing (fills conId, exchange, etc.)
            qualified = self.ib.qualifyContracts(contract)
            if not qualified:
                logger.error(f"[{self.config.name}] Failed to qualify contract: {contract.symbol}")
                return None
            trade = self.ib.placeOrder(contract, order)
            self.audit_db.log_order({
                "account_id": self.config.id, "account_name": self.config.name,
                "symbol": contract.symbol, "action": order.action,
                "order_type": order.orderType, "shares": float(order.totalQuantity),
                "price": order.lmtPrice or order.auxPrice or 0,
                "notional": float(order.totalQuantity) * (order.lmtPrice or order.auxPrice or 0),
                "tif": order.tif, "outside_rth": order.outsideRth,
                "status": "SUBMITTED", "ib_order_id": trade.order.orderId,
            })
            return trade
        except Exception as e:
            logger.error(f"[{self.config.name}] Place order error: {e}")
            return None

    async def cancel_order(self, order_id: int) -> bool:
        try:
            for trade in self.ib.openTrades():
                if trade.order.orderId == order_id:
                    self.ib.cancelOrder(trade.order)
                    return True
            return False
        except Exception as e:
            logger.error(f"[{self.config.name}] Cancel error: {e}")
            return False

    async def modify_order(self, order_id: int, new_price: float) -> bool:
        try:
            for trade in self.ib.openTrades():
                if trade.order.orderId == order_id:
                    order = trade.order
                    if order.orderType in ("LMT", "MIDPRICE"): order.lmtPrice = new_price
                    elif order.orderType == "STP": order.auxPrice = new_price
                    else:
                        logger.warning(f"[{self.config.name}] Cannot modify {order.orderType} order — no price field")
                        return False
                    self.ib.placeOrder(trade.contract, order)
                    return True
            return False
        except Exception as e:
            logger.error(f"[{self.config.name}] Modify error: {e}")
            return False

    def get_equity(self) -> float:
        if self.config.equity_source == "manual":
            return self.config.manual_equity
        return self.equity

    def _trade_to_dict(self, trade: Trade) -> dict:
        order = trade.order
        status = trade.orderStatus
        filled_qty = float(status.filled) if status else 0
        total_qty = float(order.totalQuantity)
        mapped = self._map_status(status.status if status else "")
        if filled_qty > 0 and filled_qty < total_qty and mapped not in ("FILLED", "CANCELLED"):
            mapped = "PARTIAL"
        return {
            "order_id": order.orderId, "symbol": trade.contract.symbol,
            "action": order.action, "type": order.orderType,
            "shares": total_qty, "filled": filled_qty,
            "remaining": float(status.remaining) if status else total_qty,
            "price": order.lmtPrice or order.auxPrice or 0,
            "avg_fill_price": float(status.avgFillPrice) if status else 0,
            "tif": order.tif, "outside_rth": order.outsideRth,
            "status": mapped, "account_id": self.config.id,
            "account_name": self.config.name,
            "time": datetime.now().strftime("%H:%M:%S"),
            "date": datetime.now().strftime("%Y-%m-%d"),
        }

    @staticmethod
    def _map_status(ib_status: str) -> str:
        return {"Submitted": "SUBMITTED", "PreSubmitted": "SUBMITTED",
                "Filled": "FILLED", "Cancelled": "CANCELLED",
                "Inactive": "CANCELLED", "ApiCancelled": "CANCELLED"}.get(ib_status, "WORKING")

    def to_dict(self) -> dict:
        return {
            "id": self.config.id, "name": self.config.name,
            "host": self.config.host, "port": self.config.port,
            "client_id": self.config.client_id, "enabled": self.config.enabled,
            "connected": self.is_connected(), "equity": self.get_equity(),
            "cash": self.cash, "buying_power": self.buying_power,
            "margin_used": self.margin_used, "equity_source": self.config.equity_source,
            "positions": list(self.positions.values()),
            "open_orders": list(self.open_orders.values()),
        }


# ─── Risk Checks (Non-Blocking Warnings) ─────────────────

def check_risk(symbol: str, action: str, quantity: float, price: float,
               account: IBAccount, risk_cfg: RiskConfig) -> List[RiskWarning]:
    warnings = []
    equity = account.get_equity()
    if equity <= 0 or price <= 0:
        return warnings

    notional = quantity * price

    if notional > risk_cfg.max_order_notional:
        warnings.append(RiskWarning(level="warning",
            message=f"Order notional ${notional:,.0f} exceeds ${risk_cfg.max_order_notional:,.0f}",
            field="notional"))

    existing = 0
    pos = account.positions.get(symbol)
    if pos and pos.get("current_price"):
        existing = abs(pos["shares"]) * pos["current_price"]
    pct = ((existing + notional) / equity) * 100
    if pct > risk_cfg.max_position_pct:
        warnings.append(RiskWarning(level="warning",
            message=f"{symbol} would be {pct:.1f}% of equity (threshold: {risk_cfg.max_position_pct}%)",
            field="concentration"))

    total_exp = sum(abs(p.get("shares", 0)) * (p.get("current_price", 0) or 0)
                    for p in account.positions.values())
    lev = (total_exp + notional) / equity
    if lev > risk_cfg.max_leverage:
        warnings.append(RiskWarning(level="critical",
            message=f"Leverage would be {lev:.2f}x (threshold: {risk_cfg.max_leverage}x)",
            field="leverage"))

    return warnings


def round_shares(shares: float, do_round: bool) -> dict:
    if not do_round:
        return {"shares": round(shares, 2), "rounded": False, "original": shares}
    rounded = math.floor(shares)
    return {"shares": rounded, "rounded": True, "original": round(shares, 4),
            "rounding_diff": round(shares - rounded, 4)}


# ─── WebSocket Manager ───────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.add(ws)

    def disconnect(self, ws: WebSocket):
        self.active_connections.discard(ws)

    async def broadcast(self, msg: dict):
        dead = set()
        for ws in self.active_connections:
            try:
                await ws.send_json(msg)
            except Exception:
                dead.add(ws)
        self.active_connections -= dead


manager = ConnectionManager()

# ─── Globals ──────────────────────────────────────────────

ib_accounts: Dict[int, IBAccount] = {}
audit_db: Optional[AuditDB] = None
market_data = MarketDataManager()
risk_config = RiskConfig()
app_settings = AppSettings()


# ─── Build state from IB API (never from DB) ─────────────

def get_live_state() -> dict:
    """Current state built entirely from IB API connections. DB not consulted."""
    accounts_data = []
    all_positions = {}

    for acct in ib_accounts.values():
        accounts_data.append(acct.to_dict())
        for key, pos in acct.positions.items():
            if key not in all_positions:
                all_positions[key] = {
                    "symbol": pos.get("symbol", key),
                    "key": key,
                    "currency": pos.get("currency", "USD"),
                    "primary_exchange": pos.get("primary_exchange", ""),
                    "accounts": [],
                }
            all_positions[key]["accounts"].append({
                "account_id": acct.config.id,
                "shares": pos.get("shares", 0),
                "avg_cost": pos.get("avg_cost", 0),
                "current_price": pos.get("current_price", 0),
                "unrealized_pnl": pos.get("unrealized_pnl", 0),
                "realized_pnl": pos.get("realized_pnl", 0),
            })

    return {
        "accounts": accounts_data,
        "positions": list(all_positions.values()),
        "quotes": market_data.quotes if market_data.enabled else {},
        "settings": {
            "market_data": {
                "enabled": market_data.enabled,
                "source_account_id": market_data.source_account_id,
            },
            "risk": risk_config.dict(),
        },
        "timestamp": datetime.now().isoformat(),
    }


def build_order_from_req(req, quantity: float) -> Order:
    if req.order_type == "MKT": order = MarketOrder(req.action, quantity)
    elif req.order_type == "LMT":
        price = req.limit_price or req.current_price or 0
        if not price or price <= 0:
            raise ValueError("Limit order requires a price")
        order = LimitOrder(req.action, quantity, price)
    elif req.order_type == "STP":
        price = req.stop_price or 0
        if not price or price <= 0:
            raise ValueError("Stop order requires a price")
        order = StopOrder(req.action, quantity, price)
    elif req.order_type == "MIDPRICE":
        order = Order(action=req.action, totalQuantity=quantity, orderType="MIDPRICE")
        if req.limit_price and req.limit_price > 0:
            order.lmtPrice = req.limit_price
    elif req.order_type == "MOC":
        order = Order(action=req.action, totalQuantity=quantity, orderType="MOC")
    elif req.order_type == "MOO":
        order = Order(action=req.action, totalQuantity=quantity, orderType="MKT")
        order.tif = "OPG"
        order.outsideRth = False
        return order
    else:
        raise ValueError(f"Unknown order type: {req.order_type}")
    order.tif = req.tif
    order.outsideRth = req.outside_rth
    return order


def contract_from_position(pos: dict) -> Stock:
    """Build the correct contract from stored position data.
    Uses conId when available for exact routing — no guessing exchange/currency.
    Falls back to symbol + currency + primaryExchange."""
    con_id = pos.get("con_id")
    sym = pos.get("symbol", "")
    cur = pos.get("currency", "USD")
    pex = pos.get("primary_exchange", "")
    if con_id:
        # conId is unique — IB resolves the exact contract
        c = Stock(sym, "SMART", cur)
        c.conId = con_id
        return c
    # Fallback: use symbol + currency + primaryExchange
    c = Stock(sym, "SMART", cur)
    if pex:
        c.primaryExchange = pex
    return c


# ─── Background Loops ────────────────────────────────────

async def push_state_loop():
    """Push cached state to frontend every 1 second."""
    while True:
        try:
            if manager.active_connections:
                await manager.broadcast({"type": "state", "data": get_live_state()})
        except Exception as e:
            logger.error(f"State push error: {e}")
        await asyncio.sleep(1)


async def force_refresh_loop():
    """Force re-pull all data from IB every 5 seconds.
    This ensures positions, orders, and account values stay fresh
    even if IB event callbacks are delayed (common on paper trading)."""
    while True:
        await asyncio.sleep(5)
        try:
            for acct in ib_accounts.values():
                if acct.is_connected():
                    await acct._refresh_all()
        except Exception as e:
            logger.error(f"Force refresh error: {e}")


async def market_data_loop():
    while True:
        try:
            if market_data.enabled:
                market_data.update_quotes()
        except Exception as e:
            logger.error(f"Market data loop error: {e}")
        await asyncio.sleep(0.5)


# ─── FastAPI App ──────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global audit_db, risk_config, app_settings

    audit_db = AuditDB(DB_PATH)
    config = load_config()

    # Load risk config
    risk_data = config.get("settings", {}).get("risk", config.get("risk", {}))
    if risk_data:
        risk_config = RiskConfig(**risk_data)

    # Load market data config
    md_data = config.get("settings", {}).get("market_data", {})
    if md_data:
        market_data.configure(md_data.get("enabled", False), md_data.get("source_account_id"))

    # Load accounts
    acct_configs = [AccountConfig(**a) for a in config.get("accounts", [])]
    if not acct_configs:
        acct_configs = [AccountConfig(id=1, name="Account 1", host="127.0.0.1", port=7496, client_id=1)]

    for cfg in acct_configs:
        ib_accounts[cfg.id] = IBAccount(cfg, audit_db)
        if cfg.enabled:
            await ib_accounts[cfg.id].connect()

    util.startLoop()
    t1 = asyncio.create_task(push_state_loop())
    t2 = asyncio.create_task(market_data_loop())
    t3 = asyncio.create_task(force_refresh_loop())

    yield

    t1.cancel()
    t2.cancel()
    for acct in ib_accounts.values():
        await acct.disconnect()


app = FastAPI(title="IB Terminal — Porticus Capital", lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# ─── Security: Localhost-Only Enforcement ─────────────────
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

ALLOWED_IPS = {"127.0.0.1", "::1", "localhost"}

class LocalhostOnlyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        if client_ip not in ALLOWED_IPS:
            logger.warning(f"BLOCKED request from {client_ip} to {request.url.path}")
            return JSONResponse(status_code=403, content={"detail": "Access denied. Localhost only."})
        return await call_next(request)

app.add_middleware(LocalhostOnlyMiddleware)


# ─── WebSocket ────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        await ws.send_json({"type": "state", "data": get_live_state()})
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "subscribe_quote" and market_data.enabled:
                await market_data.subscribe(msg["symbol"])
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ─── REST: Live State (from IB API) ──────────────────────

@app.get("/api/state")
async def get_state():
    """Current state from IB API. Never reads DB."""
    return get_live_state()


@app.get("/api/accounts")
async def get_accounts():
    return [a.to_dict() for a in ib_accounts.values()]


@app.post("/api/accounts/{aid}/connect")
async def connect_acct(aid: int):
    acct = ib_accounts.get(aid)
    if not acct: raise HTTPException(404)
    return {"connected": await acct.connect()}


@app.post("/api/accounts/{aid}/disconnect")
async def disconnect_acct(aid: int):
    acct = ib_accounts.get(aid)
    if not acct: raise HTTPException(404)
    await acct.disconnect()
    return {"connected": False}


@app.post("/api/accounts/{aid}/equity")
async def set_equity(aid: int, source: str, manual_value: float = 0):
    acct = ib_accounts.get(aid)
    if not acct: raise HTTPException(404)
    acct.config.equity_source = source
    if source == "manual": acct.config.manual_equity = manual_value
    _save_accounts_to_config()
    return {"equity_source": source, "equity": acct.get_equity()}


class AccountUpdateRequest(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    client_id: Optional[int] = None
    enabled: Optional[bool] = None
    equity_source: Optional[str] = None
    manual_equity: Optional[float] = None


@app.put("/api/accounts/{aid}")
async def update_account(aid: int, req: AccountUpdateRequest):
    """Update account settings from the GUI. Saves to config.json."""
    acct = ib_accounts.get(aid)
    if not acct: raise HTTPException(404)
    if req.name is not None: acct.config.name = req.name
    if req.host is not None: acct.config.host = req.host
    if req.port is not None: acct.config.port = req.port
    if req.client_id is not None: acct.config.client_id = req.client_id
    if req.enabled is not None: acct.config.enabled = req.enabled
    if req.equity_source is not None: acct.config.equity_source = req.equity_source
    if req.manual_equity is not None: acct.config.manual_equity = req.manual_equity
    _save_accounts_to_config()
    return acct.to_dict()


@app.post("/api/accounts/add")
async def add_account(cfg: AccountConfig):
    """Add a new account from the GUI. Saves to config.json."""
    if cfg.id in ib_accounts:
        raise HTTPException(400, "Account ID already exists")
    acct = IBAccount(cfg, audit_db)
    ib_accounts[cfg.id] = acct
    _save_accounts_to_config()
    return acct.to_dict()


@app.delete("/api/accounts/{aid}")
async def remove_account(aid: int):
    """Remove an account. Disconnects first. Saves to config.json."""
    acct = ib_accounts.get(aid)
    if not acct: raise HTTPException(404)
    await acct.disconnect()
    del ib_accounts[aid]
    _save_accounts_to_config()
    return {"removed": aid}


def _save_accounts_to_config():
    """Persist current account configs to config.json."""
    config = load_config()
    config["accounts"] = [
        {
            "id": a.config.id, "name": a.config.name,
            "host": a.config.host, "port": a.config.port,
            "client_id": a.config.client_id, "enabled": a.config.enabled,
            "equity_source": a.config.equity_source,
            "manual_equity": a.config.manual_equity,
        }
        for a in ib_accounts.values()
    ]
    save_config(config)


# ─── REST: Force Refresh ──────────────────────────────────

@app.post("/api/refresh")
async def force_refresh():
    """Force all accounts to re-pull positions, orders, and account data from IB.
    Then push an immediate state update to all WebSocket clients."""
    refreshed = []
    for acct in ib_accounts.values():
        if acct.is_connected():
            try:
                await acct._refresh_all()
                refreshed.append({"account_id": acct.config.id, "name": acct.config.name, "ok": True})
            except Exception as e:
                refreshed.append({"account_id": acct.config.id, "name": acct.config.name, "error": str(e)})
    # Push immediate state to all clients
    if manager.active_connections:
        await manager.broadcast({"type": "state", "data": get_live_state()})
    return {"refreshed": refreshed}


# ─── REST: Settings ───────────────────────────────────────

@app.get("/api/settings")
async def get_settings():
    return {
        "market_data": {
            "enabled": market_data.enabled,
            "source_account_id": market_data.source_account_id,
            "available_accounts": [
                {"id": a.config.id, "name": a.config.name, "connected": a.is_connected()}
                for a in ib_accounts.values()
            ],
        },
        "risk": risk_config.dict(),
    }


@app.post("/api/settings/market-data")
async def update_market_data_settings(enabled: bool, source_account_id: Optional[int] = None):
    """Toggle market data on/off and choose source account."""
    market_data.configure(enabled, source_account_id)
    # Save to config
    config = load_config()
    if "settings" not in config: config["settings"] = {}
    config["settings"]["market_data"] = {"enabled": enabled, "source_account_id": source_account_id}
    save_config(config)
    return {"enabled": enabled, "source_account_id": source_account_id}


@app.post("/api/settings/risk")
async def update_risk_settings(new_config: RiskConfig):
    global risk_config
    risk_config = new_config
    config = load_config()
    if "settings" not in config: config["settings"] = {}
    config["settings"]["risk"] = new_config.dict()
    save_config(config)
    return risk_config.dict()


# ─── REST: Market Data (display only) ────────────────────

@app.get("/api/quote/{symbol}")
async def get_quote(symbol: str):
    sym = symbol.upper()
    # First try portfolio data (always available if connected, no market data sub needed)
    for acct in ib_accounts.values():
        if acct.is_connected():
            pos = acct.positions.get(sym)
            if pos and pos.get("current_price", 0) > 0:
                return {"symbol": sym, "last": pos["current_price"], "source": "portfolio"}
            # Also try compound keys
            for k, p in acct.positions.items():
                if p.get("symbol") == sym and p.get("current_price", 0) > 0:
                    return {"symbol": sym, "last": p["current_price"], "source": "portfolio"}
    # Then try market data subscription
    if market_data.enabled:
        await market_data.subscribe(sym)
        await asyncio.sleep(0.5)
        q = market_data.quotes.get(sym)
        if q:
            return {"symbol": sym, **q, "source": "market_data"}
    # Last resort: try reqMktData snapshot
    for acct in ib_accounts.values():
        if acct.is_connected():
            try:
                contract = Stock(sym, "SMART", "USD")
                acct.ib.qualifyContracts(contract)
                ticker = acct.ib.reqMktData(contract, snapshot=True)
                await asyncio.sleep(1)
                if ticker.last and ticker.last > 0:
                    acct.ib.cancelMktData(contract)
                    return {"symbol": sym, "last": ticker.last, "mid": (ticker.bid + ticker.ask) / 2 if ticker.bid and ticker.ask else 0, "source": "snapshot"}
                elif ticker.close and ticker.close > 0:
                    acct.ib.cancelMktData(contract)
                    return {"symbol": sym, "last": ticker.close, "source": "close"}
                acct.ib.cancelMktData(contract)
            except Exception as e:
                logger.warning(f"Snapshot quote failed for {sym}: {e}")
    return {"symbol": sym, "error": "No price data available"}


@app.get("/api/quotes")
async def get_quotes():
    if not market_data.enabled:
        return {"enabled": False, "quotes": {}}
    return {"enabled": True, "quotes": market_data.quotes}


# ─── REST: Contract Search ────────────────────────────────

@app.get("/api/search/{symbol}")
async def search_contract(symbol: str, sec_type: str = "STK", currency: str = ""):
    """
    Search IB for matching contracts. Returns matches sorted with
    USD/US markets first. If there's a single USD match, it's flagged
    as the recommended default so the frontend can auto-select it.
    """
    US_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "ARCA", "BATS", "IEX", "ISLAND", "BYX",
                    "EDGX", "EDGEA", "LTSE", "MEMX", "PEARL", "PSX", "NYSENAT", "CHX",
                    "DRCTEDGE", "BEX", "FOXRIVER"}

    for acct in ib_accounts.values():
        if not acct.is_connected():
            continue
        try:
            contract = Stock(symbol.upper(), "SMART", currency.upper() if currency else "")
            details = acct.ib.reqContractDetails(contract)
            results = []
            seen = set()
            for d in details:
                c = d.contract
                key = f"{c.symbol}:{c.primaryExchange}:{c.currency}"
                if key in seen:
                    continue
                seen.add(key)
                is_us = c.currency == "USD" and (c.primaryExchange in US_EXCHANGES or not c.primaryExchange)
                results.append({
                    "symbol": c.symbol,
                    "con_id": c.conId,
                    "exchange": c.exchange,
                    "primary_exchange": c.primaryExchange,
                    "currency": c.currency,
                    "sec_type": c.secType,
                    "long_name": d.longName,
                    "industry": d.industry,
                    "category": d.category,
                    "min_tick": d.minTick,
                    "is_us": is_us,
                })

            # Sort: USD first, then US exchanges first, then alphabetical
            results.sort(key=lambda r: (
                0 if r["currency"] == "USD" else 1,
                0 if r["is_us"] else 1,
                r["primary_exchange"] or "ZZZZ",
            ))

            # Flag the recommended default (first USD result)
            usd_results = [r for r in results if r["currency"] == "USD"]
            recommended = usd_results[0] if usd_results else (results[0] if results else None)

            return {
                "symbol": symbol.upper(),
                "results": results,
                "recommended": recommended,
            }
        except Exception as e:
            logger.error(f"Contract search error: {e}")
            return {"symbol": symbol.upper(), "results": [], "error": str(e)}

    return {"symbol": symbol.upper(), "results": [], "error": "No connected accounts"}


# ─── REST: Orders ─────────────────────────────────────────

@app.post("/api/order")
async def place_order_ep(req: OrderRequest):
    results = []
    contract = Stock(req.symbol.upper(), req.exchange, req.currency)
    if req.primary_exchange:
        contract.primaryExchange = req.primary_exchange
    for aid in req.account_ids:
        acct = ib_accounts.get(aid)
        if not acct or not acct.is_connected():
            results.append({"account_id": aid, "error": "Not connected"})
            continue
        si = round_shares(req.quantity, req.round_shares)
        qty = si["shares"]
        if qty <= 0:
            results.append({"account_id": aid, "error": "0 shares after rounding"})
            continue
        price = req.limit_price or req.stop_price or market_data.get_price(req.symbol.upper()) or 0
        warns = check_risk(req.symbol, req.action, qty, price, acct, risk_config)
        order = build_order_from_req(req, qty)
        # If bracket: parent must NOT transmit until children are placed
        if req.bracket and req.profit_target and req.stop_loss:
            order.transmit = False
        trade = await acct.place_order(contract, order)
        if trade:
            r = {"account_id": aid, "order_id": trade.order.orderId, "shares": qty,
                 "status": "SUBMITTED", "rounding": si if si["rounded"] else None,
                 "warnings": [w.dict() for w in warns]}
            if req.bracket and req.profit_target and req.stop_loss:
                tp_a = "SELL" if req.action == "BUY" else "BUY"
                tp = LimitOrder(tp_a, qty, req.profit_target)
                tp.parentId = trade.order.orderId
                tp.transmit = False
                await acct.place_order(contract, tp)
                sl = StopOrder(tp_a, qty, req.stop_loss)
                sl.parentId = trade.order.orderId
                sl.transmit = True  # last child transmits entire bracket
                await acct.place_order(contract, sl)
            results.append(r)
        else:
            results.append({"account_id": aid, "error": "Failed"})
    return {"results": results}


@app.post("/api/order/proportional")
async def place_proportional_ep(req: ProportionalOrderRequest):
    """Frontend provides current_price — no dependency on local market data."""
    results = []
    contract = Stock(req.symbol.upper(), req.exchange, req.currency)
    if req.primary_exchange:
        contract.primaryExchange = req.primary_exchange
    for aid in req.account_ids:
        acct = ib_accounts.get(aid)
        if not acct or not acct.is_connected():
            results.append({"account_id": aid, "error": "Not connected"})
            continue
        equity = acct.get_equity()
        raw = (equity * req.allocation_pct / 100) / req.current_price
        si = round_shares(raw, req.round_shares)
        qty = si["shares"]
        if qty <= 0:
            results.append({"account_id": aid, "error": "0 shares", "raw": raw})
            continue
        price = req.limit_price or req.stop_price or req.current_price
        warns = check_risk(req.symbol, req.action, qty, price, acct, risk_config)
        order = build_order_from_req(req, qty)
        if req.bracket and req.profit_target and req.stop_loss:
            order.transmit = False
        trade = await acct.place_order(contract, order)
        if trade:
            r = {"account_id": aid, "order_id": trade.order.orderId, "shares": qty,
                 "notional": round(qty * req.current_price, 2), "equity": equity,
                 "status": "SUBMITTED", "rounding": si if si["rounded"] else None,
                 "warnings": [w.dict() for w in warns]}
            if req.bracket and req.profit_target and req.stop_loss:
                tp_a = "SELL" if req.action == "BUY" else "BUY"
                tp = LimitOrder(tp_a, qty, req.profit_target)
                tp.parentId = trade.order.orderId
                tp.transmit = False
                await acct.place_order(contract, tp)
                sl = StopOrder(tp_a, qty, req.stop_loss)
                sl.parentId = trade.order.orderId
                sl.transmit = True
                await acct.place_order(contract, sl)
            results.append(r)
        else:
            results.append({"account_id": aid, "error": "Failed"})
    return {"current_price": req.current_price, "results": results}


@app.post("/api/order/{aid}/{oid}/cancel")
async def cancel_ep(aid: int, oid: int):
    acct = ib_accounts.get(aid)
    if not acct: raise HTTPException(404)
    return {"cancelled": await acct.cancel_order(oid)}


@app.post("/api/order/{aid}/{oid}/modify")
async def modify_ep(aid: int, oid: int, req: ModifyOrderRequest):
    acct = ib_accounts.get(aid)
    if not acct: raise HTTPException(404)
    return {"modified": await acct.modify_order(oid, req.new_price)}


@app.post("/api/exit")
async def exit_ep(req: ExitRequest):
    results = []
    targets = req.account_ids or list(ib_accounts.keys())
    for aid in targets:
        acct = ib_accounts.get(aid)
        if not acct or not acct.is_connected(): continue
        # Find position — try exact key first, then symbol match
        pos = None
        for k, p in acct.positions.items():
            if p.get("symbol", "").upper() == req.symbol.upper() or k == req.symbol.upper():
                pos = p
                break
        if not pos or abs(pos["shares"]) < 0.01: continue
        # Build contract from position data — routes to correct exchange/currency
        contract = contract_from_position(pos)
        raw_sh = pos["shares"]
        exit_act = "SELL" if raw_sh > 0 else "BUY"
        working = sum(o["remaining"] for o in acct.open_orders.values()
                      if o["symbol"] == req.symbol.upper() and o["action"] == exit_act
                      and o["status"] in ("WORKING", "SUBMITTED", "PARTIAL"))
        net = abs(raw_sh) - working
        if net <= 0.01:
            results.append({"account_id": aid, "skipped": True, "reason": "Covered"})
            continue
        raw_exit = min(net, abs(raw_sh) * (req.exit_pct / 100))
        si = round_shares(raw_exit, req.round_shares)
        qty = si["shares"]
        if qty <= 0: continue
        if req.order_type == "MIDPRICE":
            order = Order(action=exit_act, totalQuantity=qty, orderType="MIDPRICE")
        else:
            order = MarketOrder(exit_act, qty)
        order.tif = "DAY"
        trade = await acct.place_order(contract, order)
        if trade:
            results.append({"account_id": aid, "order_id": trade.order.orderId,
                            "action": exit_act, "shares": qty, "rounding": si if si["rounded"] else None})
    return {"results": results}


class ClosePositionRequest(BaseModel):
    """Close a specific position on a specific account."""
    symbol: str
    account_id: int
    exit_pct: float = 100.0             # default 100% = full close
    order_type: str = "MIDPRICE"
    round_shares: bool = True


@app.post("/api/close-position")
async def close_single_position(req: ClosePositionRequest):
    """Close a position on ONE specific account. For when one account needs
    to exit but others stay in the position."""
    acct = ib_accounts.get(req.account_id)
    if not acct:
        raise HTTPException(404, "Account not found")
    if not acct.is_connected():
        raise HTTPException(400, "Account not connected")
    # Find position using key or symbol match
    pos = None
    for k, p in acct.positions.items():
        if p.get("symbol", "").upper() == req.symbol.upper() or k == req.symbol.upper():
            pos = p
            break
    if not pos or abs(pos["shares"]) < 0.01:
        raise HTTPException(400, "No position in " + req.symbol.upper())

    raw_sh = pos["shares"]
    exit_act = "SELL" if raw_sh > 0 else "BUY"

    # Calculate net exposure
    working = sum(o["remaining"] for o in acct.open_orders.values()
                  if o["symbol"] == req.symbol.upper() and o["action"] == exit_act
                  and o["status"] in ("WORKING", "SUBMITTED", "PARTIAL"))
    net = abs(raw_sh) - working
    if net <= 0.01:
        return {"skipped": True, "reason": "Position fully covered by working orders"}

    raw_exit = min(net, abs(raw_sh) * (req.exit_pct / 100))
    si = round_shares(raw_exit, req.round_shares)
    qty = si["shares"]
    if qty <= 0:
        return {"skipped": True, "reason": "0 shares after rounding"}

    # Build contract from position data — routes to correct exchange/currency
    contract = contract_from_position(pos)
    if req.order_type == "MIDPRICE":
        order = Order(action=exit_act, totalQuantity=qty, orderType="MIDPRICE")
    else:
        order = MarketOrder(exit_act, qty)
    order.tif = "DAY"

    trade = await acct.place_order(contract, order)
    if trade:
        return {
            "account_id": req.account_id, "account_name": acct.config.name,
            "symbol": req.symbol.upper(), "action": exit_act, "shares": qty,
            "order_id": trade.order.orderId, "status": "SUBMITTED",
            "rounding": si if si["rounded"] else None,
        }
    return {"error": "Order placement failed"}


@app.post("/api/kill")
async def kill_ep():
    cancels, flattens = [], []
    for acct in ib_accounts.values():
        if not acct.is_connected(): continue
        for trade in acct.ib.openTrades():
            try:
                acct.ib.cancelOrder(trade.order)
                cancels.append({"account_id": acct.config.id, "order_id": trade.order.orderId})
            except Exception as e:
                cancels.append({"account_id": acct.config.id, "error": str(e)})
    await asyncio.sleep(0.5)
    for acct in ib_accounts.values():
        if not acct.is_connected(): continue
        await acct._refresh_positions()
        for key, pos in acct.positions.items():
            sh = pos["shares"]
            if abs(sh) < 0.01: continue
            act = "SELL" if sh > 0 else "BUY"
            contract = contract_from_position(pos)
            trade = await acct.place_order(contract, MarketOrder(act, abs(sh)))
            flattens.append({"account_id": acct.config.id, "symbol": pos.get("symbol", key), "shares": abs(sh), "ok": trade is not None})
    return {"cancelled": cancels, "flattened": flattens}


@app.post("/api/cancel-symbol/{symbol}")
async def cancel_symbol_ep(symbol: str):
    results = []
    for acct in ib_accounts.values():
        if not acct.is_connected(): continue
        for trade in acct.ib.openTrades():
            if trade.contract.symbol == symbol.upper():
                try:
                    acct.ib.cancelOrder(trade.order)
                    results.append({"account_id": acct.config.id, "order_id": trade.order.orderId})
                except Exception as e:
                    results.append({"account_id": acct.config.id, "error": str(e)})
    return {"results": results}


# ─── REST: Historical Archive (SQLite) ────────────────────
# ARCHITECTURE NOTE:
# These endpoints serve HISTORICAL data only. The database is an
# append-only write-behind log of events that already happened.
# It is NEVER the source of truth for current state.
#
# Source of truth hierarchy:
#   Current positions → IB API (ib.positions(), positionEvent)
#   Current orders    → IB API (ib.openTrades(), orderStatusEvent)
#   Current equity    → IB API (accountValueEvent)
#   Current P&L       → IB API (pnlSingleEvent)
#   Order history     → SQLite archive (populated by IB events)
#   Commissions       → SQLite archive (from commissionReportEvent)
#
# The frontend loads historical log on startup for display,
# then gets real-time updates via WebSocket from IB events.

@app.get("/api/log")
async def get_log(limit: int = 500, account_id: Optional[int] = None,
                  symbol: Optional[str] = None, date_from: Optional[str] = None,
                  date_to: Optional[str] = None):
    """Historical order log. Populated by IB events, not user input."""
    return audit_db.get_log(limit, account_id, symbol, date_from, date_to)


@app.get("/api/blotter")
async def get_blotter(target_date: Optional[str] = None, account_id: Optional[int] = None):
    return audit_db.get_blotter(target_date, account_id)


@app.get("/api/blotter/csv")
async def get_blotter_csv(target_date: Optional[str] = None):
    blotter = audit_db.get_blotter(target_date)
    hdr = "Date,Time,Account,Symbol,Side,Type,Shares,Filled,Price,AvgFill,Notional,TIF,Status,Commission,RealizedPnL"
    lines = [hdr]
    for o in blotter["orders"]:
        lines.append(",".join([str(o.get(k, "")) for k in
            ["date","time","account_name","symbol","action","order_type","shares","filled",
             "price","avg_fill_price","notional","tif","status","commission","realized_pnl"]]))
    return StreamingResponse(iter(["\n".join(lines)]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=blotter_{blotter['date']}.csv"})


@app.get("/api/commissions")
async def get_commissions(date_from: Optional[str] = None, date_to: Optional[str] = None,
                          account_id: Optional[int] = None):
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    q = "SELECT * FROM commissions WHERE 1=1"
    p = []
    if date_from: q += " AND date >= ?"; p.append(date_from)
    if date_to: q += " AND date <= ?"; p.append(date_to)
    if account_id: q += " AND account_id = ?"; p.append(account_id)
    q += " ORDER BY date DESC LIMIT 500"
    rows = conn.execute(q, p).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/risk/check")
async def risk_check_ep(symbol: str, action: str, quantity: float, price: float, account_id: int):
    acct = ib_accounts.get(account_id)
    if not acct: raise HTTPException(404)
    return {"warnings": [w.dict() for w in check_risk(symbol, action, quantity, price, acct, risk_config)]}


if __name__ == "__main__":
    import uvicorn
    # SECURITY: Bind to 127.0.0.1 only — no external network access
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

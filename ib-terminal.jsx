/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";

// ─── API Configuration ───────────────────────────────────
const DEFAULT_API_URL = "http://localhost:8000";
const DEFAULT_WS_URL = "ws://localhost:8000/ws";

// ─── Sound System ────────────────────────────────────────
// Sound files should be placed in the public/sounds/ folder of the React app
// Supported: .mp3, .wav, .ogg
const SOUND_FILES = {
  fill: "/sounds/fill.mp3",
  partial_fill: "/sounds/partial_fill.mp3",
  disconnect: "/sounds/disconnect.mp3",
  connect: "/sounds/connect.mp3",
  pnl_alert: "/sounds/pnl_alert.mp3",
};

const DEFAULT_SOUND_ENABLED = {
  fill: true,
  partial_fill: true,
  disconnect: true,
  connect: true,
  pnl_alert: true,
};

function useSoundPlayer() {
  const audioRef = useRef({});
  const enabledRef = useRef(DEFAULT_SOUND_ENABLED);

  const preload = useCallback(() => {
    Object.entries(SOUND_FILES).forEach(function(entry) {
      try {
        const audio = new Audio(entry[1]);
        audio.volume = 0.5;
        audio.preload = "auto";
        audioRef.current[entry[0]] = audio;
      } catch (e) {
        // Sound file not found — silent fail
      }
    });
  }, []);

  const play = useCallback(function(soundKey) {
    if (!soundKey) return;
    if (!enabledRef.current[soundKey]) return;
    var audio = audioRef.current[soundKey];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(function() {});
    }
  }, []);

  const setEnabled = useCallback(function(key, value) {
    enabledRef.current[key] = value;
  }, []);

  const setVolume = useCallback(function(vol) {
    Object.values(audioRef.current).forEach(function(a) { a.volume = vol; });
  }, []);

  return { preload: preload, play: play, setEnabled: setEnabled, setVolume: setVolume, enabledRef: enabledRef };
}

// ─── API Helper ──────────────────────────────────────────
// ─── Diagnostics Log ─────────────────────────────────────
// Global array — captures API, WebSocket, IB, and React errors
var _diagLog = [];
var _diagListeners = [];
function addDiag(level, source, message, detail) {
  var entry = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    time: new Date().toLocaleTimeString(),
    date: new Date().toISOString().slice(0, 10),
    level: level, // info, warn, error
    source: source, // API, WS, IB, UI, REACT
    message: message,
    detail: detail || "",
  };
  _diagLog.unshift(entry);
  if (_diagLog.length > 500) _diagLog.length = 500;
  _diagListeners.forEach(function(fn) { fn(_diagLog.slice()); });
}

// Capture global JS errors
if (typeof window !== "undefined") {
  window.onerror = function(msg, src, line, col, err) {
    addDiag("error", "REACT", msg, (src || "") + ":" + (line || "") + ":" + (col || ""));
  };
  window.onunhandledrejection = function(e) {
    addDiag("error", "REACT", "Unhandled promise rejection", e.reason ? e.reason.toString() : "");
  };
}

async function apiCall(method, path, body, apiUrl) {
  try {
    var baseUrl = apiUrl || DEFAULT_API_URL;
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    addDiag("info", "API", method + " " + path, body ? JSON.stringify(body).slice(0, 200) : "");
    var response = await fetch(baseUrl + path, opts);
    if (!response.ok) {
      var errText = await response.text();
      addDiag("error", "API", method + " " + path + " → " + response.status, errText.slice(0, 300));
      return { error: errText };
    }
    return await response.json();
  } catch (err) {
    addDiag("error", "API", method + " " + path + " FAILED", err.message);
    return { error: err.message };
  }
}

// ─── Constants ───────────────────────────────────────────
const ORDER_TYPES = [
  { value: "MKT", label: "Market" },
  { value: "LMT", label: "Limit" },
  { value: "STP", label: "Stop" },
  { value: "MIDPRICE", label: "Midprice" },
  { value: "MOC", label: "MOC" },
  { value: "MOO", label: "MOO" },
];
const TIF_OPTIONS = ["DAY", "GTC"];
const EXIT_PCTS = [25, 50, 75, 100];

// ─── Helpers ─────────────────────────────────────────────
const fmt = (v, cur) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtShares = (v) => Math.abs(v).toFixed(2);

// Currency to country flag emoji
const CURRENCY_FLAGS = {
  USD: "", AUD: "\u{1F1E6}\u{1F1FA}", CAD: "\u{1F1E8}\u{1F1E6}", GBP: "\u{1F1EC}\u{1F1E7}", EUR: "\u{1F1EA}\u{1F1FA}",
  JPY: "\u{1F1EF}\u{1F1F5}", HKD: "\u{1F1ED}\u{1F1F0}", SGD: "\u{1F1F8}\u{1F1EC}", CHF: "\u{1F1E8}\u{1F1ED}", SEK: "\u{1F1F8}\u{1F1EA}",
  NOK: "\u{1F1F3}\u{1F1F4}", DKK: "\u{1F1E9}\u{1F1F0}", NZD: "\u{1F1F3}\u{1F1FF}", ZAR: "\u{1F1FF}\u{1F1E6}", MXN: "\u{1F1F2}\u{1F1FD}",
  INR: "\u{1F1EE}\u{1F1F3}", KRW: "\u{1F1F0}\u{1F1F7}", TWD: "\u{1F1F9}\u{1F1FC}", BRL: "\u{1F1E7}\u{1F1F7}", ILS: "\u{1F1EE}\u{1F1F1}",
};

// ─── Icons ───────────────────────────────────────────────
const Icon = ({ d, size = 14, color = "currentColor", sw = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const PlusIcon = () => <Icon d="M8 3v10M3 8h10" />;
const TrashIcon = () => <Icon d="M3 5h10M6 5V3h4v2M4.5 5l.5 9h6l.5-9" />;
const XIcon = () => <Icon d="M4 4l8 8M12 4l-8 8" />;
const SendIcon = () => <Icon d="M2 8l12-6-6 12V8H2z" size={16} />;
const AlertIcon = () => <Icon d="M8 2L1 14h14L8 2zM8 6v4M8 12h.01" color="#f59e0b" />;
const SkullIcon = () => <Icon d="M8 1a6 6 0 00-6 6c0 2.2 1.2 4.1 3 5.1V14h6v-1.9c1.8-1 3-2.9 3-5.1a6 6 0 00-6-6zM6 9.5a1 1 0 100-2 1 1 0 000 2zM10 9.5a1 1 0 100-2 1 1 0 000 2z" sw={1.3} />;
const EditIcon = () => <Icon d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" />;
const CheckIcon = () => <Icon d="M3 8l3.5 3.5L13 5" sw={2} />;
const SortIcon = ({ dir }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
    {dir === "asc" ? <path d="M5 2v6M2.5 4.5L5 2l2.5 2.5" /> : dir === "desc" ? <path d="M5 2v6M2.5 5.5L5 8l2.5-2.5" /> : [<path key="u" d="M3 3l2-1.5L7 3" opacity="0.4" />, <path key="d" d="M3 7l2 1.5L7 7" opacity="0.4" />]}
  </svg>
);
const WarningBadge = () => <Icon d="M8 2L1 14h14L8 2zM8 6v4M8 12h.01" color="#ef4444" size={12} sw={1.8} />;
const ChevronIcon = ({ open }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
    <path d="M4.5 2.5l3.5 3.5-3.5 3.5" />
  </svg>
);

// ─── Theme ───────────────────────────────────────────────
const C = {
  bg0: "#06080c", bg1: "#0b0e14", bg2: "#10141c", bg3: "#161b27",
  border: "#1b2030", borderHi: "#252d40",
  text: "#b8c0ce", textDim: "#505b6e", textBright: "#e2e7ef",
  blue: "#3b82f6", blueDim: "#1e3a5f",
  green: "#22c55e", greenDim: "#0a2618",
  red: "#ef4444", redDim: "#2a0f0f",
  amber: "#f59e0b", amberDim: "#2a1f0a",
  font: "'IBM Plex Mono', 'JetBrains Mono', 'SF Mono', monospace",
};

// ─── Reusable Components ─────────────────────────────────
function Btn({ children, variant = "default", disabled, small, full, style: extraStyle, ...props }) {
  const base = {
    fontFamily: C.font, fontSize: small ? "10px" : "12px", fontWeight: 600,
    border: "none", borderRadius: "4px", cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex", alignItems: "center", gap: "6px",
    padding: small ? "3px 8px" : "8px 14px", letterSpacing: "0.4px",
    width: full ? "100%" : "auto", justifyContent: full ? "center" : "flex-start",
    opacity: disabled ? 0.35 : 1, transition: "all 0.12s",
  };
  const variants = {
    default: { background: C.bg3, color: C.text, border: `1px solid ${C.border}` },
    primary: { background: `linear-gradient(135deg, #2563eb 0%, #1e40af 100%)`, color: "#fff" },
    danger: { background: `linear-gradient(135deg, #dc2626 0%, #991b1b 100%)`, color: "#fff" },
    kill: { background: `linear-gradient(135deg, #dc2626 0%, #7f1d1d 100%)`, color: "#fff", fontSize: "13px", fontWeight: 800, padding: "10px 20px" },
    ghost: { background: "transparent", color: C.textDim, border: `1px solid transparent` },
  };
  return <button style={{ ...base, ...variants[variant], ...extraStyle }} disabled={disabled} {...props}>{children}</button>;
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: "10px" }}>
      {label && <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "4px" }}>{label}</label>}
      <input style={{ width: "100%", boxSizing: "border-box", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: "4px", color: C.text, padding: "7px 10px", fontSize: "13px", fontFamily: C.font, outline: "none" }} {...props} />
    </div>
  );
}

function Select({ label, options, ...props }) {
  return (
    <div style={{ marginBottom: "10px" }}>
      {label && <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "4px" }}>{label}</label>}
      <select style={{ width: "100%", boxSizing: "border-box", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: "4px", color: C.text, padding: "7px 10px", fontSize: "13px", fontFamily: C.font, outline: "none", appearance: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23505b6e' d='M2 3.5l3 3 3-3'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
      }} {...props}>
        {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
      </select>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", cursor: "pointer" }} onClick={() => onChange(!on)}>
      <div style={{ width: "32px", height: "18px", borderRadius: "9px", background: on ? C.blue : C.border, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
        <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#fff", position: "absolute", top: "3px", left: on ? "17px" : "3px", transition: "left 0.2s" }} />
      </div>
      {label && <span style={{ fontSize: "11px", color: on ? C.text : C.textDim }}>{label}</span>}
    </div>
  );
}

function SectionHead({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
      <span style={{ fontSize: "9px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.8px", color: C.textDim }}>{children}</span>
      {right}
    </div>
  );
}

function Tag({ children, color = "blue" }) {
  const colors = {
    blue: ["#2563eb", "#fff"],
    green: ["#16a34a", "#fff"],
    red: ["#dc2626", "#fff"],
    amber: ["#d97706", "#fff"],
    gray: ["#374151", "#d1d5db"],
  };
  const [bg, fg] = colors[color] || colors.blue;
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "3px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.5px", background: bg, color: fg }}>{children}</span>;
}

function PnlValue({ value, size = "13px" }) {
  const pos = value >= 0;
  return <span style={{ color: pos ? C.green : C.red, fontWeight: 700, fontSize: size }}>{pos ? "+" : ""}{fmt(value)}</span>;
}

function SortTh({ label, field, sortCol, sortDir, onSort }) {
  const active = sortCol === field;
  return (
    <th onClick={() => onSort(field)} style={{
      textAlign: "left", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px",
      color: active ? C.blue : C.textDim, padding: "10px 12px", borderBottom: `1px solid ${C.border}`,
      cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        {label} <SortIcon dir={active ? sortDir : null} />
      </span>
    </th>
  );
}

// ─── Main App ────────────────────────────────────────────
export default function IBTerminal() {
  // Backend connection state — GUI-controlled, no code editing needed
  const [backendConnected, setBackendConnected] = useState(false);
  const [backendUrl, setBackendUrl] = useState(DEFAULT_API_URL);
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  // Always connects to backend — IB API is the single source of truth
  const [accounts, setAccounts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [orderLog, setOrderLog] = useState([]); // loaded from backend /api/log on startup
  const [alerts, setAlerts] = useState([]);
  const [tab, setTab] = useState("positions");

  // Order entry
  const [symbol, setSymbol] = useState("");
  const [action, setAction] = useState("BUY");
  const [orderType, setOrderType] = useState("MIDPRICE");
  const [tif, setTif] = useState("GTC");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [allocPct, setAllocPct] = useState(10);
  const [sizingMode, setSizingMode] = useState("pct");
  const [fixedShares, setFixedShares] = useState("");

  // Contract search
  const [contractResults, setContractResults] = useState([]);
  const [selectedContract, setSelectedContract] = useState(null); // { symbol, primary_exchange, currency, long_name }
  const [contractSearching, setContractSearching] = useState(false);
  const [fixedNotional, setFixedNotional] = useState("");
  const [outsideRth, setOutsideRth] = useState(false);
  const [exchange, setExchange] = useState("SMART");
  const [bracketEnabled, setBracketEnabled] = useState(false);
  const [profitTarget, setProfitTarget] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  // Kill all — checkbox gated
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [killCheckbox, setKillCheckbox] = useState(false);

  // Exit modal (aggregate — all accounts)
  const [exitModal, setExitModal] = useState(null);
  const [customExitPct, setCustomExitPct] = useState("");

  // Per-account exit modal (single account close)
  const [acctExitModal, setAcctExitModal] = useState(null); // { symbol, accountId, accountName, shares, currentPrice }
  const [acctCustomExitPct, setAcctCustomExitPct] = useState("");

  // Order modify
  const [modifyOrder, setModifyOrder] = useState(null);
  const [editingWo, setEditingWo] = useState({}); // { orderId: { price, qty } }
  const [modifyPrice, setModifyPrice] = useState("");

  // Open orders sort
  const [sortCol, setSortCol] = useState("symbol");
  const [sortDir, setSortDir] = useState("asc");

  // Account filter
  const [acctFilter, setAcctFilter] = useState("all");

  // Positions expand/collapse
  const [expandedSymbols, setExpandedSymbols] = useState({});

  // Orders tab
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  // Settings state
  const [marketDataEnabled, setMarketDataEnabled] = useState(false);
  const [marketDataSourceAcct, setMarketDataSourceAcct] = useState("none");
  const [riskMaxLeverage, setRiskMaxLeverage] = useState(3.0);
  const [riskMaxPositionPct, setRiskMaxPositionPct] = useState(25.0);
  const [riskMaxOrderNotional, setRiskMaxOrderNotional] = useState(100000);

  // Sound settings
  const [soundEnabled, setSoundEnabled] = useState(DEFAULT_SOUND_ENABLED);
  const [soundVolume, setSoundVolume] = useState(50);

  // Order routing
  const [orderAcctIds, setOrderAcctIds] = useState(new Set());

  // Sync orderAcctIds when accounts change (auto-select new accounts)
  useEffect(function() {
    if (accounts.length > 0 && orderAcctIds.size === 0) {
      setOrderAcctIds(new Set(accounts.filter(a => a.enabled).map(a => a.id)));
    }
  }, [accounts]);

  // UI state
  const [syncState, setSyncState] = useState("idle");
  const [inlineOrder, setInlineOrder] = useState(null);
  const [posOrderOpen, setPosOrderOpen] = useState(false); // expanded order form on positions page
  const [contextMenu, setContextMenu] = useState(null); // { x, y, symbol, accountId, accountName, shares, currentPrice }
  const [diagLog, setDiagLog] = useState(_diagLog);
  const [diagFilter, setDiagFilter] = useState("all");
  const [diagSourceFilter, setDiagSourceFilter] = useState("all");
  const [posSymbolFilter, setPosSymbolFilter] = useState("");

  // Subscribe to diagnostics updates
  useEffect(function() {
    function onDiag(log) { setDiagLog(log); }
    _diagListeners.push(onDiag);
    return function() { _diagListeners = _diagListeners.filter(function(fn) { return fn !== onDiag; }); };
  }, []);

  // Auto-dismiss alerts after 15 seconds
  useEffect(function() {
    if (alerts.length === 0) return;
    var timer = setInterval(function() {
      var now = Date.now();
      setAlerts(function(prev) { return prev.filter(function(a) { return (now - a.id) < 15000; }); });
    }, 3000);
    return function() { clearInterval(timer); };
  }, [alerts.length]);

  // Sound player
  const sound = useSoundPlayer();

  // ─── WebSocket + Sound Init ────────────────────────────
  useEffect(function() {
    sound.preload();

    // Load historical order log from backend archive on startup
    apiCall("GET", "/api/log?limit=500", null, backendUrl).then(function(res) {
      if (res && !res.error && Array.isArray(res)) {
        setOrderLog(res.map(function(o) {
          return {
            id: "DB-" + o.id, date: o.date, time: o.time,
            account: o.account_name || ("Acct " + o.account_id),
            symbol: o.symbol, action: o.action, type: o.order_type,
            shares: o.shares, filled: o.filled, notional: o.notional,
            price: o.price || o.avg_fill_price, tif: o.tif,
            outsideRth: o.outside_rth, status: o.status,
            realizedPnl: o.realized_pnl, commission: o.commission,
          };
        }));
      }
    });

    var reconnectTimer = null;

    function connectWs() {
      var socket = new WebSocket(wsUrl);

      socket.onopen = function() {
        console.log("[WS] Connected to backend");
        addDiag("info", "WS", "WebSocket connected to backend");
        setBackendConnected(true);
      };

      socket.onmessage = function(event) {
        try {
          var msg = JSON.parse(event.data);

          if (msg.type === "state" && msg.data) {
            // Update accounts from live API
            setAccounts((msg.data.accounts || []).map(function(a) {
              return {
                id: a.id, name: a.name, host: a.host, port: a.port,
                clientId: a.client_id, equity: a.equity, cash: a.cash,
                buyingPower: a.buying_power, marginUsed: a.margin_used,
                enabled: a.enabled, connected: a.connected,
                equitySource: a.equity_source,
              };
            }));
            // Update positions
            setPositions((msg.data.positions || []).map(function(p) {
              return {
                symbol: p.symbol,
                key: p.key || p.symbol,
                currency: p.currency || "USD",
                primary_exchange: p.primary_exchange || "",
                accounts: (p.accounts || []).map(function(a) {
                  return {
                    accountId: a.account_id, shares: a.shares,
                    avgCost: a.avg_cost, currentPrice: a.current_price,
                    unrealizedPnl: a.unrealized_pnl || 0,
                    realizedPnl: a.realized_pnl || 0,
                  };
                }),
              };
            }));
            // Update open orders
            var allOrders = [];
            (msg.data.accounts || []).forEach(function(a) {
              (a.open_orders || []).forEach(function(o) {
                allOrders.push({
                  id: "ORD-" + o.order_id, symbol: o.symbol, action: o.action,
                  type: o.type, shares: o.shares, filled: o.filled || 0,
                  price: o.price, tif: o.tif, account: a.name, accountId: a.id,
                  status: o.filled > 0 && o.filled < o.shares ? "PARTIAL" : o.status,
                  time: o.time, date: o.date, outsideRth: o.outside_rth,
                });
              });
            });
            setOpenOrders(allOrders);

            // Update settings from backend state
            if (msg.data.settings) {
              var md = msg.data.settings.market_data;
              if (md) {
                setMarketDataEnabled(md.enabled || false);
                setMarketDataSourceAcct(md.source_account_id || "none");
              }
              var risk = msg.data.settings.risk;
              if (risk) {
                setRiskMaxLeverage(risk.max_leverage || 3.0);
                setRiskMaxPositionPct(risk.max_position_pct || 25.0);
                setRiskMaxOrderNotional(risk.max_order_notional || 100000);
              }
            }
          }

          if (msg.type === "order_update") {
            sound.play(msg.sound);
            // When an order reaches terminal state (FILLED/CANCELLED), add to log
            var o = msg.order;
            if (o && (o.status === "FILLED" || o.status === "CANCELLED")) {
              setOrderLog(function(prev) {
                // Avoid duplicates — check if we already have this order
                var exists = prev.some(function(l) { return l.id === "WS-" + o.order_id + "-" + msg.account_id; });
                if (exists) return prev;
                return [{
                  id: "WS-" + o.order_id + "-" + msg.account_id,
                  date: o.date || new Date().toISOString().slice(0,10),
                  time: o.time || new Date().toLocaleTimeString(),
                  account: msg.account_name || ("Acct " + msg.account_id),
                  symbol: o.symbol, action: o.action, type: o.type,
                  shares: o.shares, filled: o.filled,
                  notional: o.shares * (o.avg_fill_price || o.price || 0),
                  price: o.avg_fill_price || o.price,
                  tif: o.tif, outsideRth: o.outside_rth,
                  status: o.status, realizedPnl: 0,
                }].concat(prev);
              });
            }
          }

          if (msg.type === "alert") {
            addDiag(msg.level === "critical" ? "error" : "warn", "IB", msg.message, "account_id: " + msg.account_id);
            sound.play(msg.sound);
            setAlerts(function(prev) {
              // Deduplicate: skip if same message exists within last 5 seconds
              var isDupe = prev.some(function(a) { return a.message === msg.message && (Date.now() - a.id) < 5000; });
              if (isDupe) return prev;
              return [{ id: Date.now(), level: msg.level, message: msg.message, time: new Date().toLocaleTimeString() }].concat(prev).slice(0, 20);
            });
          }
        } catch (e) {
          console.error("[WS] Parse error:", e);
          addDiag("error", "WS", "WebSocket parse error", e.message || e.toString());
        }
      };

      socket.onclose = function() {
        console.log("[WS] Disconnected, reconnecting in 3s...");
        addDiag("warn", "WS", "WebSocket disconnected, reconnecting in 3s");
        setBackendConnected(false);
        reconnectTimer = setTimeout(connectWs, 3000);
      };

      socket.onerror = function(err) {
        console.error("[WS] Error:", err);
        addDiag("error", "WS", "WebSocket error", err.type || "connection error");
        socket.close();
      };

      return socket;
    }

    var ws = connectWs();
    return function() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [wsUrl, backendUrl]);

  const enabledAccounts = accounts.filter(a => a.enabled);
  const acctMap = Object.fromEntries(accounts.map(a => [a.id, a]));
  const needsLimit = orderType === "LMT";
  const needsStop = orderType === "STP";

  // API wrapper — always uses current backendUrl
  const api = useCallback(function(method, path, body) {
    return apiCall(method, path, body, backendUrl);
  }, [backendUrl]);

  // ═══════════════════════════════════════════════════════
  // NET EXPOSURE ENGINE
  // Calculates effective position = raw shares - shares already
  // covered by working orders. Prevents over-selling / accidental
  // position flips on exits, kill-all, and partial closes.
  // ═══════════════════════════════════════════════════════
  const workingOrdersByAcctSymbol = useMemo(() => {
    const map = {};
    openOrders.forEach(o => {
      const key = `${o.symbol}:${o.accountId}`;
      if (!map[key]) map[key] = { buyShares: 0, sellShares: 0 };
      if (o.action === "BUY") map[key].buyShares += o.shares;
      else map[key].sellShares += o.shares;
    });
    return map;
  }, [openOrders]);

  const getNetExposure = useCallback((sym, accountId, rawShares) => {
    const key = `${sym}:${accountId}`;
    const w = workingOrdersByAcctSymbol[key] || { buyShares: 0, sellShares: 0 };
    if (rawShares > 0) return Math.max(0, rawShares - w.sellShares);
    if (rawShares < 0) return Math.min(0, rawShares + w.buyShares);
    return 0;
  }, [workingOrdersByAcctSymbol]);

  // ═══════════════════════════════════════════════════════
  // STOP ORDER INTELLIGENCE
  // ═══════════════════════════════════════════════════════
  const symbolPositionMap = useMemo(() => {
    const map = {};
    positions.forEach(p => {
      const byAcct = {};
      p.accounts.forEach(a => { byAcct[a.accountId] = a.shares; });
      map[p.symbol] = byAcct;
    });
    return map;
  }, [positions]);

  const getAcctPosition = useCallback((sym, accountId) => {
    const posMap = symbolPositionMap[sym?.toUpperCase()];
    if (!posMap) return { shares: 0, direction: "FLAT" };
    const shares = posMap[accountId] || 0;
    return { shares, direction: shares > 0 ? "LONG" : shares < 0 ? "SHORT" : "FLAT" };
  }, [symbolPositionMap]);

  const getStopAction = useCallback((sym, accountId) => {
    const { direction } = getAcctPosition(sym, accountId);
    if (direction === "LONG") return "SELL";
    if (direction === "SHORT") return "BUY";
    return action;
  }, [getAcctPosition, action]);

  const stopContext = useMemo(() => {
    if (!needsStop || !symbol) return null;
    let longs = 0, shorts = 0, flats = 0;
    enabledAccounts.forEach(acct => {
      const { direction } = getAcctPosition(symbol, acct.id);
      if (direction === "LONG") longs++;
      else if (direction === "SHORT") shorts++;
      else flats++;
    });
    return { longs, shorts, flats };
  }, [needsStop, symbol, enabledAccounts, symbolPositionMap]);

  // ═══════════════════════════════════════════════════════
  // DUPLICATE ORDER DETECTION
  // ═══════════════════════════════════════════════════════
  const duplicateWarning = useMemo(() => {
    if (!symbol || !orderType) return null;
    const dupes = openOrders.filter(o => o.symbol === symbol.toUpperCase() && o.type === orderType);
    if (dupes.length === 0) return null;
    return `${dupes.length} existing ${orderType} order${dupes.length > 1 ? "s" : ""} for ${symbol.toUpperCase()} already working. Submitting creates additional orders.`;
  }, [symbol, orderType, openOrders]);

  // ═══════════════════════════════════════════════════════
  // COMPUTED ORDER PREVIEW
  // ═══════════════════════════════════════════════════════
  // Accounts selected for new order routing
  const orderRoutingAccounts = useMemo(() => {
    return enabledAccounts.filter(a => orderAcctIds.has(a.id));
  }, [enabledAccounts, orderAcctIds]);

  const computedOrders = useMemo(() => {
    const price = parseFloat(currentPrice);
    if (!symbol || !price || price <= 0) return [];
    return orderRoutingAccounts.map(acct => {
      let shares = 0, notional = 0;
      if (sizingMode === "pct") { notional = acct.equity * (allocPct / 100); shares = notional / price; }
      else if (sizingMode === "fixed_shares") { shares = parseFloat(fixedShares) || 0; notional = shares * price; }
      else { notional = parseFloat(fixedNotional) || 0; shares = notional / price; }
      const effectiveAction = needsStop ? getStopAction(symbol, acct.id) : action;
      const { direction } = getAcctPosition(symbol, acct.id);
      return {
        accountId: acct.id, accountName: acct.name, equity: acct.equity,
        shares: Math.round(shares * 100) / 100, notional: Math.round(notional * 100) / 100,
        pctEq: acct.equity > 0 ? (notional / acct.equity * 100).toFixed(1) : "0",
        effectiveAction, posDirection: direction,
      };
    });
  }, [orderRoutingAccounts, symbol, currentPrice, allocPct, sizingMode, fixedShares, fixedNotional, action, needsStop, symbolPositionMap]);

  // Aggregate positions with net exposure
  const aggPositions = useMemo(() => positions.map(p => {
    const totalShares = p.accounts.reduce((s, a) => s + a.shares, 0);
    const totalCost = p.accounts.reduce((s, a) => s + a.shares * a.avgCost, 0);
    const avgCost = totalShares !== 0 ? totalCost / totalShares : 0;
    const curPrice = p.accounts[0]?.currentPrice || 0;
    const totalUnrealized = p.accounts.reduce((s, a) => s + (a.unrealizedPnl || 0), 0);
    const totalRealized = p.accounts.reduce((s, a) => s + (a.realizedPnl || 0), 0);
    const totalNotional = totalShares * curPrice;
    const totalNetExposure = p.accounts.reduce((s, a) => s + getNetExposure(p.symbol, a.accountId, a.shares), 0);
    return { ...p, totalShares, avgCost, curPrice, totalUnrealized, totalRealized, totalPnl: totalUnrealized, totalNotional, totalNetExposure };
  }).filter(p => Math.abs(p.totalShares) > 0.001), [positions, workingOrdersByAcctSymbol]);

  const totalUnrealizedPnl = aggPositions.reduce((s, p) => s + p.totalUnrealized, 0);
  const totalRealizedPnl = aggPositions.reduce((s, p) => s + p.totalRealized, 0);
  const totalEquity = enabledAccounts.reduce((s, a) => s + a.equity, 0);

  // ─── Account-filtered views ───
  const filterAcctId = acctFilter === "all" ? null : parseInt(acctFilter);

  const filteredPositions = useMemo(() => {
    if (!filterAcctId) return aggPositions;
    return aggPositions
      .map(p => {
        const filteredAccts = p.accounts.filter(a => a.accountId === filterAcctId);
        if (filteredAccts.length === 0) return null;
        const totalShares = filteredAccts.reduce((s, a) => s + a.shares, 0);
        const totalCost = filteredAccts.reduce((s, a) => s + a.shares * a.avgCost, 0);
        const avgCost = totalShares !== 0 ? totalCost / totalShares : 0;
        const curPrice = filteredAccts[0]?.currentPrice || 0;
        const totalUnrealized = filteredAccts.reduce((s, a) => s + (a.unrealizedPnl || 0), 0);
        const totalRealized = filteredAccts.reduce((s, a) => s + (a.realizedPnl || 0), 0);
        const totalNotional = totalShares * curPrice;
        const totalNetExposure = filteredAccts.reduce((s, a) => s + getNetExposure(p.symbol, a.accountId, a.shares), 0);
        return { ...p, accounts: filteredAccts, totalShares, avgCost, curPrice, totalUnrealized, totalRealized, totalPnl: totalUnrealized, totalNotional, totalNetExposure };
      })
      .filter(Boolean);
  }, [aggPositions, filterAcctId]);

  // Sort logic
  const handleSort = (field) => {
    if (sortCol === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(field); setSortDir("asc"); }
  };

  // ═══════════════════════════════════════════════════════
  // ACTIONS — all wired to API when live=true
  // ═══════════════════════════════════════════════════════

  const submitOrders = async () => {
      var res = await api("POST", "/api/order/proportional", {
        symbol: symbol.toUpperCase(), action: action, order_type: orderType,
        allocation_pct: allocPct, current_price: parseFloat(currentPrice),
        limit_price: orderType === "LMT" ? parseFloat(limitPrice) : null,
        stop_price: needsStop ? parseFloat(stopPrice) : null,
        tif: tif, outside_rth: outsideRth, exchange: exchange,
        currency: selectedContract ? selectedContract.currency : "USD",
        primary_exchange: selectedContract ? selectedContract.primary_exchange : "",
        account_ids: Array.from(orderAcctIds),
        bracket: bracketEnabled,
        profit_target: bracketEnabled ? parseFloat(profitTarget) : null,
        stop_loss: bracketEnabled ? parseFloat(stopLoss) : null,
      });
      console.log("Order result:", res);
      // State updates come via WebSocket
    setShowConfirm(false);
  };

  const executeExit = async (sym, pct) => {
      var res = await api("POST", "/api/exit", {
        symbol: sym, exit_pct: pct, order_type: "MIDPRICE",
      });
      console.log("Exit result:", res);
    setExitModal(null);
  };

  const killAll = async () => {
      var res = await api("POST", "/api/kill");
      console.log("Kill result:", res);
    setShowKillConfirm(false);
    setKillCheckbox(false);
  };

  const cancelOrder = async (orderId) => {
      var order = openOrders.find(o => o.id === orderId);
      if (order) {
        var realId = orderId.toString().replace("ORD-", "");
        await api("POST", "/api/order/" + order.accountId + "/" + realId + "/cancel");
      }
  };

  const cancelSymbolOrders = async (sym) => {
      await api("POST", "/api/cancel-symbol/" + sym);
  };

  const modifyOrderPrice = async () => {
    if (!modifyOrder || !modifyPrice) return;
      var realId = modifyOrder.id.toString().replace("ORD-", "");
      await api("POST", "/api/order/" + modifyOrder.accountId + "/" + realId + "/modify", {
        new_price: parseFloat(modifyPrice),
      });
    setModifyOrder(null); setModifyPrice("");
  };

  // ─── Account actions (wired to API) ────────────────────
  const [acctFeedback, setAcctFeedback] = useState({}); // { acctId: "msg" }

  const connectAccount = async (acctId) => {
    setAcctFeedback(function(p) { var n = Object.assign({}, p); n[acctId] = "Connecting..."; return n; });
    await api("POST", "/api/accounts/" + acctId + "/connect");
    // Clear after 4 seconds — by then the WebSocket state push will show real status
    setTimeout(function() { setAcctFeedback(function(p) { var n = Object.assign({}, p); delete n[acctId]; return n; }); }, 4000);
  };

  const updateAccount = async (acctId, updates) => {
    await api("PUT", "/api/accounts/" + acctId, updates);
    setAccounts(accounts.map(a => a.id === acctId ? { ...a, ...updates } : a));
    setAcctFeedback(function(p) { var n = Object.assign({}, p); n[acctId] = "Saved ✓"; return n; });
    setTimeout(function() { setAcctFeedback(function(p) { var n = Object.assign({}, p); delete n[acctId]; return n; }); }, 1500);
  };

  const deleteAccount = async (acctId) => {
    await api("DELETE", "/api/accounts/" + acctId);
    setAccounts(accounts.filter(a => a.id !== acctId));
  };

  const addAccount = async () => {
    var nid = Math.max(0, ...accounts.map(a => a.id)) + 1;
    var newAcct = { id: nid, name: "Account-" + nid, host: "127.0.0.1", port: 7496 + nid - 1, clientId: nid, equity: 0, cash: 0, buyingPower: 0, marginUsed: 0, enabled: true, connected: false };
    await api("POST", "/api/accounts/add", {
      id: nid, name: newAcct.name, host: newAcct.host, port: newAcct.port,
      client_id: newAcct.clientId, enabled: true, equity_source: "api", manual_equity: 0,
    });
    setAccounts(function(prev) { return prev.concat([newAcct]); });
  };

  // ─── Settings actions (wired to API) ───────────────────
  const saveMarketDataSettings = async (enabled, sourceId) => {
    setMarketDataEnabled(enabled);
    setMarketDataSourceAcct(sourceId);
    await api("POST", "/api/settings/market-data?enabled=" + enabled + "&source_account_id=" + (sourceId === "none" ? "" : sourceId));
  };

  const saveRiskSettings = async () => {
    await api("POST", "/api/settings/risk", {
      max_leverage: riskMaxLeverage,
      max_position_pct: riskMaxPositionPct,
      max_order_notional: riskMaxOrderNotional,
    });
  };

  // Close position on a SINGLE account at a given percentage
  const closeAccountPosition = async (sym, accountId, pct) => {
    await api("POST", "/api/close-position", {
      symbol: sym, account_id: accountId, exit_pct: pct, order_type: "MIDPRICE",
    });
    setAcctExitModal(null);
  };

  // Search IB for contract matches when symbol is entered
  const searchContract = async (sym) => {
    if (!sym || sym.length < 1) {
      setContractResults([]);
      setSelectedContract(null);
      return;
    }
    setContractSearching(true);
    var res = await api("GET", "/api/search/" + sym.toUpperCase());
    setContractSearching(false);
    if (res && res.results && res.results.length > 0) {
      if (res.recommended) {
        setSelectedContract(res.recommended);
      }
      if (res.results.length > 1) {
        setContractResults(res.results);
      } else {
        setContractResults([]);
      }
    } else {
      setContractResults([]);
      setSelectedContract(null);
    }
    // Auto-fill price from existing position or quote
    var existingPos = positions.find(function(p) { return p.symbol === sym.toUpperCase(); });
    if (existingPos && existingPos.accounts[0] && existingPos.accounts[0].currentPrice > 0) {
      setCurrentPrice(existingPos.accounts[0].currentPrice.toString());
    } else {
      // Try to get last price from quote API
      var quote = await api("GET", "/api/quote/" + sym.toUpperCase());
      if (quote && quote.last && quote.last > 0) {
        setCurrentPrice(quote.last.toString());
      } else if (quote && quote.mid && quote.mid > 0) {
        setCurrentPrice(quote.mid.toString());
      }
    }
  };

  const selectContract = function(c) {
    setSelectedContract(c);
    setContractResults([]);
    setSymbol(c.symbol);
  };

  const priceNotNeeded = ["MKT", "MOC", "MOO"].includes(orderType) && sizingMode === "fixed_shares";
  const canSubmit = symbol && (priceNotNeeded || parseFloat(currentPrice) > 0) && computedOrders.length > 0 && computedOrders.some(o => o.shares > 0);

  const tabs = [
    { key: "positions", label: "POSITIONS", count: aggPositions.length },
    { key: "entry", label: "NEW ORDER" },
    { key: "orders", label: "ORDERS", count: openOrders.length + orderLog.filter(function(l) { return l.status === "FILLED" || l.status === "CANCELLED"; }).length },
    { key: "accounts", label: "ACCOUNTS", count: accounts.length },
    { key: "log", label: "TRADING LOG", count: orderLog.length },
    { key: "settings", label: "SETTINGS" },
    { key: "diag", label: "DIAGNOSTICS", count: diagLog.filter(function(d) { return d.level === "error"; }).length || undefined },
  ];

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: C.bg0, color: C.text, fontFamily: C.font, fontSize: "13px", lineHeight: 1.5 }} onClick={function() { if (contextMenu) setContextMenu(null); }}>

      {/* ─── TOP BAR ─── */}
      <div style={{ background: C.bg1, borderBottom: `1px solid ${C.border}`, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: "48px", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", fontWeight: 800, color: C.textBright, letterSpacing: "0.8px" }}>IB TERMINAL — PORTICUS CAPITAL</span>
          {/* Connection status dots */}
          <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
            {accounts.filter(a => a.enabled).map(a => (
              <div key={a.id} title={a.name + (a.connected ? " — Connected" : " — Disconnected")} style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: a.connected ? C.green : C.red,
                boxShadow: a.connected ? ("0 0 6px " + C.green + "55") : ("0 0 6px " + C.red + "55"),
                cursor: "pointer",
              }} />
            ))}
          </div>
          <span style={{ fontSize: "10px", color: C.textDim }}>
            {accounts.filter(a => a.enabled && a.connected).length}/{accounts.filter(a => a.enabled).length} connected
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: backendConnected ? (marketDataEnabled ? C.green : C.amber) : C.red }} />
            <span style={{ fontSize: "9px", color: C.textDim }}>
              {!backendConnected ? "No Data" : marketDataEnabled ? "Live Data" : "Delayed"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "10px", color: C.textDim }}>EQUITY </span>
            <span style={{ fontSize: "14px", fontWeight: 700, color: C.textBright }}>{fmt(totalEquity)}</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "10px", color: C.textDim }}>TOTAL P&L </span>
            <PnlValue value={totalUnrealizedPnl + totalRealizedPnl} size="14px" />
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "10px", color: C.textDim }}>UNREAL </span>
            <PnlValue value={totalUnrealizedPnl} size="14px" />
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "10px", color: C.textDim }}>REAL </span>
            <PnlValue value={totalRealizedPnl} size="14px" />
          </div>
          <Btn small variant="default" onClick={async function() {
            setSyncState("syncing");
            var res = await api("POST", "/api/refresh");
            if (res && !res.error) { setSyncState("done"); } else { setSyncState("error"); }
            setTimeout(function() { setSyncState("idle"); }, 2000);
          }} title="Force refresh all data from IB" style={{ padding: "4px 8px", fontSize: "10px" }}>
            {syncState === "syncing" ? "⟳ ..." : syncState === "done" ? "✓ OK" : syncState === "error" ? "✕ ERR" : "↻ SYNC"}
          </Btn>
          <div style={{ width: "1px", height: "28px", background: C.border }} />

          {/* KILL ALL — checkbox gated */}
          {!showKillConfirm ? (
            <Btn variant="kill" onClick={() => { setShowKillConfirm(true); setKillCheckbox(false); }}><SkullIcon /> KILL ALL</Btn>
          ) : (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", background: C.redDim, border: `1px solid ${C.red}40`, borderRadius: "6px", padding: "8px 14px" }}>
              <div>
                <div style={{ fontSize: "10px", color: C.red, fontWeight: 800, letterSpacing: "0.5px", animation: "pulse 1s infinite", marginBottom: "4px" }}>
                  CANCEL {openOrders.length} ORDERS + FLATTEN {aggPositions.length} POSITIONS
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }} onClick={() => setKillCheckbox(!killCheckbox)}>
                  <div style={{
                    width: "14px", height: "14px", borderRadius: "3px", flexShrink: 0,
                    border: killCheckbox ? "none" : `2px solid ${C.red}`,
                    background: killCheckbox ? C.red : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {killCheckbox && <CheckIcon />}
                  </div>
                  <span style={{ fontSize: "10px", color: C.text }}>I confirm: flatten everything and cancel all orders</span>
                </div>
              </div>
              <Btn variant="kill" disabled={!killCheckbox} onClick={killAll} style={{ whiteSpace: "nowrap" }}>EXECUTE KILL</Btn>
              <Btn variant="default" small onClick={() => { setShowKillConfirm(false); setKillCheckbox(false); }}>No</Btn>
            </div>
          )}
        </div>
      </div>

      {/* ─── TAB BAR ─── */}
      <div style={{ background: C.bg1, borderBottom: `1px solid ${C.border}`, padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex" }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: "10px 18px", background: tab === t.key ? C.bg2 : "transparent",
              border: "none", borderBottom: tab === t.key ? `2px solid ${C.blue}` : "2px solid transparent",
              color: tab === t.key ? C.textBright : C.textDim, fontSize: "11px", fontWeight: 700,
              fontFamily: C.font, cursor: "pointer", letterSpacing: "0.8px", display: "flex", alignItems: "center", gap: "6px",
            }}>
              {t.label}
              {t.count !== undefined && <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "8px", background: tab === t.key ? "#ffffff18" : "#ffffff0a", color: tab === t.key ? C.textBright : C.textDim, fontWeight: 600 }}>{t.count}</span>}
            </button>
          ))}
        </div>
        {(tab === "positions" || tab === "orders" || tab === "log") && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim }}>Filter</span>
          <select
            value={acctFilter}
            onChange={e => setAcctFilter(e.target.value)}
            style={{
              background: C.bg0, border: `1px solid ${acctFilter !== "all" ? C.blue : C.border}`,
              borderRadius: "4px", color: acctFilter !== "all" ? C.blue : C.text,
              padding: "5px 24px 5px 8px", fontSize: "11px", fontFamily: C.font, fontWeight: 600,
              outline: "none", appearance: "none", cursor: "pointer",
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23505b6e' d='M2 3.5l3 3 3-3'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center",
            }}
          >
            <option value="all">All Accounts</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        )}
      </div>

      <div style={{ padding: "20px" }}>

        {/* ═══════════ POSITIONS ═══════════ */}
        {tab === "positions" && (
          <div>
            <SectionHead right={
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "11px", color: C.textDim }}>{filteredPositions.length} symbols{filterAcctId ? (" · " + (acctMap[filterAcctId]?.name || "")) : (" · " + enabledAccounts.length + " accounts")}</span>
                <Btn small variant="default" onClick={() => {
                  const allExpanded = filteredPositions.every(p => expandedSymbols[p.symbol]);
                  const next = {};
                  filteredPositions.forEach(p => { next[p.symbol] = !allExpanded; });
                  setExpandedSymbols(prev => ({ ...prev, ...next }));
                }}>{filteredPositions.every(p => expandedSymbols[p.symbol]) ? "Collapse All" : "Expand All"}</Btn>
              </div>
            }>Positions</SectionHead>

            {/* ─── NEW ORDER BUTTON (compact, centered) ─── */}
            <div style={{ textAlign: "center", marginBottom: posOrderOpen ? "0" : "16px" }}>
              <button onClick={function() { setPosOrderOpen(!posOrderOpen); }} style={{
                padding: "6px 20px", fontSize: "11px", fontWeight: 700, letterSpacing: "0.8px",
                background: posOrderOpen ? C.bg3 : C.blue, color: posOrderOpen ? C.textDim : "#fff",
                border: "1px solid " + (posOrderOpen ? C.border : C.blue), borderRadius: "4px",
                cursor: "pointer", fontFamily: C.font,
              }}>
                {posOrderOpen ? "✕ CLOSE" : "＋ NEW ORDER"}
              </button>
            </div>
            {posOrderOpen && (
              <div style={{ background: C.bg2, border: "1px solid " + C.blue + "30", borderRadius: "6px", padding: "14px", marginBottom: "16px" }}>
                {/* Row 1: Symbol + Side + Quick % buttons */}
                <div style={{ display: "flex", gap: "8px", alignItems: "end", marginBottom: "10px", flexWrap: "wrap" }}>
                  <div style={{ width: "120px" }}>
                    <Input label="Symbol" placeholder="NVDA" value={symbol} onChange={function(e) {
                      var s = e.target.value.toUpperCase(); setSymbol(s); setSelectedContract(null);
                      var ep = positions.find(function(p) { return p.symbol === s; });
                      if (ep && ep.accounts[0] && ep.accounts[0].currentPrice > 0) setCurrentPrice(ep.accounts[0].currentPrice.toString());
                    }} onKeyDown={function(e) { if (e.key === "Enter" && symbol) { e.preventDefault(); searchContract(symbol); } }} />
                  </div>
                  <div style={{ width: "100px" }}>
                    <label style={{ fontSize: "8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, display: "block", marginBottom: "3px" }}>Side</label>
                    <div style={{ display: "flex", gap: "2px" }}>
                      {["BUY", "SELL"].map(function(a) {
                        return <button key={a} onClick={function() { setAction(a); }} style={{
                          flex: 1, padding: "6px 0", borderRadius: "3px", border: "none", fontFamily: C.font,
                          background: action === a ? (a === "BUY" ? "#166534" : "#991b1b") : C.bg3,
                          color: action === a ? "#fff" : C.textDim, fontSize: "10px", fontWeight: 700, cursor: "pointer",
                        }}>{a}</button>;
                      })}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <label style={{ fontSize: "8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, display: "block", marginBottom: "3px" }}>Quick Size (% Equity per Account)</label>
                    <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", alignItems: "center" }}>
                      {[1, 2, 3, 4, 5, 10, 15, 20, 25].map(function(pct) {
                        var isActive = sizingMode === "pct" && allocPct === pct;
                        return <button key={pct} onClick={function() { setSizingMode("pct"); setAllocPct(pct); }} style={{
                          padding: "8px 12px", borderRadius: "4px", border: isActive ? "1px solid " + C.blue : "1px solid " + C.border,
                          background: isActive ? C.blue : C.bg0, color: isActive ? "#fff" : C.textDim,
                          fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: C.font,
                        }}>{pct}%</button>;
                      })}
                      <input type="number" min="0.1" max="100" step="0.1" value={sizingMode === "pct" ? allocPct : ""} placeholder="%"
                        onChange={function(e) { setSizingMode("pct"); setAllocPct(parseFloat(e.target.value) || 0); }}
                        style={{ width: "50px", background: C.bg0, border: "1px solid " + C.border, borderRadius: "4px", color: C.textBright, padding: "8px 4px", fontSize: "12px", fontWeight: 700, fontFamily: C.font, textAlign: "center" }} />
                    </div>
                  </div>
                </div>
                {/* Row 2: Order type + Price + Sizing + TIF */}
                <div style={{ display: "flex", gap: "8px", alignItems: "end", marginBottom: "10px", flexWrap: "wrap" }}>
                  <div style={{ width: "100px" }}>
                    <Select label="Type" options={ORDER_TYPES} value={orderType} onChange={function(e) { setOrderType(e.target.value); }} />
                  </div>
                  {orderType === "LMT" && (
                    <div style={{ width: "100px" }}><Input label="Limit Price" type="number" step="0.01" value={limitPrice} onChange={function(e) { setLimitPrice(e.target.value); }} /></div>
                  )}
                  {orderType === "STP" && (
                    <div style={{ width: "100px" }}><Input label="Stop Price" type="number" step="0.01" value={stopPrice} onChange={function(e) { setStopPrice(e.target.value); }} /></div>
                  )}
                  <div style={{ width: "90px" }}>
                    <label style={{ fontSize: "8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, display: "block", marginBottom: "3px" }}>Sizing</label>
                    <div style={{ display: "flex", gap: "2px" }}>
                      {[{ k: "pct", l: "%" }, { k: "fixed_shares", l: "#" }, { k: "fixed_notional", l: "$" }].map(function(m) {
                        return <button key={m.k} onClick={function() { setSizingMode(m.k); }} style={{
                          flex: 1, padding: "6px 0", borderRadius: "3px", fontFamily: C.font,
                          border: sizingMode === m.k ? "1px solid " + C.blue : "1px solid " + C.border,
                          background: sizingMode === m.k ? C.blueDim : "transparent",
                          color: sizingMode === m.k ? C.blue : C.textDim, fontSize: "10px", fontWeight: 600, cursor: "pointer",
                        }}>{m.l}</button>;
                      })}
                    </div>
                  </div>
                  {sizingMode === "fixed_shares" && <div style={{ width: "80px" }}><Input label="Shares" type="number" value={fixedShares} onChange={function(e) { setFixedShares(e.target.value); }} /></div>}
                  {sizingMode === "fixed_notional" && <div style={{ width: "80px" }}><Input label="Notional $" type="number" value={fixedNotional} onChange={function(e) { setFixedNotional(e.target.value); }} /></div>}
                  {!(["MKT", "MOC", "MOO", "MIDPRICE"].includes(orderType) && sizingMode === "fixed_shares") && (
                    <div style={{ width: "90px" }}><Input label="Ref Price" type="number" step="0.01" value={currentPrice} onChange={function(e) { setCurrentPrice(e.target.value); }} /></div>
                  )}
                  <div style={{ width: "70px" }}><Select label="TIF" options={TIF_OPTIONS.map(function(t) { return { value: t, label: t }; })} value={tif} onChange={function(e) { setTif(e.target.value); }} /></div>
                  <div style={{ width: "80px" }}><Toggle on={outsideRth} onChange={setOutsideRth} label="Ext Hrs" /></div>
                </div>
                {/* Row 3: Accounts + Contract info + Preview */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim }}>Accts:</span>
                    {enabledAccounts.map(function(a) {
                      var sel = orderAcctIds.has(a.id);
                      return <label key={a.id} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", fontSize: "10px", color: sel ? C.textBright : C.textDim }}
                        onClick={function() {
                          var next = new Set(orderAcctIds);
                          if (sel) next.delete(a.id); else next.add(a.id);
                          setOrderAcctIds(next);
                        }}>
                        <div style={{
                          width: "14px", height: "14px", borderRadius: "3px", flexShrink: 0,
                          border: sel ? "none" : "1.5px solid " + C.border,
                          background: sel ? C.blue : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>{sel && <CheckIcon />}</div>
                        <span style={{ fontWeight: 600 }}>{a.name}</span>
                      </label>;
                    })}
                  </div>
                  {selectedContract && (
                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      <Tag color={C.blue}>{selectedContract.primary_exchange || "SMART"}</Tag>
                      <Tag color={C.green}>{selectedContract.currency}</Tag>
                    </div>
                  )}
                  {!showConfirm ? (
                    <Btn variant="primary" disabled={!canSubmit} onClick={function() { setShowConfirm(true); }} style={{ padding: "6px 16px", fontSize: "11px" }}>Preview & Confirm</Btn>
                  ) : (
                    <div style={{ display: "flex", gap: "4px" }}>
                      <Btn variant={action === "BUY" ? "primary" : "danger"} onClick={submitOrders} style={{ padding: "6px 16px", fontSize: "11px" }}>CONFIRM {action} {symbol}</Btn>
                      <Btn variant="default" small onClick={function() { setShowConfirm(false); }}>Cancel</Btn>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── RIGHT-CLICK CONTEXT MENU ─── */}
            {contextMenu && (
              <div style={{
                position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 1000,
                background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)", padding: "4px 0", minWidth: "160px",
              }}>
                <div style={{ padding: "6px 12px", fontSize: "10px", fontWeight: 700, color: C.textDim, borderBottom: "1px solid " + C.border }}>
                  {contextMenu.symbol} · {contextMenu.accountName}
                </div>
                {[
                  { label: "Close Position", act: contextMenu.shares > 0 ? "SELL" : "BUY", qty: Math.abs(contextMenu.shares), type: "MIDPRICE" },
                  { label: "Buy", act: "BUY", qty: 0, type: "LMT" },
                  { label: "Sell", act: "SELL", qty: 0, type: "LMT" },
                ].map(function(item) {
                  var color = item.act === "BUY" ? C.green : C.red;
                  return (
                    <div key={item.label} onClick={function() {
                      setInlineOrder({
                        symbol: contextMenu.symbol, accountId: contextMenu.accountId,
                        accountName: contextMenu.accountName, shares: contextMenu.shares,
                        currentPrice: contextMenu.currentPrice,
                        action: item.act, type: item.type,
                        price: contextMenu.currentPrice, qty: item.qty, pct: item.qty > 0 ? 100 : 0,
                      });
                      setContextMenu(null);
                    }} style={{
                      padding: "8px 12px", cursor: "pointer", fontSize: "12px", fontWeight: 600,
                      color: color, display: "flex", alignItems: "center", gap: "8px",
                    }}
                    onMouseEnter={function(e) { e.currentTarget.style.background = "#1a2236"; }}
                    onMouseLeave={function(e) { e.currentTarget.style.background = "transparent"; }}
                    >
                      {item.label === "Close Position" ? "✕" : item.act === "BUY" ? "↑" : "↓"} {item.label}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Symbol filter */}
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
              <input placeholder="Filter by symbol..." value={posSymbolFilter} onChange={function(e) { setPosSymbolFilter(e.target.value.toUpperCase()); }}
                style={{ width: "180px", background: C.bg2, border: "1px solid " + C.border, borderRadius: "4px", color: C.text, padding: "5px 8px", fontSize: "11px", fontFamily: C.font, outline: "none" }} />
              {posSymbolFilter && <button onClick={function() { setPosSymbolFilter(""); }} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: "12px" }}>✕</button>}
            </div>

            {(function() {
              var displayPositions = filteredPositions;
              if (posSymbolFilter) { displayPositions = displayPositions.filter(function(p) { return p.symbol.includes(posSymbolFilter); }); }
              return displayPositions.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: C.textDim }}>{filterAcctId ? "No positions for this account." : "No open positions."}</div>
            ) : (
              <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["", "Symbol", "Side", "Shares", "Net Exp", "Avg Cost", "Mkt Price", "Mkt Value", "% Port", "Unreal P&L", "Real P&L", "Total P&L", "P&L %", "Account", "Actions"].map(h => (
                        <th key={h || "expand"} style={{ textAlign: h === "Actions" ? "right" : "left", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, padding: "8px 6px", borderBottom: "1px solid " + C.border, whiteSpace: "nowrap", width: h === "" ? "28px" : "auto" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayPositions.flatMap(pos => {
                      const hedged = Math.abs(pos.totalNetExposure) < Math.abs(pos.totalShares) - 0.01;
                      const pnlPctVal = pos.avgCost !== 0 ? ((pos.curPrice - pos.avgCost) / Math.abs(pos.avgCost) * 100) : 0;
                      const portPct = (function() {
                        // Per-account % portfolio — show the highest exposure across accounts
                        var maxPct = 0;
                        pos.accounts.forEach(function(a) {
                          var acctObj = accounts.find(function(ac) { return ac.id === a.accountId; });
                          if (acctObj && acctObj.equity > 0) {
                            var pct = (Math.abs(a.shares * (a.currentPrice || pos.curPrice)) / acctObj.equity * 100);
                            if (pct > maxPct) maxPct = pct;
                          }
                        });
                        return maxPct;
                      })();
                      const isOpen = expandedSymbols[pos.symbol];
                      const rows = [];
                      rows.push(
                        <tr key={pos.symbol} style={{ borderBottom: "1px solid " + C.bg0, background: C.bg2, cursor: "pointer" }} onClick={() => setExpandedSymbols(prev => ({ ...prev, [pos.symbol]: !prev[pos.symbol] }))}>
                          <td style={{ padding: "8px 6px", color: C.textDim, width: "28px" }}>
                            <ChevronIcon open={isOpen} />
                          </td>
                          <td style={{ padding: "8px 6px", fontWeight: 800, fontSize: "14px", color: C.textBright }}>
                            {pos.currency && pos.currency !== "USD" && CURRENCY_FLAGS[pos.currency] && (
                              <span style={{ marginRight: "6px", fontSize: "14px" }}>{CURRENCY_FLAGS[pos.currency]}</span>
                            )}
                            {pos.symbol}
                            {pos.primary_exchange && (
                              <span style={{ marginLeft: "6px", fontSize: "9px", color: C.textDim }}>{pos.primary_exchange}</span>
                            )}
                            {pos.currency && pos.currency !== "USD" && (
                              <span style={{ marginLeft: "4px", fontSize: "9px", fontWeight: 700, padding: "1px 5px", borderRadius: "2px", background: C.amberDim, color: C.amber }}>{pos.currency}</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 6px" }}><Tag color={pos.totalShares > 0 ? "green" : "red"}>{pos.totalShares > 0 ? "LONG" : "SHORT"}</Tag></td>
                          <td style={{ padding: "8px 6px", fontWeight: 700, color: C.textBright }}>{fmtShares(pos.totalShares)}</td>
                          <td style={{ padding: "8px 6px", fontWeight: 600, color: hedged ? C.amber : C.textDim }}>{hedged ? fmtShares(pos.totalNetExposure) : "—"}</td>
                          <td style={{ padding: "8px 6px" }}>{fmt(pos.avgCost)}</td>
                          <td style={{ padding: "8px 6px" }}>{fmt(pos.curPrice)}</td>
                          <td style={{ padding: "8px 6px", fontWeight: 600 }}>{fmt(Math.abs(pos.totalNotional))}</td>
                          <td style={{ padding: "8px 6px", fontWeight: 600, color: portPct > 20 ? C.amber : C.textDim }}>{portPct.toFixed(1)}%</td>
                          <td style={{ padding: "8px 6px" }}><PnlValue value={pos.totalUnrealized} size="12px" /></td>
                          <td style={{ padding: "8px 6px" }}><PnlValue value={pos.totalRealized} size="12px" /></td>
                          <td style={{ padding: "8px 6px" }}><PnlValue value={pos.totalUnrealized + pos.totalRealized} size="12px" /></td>
                          <td style={{ padding: "8px 6px", fontWeight: 600, color: pnlPctVal >= 0 ? C.green : C.red }}>{pnlPctVal >= 0 ? "+" : ""}{pnlPctVal.toFixed(2)}%</td>
                          <td style={{ padding: "8px 6px", fontSize: "10px", color: C.textDim }}>{pos.accounts.length} acct{pos.accounts.length > 1 ? "s" : ""}</td>
                          <td style={{ padding: "8px 6px", textAlign: "right" }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: "flex", gap: "3px", justifyContent: "flex-end" }}>
                              {EXIT_PCTS.map(pct => (
                                <Btn key={pct} small variant={pct === 100 ? "danger" : "default"} onClick={() => setExitModal({ symbol: pos.symbol, pct })}>
                                  {pct === 100 ? "ALL" : pct + "%"}
                                </Btn>
                              ))}
                              <Btn small variant="default" onClick={() => { setExitModal({ symbol: pos.symbol, pct: "custom" }); setCustomExitPct(""); }}>X%</Btn>
                            </div>
                          </td>
                        </tr>
                      );
                      if (isOpen) {
                        pos.accounts.forEach(a => {
                          const acct = acctMap[a.accountId];
                          const uPnl = (a.unrealizedPnl || 0);
                          const rPnl = a.realizedPnl || 0;
                          const netExp = getNetExposure(pos.symbol, a.accountId, a.shares);
                          const isHedged = Math.abs(netExp) < Math.abs(a.shares) - 0.01;
                          const aPnlPct = a.avgCost !== 0 ? ((a.currentPrice - a.avgCost) / Math.abs(a.avgCost) * 100) : 0;
                          const acctNotional = Math.abs(a.shares * a.currentPrice);
                          const acctObj = accounts.find(ac => ac.id === a.accountId);
                          const acctPortPct = acctObj && acctObj.equity > 0 ? (acctNotional / acctObj.equity * 100) : 0;
                          rows.push(
                            <tr key={pos.symbol + "-" + a.accountId} style={{ borderBottom: "1px solid " + C.bg0, background: C.bg1 }}
                              onContextMenu={function(e) {
                                e.preventDefault();
                                setContextMenu({
                                  x: e.clientX, y: e.clientY,
                                  symbol: pos.symbol, accountId: a.accountId,
                                  accountName: acct?.name || ("Acct " + a.accountId),
                                  shares: a.shares, currentPrice: a.currentPrice,
                                });
                              }}>
                              <td style={{ padding: "5px 6px" }}></td>
                              <td style={{ padding: "5px 6px 5px 20px", fontSize: "11px", color: C.textDim }}>└</td>
                              <td style={{ padding: "5px 6px" }}></td>
                              <td style={{ padding: "5px 6px", fontSize: "12px", fontWeight: 600 }}>{a.shares}</td>
                              <td style={{ padding: "5px 6px", fontSize: "11px", color: isHedged ? C.amber : C.textDim }}>{isHedged ? netExp : "—"}</td>
                              <td style={{ padding: "5px 6px", fontSize: "12px", color: C.textDim }}>{fmt(a.avgCost)}</td>
                              <td style={{ padding: "5px 6px" }}></td>
                              <td style={{ padding: "5px 6px", fontSize: "12px", color: C.textDim }}>{fmt(acctNotional)}</td>
                              <td style={{ padding: "5px 6px", fontSize: "11px", color: C.textDim }}>{acctPortPct.toFixed(1)}%</td>
                              <td style={{ padding: "5px 6px" }}><PnlValue value={uPnl} size="11px" /></td>
                              <td style={{ padding: "5px 6px" }}><PnlValue value={rPnl} size="11px" /></td>
                              <td style={{ padding: "5px 6px" }}><PnlValue value={uPnl + rPnl} size="11px" /></td>
                              <td style={{ padding: "5px 6px", fontSize: "11px", color: aPnlPct >= 0 ? C.green : C.red }}>{aPnlPct >= 0 ? "+" : ""}{aPnlPct.toFixed(2)}%</td>
                              <td style={{ padding: "5px 6px", fontSize: "11px", color: C.blue }}>{acct?.name || ("Acct " + a.accountId)}</td>
                              <td style={{ padding: "5px 6px", textAlign: "right" }}>
                                <div style={{ display: "flex", gap: "2px", justifyContent: "flex-end" }}>
                                  {[25, 50, 75, 100].map(function(pct) {
                                    var exitQty = Math.floor(Math.abs(a.shares) * pct / 100);
                                    var exitAct = a.shares > 0 ? "SELL" : "BUY";
                                    return (
                                      <Btn key={pct} small variant={pct === 100 ? "danger" : "default"}
                                        onClick={function() {
                                          setInlineOrder({
                                            symbol: pos.symbol, accountId: a.accountId,
                                            accountName: acct?.name || ("Acct " + a.accountId),
                                            shares: a.shares, currentPrice: a.currentPrice,
                                            action: exitAct, type: "MIDPRICE",
                                            price: a.currentPrice, qty: exitQty, pct: pct,
                                          });
                                        }}>
                                        {pct === 100 ? "ALL" : pct + "%"}
                                      </Btn>
                                    );
                                  })}
                                  <Btn small variant="default" onClick={function() {
                                    setInlineOrder({
                                      symbol: pos.symbol, accountId: a.accountId,
                                      accountName: acct?.name || ("Acct " + a.accountId),
                                      shares: a.shares, currentPrice: a.currentPrice,
                                      action: a.shares > 0 ? "SELL" : "BUY", type: "LMT",
                                      price: a.currentPrice, qty: 0, pct: 0,
                                    });
                                  }}>Order</Btn>
                                </div>
                              </td>
                            </tr>
                          );
                          // ─── INLINE ORDER ENTRY ROW (IB TWS style) ───
                          if (inlineOrder && inlineOrder.symbol === pos.symbol && inlineOrder.accountId === a.accountId) {
                            rows.push(
                              <tr key={"inline-" + pos.symbol + "-" + a.accountId} style={{ borderBottom: "1px solid " + C.bg0, background: "#0d1a26" }}>
                                <td style={{ padding: "6px" }}></td>
                                <td colSpan="14" style={{ padding: "6px 6px 6px 20px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                    <span style={{ fontSize: "10px", color: C.blue, fontWeight: 700, padding: "2px 6px", background: C.blueDim, borderRadius: "3px" }}>{inlineOrder.accountName}</span>
                                    <div style={{ display: "flex", gap: "3px" }}>
                                      {["BUY", "SELL"].map(function(act) {
                                        return <Btn key={act} small variant={inlineOrder.action === act ? (act === "BUY" ? "primary" : "danger") : "default"}
                                          onClick={function() { setInlineOrder(Object.assign({}, inlineOrder, { action: act })); }}>{act}</Btn>;
                                      })}
                                    </div>
                                    <input type="number" value={inlineOrder.qty} onChange={function(e) { setInlineOrder(Object.assign({}, inlineOrder, { qty: parseInt(e.target.value) || 0 })); }}
                                      style={{ width: "70px", background: C.bg0, border: "1px solid " + C.border, borderRadius: "3px", color: C.textBright, padding: "4px 6px", fontSize: "12px", fontWeight: 700, fontFamily: C.font, textAlign: "center" }} />
                                    <select value={inlineOrder.type} onChange={function(e) { setInlineOrder(Object.assign({}, inlineOrder, { type: e.target.value })); }}
                                      style={{ background: C.bg0, border: "1px solid " + C.border, borderRadius: "3px", color: C.text, padding: "4px 6px", fontSize: "11px", fontFamily: C.font }}>
                                      <option value="MKT">MKT</option><option value="LMT">LMT</option><option value="MIDPRICE">MIDPRICE</option><option value="STP">STP</option><option value="MOC">MOC</option>
                                    </select>
                                    {inlineOrder.type === "LMT" && (
                                      <input type="number" step="0.01" value={inlineOrder.price || ""} onChange={function(e) { setInlineOrder(Object.assign({}, inlineOrder, { price: parseFloat(e.target.value) || 0 })); }}
                                        placeholder="Limit $" style={{ width: "80px", background: C.bg0, border: "1px solid " + C.border, borderRadius: "3px", color: C.textBright, padding: "4px 6px", fontSize: "12px", fontFamily: C.font, textAlign: "center" }} />
                                    )}
                                    {inlineOrder.type === "STP" && (
                                      <input type="number" step="0.01" value={inlineOrder.price || ""} onChange={function(e) { setInlineOrder(Object.assign({}, inlineOrder, { price: parseFloat(e.target.value) || 0 })); }}
                                        placeholder="Stop $" style={{ width: "80px", background: C.bg0, border: "1px solid " + C.border, borderRadius: "3px", color: C.textBright, padding: "4px 6px", fontSize: "12px", fontFamily: C.font, textAlign: "center" }} />
                                    )}
                                    <span style={{ fontSize: "10px", color: C.textDim }}>GTC SMART</span>
                                    <Btn small variant={inlineOrder.action === "BUY" ? "primary" : "danger"} onClick={async function() {
                                      await api("POST", "/api/order", {
                                        symbol: inlineOrder.symbol, action: inlineOrder.action, order_type: inlineOrder.type,
                                        quantity: inlineOrder.qty, limit_price: inlineOrder.type === "LMT" ? inlineOrder.price : null,
                                        stop_price: inlineOrder.type === "STP" ? inlineOrder.price : null,
                                        current_price: inlineOrder.currentPrice, tif: "GTC", account_ids: [inlineOrder.accountId],
                                      });
                                      setInlineOrder(null);
                                    }}>Transmit</Btn>
                                    <Btn small variant="default" onClick={function() { setInlineOrder(null); }}>✕</Btn>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                          // Working orders for this account+symbol — IB TWS style sub-rows
                          var acctWorkingOrders = openOrders.filter(function(o) {
                            return o.symbol === pos.symbol && o.accountId === a.accountId && ["WORKING", "SUBMITTED", "PARTIAL"].includes(o.status);
                          });
                          acctWorkingOrders.forEach(function(wo) {
                            var filledQty = wo.filled || 0;
                            var fillPct = wo.shares > 0 ? (filledQty / wo.shares * 100) : 0;
                            var isEditable = wo.type === "LMT" || wo.type === "STP" || wo.type === "MIDPRICE";
                            var edit = editingWo[wo.id];
                            var isEditing = !!edit;
                            var woPrice = typeof wo.price === "number" ? wo.price : 0;
                            rows.push(
                              <tr key={"wo-" + wo.id} style={{ borderBottom: "1px solid " + C.bg0, background: "#1a1a2e" }}>
                                <td style={{ padding: "4px 6px" }}></td>
                                <td colSpan="6" style={{ padding: "4px 6px 4px 32px", fontSize: "10px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ color: C.textDim }}>↳</span>
                                    <Tag color={wo.action === "BUY" ? "green" : "red"}>{wo.action}</Tag>
                                    <input type="number" value={isEditing ? edit.qty : wo.shares}
                                      onClick={function() { if (!isEditing) setEditingWo(function(p) { var n = Object.assign({}, p); n[wo.id] = { price: woPrice, qty: wo.shares }; return n; }); }}
                                      onChange={function(e) { setEditingWo(function(p) { var n = Object.assign({}, p); n[wo.id] = Object.assign({}, n[wo.id] || { price: woPrice, qty: wo.shares }, { qty: parseInt(e.target.value) || 0 }); return n; }); }}
                                      style={{ width: "55px", background: C.bg0, border: "1px solid " + (isEditing ? C.amber : C.border), borderRadius: "3px", color: C.textBright, padding: "2px 4px", fontSize: "11px", fontWeight: 700, fontFamily: C.font, textAlign: "center", cursor: "text" }} />
                                    <Tag color="blue">{wo.type}</Tag>
                                    <input type="number" step="0.01" value={isEditing ? edit.price : woPrice}
                                      onClick={function() { if (!isEditing) setEditingWo(function(p) { var n = Object.assign({}, p); n[wo.id] = { price: woPrice, qty: wo.shares }; return n; }); }}
                                      onChange={function(e) { setEditingWo(function(p) { var n = Object.assign({}, p); n[wo.id] = Object.assign({}, n[wo.id] || { price: woPrice, qty: wo.shares }, { price: parseFloat(e.target.value) || 0 }); return n; }); }}
                                      style={{ width: "70px", background: C.bg0, border: "1px solid " + (isEditing ? C.amber : C.border), borderRadius: "3px", color: C.amber, padding: "2px 4px", fontSize: "11px", fontWeight: 700, fontFamily: C.font, textAlign: "center", cursor: "text" }} />
                                    <span style={{ color: C.textDim }}>{wo.tif} SMART</span>
                                  </div>
                                </td>
                                <td colSpan="2" style={{ padding: "4px 6px", fontSize: "10px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Tag color={wo.status === "PARTIAL" ? "amber" : "blue"}>
                                      {wo.status === "SUBMITTED" ? "WORKING" : wo.status}
                                    </Tag>
                                  </div>
                                </td>
                                <td colSpan="4" style={{ padding: "4px 6px", fontSize: "9px", color: C.textDim }}>{wo.id}</td>
                                <td style={{ padding: "4px 6px", fontSize: "10px", color: C.blue, fontWeight: 600 }}>{acct?.name || ("Acct " + a.accountId)}</td>
                                <td style={{ padding: "4px 6px", textAlign: "right" }}>
                                  <div style={{ display: "flex", gap: "3px", justifyContent: "flex-end" }}>
                                    {isEditing && (
                                      <Btn small variant="primary" onClick={async function() {
                                        var realId = wo.id.toString().replace("ORD-", "");
                                        await api("POST", "/api/order/" + wo.accountId + "/" + realId + "/modify", { new_price: edit.price });
                                        setEditingWo(function(p) { var n = Object.assign({}, p); delete n[wo.id]; return n; });
                                      }} style={{ background: "#b8860b", fontSize: "9px" }}>Update</Btn>
                                    )}
                                    <Btn small variant="danger" onClick={function() { cancelOrder(wo.id); setEditingWo(function(p) { var n = Object.assign({}, p); delete n[wo.id]; return n; }); }}><XIcon /></Btn>
                                  </div>
                                </td>
                              </tr>
                            );
                          });
                        });
                      }
                      return rows;
                    })}
                  </tbody>
                </table>
              </div>
            );
            })()}
          </div>
        )}

        {/* ═══════════ ORDER ENTRY ═══════════ */}
        {tab === "entry" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <div>
              <SectionHead>Instrument & Order</SectionHead>
              <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "16px" }}>
                <div style={{ display: "flex", gap: "10px" }}>
                  <div style={{ flex: 2, position: "relative" }}>
                    <Input label="Symbol" placeholder="e.g. MSFT" value={symbol} onChange={e => {
                      var s = e.target.value.toUpperCase();
                      setSymbol(s);
                      setSelectedContract(null);
                      // Auto-fill price from existing position if we have one
                      var existingPos = positions.find(function(p) { return p.symbol === s; });
                      if (existingPos && existingPos.accounts[0] && existingPos.accounts[0].currentPrice > 0) {
                        setCurrentPrice(existingPos.accounts[0].currentPrice.toString());
                      }
                    }} onBlur={function() { if (symbol && !selectedContract) searchContract(symbol); }} onKeyDown={function(e) { if (e.key === "Enter" && symbol && !selectedContract) { e.preventDefault(); searchContract(symbol); } }} />
                    {/* Contract search button */}
                    {symbol && !selectedContract && (
                      <button onClick={function() { searchContract(symbol); }} style={{
                        position: "absolute", right: "4px", top: "20px", padding: "3px 8px",
                        background: C.blue, color: "#fff", border: "none", borderRadius: "3px",
                        fontSize: "9px", fontWeight: 700, fontFamily: C.font, cursor: "pointer",
                      }}>{contractSearching ? "..." : "Lookup"}</button>
                    )}
                    {/* Selected contract badge */}
                    {selectedContract && (
                      <div style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
                        <Tag color={C.blue}>{selectedContract.primary_exchange || "SMART"}</Tag>
                        <Tag color={C.green}>{selectedContract.currency}</Tag>
                        {selectedContract.long_name && <span style={{ fontSize: "10px", color: C.textDim }}>{selectedContract.long_name}</span>}
                      </div>
                    )}
                    {/* Search results dropdown — only shows when multiple markets exist */}
                    {contractResults.length > 1 && (
                      <div style={{
                        position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
                        background: C.bg2, border: "1px solid " + C.blue, borderRadius: "4px",
                        maxHeight: "200px", overflowY: "auto", marginTop: "2px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                      }}>
                        <div style={{ padding: "6px 10px", fontSize: "9px", fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid " + C.border }}>
                          Multiple markets found — US selected by default
                        </div>
                        {contractResults.map(function(c, i) {
                          var isSelected = selectedContract && selectedContract.con_id === c.con_id;
                          return (
                            <div key={c.con_id || i} onClick={function() { selectContract(c); }}
                              style={{
                                padding: "8px 10px", cursor: "pointer",
                                borderBottom: "1px solid " + C.bg0,
                                background: isSelected ? C.blueDim : "transparent",
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                              }}
                              onMouseEnter={function(e) { if (!isSelected) e.currentTarget.style.background = "#1a2236"; }}
                              onMouseLeave={function(e) { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                {isSelected && <span style={{ color: C.blue, fontSize: "12px" }}>✓</span>}
                                <span style={{ fontWeight: 700, color: C.textBright, fontSize: "12px" }}>{c.symbol}</span>
                                <span style={{ color: C.textDim, fontSize: "11px" }}>{c.long_name || ""}</span>
                              </div>
                              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                                {c.is_us && <span style={{ fontSize: "8px", fontWeight: 700, color: C.green, padding: "1px 4px", borderRadius: "2px", background: C.greenDim }}>US</span>}
                                <Tag color={C.blue}>{c.primary_exchange || "SMART"}</Tag>
                                <Tag color={c.currency === "USD" ? C.green : C.amber}>{c.currency}</Tag>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "4px" }}>
                      {needsStop ? "Side (flat only)" : "Side"}
                    </label>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {["BUY", "SELL"].map(function(a) {
                        // Context-aware label
                        var posDir = symbolPositionMap[symbol?.toUpperCase()];
                        var hasPosition = posDir && Object.values(posDir).some(function(s) { return s !== 0; });
                        var isLong = posDir && Object.values(posDir).some(function(s) { return s > 0; });
                        var isShort = posDir && Object.values(posDir).some(function(s) { return s < 0; });
                        var label = a;
                        if (hasPosition) {
                          if (a === "BUY" && isShort) label = "BUY (Cover)";
                          else if (a === "SELL" && isLong) label = "SELL (Close)";
                          else if (a === "BUY" && isLong) label = "BUY (Add)";
                          else if (a === "SELL" && isShort) label = "SELL (Add)";
                        } else if (symbol) {
                          if (a === "BUY") label = "BUY (Long)";
                          else label = "SELL (Short)";
                        }
                        return (
                        <button key={a} onClick={() => setAction(a)} style={{
                          flex: 1, padding: "7px 0", borderRadius: "4px", border: "none", fontFamily: C.font,
                          background: action === a ? (a === "BUY" ? "linear-gradient(135deg, #166534, #14532d)" : "linear-gradient(135deg, #991b1b, #7f1d1d)") : C.bg3,
                          color: action === a ? "#fff" : C.textDim, fontSize: "11px", fontWeight: 700, cursor: "pointer",
                          opacity: needsStop && stopContext && stopContext.flats === 0 ? 0.35 : 1,
                        }}>{label}</button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {needsStop && symbol && stopContext && (
                  <div style={{ background: C.amberDim, border: `1px solid ${C.amber}30`, borderRadius: "5px", padding: "10px 12px", marginBottom: "10px", fontSize: "11px", lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 800, color: C.amber, marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}><AlertIcon /> SMART STOP — {symbol}</div>
                    <div style={{ color: C.text }}>
                      {stopContext.longs > 0 && <div><Tag color="green">LONG</Tag> {stopContext.longs} acct{stopContext.longs > 1 ? "s" : ""} → <span style={{ fontWeight: 700, color: C.red }}>SELL STOP</span></div>}
                      {stopContext.shorts > 0 && <div><Tag color="red">SHORT</Tag> {stopContext.shorts} acct{stopContext.shorts > 1 ? "s" : ""} → <span style={{ fontWeight: 700, color: C.green }}>BUY STOP</span></div>}
                      {stopContext.flats > 0 && <div><Tag color="gray">FLAT</Tag> {stopContext.flats} acct{stopContext.flats > 1 ? "s" : ""} → <span style={{ fontWeight: 700, color: action === "BUY" ? C.green : C.red }}>{action} STOP</span> (entry)</div>}
                    </div>
                  </div>
                )}

                {duplicateWarning && (
                  <div style={{ background: C.redDim, border: `1px solid ${C.red}30`, borderRadius: "5px", padding: "8px 12px", marginBottom: "10px", fontSize: "11px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <WarningBadge /><span style={{ color: C.red, fontWeight: 600 }}>{duplicateWarning}</span>
                  </div>
                )}

                <div style={{ display: "flex", gap: "10px" }}>
                  {!(["MKT", "MOC", "MOO"].includes(orderType) && sizingMode === "fixed_shares") && (
                    <div style={{ flex: 1 }}><Input label={["MKT", "MOC", "MOO"].includes(orderType) ? "Reference Price ($) — for share calc" : "Current Price ($)"} type="number" step="0.01" placeholder="410.45" value={currentPrice} onChange={e => setCurrentPrice(e.target.value)} /></div>
                  )}
                  <div style={{ flex: 1 }}><Select label="Order Type" options={ORDER_TYPES} value={orderType} onChange={e => setOrderType(e.target.value)} /></div>
                </div>
                {needsLimit && <Input label="Limit Price ($)" type="number" step="0.01" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} />}
                {needsStop && <Input label="Stop Price ($)" type="number" step="0.01" value={stopPrice} onChange={e => setStopPrice(e.target.value)} />}
                <div style={{ display: "flex", gap: "10px" }}>
                  <div style={{ flex: 1 }}><Select label="Time in Force" options={TIF_OPTIONS.map(t => ({ value: t, label: t }))} value={tif} onChange={e => setTif(e.target.value)} /></div>
                  <div style={{ flex: 1 }}><Input label="Exchange" value={exchange} onChange={e => setExchange(e.target.value.toUpperCase())} /></div>
                </div>
                <Toggle on={outsideRth} onChange={setOutsideRth} label="Allow Outside RTH (Pre/Post Market)" />
                <div style={{ borderTop: `1px solid ${C.border}`, marginTop: "10px", paddingTop: "10px" }}>
                  <Toggle on={bracketEnabled} onChange={setBracketEnabled} label="Bracket Order (Profit Target + Stop Loss)" />
                  {bracketEnabled && (
                    <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                      <div style={{ flex: 1 }}><Input label="Profit Target ($)" type="number" step="0.01" value={profitTarget} onChange={e => setProfitTarget(e.target.value)} /></div>
                      <div style={{ flex: 1 }}><Input label="Stop Loss ($)" type="number" step="0.01" value={stopLoss} onChange={e => setStopLoss(e.target.value)} /></div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <SectionHead>Route to Accounts</SectionHead>
              <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", padding: "10px 0", marginBottom: "16px", maxHeight: "220px", overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 8px 12px", borderBottom: "1px solid " + C.border }}>
                  <span style={{ fontSize: "10px", color: C.textDim, fontWeight: 600 }}>{orderAcctIds.size}/{enabledAccounts.length} selected</span>
                  <Btn small variant="default" onClick={() => {
                    const allSelected = enabledAccounts.every(a => orderAcctIds.has(a.id));
                    if (allSelected) setOrderAcctIds(new Set());
                    else setOrderAcctIds(new Set(enabledAccounts.map(a => a.id)));
                  }}>{enabledAccounts.every(a => orderAcctIds.has(a.id)) ? "Deselect All" : "Select All"}</Btn>
                </div>
                {enabledAccounts.map(a => {
                  const selected = orderAcctIds.has(a.id);
                  return (
                    <div key={a.id} onClick={() => {
                      const next = new Set(orderAcctIds);
                      if (selected) next.delete(a.id); else next.add(a.id);
                      setOrderAcctIds(next);
                    }} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "6px 12px", cursor: "pointer",
                      background: selected ? C.blueDim + "40" : "transparent",
                      borderBottom: "1px solid " + C.bg0,
                      transition: "background 0.1s",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{
                          width: "14px", height: "14px", borderRadius: "3px", flexShrink: 0,
                          border: selected ? "none" : "1.5px solid " + C.border,
                          background: selected ? C.blue : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {selected && <CheckIcon />}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: a.connected ? C.green : C.red, flexShrink: 0 }} />
                          <span style={{ fontSize: "12px", fontWeight: 600, color: selected ? C.textBright : C.textDim }}>{a.name}</span>
                        </div>
                      </div>
                      <span style={{ fontSize: "10px", color: C.textDim, fontFamily: C.font }}>{fmt(a.equity)}</span>
                    </div>
                  );
                })}
              </div>

              <SectionHead>Position Sizing</SectionHead>
              <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "16px" }}>
                <div style={{ display: "flex", gap: "4px", marginBottom: "14px" }}>
                  {[{ k: "pct", l: "% of Equity" }, { k: "fixed_shares", l: "Fixed Shares" }, { k: "fixed_notional", l: "Fixed $" }].map(m => (
                    <button key={m.k} onClick={() => setSizingMode(m.k)} style={{
                      flex: 1, padding: "7px 0", borderRadius: "4px", fontFamily: C.font,
                      border: sizingMode === m.k ? `1px solid ${C.blue}` : `1px solid ${C.border}`,
                      background: sizingMode === m.k ? C.blueDim : "transparent",
                      color: sizingMode === m.k ? C.blue : C.textDim, fontSize: "11px", fontWeight: 600, cursor: "pointer",
                    }}>{m.l}</button>
                  ))}
                </div>
                {sizingMode === "pct" && (
                  <div style={{ marginBottom: "10px" }}>
                    <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "4px" }}>Allocation %</label>
                    <div style={{ display: "flex", gap: "3px", marginBottom: "8px", flexWrap: "wrap" }}>
                      {[1, 2, 3, 4, 5, 10, 15, 20, 25].map(function(pct) {
                        var isActive = allocPct === pct;
                        return <button key={pct} onClick={function() { setAllocPct(pct); }} style={{
                          padding: "8px 12px", borderRadius: "4px", border: isActive ? "1px solid " + C.blue : "1px solid " + C.border,
                          background: isActive ? C.blue : C.bg0, color: isActive ? "#fff" : C.textDim,
                          fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: C.font,
                        }}>{pct}%</button>;
                      })}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <input type="range" min="1" max="100" value={allocPct} onChange={e => setAllocPct(parseFloat(e.target.value))} style={{ flex: 1, accentColor: C.blue }} />
                      <input style={{ width: "60px", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: "4px", color: C.text, padding: "5px 8px", fontSize: "13px", fontFamily: C.font, textAlign: "center", fontWeight: 700, outline: "none" }}
                        type="number" min="0.1" max="100" step="0.1" value={allocPct} onChange={e => setAllocPct(parseFloat(e.target.value) || 0)} />
                      <span style={{ color: C.textDim, fontSize: "12px" }}>%</span>
                    </div>
                  </div>
                )}
                {sizingMode === "fixed_shares" && <Input label="Shares per Account" type="number" step="0.01" value={fixedShares} onChange={e => setFixedShares(e.target.value)} />}
                {sizingMode === "fixed_notional" && <Input label="Notional ($) per Account" type="number" step="0.01" value={fixedNotional} onChange={e => setFixedNotional(e.target.value)} />}

                {computedOrders.length > 0 && (
                  <div style={{ marginTop: "12px" }}>
                    <SectionHead>Order Preview</SectionHead>
                    {computedOrders.map(o => (
                      <div key={o.accountId} style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: "4px", padding: "10px 12px", marginBottom: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontWeight: 700, color: C.textBright, fontSize: "12px" }}>{o.accountName}</span>
                          {needsStop && <Tag color={o.posDirection === "LONG" ? "green" : o.posDirection === "SHORT" ? "red" : "gray"}>{o.posDirection}</Tag>}
                          <span style={{ fontSize: "10px", color: C.textDim }}>{fmt(o.equity)} · {o.pctEq}%</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <Tag color={o.effectiveAction === "BUY" ? "green" : "red"}>{o.effectiveAction}</Tag>
                          <span style={{ fontWeight: 700, fontSize: "14px", color: o.effectiveAction === "BUY" ? C.green : C.red }}>{fmtShares(o.shares)} shs</span>
                          <span style={{ fontSize: "10px", color: C.textDim }}>{fmt(o.notional)}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{ background: C.blueDim, border: `1px solid ${C.blue}30`, borderRadius: "4px", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, color: C.blue, fontSize: "12px" }}>TOTAL</span>
                      <span style={{ fontWeight: 700, color: C.textBright, fontSize: "14px" }}>
                        {fmtShares(computedOrders.reduce((s, o) => s + o.shares, 0))} shs · {fmt(computedOrders.reduce((s, o) => s + o.notional, 0))}
                      </span>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: "16px" }}>
                  {!showConfirm ? (
                    <Btn variant="primary" full disabled={!canSubmit} onClick={() => setShowConfirm(true)}><SendIcon /> PREVIEW & CONFIRM</Btn>
                  ) : (
                    <div style={{ display: "flex", gap: "8px" }}>
                      <Btn variant="danger" full onClick={submitOrders}>
                        <AlertIcon /> CONFIRM {needsStop ? "STOP" : action} {symbol} × {computedOrders.length} accts
                      </Btn>
                      <Btn variant="default" onClick={() => setShowConfirm(false)}>Cancel</Btn>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════ ORDERS (unified view) ═══════════ */}
        {tab === "orders" && (function() {
          // Merge active orders + log into unified list
          var activeStatuses = { WORKING: true, PARTIAL: true, SUBMITTED: true };
          var allOrders = openOrders.map(function(o) { return { ...o, date: o.date || new Date().toISOString().slice(0, 10), isActive: true }; })
            .concat(orderLog.map(function(l) { return { ...l, filled: l.status === "FILLED" ? l.shares : (l.filled || 0), isActive: false }; }));

          // Apply account filter
          if (filterAcctId) {
            allOrders = allOrders.filter(function(o) { return o.accountId === filterAcctId || o.account === (acctMap[filterAcctId]?.name || ""); });
          }

          // Apply active-only filter
          if (showActiveOnly) {
            allOrders = allOrders.filter(function(o) { return activeStatuses[o.status]; });
          }

          // Sort
          var dir = sortDir === "asc" ? 1 : -1;
          allOrders.sort(function(a, b) {
            var va = a[sortCol], vb = b[sortCol];
            if (sortCol === "date") {
              var da = (a.date || "") + " " + (a.time || "");
              var db = (b.date || "") + " " + (b.time || "");
              return da.localeCompare(db) * dir;
            }
            if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
            if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
            return 0;
          });

          var activeCount = allOrders.filter(function(o) { return activeStatuses[o.status]; }).length;

          return (
          <div>
            <SectionHead right={
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <Btn small variant={showActiveOnly ? "primary" : "default"} onClick={() => setShowActiveOnly(!showActiveOnly)}>
                  {showActiveOnly ? "Showing Active Only" : "Show Active Only"}
                </Btn>
                <Btn small variant="default" onClick={function() {
                  var headers = ["Date", "Time", "Symbol", "Side", "Type", "Qty", "Filled", "Price", "TIF", "Account", "Status"];
                  var csvRows = [headers.join(",")];
                  allOrders.forEach(function(o) {
                    csvRows.push([o.date || "", o.time || "", o.symbol, o.action, o.type, o.shares, o.filled || 0, o.price || "", o.tif || "", o.account || "", o.status || ""].join(","));
                  });
                  var blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
                  var url = URL.createObjectURL(blob);
                  var a = document.createElement("a");
                  a.href = url;
                  a.download = "orders_" + new Date().toISOString().slice(0, 10) + ".csv";
                  a.click();
                }}>Export CSV</Btn>
                {activeCount > 0 && (
                  <Btn small variant="danger" onClick={async () => {
                      for (var o of openOrders) {
                        var rid = o.id.toString().replace("ORD-", "");
                        await api("POST", "/api/order/" + o.accountId + "/" + rid + "/cancel");
                      }
                  }}>Cancel All Active</Btn>
                )}
              </div>
            }>Orders ({allOrders.length} shown · {activeCount} active)</SectionHead>
            {allOrders.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: C.textDim }}>No orders.</div>
            ) : (
              <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1100px" }}>
                  <thead>
                    <tr>
                      <SortTh label="Date" field="date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Time" field="time" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Symbol" field="symbol" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Side" field="action" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Type" field="type" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Qty" field="shares" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Filled" field="filled" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Price" field="price" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="TIF" field="tif" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Account" field="account" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Status" field="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <th style={{ textAlign: "left", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, padding: "10px 8px", borderBottom: "1px solid " + C.border }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allOrders.map(function(o, i) {
                      var filledQty = o.filled || 0;
                      var fillPct = o.shares > 0 ? (filledQty / o.shares * 100) : 0;
                      var isPartial = filledQty > 0 && filledQty < o.shares;
                      var isActive = activeStatuses[o.status];
                      var rowOpacity = isActive ? 1 : 0.6;
                      return (
                      <tr key={o.id || ("row-" + i)} style={{ borderBottom: "1px solid " + C.bg0, opacity: rowOpacity }}>
                        <td style={{ padding: "8px 8px", color: C.textDim, fontSize: "11px", whiteSpace: "nowrap" }}>{o.date || "—"}</td>
                        <td style={{ padding: "8px 8px", color: C.textDim, fontSize: "11px" }}>{o.time || "—"}</td>
                        <td style={{ padding: "8px 8px", fontWeight: 700, color: C.textBright }}>{o.symbol}</td>
                        <td style={{ padding: "8px 8px" }}><Tag color={o.action === "BUY" ? "green" : "red"}>{o.action}</Tag></td>
                        <td style={{ padding: "8px 8px" }}><Tag color="blue">{o.type}</Tag></td>
                        <td style={{ padding: "8px 8px", fontWeight: 700 }}>{typeof o.shares === "number" ? o.shares : "—"}</td>
                        <td style={{ padding: "8px 8px" }}>
                          {isPartial ? (
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <span style={{ fontWeight: 700, color: C.amber }}>{filledQty}</span>
                                <span style={{ color: C.textDim, fontSize: "10px" }}>/</span>
                                <span style={{ color: C.textDim, fontSize: "11px" }}>{o.shares}</span>
                              </div>
                              <div style={{ height: "3px", width: "50px", background: C.border, borderRadius: "2px", marginTop: "2px", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: fillPct + "%", background: C.amber, borderRadius: "2px" }} />
                              </div>
                            </div>
                          ) : o.status === "FILLED" ? (
                            <span style={{ fontWeight: 600, color: C.green, fontSize: "11px" }}>{typeof o.shares === "number" ? o.shares : "—"}/{typeof o.shares === "number" ? o.shares : "—"}</span>
                          ) : o.status === "CANCELLED" ? (
                            <span style={{ color: C.textDim, fontSize: "11px" }}>{filledQty > 0 ? (filledQty + "/" + o.shares) : "—"}</span>
                          ) : (
                            <span style={{ color: C.textDim, fontSize: "11px" }}>0/{typeof o.shares === "number" ? o.shares : "—"}</span>
                          )}
                        </td>
                        <td style={{ padding: "8px 8px" }}>{typeof o.price === "number" ? fmt(o.price) : (o.price || "—")}</td>
                        <td style={{ padding: "8px 8px" }}>{o.tif || "—"}</td>
                        <td style={{ padding: "8px 8px", color: C.blue, fontSize: "11px" }}>{o.account}</td>
                        <td style={{ padding: "8px 8px" }}>
                          <Tag color={o.status === "PARTIAL" ? "amber" : o.status === "CANCELLED" ? "red" : o.status === "FILLED" ? "green" : "blue"}>
                            {o.status === "PARTIAL" ? "PARTIAL" : o.status}
                          </Tag>
                        </td>
                        <td style={{ padding: "8px 8px" }}>
                          {isActive ? (
                            <div style={{ display: "flex", gap: "4px" }}>
                              {(o.type === "LMT" || o.type === "STP" || o.type === "MIDPRICE") && (
                                <Btn small variant="default" onClick={() => { setModifyOrder(o); setModifyPrice(typeof o.price === "number" ? o.price.toString() : ""); }}><EditIcon /> Modify</Btn>
                              )}
                              <Btn small variant="danger" onClick={() => cancelOrder(o.id)}><XIcon /> Cancel</Btn>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                {openOrders.length > 0 && (
                <div style={{ padding: "10px 12px", borderTop: "1px solid " + C.border, display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "10px", color: C.textDim, fontWeight: 700 }}>CANCEL BY SYMBOL:</span>
                  {[...new Set(openOrders.map(o => o.symbol))].map(sym => (
                    <Btn key={sym} small variant="default" onClick={() => cancelSymbolOrders(sym)}><XIcon /> {sym}</Btn>
                  ))}
                </div>
                )}
              </div>
            )}
          </div>
          );
        })()}

        {/* ═══════════ ACCOUNTS ═══════════ */}
        {tab === "accounts" && (
          <div>
            <SectionHead right={accounts.length < 10 && <Btn small variant="default" onClick={addAccount}><PlusIcon /> Add</Btn>}>Accounts ({accounts.length}/10)</SectionHead>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}>
              {accounts.map(acct => {
                // Calculate leverage: total notional exposure / equity
                const acctNotional = positions.reduce((sum, p) => {
                  const pa = p.accounts.find(a => a.accountId === acct.id);
                  return sum + (pa ? Math.abs(pa.shares * pa.currentPrice) : 0);
                }, 0);
                const leverage = acct.equity > 0 ? acctNotional / acct.equity : 0;
                const leverageColor = leverage > 2 ? C.red : leverage > 1 ? C.amber : C.green;

                return (
                <div key={acct.id} style={{ background: C.bg2, border: "1px solid " + (acct.enabled ? C.blue + "40" : C.border), borderRadius: "6px", padding: "16px", opacity: acct.enabled ? 1 : 0.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Toggle on={acct.enabled} onChange={v => updateAccount(acct.id, { enabled: v })} />
                      <input
                        value={acct.name}
                        onChange={e => updateAccount(acct.id, { name: e.target.value })}
                        style={{
                          fontWeight: 800, color: C.textBright, fontSize: "14px", fontFamily: C.font,
                          background: "transparent", border: "1px solid transparent", borderRadius: "4px",
                          padding: "2px 6px", outline: "none", width: "160px",
                          transition: "border-color 0.15s, background 0.15s",
                        }}
                        onFocus={e => { e.target.style.borderColor = C.blue; e.target.style.background = C.bg0; }}
                        onBlur={e => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }}
                        placeholder="Account name"
                      />
                    </div>
                    <Btn small variant="ghost" onClick={() => deleteAccount(acct.id)} style={{ color: C.red }}><TrashIcon /></Btn>
                  </div>

                  {/* Connection status */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", padding: "6px 10px", background: acct.connected ? (C.greenDim) : (C.redDim), borderRadius: "4px", border: "1px solid " + (acct.connected ? C.green + "30" : C.red + "30") }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: acct.connected ? C.green : C.red, boxShadow: "0 0 6px " + (acct.connected ? C.green + "55" : C.red + "55") }} />
                      <span style={{ fontSize: "11px", fontWeight: 600, color: acct.connected ? C.green : C.red }}>
                        {acct.connected ? "Connected" : "Disconnected"}
                      </span>
                      {acctFeedback[acct.id] && !acct.connected && <span style={{ fontSize: "10px", fontWeight: 700, color: C.amber, marginLeft: "6px" }}>{acctFeedback[acct.id]}</span>}
                    </div>
                    <Btn small variant="default" onClick={() => connectAccount(acct.id)}>
                      {acctFeedback[acct.id] === "Connecting..." ? "..." : acct.connected ? "Disconnect" : "Connect"}
                    </Btn>
                  </div>

                  {/* Leverage bar */}
                  <div style={{ marginBottom: "10px", padding: "8px 10px", background: C.bg0, borderRadius: "4px", border: "1px solid " + C.border }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim }}>Leverage</span>
                      <span style={{ fontSize: "14px", fontWeight: 800, color: leverageColor }}>{leverage.toFixed(2)}x</span>
                    </div>
                    <div style={{ height: "4px", background: C.border, borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: Math.min(100, leverage * 50) + "%", background: leverageColor, borderRadius: "2px", transition: "width 0.3s" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", fontSize: "10px", color: C.textDim }}>
                      <span>Exposure: {fmt(acctNotional)}</span>
                      <span>Equity: {fmt(acct.equity)}</span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: "12px", marginBottom: "12px" }}>
                    {[["Net Liq", fmt(acct.equity), C.textBright], ["Cash", fmt(acct.cash), C.green], ["Buying Pwr", fmt(acct.buyingPower), C.blue], ["Margin", fmt(acct.marginUsed), C.amber]].map(function(item) {
                      return (
                        <div key={item[0]} style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: C.textDim }}>{item[0]}</span><span style={{ fontWeight: 700, color: item[2] }}>{item[1]}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ borderTop: "1px solid " + C.border, paddingTop: "10px" }}>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <div style={{ flex: 2 }}><Input label="Host" value={acct.host} onChange={e => updateAccount(acct.id, { host: e.target.value })} /></div>
                      <div style={{ flex: 1 }}><Input label="Port" type="number" value={acct.port} onChange={e => updateAccount(acct.id, { port: parseInt(e.target.value) || 0 })} /></div>
                      <div style={{ flex: 1 }}><Input label="CID" type="number" value={acct.clientId} onChange={e => updateAccount(acct.id, { client_id: parseInt(e.target.value) || 0, clientId: parseInt(e.target.value) || 0 })} /></div>
                    </div>
                    <div style={{ marginTop: "2px" }}>
                      <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "4px" }}>Equity Source</label>
                      <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
                        <button onClick={() => updateAccount(acct.id, { equitySource: "api", equity_source: "api" })} style={{
                          flex: 1, padding: "5px 0", borderRadius: "4px", border: "none", fontFamily: C.font,
                          background: (acct.equitySource || "api") === "api" ? C.blueDim : C.bg3,
                          color: (acct.equitySource || "api") === "api" ? C.blue : C.textDim,
                          fontSize: "10px", fontWeight: 700, cursor: "pointer",
                        }}>API (Live)</button>
                        <button onClick={() => updateAccount(acct.id, { equitySource: "manual", equity_source: "manual" })} style={{
                          flex: 1, padding: "5px 0", borderRadius: "4px", border: "none", fontFamily: C.font,
                          background: acct.equitySource === "manual" ? C.amberDim : C.bg3,
                          color: acct.equitySource === "manual" ? C.amber : C.textDim,
                          fontSize: "10px", fontWeight: 700, cursor: "pointer",
                        }}>Manual</button>
                      </div>
                      {acct.equitySource === "manual" ? (
                        <Input label="Manual Equity ($)" type="number" value={acct.equity} onChange={e => updateAccount(acct.id, { equity: parseFloat(e.target.value) || 0, manual_equity: parseFloat(e.target.value) || 0 })} />
                      ) : (
                        <div style={{ fontSize: "11px", color: C.textDim, padding: "4px 0" }}>
                          Equity pulled from TWS API (NetLiquidation). Current: <span style={{ color: C.textBright, fontWeight: 700 }}>{fmt(acct.equity)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════════ LOG ═══════════ */}
        {tab === "log" && (
          <div>
            <SectionHead right={
              <div style={{ display: "flex", gap: "6px" }}>
                {orderLog.length > 0 && (
                  <Btn small variant="primary" onClick={() => {
                    const filtered = orderLog.filter(l => !filterAcctId || l.account === (acctMap[filterAcctId]?.name || ""));
                    const headers = ["Date", "Time", "Account", "Symbol", "Side", "Type", "Shares", "Notional", "Price", "TIF", "RTH", "Status", "Realized P&L"];
                    const csvRows = [headers.join(",")];
                    filtered.forEach(l => {
                      csvRows.push([
                        l.date || "", l.time || "", '"' + (l.account || "") + '"', l.symbol || "", l.action || "", l.type || "",
                        typeof l.shares === "number" ? l.shares.toFixed(2) : (l.shares || ""),
                        l.notional ? l.notional.toFixed(2) : "",
                        typeof l.price === "number" ? l.price.toFixed(2) : (l.price || ""),
                        l.tif || "", l.outsideRth ? "Ext" : "RTH", l.status || "",
                        typeof l.realizedPnl === "number" ? l.realizedPnl.toFixed(2) : "0.00",
                      ].join(","));
                    });
                    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "porticus_order_log_" + new Date().toISOString().slice(0, 10) + ".csv";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}>Export CSV</Btn>
                )}
                {orderLog.length > 0 && <Btn small variant="default" onClick={() => setOrderLog([])}><TrashIcon /> Clear</Btn>}
              </div>
            }>Order Log ({orderLog.filter(l => !filterAcctId || l.account === (acctMap[filterAcctId]?.name || "")).length} entries)</SectionHead>
            {orderLog.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: C.textDim }}>No history.</div>
            ) : (
              <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1100px" }}>
                  <thead>
                    <tr>{["Date", "Time", "Account", "Symbol", "Side", "Type", "Shares", "Notional", "Price", "TIF", "RTH", "Status", "Real P&L"].map(h => (
                      <th key={h} style={{ textAlign: "left", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, padding: "8px 8px", borderBottom: "1px solid " + C.border, whiteSpace: "nowrap" }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {orderLog.filter(l => !filterAcctId || l.account === (acctMap[filterAcctId]?.name || "")).map(function(l, i) {
                      var rPnl = typeof l.realizedPnl === "number" ? l.realizedPnl : 0;
                      return (
                      <tr key={l.id || i} style={{ borderBottom: "1px solid " + C.bg0 }}>
                        <td style={{ padding: "8px 8px", color: C.textDim, fontSize: "11px", whiteSpace: "nowrap" }}>{l.date || "—"}</td>
                        <td style={{ padding: "8px 8px", color: C.textDim, fontSize: "11px" }}>{l.time}</td>
                        <td style={{ padding: "8px 8px", color: C.blue, fontSize: "12px" }}>{l.account}</td>
                        <td style={{ padding: "8px 8px", fontWeight: 700, color: C.textBright }}>{l.symbol}</td>
                        <td style={{ padding: "8px 8px" }}><Tag color={l.action === "BUY" ? "green" : "red"}>{l.action}</Tag></td>
                        <td style={{ padding: "8px 8px" }}><Tag color="blue">{l.type}</Tag></td>
                        <td style={{ padding: "8px 8px", fontWeight: 700 }}>{typeof l.shares === "number" ? fmtShares(l.shares) : l.shares}</td>
                        <td style={{ padding: "8px 8px" }}>{l.notional ? fmt(l.notional) : "—"}</td>
                        <td style={{ padding: "8px 8px" }}>{typeof l.price === "number" ? fmt(l.price) : l.price}</td>
                        <td style={{ padding: "8px 8px" }}>{l.tif}</td>
                        <td style={{ padding: "8px 8px" }}>{l.outsideRth ? "Ext" : "RTH"}</td>
                        <td style={{ padding: "8px 8px" }}><Tag color={l.status === "CANCELLED" ? "red" : l.status === "FILLED" ? "green" : "blue"}>{l.status}</Tag></td>
                        <td style={{ padding: "8px 8px" }}>{rPnl !== 0 ? <PnlValue value={rPnl} size="11px" /> : <span style={{ color: C.textDim }}>—</span>}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                {/* Summary footer */}
                {(function() {
                  var filtered = orderLog.filter(function(l) { return !filterAcctId || l.account === (acctMap[filterAcctId]?.name || ""); });
                  var totalReal = filtered.reduce(function(s, l) { return s + (typeof l.realizedPnl === "number" ? l.realizedPnl : 0); }, 0);
                  var filledCount = filtered.filter(function(l) { return l.status === "FILLED"; }).length;
                  var cancelledCount = filtered.filter(function(l) { return l.status === "CANCELLED"; }).length;
                  var submittedCount = filtered.filter(function(l) { return l.status === "SUBMITTED"; }).length;
                  // Per-account realized P&L
                  var acctPnls = {};
                  filtered.forEach(function(l) {
                    if (typeof l.realizedPnl === "number" && l.realizedPnl !== 0) {
                      var name = l.account || "Unknown";
                      acctPnls[name] = (acctPnls[name] || 0) + l.realizedPnl;
                    }
                  });
                  return (
                    <div style={{ padding: "10px 12px", borderTop: "1px solid " + C.border, fontSize: "11px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: Object.keys(acctPnls).length > 0 ? "8px" : "0" }}>
                        <div style={{ display: "flex", gap: "16px" }}>
                          <span style={{ color: C.textDim }}>Filled: <span style={{ color: C.green, fontWeight: 700 }}>{filledCount}</span></span>
                          <span style={{ color: C.textDim }}>Submitted: <span style={{ color: C.blue, fontWeight: 700 }}>{submittedCount}</span></span>
                          <span style={{ color: C.textDim }}>Cancelled: <span style={{ color: C.red, fontWeight: 700 }}>{cancelledCount}</span></span>
                        </div>
                        <div>
                          <span style={{ color: C.textDim }}>Total Realized P&L: </span>
                          <PnlValue value={totalReal} size="12px" />
                        </div>
                      </div>
                      {Object.keys(acctPnls).length > 0 && (
                        <div style={{ display: "flex", gap: "16px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                          {Object.entries(acctPnls).map(function(entry) {
                            return (
                              <span key={entry[0]} style={{ color: C.textDim }}>{entry[0]}: <PnlValue value={entry[1]} size="11px" /></span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
        {/* ═══════════ SETTINGS ═══════════ */}
        {tab === "settings" && (
          <div style={{ maxWidth: "800px" }}>
            <SectionHead>Settings</SectionHead>

            {/* ─── Backend Connection ─── */}
            <div style={{ background: C.bg2, border: "1px solid " + (backendConnected ? C.green + "40" : C.red + "40"), borderRadius: "6px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: C.textBright, marginBottom: "4px" }}>Backend Connection</div>
                <div style={{ fontSize: "11px", color: C.textDim }}>
                  The GUI connects to the Python backend automatically. The IB API is the single source of truth for all data.
                </div>
              </div>

              {/* Connection status */}
              <div style={{
                display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px",
                borderRadius: "4px", marginBottom: "12px",
                background: backendConnected ? C.greenDim : C.redDim,
                border: "1px solid " + (backendConnected ? C.green + "30" : C.red + "30"),
              }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%",
                  background: backendConnected ? C.green : C.red,
                  boxShadow: backendConnected ? ("0 0 6px " + C.green + "55") : "none",
                }} />
                <span style={{ fontSize: "12px", fontWeight: 600,
                  color: backendConnected ? C.green : C.red,
                }}>
                  {backendConnected ? "Connected to backend" : "Connecting... Make sure the backend is running."}
                </span>
              </div>

              {/* URL config */}
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 2 }}>
                  <Input label="Backend URL" value={backendUrl} onChange={function(e) {
                    setBackendUrl(e.target.value);
                    setWsUrl(e.target.value.replace("http", "ws") + "/ws");
                  }} placeholder="http://localhost:8000" />
                </div>
              </div>
              <div style={{ fontSize: "10px", color: C.textDim, marginTop: "6px" }}>
                Start the backend: <span style={{ fontFamily: C.font, color: C.blue }}>python ib_backend.py</span> — the GUI reconnects automatically every 3 seconds.
              </div>
            </div>

            {/* ─── Market Data ─── */}
            <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: C.textBright, marginBottom: "4px" }}>Live Market Data</div>
                  <div style={{ fontSize: "11px", color: C.textDim }}>
                    Optional — for displaying bid/ask/mid in the GUI. IB handles order pricing internally.
                  </div>
                </div>
                <Toggle on={marketDataEnabled} onChange={v => saveMarketDataSettings(v, marketDataSourceAcct)} />
              </div>

              {marketDataEnabled && (
                <div style={{ borderTop: "1px solid " + C.border, paddingTop: "12px" }}>
                  <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "6px" }}>
                    Source Account (which TWS connection provides the data feed)
                  </label>
                  <select
                    value={marketDataSourceAcct}
                    onChange={e => saveMarketDataSettings(marketDataEnabled, e.target.value)}
                    style={{
                      width: "100%", boxSizing: "border-box", background: C.bg0,
                      border: "1px solid " + C.border, borderRadius: "4px", color: C.text,
                      padding: "8px 10px", fontSize: "13px", fontFamily: C.font, outline: "none",
                      appearance: "none", cursor: "pointer",
                      backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23505b6e' d='M2 3.5l3 3 3-3'/%3E%3C/svg%3E\")",
                      backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
                    }}
                  >
                    <option value="none">Select an account...</option>
                    {accounts.filter(a => a.enabled).map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.host}:{a.port}) {a.connected ? "— Connected" : "— Disconnected"}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: "10px", color: C.textDim, marginTop: "6px" }}>
                    Choose which account's TWS connection to use for market data subscriptions.
                    Only one account needs a data subscription — quotes are shared across the GUI.
                  </div>
                </div>
              )}
            </div>

            {/* ─── Risk Warnings ─── */}
            <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: C.textBright, marginBottom: "4px" }}>Pre-Trade Risk Warnings</div>
                <div style={{ fontSize: "11px", color: C.textDim }}>
                  These generate warnings before order submission. They do NOT block orders — IB TWS has its own risk checks.
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
                <div>
                  <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "6px" }}>
                    Max Leverage
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="number" step="0.1" min="0.1" max="10"
                      value={riskMaxLeverage}
                      onChange={e => setRiskMaxLeverage(parseFloat(e.target.value) || 1)}
                      style={{
                        flex: 1, background: C.bg0, border: "1px solid " + C.border, borderRadius: "4px",
                        color: C.text, padding: "8px 10px", fontSize: "14px", fontFamily: C.font,
                        fontWeight: 700, outline: "none", textAlign: "center",
                      }}
                    />
                    <span style={{ color: C.textDim, fontSize: "14px", fontWeight: 700 }}>x</span>
                  </div>
                  <div style={{ fontSize: "10px", color: C.textDim, marginTop: "4px" }}>
                    Warn if total exposure / equity exceeds this
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "6px" }}>
                    Max Position %
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="number" step="1" min="1" max="100"
                      value={riskMaxPositionPct}
                      onChange={e => setRiskMaxPositionPct(parseFloat(e.target.value) || 10)}
                      style={{
                        flex: 1, background: C.bg0, border: "1px solid " + C.border, borderRadius: "4px",
                        color: C.text, padding: "8px 10px", fontSize: "14px", fontFamily: C.font,
                        fontWeight: 700, outline: "none", textAlign: "center",
                      }}
                    />
                    <span style={{ color: C.textDim, fontSize: "14px", fontWeight: 700 }}>%</span>
                  </div>
                  <div style={{ fontSize: "10px", color: C.textDim, marginTop: "4px" }}>
                    Warn if single position exceeds this % of equity
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: C.textDim, display: "block", marginBottom: "6px" }}>
                    Max Order Notional
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ color: C.textDim, fontSize: "14px", fontWeight: 700 }}>$</span>
                    <input
                      type="number" step="1000" min="0"
                      value={riskMaxOrderNotional}
                      onChange={e => setRiskMaxOrderNotional(parseFloat(e.target.value) || 0)}
                      style={{
                        flex: 1, background: C.bg0, border: "1px solid " + C.border, borderRadius: "4px",
                        color: C.text, padding: "8px 10px", fontSize: "14px", fontFamily: C.font,
                        fontWeight: 700, outline: "none", textAlign: "center",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: "10px", color: C.textDim, marginTop: "4px" }}>
                    Warn if single order exceeds this dollar amount
                  </div>
                </div>
              </div>
              <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
                <Btn small variant="primary" onClick={saveRiskSettings}>Save Risk Settings</Btn>
              </div>
            </div>

            {/* ─── Share Rounding ─── */}
            <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ marginBottom: "4px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: C.textBright, marginBottom: "4px" }}>Share Rounding</div>
                <div style={{ fontSize: "11px", color: C.textDim }}>
                  Proportional sizing often calculates fractional shares (e.g. 24.37). Orders are rounded down to whole shares by default to avoid over-allocating. The order preview shows the rounding impact.
                </div>
              </div>
            </div>

            {/* ─── Connection ─── */}
            <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: C.textBright, marginBottom: "4px" }}>Auto-Reconnection</div>
                <div style={{ fontSize: "11px", color: C.textDim }}>
                  If a TWS/Gateway connection drops (daily reset at 11:45 PM ET, network issues), the backend automatically reconnects with exponential backoff: 1s, 2s, 5s, 10s, 30s, 60s. No action needed.
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                {accounts.filter(a => a.enabled).map(function(a, i) {
                  return (
                  <div key={a.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 12px",
                    borderBottom: "1px solid " + C.bg0,
                    background: i % 2 === 0 ? "transparent" : C.bg0 + "40",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: a.connected ? C.green : C.red, boxShadow: "0 0 6px " + (a.connected ? C.green + "55" : C.red + "55") }} />
                      <span style={{ fontSize: "12px", fontWeight: 600, color: C.textBright }}>{a.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "11px", color: C.textDim }}>{a.host}:{a.port}</span>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: a.connected ? C.green : C.red }}>
                        {a.connected ? "Connected" : "Disconnected"}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            {/* ─── Sound Settings ─── */}
            <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: C.textBright, marginBottom: "4px" }}>Sound Alerts</div>
                <div style={{ fontSize: "11px", color: C.textDim }}>
                  Place .mp3 files in <span style={{ fontFamily: C.font, color: C.blue }}>public/sounds/</span> folder of the React app.
                  Files: fill.mp3, partial_fill.mp3, disconnect.mp3, connect.mp3, pnl_alert.mp3
                </div>
              </div>

              {/* Volume slider */}
              <div style={{ marginBottom: "14px", display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, width: "60px" }}>Volume</span>
                <input
                  type="range" min="0" max="100" value={soundVolume}
                  onChange={e => { var v = parseInt(e.target.value); setSoundVolume(v); sound.setVolume(v / 100); }}
                  style={{ flex: 1, accentColor: C.blue }}
                />
                <span style={{ fontSize: "12px", fontWeight: 700, color: C.textBright, width: "36px", textAlign: "right" }}>{soundVolume}%</span>
              </div>

              {/* Per-sound toggles */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                {[
                  { key: "fill", label: "Order Filled", desc: "Plays when an order fully executes", color: C.green },
                  { key: "partial_fill", label: "Partial Fill", desc: "Plays on each partial fill", color: C.amber },
                  { key: "disconnect", label: "Disconnection", desc: "Alert when an account loses connection", color: C.red },
                  { key: "connect", label: "Connected", desc: "Confirmation when account connects", color: C.green },
                  { key: "pnl_alert", label: "P&L Alert", desc: "Warning when unrealized loss exceeds -$1,000", color: C.amber },
                ].map(function(item, i) {
                  return (
                    <div key={item.key} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 12px", borderBottom: "1px solid " + C.bg0,
                      background: i % 2 === 0 ? "transparent" : C.bg0 + "40",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: C.textBright }}>{item.label}</div>
                          <div style={{ fontSize: "10px", color: C.textDim }}>{item.desc}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <Btn small variant="default" onClick={function() { sound.play(item.key); }} style={{ fontSize: "9px", padding: "2px 8px" }}>Test</Btn>
                        <Toggle on={soundEnabled[item.key]} onChange={function(v) {
                          sound.setEnabled(item.key, v);
                          setSoundEnabled(function(prev) { var next = Object.assign({}, prev); next[item.key] = v; return next; });
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: "10px", fontSize: "10px", color: C.textDim }}>
                Sound files not found? Create a <span style={{ fontFamily: C.font, color: C.blue }}>public/sounds/</span> folder and add your .mp3 files.
                The Test button will play silently if the file is missing.
              </div>
            </div>

            {/* ─── Data Architecture ─── */}
            <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", padding: "20px" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: C.textBright, marginBottom: "4px" }}>Data Architecture</div>
                <div style={{ fontSize: "11px", color: C.textDim, lineHeight: 1.7 }}>
                  Current state (positions, orders, equity, P&L) always comes from the IB API in real-time.
                  The SQLite database (ib_terminal.db) is an append-only archive used only for the order log, commission tracking, and end-of-day blotter reports. It is never used as a source of truth for live data.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════ DIAGNOSTICS ═══════════ */}
        {tab === "diag" && (
          <div>
            <SectionHead right={
              <div style={{ display: "flex", gap: "6px" }}>
                {["all", "error", "warn", "info"].map(function(lvl) {
                  return <Btn key={lvl} small variant={diagFilter === lvl ? "primary" : "default"} onClick={function() { setDiagFilter(lvl); }}>
                    {lvl === "all" ? "All" : lvl.toUpperCase()}
                  </Btn>;
                })}
                <span style={{ width: "1px", height: "18px", background: C.border }} />
                {["all", "API", "WS", "IB", "REACT"].map(function(src) {
                  return <Btn key={src} small variant={diagSourceFilter === src ? "primary" : "default"} onClick={function() { setDiagSourceFilter(src); }}>
                    {src === "all" ? "All Sources" : src}
                  </Btn>;
                })}
                <Btn small variant="default" onClick={function() {
                  var rows = ["Time,Level,Source,Message,Detail"];
                  diagLog.forEach(function(d) { rows.push([d.date + " " + d.time, d.level, d.source, "\"" + (d.message || "").replace(/"/g, '""') + "\"", "\"" + (d.detail || "").replace(/"/g, '""') + "\""].join(",")); });
                  var blob = new Blob([rows.join("\n")], { type: "text/csv" });
                  var url = URL.createObjectURL(blob);
                  var a = document.createElement("a"); a.href = url; a.download = "diagnostics_" + new Date().toISOString().slice(0, 10) + ".csv"; a.click();
                }}>Export CSV</Btn>
                <Btn small variant="default" onClick={function() { _diagLog.length = 0; setDiagLog([]); }}><TrashIcon /> Clear</Btn>
              </div>
            }>Diagnostics ({diagLog.length} entries · {diagLog.filter(function(d) { return d.level === "error"; }).length} errors)</SectionHead>
            {diagLog.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: C.textDim }}>No diagnostic entries. Errors from API, WebSocket, IB, and React will appear here.</div>
            ) : (
              <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "6px", overflow: "hidden" }}>
                <div style={{ overflowX: "auto", maxHeight: "600px", overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                  <thead>
                    <tr>
                      {["Time", "Level", "Source", "Message", "Detail"].map(function(h) {
                        return <th key={h} style={{ textAlign: "left", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textDim, padding: "8px 8px", borderBottom: "1px solid " + C.border, position: "sticky", top: 0, background: C.bg2, zIndex: 1 }}>{h}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {diagLog.filter(function(d) { return (diagFilter === "all" || d.level === diagFilter) && (diagSourceFilter === "all" || d.source === diagSourceFilter); }).map(function(d) {
                      var levelColor = d.level === "error" ? C.red : d.level === "warn" ? C.amber : C.textDim;
                      var sourceColors = { API: C.blue, WS: C.green, IB: C.amber, UI: C.textBright, REACT: C.red };
                      return (
                        <tr key={d.id} style={{ borderBottom: "1px solid " + C.bg0, opacity: d.level === "info" ? 0.7 : 1 }}>
                          <td style={{ padding: "6px 8px", fontSize: "11px", color: C.textDim, whiteSpace: "nowrap", fontFamily: C.font }}>{d.date} {d.time}</td>
                          <td style={{ padding: "6px 8px" }}>
                            <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", borderRadius: "3px", background: d.level === "error" ? C.redDim : d.level === "warn" ? C.amberDim : C.bg3, color: levelColor }}>{d.level.toUpperCase()}</span>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <span style={{ fontSize: "10px", fontWeight: 700, color: sourceColors[d.source] || C.textDim }}>{d.source}</span>
                          </td>
                          <td style={{ padding: "6px 8px", fontSize: "11px", color: C.textBright, maxWidth: "400px", overflow: "hidden", textOverflow: "ellipsis" }}>{d.message}</td>
                          <td style={{ padding: "6px 8px", fontSize: "10px", color: C.textDim, fontFamily: C.font, maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.detail}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ═══════════ EXIT MODAL (state-aware) ═══════════ */}
      {exitModal && (
        <div style={{ position: "fixed", inset: 0, background: "#00000088", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setExitModal(null)}>
          <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "24px", width: "520px", maxWidth: "90vw" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: "16px", fontWeight: 800, color: C.textBright, marginBottom: "4px" }}>Exit {exitModal.symbol}</div>
            <div style={{ fontSize: "12px", color: C.textDim, marginBottom: "16px" }}>
              {exitModal.pct === "custom" ? "Enter custom exit percentage" : `Close ${exitModal.pct}% across all accounts`}
            </div>
            {exitModal.pct === "custom" && (
              <div style={{ marginBottom: "16px" }}>
                <Input label="Exit %" type="number" min="1" max="100" value={customExitPct} onChange={e => setCustomExitPct(e.target.value)} placeholder="e.g. 33" />
              </div>
            )}
            {(() => {
              const pos = positions.find(p => p.symbol === exitModal.symbol);
              const pct = exitModal.pct === "custom" ? (parseFloat(customExitPct) || 0) : exitModal.pct;
              if (!pos || !pct) return null;
              let anySkipped = false;
              return (
                <div style={{ marginBottom: "16px" }}>
                  {pos.accounts.map(a => {
                    const netExp = getNetExposure(exitModal.symbol, a.accountId, a.shares);
                    const absNet = Math.abs(netExp);
                    const exitShares = Math.round(Math.min(absNet, Math.abs(a.shares) * (pct / 100)) * 100) / 100;
                    const covered = absNet <= 0.01;
                    if (covered) anySkipped = true;
                    return (
                      <div key={a.accountId} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: "12px", opacity: covered ? 0.4 : 1 }}>
                        <span style={{ color: C.blue }}>{acctMap[a.accountId]?.name}</span>
                        {covered ? (
                          <span style={{ color: C.amber, fontWeight: 600 }}>Covered by working orders — SKIP</span>
                        ) : (
                          <span>
                            {a.shares > 0 ? "SELL" : "BUY"} <span style={{ fontWeight: 700, color: C.textBright }}>{fmtShares(exitShares)}</span> shs
                            {absNet < Math.abs(a.shares) - 0.01 && <span style={{ color: C.amber, marginLeft: "6px", fontSize: "10px" }}>(net: {absNet})</span>}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {anySkipped && (
                    <div style={{ marginTop: "8px", padding: "8px 10px", background: C.amberDim, border: `1px solid ${C.amber}30`, borderRadius: "4px", fontSize: "11px", color: C.amber, display: "flex", alignItems: "center", gap: "6px" }}>
                      <AlertIcon /> Some accounts skipped — working orders already cover the position.
                    </div>
                  )}
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: "8px" }}>
              <Btn variant="danger" full onClick={() => executeExit(exitModal.symbol, exitModal.pct === "custom" ? parseFloat(customExitPct) || 0 : exitModal.pct)}
                disabled={exitModal.pct === "custom" && (!customExitPct || parseFloat(customExitPct) <= 0 || parseFloat(customExitPct) > 100)}>
                Confirm Exit
              </Btn>
              <Btn variant="default" onClick={() => setExitModal(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ PER-ACCOUNT EXIT MODAL ═══════════ */}
      {acctExitModal && (
        <div style={{ position: "fixed", inset: 0, background: "#00000088", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setAcctExitModal(null)}>
          <div style={{ background: C.bg2, border: "1px solid " + C.border, borderRadius: "8px", padding: "24px", width: "420px", maxWidth: "90vw" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: "16px", fontWeight: 800, color: C.textBright, marginBottom: "4px" }}>
              Close {acctExitModal.symbol} — {acctExitModal.accountName}
            </div>
            <div style={{ fontSize: "12px", color: C.textDim, marginBottom: "16px" }}>
              Position: {acctExitModal.shares > 0 ? "LONG" : "SHORT"} {Math.abs(acctExitModal.shares)} shares
            </div>
            <div style={{ marginBottom: "12px" }}>
              <Input label="Custom Exit %" type="number" min="1" max="100" value={acctCustomExitPct} onChange={e => setAcctCustomExitPct(e.target.value)} placeholder="e.g. 33" />
            </div>
            {acctCustomExitPct && parseFloat(acctCustomExitPct) > 0 && (
              <div style={{ background: C.bg0, borderRadius: "4px", padding: "10px 12px", marginBottom: "12px", fontSize: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: C.textDim }}>Exit shares:</span>
                  <span style={{ fontWeight: 700, color: C.textBright }}>{Math.floor(Math.abs(acctExitModal.shares) * (parseFloat(acctCustomExitPct) / 100))}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.textDim }}>Est. notional:</span>
                  <span style={{ fontWeight: 700, color: C.textBright }}>{fmt(Math.floor(Math.abs(acctExitModal.shares) * (parseFloat(acctCustomExitPct) / 100)) * acctExitModal.currentPrice)}</span>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <Btn variant="danger" full disabled={!acctCustomExitPct || parseFloat(acctCustomExitPct) <= 0}
                onClick={function() { closeAccountPosition(acctExitModal.symbol, acctExitModal.accountId, parseFloat(acctCustomExitPct)); }}>
                Close {acctCustomExitPct || "X"}%
              </Btn>
              <Btn variant="default" onClick={() => setAcctExitModal(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ MODIFY MODAL ═══════════ */}
      {modifyOrder && (
        <div style={{ position: "fixed", inset: 0, background: "#00000088", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setModifyOrder(null)}>
          <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "24px", width: "380px" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: "16px", fontWeight: 800, color: C.textBright, marginBottom: "12px" }}>Modify {modifyOrder.symbol} {modifyOrder.type} — {modifyOrder.account}</div>
            <Input label="New Price ($)" type="number" step="0.01" value={modifyPrice} onChange={e => setModifyPrice(e.target.value)} />
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <Btn variant="primary" full onClick={modifyOrderPrice}>Update</Btn>
              <Btn variant="default" onClick={() => setModifyOrder(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ ALERT TOASTS ═══════════ */}
      {alerts.length > 0 && (
        <div style={{ position: "fixed", top: "56px", right: "16px", zIndex: 2000, display: "flex", flexDirection: "column", gap: "6px", maxWidth: "360px" }}
          onClick={function(e) { e.stopPropagation(); }}>
          <button onClick={function(e) { e.stopPropagation(); setAlerts([]); }} style={{
            alignSelf: "stretch", background: C.red, border: "none", borderRadius: "4px",
            color: "#fff", cursor: "pointer", fontSize: "11px", fontWeight: 700, padding: "6px 12px", fontFamily: C.font,
          }}>✕ CLOSE ALL ({alerts.length})</button>
          {alerts.slice(0, 5).map(function(alert) {
            var borderColor = alert.level === "critical" ? C.red : alert.level === "warning" ? C.amber : C.blue;
            var bgColor = alert.level === "critical" ? C.redDim : alert.level === "warning" ? C.amberDim : C.blueDim;
            return (
              <div key={alert.id} style={{
                background: bgColor, border: "1px solid " + borderColor + "60", borderRadius: "6px",
                padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.4)", animation: "fadeIn 0.2s",
              }}>
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: borderColor, marginBottom: "2px" }}>{alert.level === "critical" ? "CRITICAL" : alert.level === "warning" ? "WARNING" : "INFO"}</div>
                  <div style={{ fontSize: "12px", color: C.textBright }}>{alert.message}</div>
                  <div style={{ fontSize: "9px", color: C.textDim, marginTop: "2px" }}>{alert.time}</div>
                </div>
                <button onClick={function(e) { e.stopPropagation(); setAlerts(function(prev) { return prev.filter(function(a) { return a.id !== alert.id; }); }); }}
                  style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: "16px", padding: "2px 4px", lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg0}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        input:focus, select:focus { border-color: ${C.blue} !important; outline: none; }
        button:hover:not(:disabled) { filter: brightness(1.15); }
        tbody tr { transition: background 0.08s; }
        tbody tr:hover { background: #1a2236 !important; }
        tbody tr:hover td { background: transparent !important; }
      `}</style>
    </div>
  );
}

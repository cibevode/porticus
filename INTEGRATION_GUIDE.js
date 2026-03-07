/**
 * IB Terminal — Porticus Capital
 * API Connector Module
 * 
 * This file contains all the functions to connect the React frontend
 * to the Python FastAPI backend. 
 * 
 * INTEGRATION GUIDE:
 * ==================
 * 
 * The React GUI (ib-terminal.jsx) currently uses mock data in useState.
 * To go live, you need to:
 * 
 * 1. Add this file to your project
 * 2. Modify ib-terminal.jsx to import and use these functions
 * 3. The specific changes are documented below
 * 
 * 
 * OPTION A: Quick Integration (modify the existing .jsx)
 * ======================================================
 * 
 * Add this at the top of ib-terminal.jsx:
 * 
 *   const API_URL = "http://localhost:8000";
 *   const WS_URL = "ws://localhost:8000/ws";
 * 
 * Replace the useState initializations:
 * 
 *   // BEFORE (mock data):
 *   const [accounts, setAccounts] = useState(MOCK_ACCOUNTS);
 *   const [positions, setPositions] = useState(MOCK_POSITIONS);
 *   const [openOrders, setOpenOrders] = useState(MOCK_OPEN_ORDERS);
 * 
 *   // AFTER (empty, filled by WebSocket):
 *   const [accounts, setAccounts] = useState([]);
 *   const [positions, setPositions] = useState([]);
 *   const [openOrders, setOpenOrders] = useState([]);
 * 
 * Add the WebSocket hook inside the component:
 * 
 *   useEffect(() => {
 *     const socket = new WebSocket(WS_URL);
 *     
 *     socket.onopen = () => console.log("WebSocket connected");
 *     
 *     socket.onmessage = (event) => {
 *       const msg = JSON.parse(event.data);
 *       
 *       if (msg.type === "state") {
 *         // Full state update (every 1 second)
 *         const data = msg.data;
 *         
 *         // Update accounts
 *         setAccounts(data.accounts.map(a => ({
 *           id: a.id,
 *           name: a.name,
 *           host: a.host,
 *           port: a.port,
 *           clientId: a.client_id,
 *           equity: a.equity,
 *           cash: a.cash,
 *           buyingPower: a.buying_power,
 *           marginUsed: a.margin_used,
 *           enabled: a.enabled,
 *           connected: a.connected,
 *           equitySource: a.equity_source,
 *         })));
 *         
 *         // Update positions
 *         setPositions(data.positions.map(p => ({
 *           symbol: p.symbol,
 *           accounts: p.accounts.map(a => ({
 *             accountId: a.account_id,
 *             shares: a.shares,
 *             avgCost: a.avg_cost,
 *             currentPrice: a.current_price,
 *             realizedPnl: a.realized_pnl || 0,
 *           })),
 *         })));
 *         
 *         // Update open orders from accounts
 *         const allOrders = [];
 *         data.accounts.forEach(a => {
 *           (a.open_orders || []).forEach(o => {
 *             allOrders.push({
 *               id: "ORD-" + o.order_id,
 *               symbol: o.symbol,
 *               action: o.action,
 *               type: o.type,
 *               shares: o.shares,
 *               filled: o.filled || 0,
 *               price: o.price,
 *               tif: o.tif,
 *               account: a.name,
 *               accountId: a.id,
 *               status: o.filled > 0 && o.filled < o.shares ? "PARTIAL" : o.status,
 *               time: o.time,
 *               date: o.date,
 *               outsideRth: o.outside_rth,
 *             });
 *           });
 *         });
 *         setOpenOrders(allOrders);
 *       }
 *       
 *       if (msg.type === "order_update") {
 *         // Real-time order status change (partial fill, fill, cancel)
 *         // The next full state push will include this, but this gives
 *         // instant feedback
 *         console.log("Order update:", msg.order);
 *       }
 *     };
 *     
 *     socket.onclose = () => {
 *       console.log("WebSocket disconnected, reconnecting in 3s...");
 *       setTimeout(() => {
 *         // Reconnect logic — in production use a proper reconnect library
 *       }, 3000);
 *     };
 *     
 *     return () => socket.close();
 *   }, []);
 * 
 * 
 * Replace the submitOrders function:
 * 
 *   const submitOrders = async () => {
 *     try {
 *       const response = await fetch(API_URL + "/api/order/proportional", {
 *         method: "POST",
 *         headers: { "Content-Type": "application/json" },
 *         body: JSON.stringify({
 *           symbol: symbol.toUpperCase(),
 *           action: action,
 *           order_type: orderType,
 *           allocation_pct: allocPct,
 *           limit_price: needsLimit ? parseFloat(limitPrice) : null,
 *           stop_price: needsStop ? parseFloat(stopPrice) : null,
 *           tif: tif,
 *           outside_rth: outsideRth,
 *           exchange: exchange,
 *           account_ids: Array.from(orderAcctIds),
 *           bracket: bracketEnabled,
 *           profit_target: bracketEnabled ? parseFloat(profitTarget) : null,
 *           stop_loss: bracketEnabled ? parseFloat(stopLoss) : null,
 *         }),
 *       });
 *       const data = await response.json();
 *       console.log("Order results:", data);
 *       // Orders will appear via WebSocket state update
 *       setShowConfirm(false);
 *     } catch (err) {
 *       console.error("Order submission failed:", err);
 *       alert("Order submission failed: " + err.message);
 *     }
 *   };
 * 
 * 
 * Replace the executeExit function:
 * 
 *   const executeExit = async (sym, pct) => {
 *     try {
 *       const response = await fetch(API_URL + "/api/exit", {
 *         method: "POST",
 *         headers: { "Content-Type": "application/json" },
 *         body: JSON.stringify({
 *           symbol: sym,
 *           exit_pct: pct,
 *           order_type: "MIDPRICE",
 *           account_ids: null,  // null = all accounts with position
 *         }),
 *       });
 *       const data = await response.json();
 *       console.log("Exit results:", data);
 *       setExitModal(null);
 *     } catch (err) {
 *       console.error("Exit failed:", err);
 *     }
 *   };
 * 
 * 
 * Replace the killAll function:
 * 
 *   const killAll = async () => {
 *     try {
 *       const response = await fetch(API_URL + "/api/kill", {
 *         method: "POST",
 *       });
 *       const data = await response.json();
 *       console.log("Kill all results:", data);
 *       setShowKillConfirm(false);
 *       setKillCheckbox(false);
 *     } catch (err) {
 *       console.error("Kill all failed:", err);
 *     }
 *   };
 * 
 * 
 * Replace the cancelOrder function:
 * 
 *   const cancelOrder = async (orderId) => {
 *     // Find the order to get the account ID
 *     const order = openOrders.find(o => o.id === orderId);
 *     if (!order) return;
 *     try {
 *       await fetch(
 *         API_URL + "/api/order/" + order.accountId + "/" + orderId.replace("ORD-","") + "/cancel",
 *         { method: "POST" }
 *       );
 *     } catch (err) {
 *       console.error("Cancel failed:", err);
 *     }
 *   };
 * 
 * 
 * Replace the cancelSymbolOrders function:
 * 
 *   const cancelSymbolOrders = async (sym) => {
 *     try {
 *       await fetch(API_URL + "/api/cancel-symbol/" + sym, { method: "POST" });
 *     } catch (err) {
 *       console.error("Cancel symbol orders failed:", err);
 *     }
 *   };
 * 
 * 
 * Replace connect/disconnect buttons on accounts page:
 * 
 *   // In the account card connect/disconnect button:
 *   onClick={async () => {
 *     const endpoint = acct.connected ? "disconnect" : "connect";
 *     await fetch(API_URL + "/api/accounts/" + acct.id + "/" + endpoint, {
 *       method: "POST"
 *     });
 *   }}
 * 
 * 
 * OPTION B: Full Production Setup
 * ================================
 * 
 * For a proper production deployment:
 * 
 * 1. Create a React app:
 *    npx create-react-app ib-terminal
 *    cd ib-terminal
 * 
 * 2. Install Tailwind CSS:
 *    npm install -D tailwindcss
 *    npx tailwindcss init
 * 
 * 3. Copy ib-terminal.jsx into src/App.jsx
 * 
 * 4. Apply the integration changes from Option A above
 * 
 * 5. Run:
 *    npm start          # Frontend on http://localhost:3000
 *    python ib_backend.py  # Backend on http://localhost:8000
 * 
 * The React dev server will proxy API calls to the backend.
 * Add this to package.json:
 *    "proxy": "http://localhost:8000"
 * 
 * 
 * TESTING WITHOUT TWS
 * ====================
 * 
 * You can test the backend without a live TWS connection by using
 * IB Gateway in paper trading mode:
 * 
 * 1. Download IB Gateway from:
 *    https://www.interactivebrokers.com/en/trading/ibgateway-stable.php
 * 
 * 2. Log in with your paper trading credentials
 *    (same username, but the paper trading port is 4002 instead of 4001)
 * 
 * 3. Update config.json to use port 4002
 * 
 * 4. Run ib_backend.py — it will connect to paper trading
 *    and you can test everything without risking real money
 */

// This file is documentation only — no executable code needed.
// All integration is done by modifying ib-terminal.jsx as described above.

# IB Terminal — Porticus Capital
## Multi-Account TWS Gateway Order Management System

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React Frontend (GUI)                       │
│         Positions │ Orders │ New Order │ Accounts │ Log       │
└──────────┬──────────────────┬────────────────────────────────┘
           │ WebSocket (ws)    │ REST API (http)
           │ Real-time state   │ Order actions
           ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│               FastAPI Backend (ib_backend.py)                 │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    ┌──────────┐   │
│  │IBAccount │  │IBAccount │  │IBAccount │ .. │IBAccount │   │
│  │  (IB())  │  │  (IB())  │  │  (IB())  │    │  (IB())  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘    └────┬─────┘   │
└───────┼──────────────┼──────────────┼──────────────┼─────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │TWS/GW   │   │TWS/GW   │   │TWS/GW   │   │TWS/GW   │
   │Port 7496│   │Port 7497│   │Port 7498│   │Port 749x│
   │ Acct #1 │   │ Acct #2 │   │ Acct #3 │   │ Acct #N │
   └─────────┘   └─────────┘   └─────────┘   └─────────┘
```

### Prerequisites

1. **Python 3.10+**
2. **IB TWS or IB Gateway** running for each account
   - Each account needs its own TWS/Gateway instance on a different port
   - Default ports: 7496 (TWS live), 7497, 7498... or 4001 (Gateway live), 4002...

### TWS/Gateway Setup (per account)

1. Open TWS or IB Gateway and log in
2. Go to **Edit → Global Configuration → API → Settings**
3. Check **Enable ActiveX and Socket Clients**
4. Set **Socket port** (unique per account: 7496, 7497, 7498...)
5. Uncheck **Read-Only API** (required for order placement)
6. Add **127.0.0.1** to Trusted IPs
7. Check **Allow connections from localhost only** (security)

### Installation

```bash
# Clone/download the files
cd ib-terminal

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or: venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt
```

### Configuration

Edit `config.json` to match your accounts:

```json
{
  "accounts": [
    {
      "id": 1,
      "name": "My IRA",
      "host": "127.0.0.1",
      "port": 7496,
      "client_id": 1,
      "enabled": true,
      "equity_source": "api",
      "manual_equity": 0
    }
  ]
}
```

Key settings:
- **port**: Must match the TWS/Gateway socket port for this account
- **client_id**: Must be unique across all connections to the same TWS instance
- **equity_source**: `"api"` pulls NetLiquidation from IB, `"manual"` uses your override

### Running

```bash
# Start the backend
python ib_backend.py

# Backend runs on http://localhost:8000
# WebSocket on ws://localhost:8000/ws
# API docs at http://localhost:8000/docs
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/state` | Full system state snapshot |
| GET | `/api/accounts` | All account statuses |
| POST | `/api/accounts/{id}/connect` | Connect specific account |
| POST | `/api/accounts/{id}/disconnect` | Disconnect specific account |
| POST | `/api/accounts/{id}/equity` | Set equity source (api/manual) |
| POST | `/api/order` | Place fixed-quantity order |
| POST | `/api/order/proportional` | Place %-of-equity order |
| POST | `/api/order/{acct}/{id}/cancel` | Cancel specific order |
| POST | `/api/order/{acct}/{id}/modify` | Modify order price |
| POST | `/api/exit` | Exit position (% based, net-aware) |
| POST | `/api/kill` | Emergency flatten all + cancel all |
| POST | `/api/cancel-symbol/{sym}` | Cancel all orders for a symbol |
| WS | `/ws` | Real-time state stream (1/sec) |

### WebSocket Data Format

The backend pushes full state every second:

```json
{
  "type": "state",
  "data": {
    "accounts": [...],
    "positions": [...],
    "timestamp": "2025-03-05T10:30:00"
  }
}
```

Order updates are pushed immediately:

```json
{
  "type": "order_update",
  "account_id": 1,
  "account_name": "Account 1",
  "order": {
    "order_id": 42,
    "symbol": "MSFT",
    "action": "BUY",
    "type": "LMT",
    "shares": 120,
    "filled": 20,
    "status": "PARTIAL",
    ...
  }
}
```

### Connecting the Frontend

To wire the React GUI to the live backend, replace the mock data with WebSocket state:

```javascript
// In the React component, add:
const [ws, setWs] = useState(null);

useEffect(() => {
  const socket = new WebSocket("ws://localhost:8000/ws");
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      setAccounts(msg.data.accounts);
      setPositions(msg.data.positions);
    }
    if (msg.type === "order_update") {
      // Update specific order in state
    }
  };
  setWs(socket);
  return () => socket.close();
}, []);

// Replace mock submit with API call:
const submitOrders = async () => {
  const response = await fetch("http://localhost:8000/api/order/proportional", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: symbol,
      action: action,
      order_type: orderType,
      allocation_pct: allocPct,
      limit_price: parseFloat(limitPrice) || null,
      stop_price: parseFloat(stopPrice) || null,
      tif: tif,
      outside_rth: outsideRth,
      exchange: exchange,
      account_ids: Array.from(orderAcctIds),
    }),
  });
  const data = await response.json();
  console.log("Order results:", data);
};
```

### Safety Features

- **Net Exposure Calculation**: Exit orders check working orders to prevent over-selling
- **Kill All**: Cancels orders FIRST, pauses, then flattens — prevents double-execution
- **Smart Stop Routing**: LONG → SELL STP, SHORT → BUY STP, FLAT → user choice
- **Duplicate Detection**: Warns when same symbol+type already has working orders
- **Partial Fill Tracking**: Real-time fill qty updates via orderStatusEvent

### Troubleshooting

| Issue | Fix |
|-------|-----|
| Connection refused | Check TWS/Gateway is running and API is enabled |
| "Port already in use" | Each account needs unique port + client_id |
| No data flowing | Verify "Enable ActiveX and Socket Clients" in TWS |
| Orders rejected | Ensure "Read-Only API" is UNCHECKED in TWS |
| Stale data | Check market data subscriptions in TWS |

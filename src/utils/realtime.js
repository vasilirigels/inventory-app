// Single shared WebSocket connection to the server's /ws endpoint. Components
// subscribe to a `table` name and get called back when the server broadcasts
// a change. Reconnects automatically on disconnect (5s backoff).

const listeners = new Map(); // table -> Set<callback>
let ws = null;
let reconnectTimer = null;

function connect() {
  if (ws && ws.readyState !== WebSocket.CLOSED) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws`;
  try {
    ws = new WebSocket(url);
  } catch (_) {
    scheduleReconnect();
    return;
  }
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg?.type !== 'change') return;
    const cbs = listeners.get(msg.table);
    if (!cbs) return;
    for (const cb of cbs) {
      try { cb(msg); } catch (_) {}
    }
  };
  ws.onclose = scheduleReconnect;
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

export function initRealtime() {
  connect();
}

export function subscribe(table, cb) {
  if (!listeners.has(table)) listeners.set(table, new Set());
  listeners.get(table).add(cb);
  connect();
  return () => {
    const set = listeners.get(table);
    if (set) set.delete(cb);
  };
}

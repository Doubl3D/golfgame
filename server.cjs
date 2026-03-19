// Production server: serves static game files + WebSocket relay on one port
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, 'dist', 'public');

// MIME types for static file serving
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.wasm': 'application/wasm',
};

// HTTP server for static files
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);

  // Security: prevent path traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // SPA fallback: serve index.html for non-file routes
      filePath = path.join(STATIC_DIR, 'index.html');
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }
      const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

// ========== WebSocket relay (same as peerserver.cjs) ==========
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map();

wss.on('connection', (ws) => {
  let role = null;
  let roomCode = null;
  let slotIndex = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.action === 'host') {
      roomCode = msg.code;
      role = 'host';
      rooms.set(roomCode, { host: ws, guests: [null, null, null] });
      ws.send(JSON.stringify({ action: 'hosted', code: roomCode }));
      console.log(`[HOST] Room "${roomCode}" created`);
    }
    else if (msg.action === 'join') {
      roomCode = msg.code;
      role = 'guest';
      const room = rooms.get(roomCode);
      if (!room || !room.host || room.host.readyState !== 1) {
        ws.send(JSON.stringify({ action: 'error', message: 'Room not found' }));
        return;
      }
      slotIndex = room.guests.indexOf(null);
      if (slotIndex === -1) {
        ws.send(JSON.stringify({ action: 'error', message: 'Room is full (max 4 players)' }));
        return;
      }
      room.guests[slotIndex] = ws;
      const connectedCount = room.guests.filter(g => g !== null).length;
      ws.send(JSON.stringify({ action: 'joined', playerIndex: slotIndex + 1 }));
      room.host.send(JSON.stringify({ action: 'guest-joined', guestCount: connectedCount, slotIndex }));
      console.log(`[GUEST] Joined room "${roomCode}" slot ${slotIndex}`);
    }
    else if (msg.action === 'rejoin') {
      roomCode = msg.code;
      role = 'guest';
      const requestedSlot = msg.slotIndex;
      const room = rooms.get(roomCode);
      if (!room || !room.host || room.host.readyState !== 1) {
        ws.send(JSON.stringify({ action: 'error', message: 'Room not found' }));
        return;
      }
      if (requestedSlot >= 0 && requestedSlot < 3 && room.guests[requestedSlot] === null) {
        slotIndex = requestedSlot;
      } else {
        slotIndex = room.guests.indexOf(null);
      }
      if (slotIndex === -1) {
        ws.send(JSON.stringify({ action: 'error', message: 'No available slot' }));
        return;
      }
      room.guests[slotIndex] = ws;
      const connectedCount = room.guests.filter(g => g !== null).length;
      ws.send(JSON.stringify({ action: 'rejoined', playerIndex: slotIndex + 1 }));
      room.host.send(JSON.stringify({ action: 'guest-rejoined', guestCount: connectedCount, slotIndex, playerIndex: slotIndex + 1 }));
      console.log(`[GUEST] Rejoined room "${roomCode}" slot ${slotIndex}`);
    }
    else if (msg.action === 'relay') {
      const room = rooms.get(roomCode);
      if (!room) return;
      const payload = JSON.stringify({ action: 'message', data: msg.data });

      if (role === 'host') {
        for (const g of room.guests) {
          if (g && g.readyState === 1) g.send(payload);
        }
      } else {
        if (room.host && room.host.readyState === 1) {
          room.host.send(payload);
        }
        for (const g of room.guests) {
          if (g && g !== ws && g.readyState === 1) g.send(payload);
        }
      }
    }
  });

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'host') {
      for (const g of room.guests) {
        if (g && g.readyState === 1) g.send(JSON.stringify({ action: 'disconnected' }));
      }
      rooms.delete(roomCode);
      console.log(`[HOST] Room "${roomCode}" closed`);
    } else {
      if (slotIndex >= 0 && slotIndex < room.guests.length) {
        room.guests[slotIndex] = null;
      }
      const connectedCount = room.guests.filter(g => g !== null).length;
      if (room.host && room.host.readyState === 1) {
        room.host.send(JSON.stringify({ action: 'guest-dropped', guestCount: connectedCount, slotIndex, playerIndex: slotIndex + 1 }));
      }
      for (const g of room.guests) {
        if (g && g.readyState === 1) {
          g.send(JSON.stringify({ action: 'player-dropped', playerIndex: slotIndex + 1 }));
        }
      }
      console.log(`[GUEST] Dropped from room "${roomCode}" slot ${slotIndex}`);
    }
  });
});

// Clean up stale rooms every 5 minutes
setInterval(() => {
  for (const [code, room] of rooms) {
    if (!room.host || room.host.readyState !== 1) {
      rooms.delete(code);
      console.log(`[CLEANUP] Removed stale room "${code}"`);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Golf game server running on port ${PORT}`);
  console.log(`  Static files: ${STATIC_DIR}`);
  console.log(`  WebSocket relay: ws://0.0.0.0:${PORT}/ws`);
});

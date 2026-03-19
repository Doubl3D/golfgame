import { HoleData, Difficulty } from './terrain';

// ========== MESSAGE TYPES ==========

export type NetMessage =
  | { type: 'join'; playerName: string; playerIndex: number }
  | { type: 'game-start'; players: { name: string; color: string }[]; totalHoles: number; difficulty: Difficulty }
  | { type: 'hole-init'; holeIndex: number; holeData: HoleData; wind: any }
  | { type: 'shot'; power: number; aimAngle: number; clubIndex: number }
  | { type: 'advance' }
  | { type: 'ready'; playerIndex: number }
  | { type: 'player-dropped'; playerIndex: number }
  | { type: 'player-rejoined'; playerIndex: number };

export interface MultiplayerConnection {
  role: 'host' | 'guest';
  playerIndex: number;
  connection: { on: (event: string, cb: (...args: any[]) => void) => void };
  sendMessage: (msg: NetMessage) => void;
  onMessage: (cb: (msg: NetMessage) => void) => void;
  disconnect: () => void;
}

// ========== CONNECTION ==========

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In production (Render etc), WS is on same host:port. In dev, Vite proxies /ws to port 9000.
  return `${proto}//${window.location.host}/ws`;
}

function log(tag: string, ...args: any[]) {
  console.log(`[MP:${tag}]`, ...args);
}

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createConnection(ws: WebSocket, role: 'host' | 'guest', playerIndex: number): MultiplayerConnection {
  const messageHandlers: Array<(msg: NetMessage) => void> = [];
  const closeHandlers: Array<() => void> = [];
  const messageQueue: NetMessage[] = [];

  ws.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.action === 'message') {
        log(role.toUpperCase(), `📨 Received:`, parsed.data?.type ?? parsed.data);
        if (messageHandlers.length > 0) {
          messageHandlers.forEach(h => h(parsed.data as NetMessage));
        } else {
          log(role.toUpperCase(), `📦 Queued (no handlers yet):`, parsed.data?.type);
          messageQueue.push(parsed.data as NetMessage);
        }
      } else if (parsed.action === 'disconnected') {
        log(role.toUpperCase(), `❌ Host disconnected`);
        closeHandlers.forEach(h => h());
      } else if (parsed.action === 'guest-dropped') {
        // Host receives this from relay server
        log(role.toUpperCase(), `⚠️ Guest dropped: playerIndex=${parsed.playerIndex}`);
        const dropMsg: NetMessage = { type: 'player-dropped', playerIndex: parsed.playerIndex };
        messageHandlers.forEach(h => h(dropMsg));
      } else if (parsed.action === 'guest-rejoined') {
        log(role.toUpperCase(), `✅ Guest rejoined: playerIndex=${parsed.playerIndex}`);
        const rejoinMsg: NetMessage = { type: 'player-rejoined', playerIndex: parsed.playerIndex };
        messageHandlers.forEach(h => h(rejoinMsg));
      } else if (parsed.action === 'player-dropped') {
        // Guests receive this from relay server
        log(role.toUpperCase(), `⚠️ Player dropped: playerIndex=${parsed.playerIndex}`);
        const dropMsg: NetMessage = { type: 'player-dropped', playerIndex: parsed.playerIndex };
        messageHandlers.forEach(h => h(dropMsg));
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    log(role.toUpperCase(), `❌ WebSocket closed`);
    closeHandlers.forEach(h => h());
  });

  return {
    role,
    playerIndex,
    connection: {
      on: (event: string, cb: (...args: any[]) => void) => {
        if (event === 'close') closeHandlers.push(cb);
      },
    },
    sendMessage: (msg: NetMessage) => {
      log(role.toUpperCase(), `📤 Sending:`, msg.type);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'relay', data: msg }));
      }
    },
    onMessage: (cb) => {
      messageHandlers.push(cb);
      if (messageQueue.length > 0) {
        log(role.toUpperCase(), `📦 Replaying ${messageQueue.length} queued messages`);
        const queued = [...messageQueue];
        messageQueue.length = 0;
        queued.forEach(msg => cb(msg));
      }
    },
    disconnect: () => {
      ws.close();
    },
  };
}

export interface HostSession {
  joinCode: string;
  connection: MultiplayerConnection;
  onGuestCountChange: (cb: (count: number) => void) => void;
  destroy: () => void;
}

export function createHostSession(): Promise<HostSession> {
  return new Promise((resolve, reject) => {
    const joinCode = generateJoinCode();
    const wsUrl = getWsUrl();

    log('HOST', `Connecting to relay server: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);

    const guestCountHandlers: Array<(count: number) => void> = [];

    ws.addEventListener('open', () => {
      log('HOST', `✅ WebSocket open, creating room: ${joinCode}`);
      ws.send(JSON.stringify({ action: 'host', code: joinCode }));
    });

    ws.addEventListener('error', (e) => {
      log('HOST', `❌ WebSocket error:`, e);
      reject(new Error('WebSocket connection failed'));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === 'hosted') {
          log('HOST', `✅ Room created! Code: ${joinCode}`);
          resolve({
            joinCode,
            connection: createConnection(ws, 'host', 0),
            onGuestCountChange: (cb) => { guestCountHandlers.push(cb); },
            destroy: () => ws.close(),
          });
        } else if (msg.action === 'guest-joined') {
          log('HOST', `✅ Guest joined (slot ${msg.slotIndex}), ${msg.guestCount} total`);
          guestCountHandlers.forEach(h => h(msg.guestCount));
        } else if (msg.action === 'guest-dropped') {
          log('HOST', `⚠️ Guest dropped (slot ${msg.slotIndex}), ${msg.guestCount} remain`);
          guestCountHandlers.forEach(h => h(msg.guestCount));
        } else if (msg.action === 'guest-rejoined') {
          log('HOST', `✅ Guest rejoined (slot ${msg.slotIndex}), ${msg.guestCount} total`);
          guestCountHandlers.forEach(h => h(msg.guestCount));
        } else if (msg.action === 'guest-left') {
          log('HOST', `⚠️ Guest left, ${msg.guestCount} remain`);
          guestCountHandlers.forEach(h => h(msg.guestCount));
        }
      } catch {}
    });
  });
}

export function joinSession(joinCode: string): Promise<MultiplayerConnection> {
  return new Promise((resolve, reject) => {
    const wsUrl = getWsUrl();

    log('GUEST', `Connecting to relay server: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      log('GUEST', `❌ Connection TIMED OUT after 10s`);
      ws.close();
      reject(new Error('Connection timed out'));
    }, 10000);

    ws.addEventListener('open', () => {
      log('GUEST', `✅ WebSocket open, joining room: ${joinCode}`);
      ws.send(JSON.stringify({ action: 'join', code: joinCode.toUpperCase() }));
    });

    ws.addEventListener('error', (e) => {
      log('GUEST', `❌ WebSocket error:`, e);
      clearTimeout(timeout);
      reject(new Error('WebSocket connection failed'));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === 'joined') {
          const playerIndex = msg.playerIndex ?? 1;
          log('GUEST', `✅ Joined room! Player index: ${playerIndex}`);
          clearTimeout(timeout);
          resolve(createConnection(ws, 'guest', playerIndex));
        } else if (msg.action === 'error') {
          log('GUEST', `❌ Server error:`, msg.message);
          clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      } catch {}
    });
  });
}

// Rejoin an existing game after disconnect
export function rejoinSession(joinCode: string, slotIndex: number): Promise<MultiplayerConnection> {
  return new Promise((resolve, reject) => {
    const wsUrl = getWsUrl();

    log('GUEST', `Reconnecting to relay server: ${wsUrl}, slot ${slotIndex}`);
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      log('GUEST', `❌ Rejoin TIMED OUT after 10s`);
      ws.close();
      reject(new Error('Rejoin timed out'));
    }, 10000);

    ws.addEventListener('open', () => {
      log('GUEST', `✅ WebSocket open, rejoining room: ${joinCode}, slot ${slotIndex}`);
      ws.send(JSON.stringify({ action: 'rejoin', code: joinCode.toUpperCase(), slotIndex }));
    });

    ws.addEventListener('error', (e) => {
      log('GUEST', `❌ WebSocket error on rejoin:`, e);
      clearTimeout(timeout);
      reject(new Error('WebSocket connection failed'));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === 'rejoined') {
          const playerIndex = msg.playerIndex ?? slotIndex + 1;
          log('GUEST', `✅ Rejoined! Player index: ${playerIndex}`);
          clearTimeout(timeout);
          resolve(createConnection(ws, 'guest', playerIndex));
        } else if (msg.action === 'error') {
          log('GUEST', `❌ Rejoin error:`, msg.message);
          clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      } catch {}
    });
  });
}

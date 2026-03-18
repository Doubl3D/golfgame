import Peer, { DataConnection } from 'peerjs';
import { HoleData } from './terrain';

// ========== MESSAGE TYPES ==========
// Simplified: both sides run full physics. Only share critical sync data.

export type NetMessage =
  | { type: 'join'; playerName: string }
  | { type: 'game-start'; players: { name: string; color: string }[]; totalHoles: number }
  | { type: 'hole-init'; holeIndex: number; holeData: HoleData; wind: any }
  | { type: 'shot'; power: number; aimAngle: number; clubIndex: number }
  | { type: 'advance' }
  | { type: 'ready' }; // guest signals it's loaded and ready for hole data

export interface MultiplayerConnection {
  role: 'host' | 'guest';
  peer: Peer;
  connection: DataConnection;
  sendMessage: (msg: NetMessage) => void;
  onMessage: (cb: (msg: NetMessage) => void) => void;
  disconnect: () => void;
}

// ========== CONNECTION ==========

const PEER_PREFIX = 'golfgame-';

const PEER_SERVER_CONFIG = {
  host: window.location.hostname,
  port: 9000,
  path: '/myapp',
};

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createHostSession(): Promise<{
  joinCode: string;
  waitForGuest: () => Promise<MultiplayerConnection>;
  destroy: () => void;
}> {
  return new Promise((resolve, reject) => {
    const joinCode = generateJoinCode();
    const peerId = PEER_PREFIX + joinCode;

    const peer = new Peer(peerId, PEER_SERVER_CONFIG);

    peer.on('open', () => {
      const waitForGuest = (): Promise<MultiplayerConnection> => {
        return new Promise((resolveGuest) => {
          peer.on('connection', (conn: DataConnection) => {
            conn.on('open', () => {
              const messageHandlers: Array<(msg: any) => void> = [];

              conn.on('data', (data: unknown) => {
                messageHandlers.forEach(h => h(data as NetMessage));
              });

              const mp: MultiplayerConnection = {
                role: 'host',
                peer,
                connection: conn,
                sendMessage: (msg) => conn.send(msg),
                onMessage: (cb) => { messageHandlers.push(cb); },
                disconnect: () => {
                  conn.close();
                  peer.destroy();
                },
              };

              resolveGuest(mp);
            });
          });
        });
      };

      resolve({
        joinCode,
        waitForGuest,
        destroy: () => peer.destroy(),
      });
    });

    peer.on('error', (err) => {
      reject(err);
    });
  });
}

export function joinSession(joinCode: string): Promise<MultiplayerConnection> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_SERVER_CONFIG);

    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + joinCode.toUpperCase());

      const timeout = setTimeout(() => {
        reject(new Error('Connection timed out'));
        peer.destroy();
      }, 10000);

      conn.on('open', () => {
        clearTimeout(timeout);
        const messageHandlers: Array<(msg: any) => void> = [];

        conn.on('data', (data: unknown) => {
          messageHandlers.forEach(h => h(data as NetMessage));
        });

        const mp: MultiplayerConnection = {
          role: 'guest',
          peer,
          connection: conn,
          sendMessage: (msg) => conn.send(msg),
          onMessage: (cb) => { messageHandlers.push(cb); },
          disconnect: () => {
            conn.close();
            peer.destroy();
          },
        };

        resolve(mp);
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    peer.on('error', (err) => {
      reject(err);
    });
  });
}

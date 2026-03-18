import Peer, { DataConnection } from 'peerjs';
import { GameState } from './gameState';
import { HoleData } from './terrain';

// ========== MESSAGE TYPES ==========

export type HostMessage =
  | { type: 'game-start'; players: { name: string; color: string }[]; totalHoles: number }
  | { type: 'hole-data'; holeIndex: number; holeData: HoleData }
  | { type: 'state-update'; state: SerializedState }
  | { type: 'your-turn'; playerIdx: number };

export type GuestMessage =
  | { type: 'join'; playerName: string }
  | { type: 'input-action'; action: InputAction };

export type InputAction =
  | { action: 'aim'; angle: number }
  | { action: 'club-select'; clubIndex: number }
  | { action: 'start-power' }
  | { action: 'launch'; power: number; aimAngle: number; clubIndex: number }
  | { action: 'advance' }; // advance from holeSunk/scorecard/gameOver

// Lightweight state for network sync (excludes terrain and allHoleData)
export interface SerializedState {
  phase: string;
  currentPlayerIdx: number;
  currentHole: number;
  totalHoles: number;
  currentStrokes: number;
  aimAngle: number;
  power: number;
  powerDirection: number;
  powerActive: boolean;
  selectedClubIndex: number;
  ball: any;
  players: any[];
  wind: any;
  holeIntroTimer: number;
  holeSunkTimer: number;
  scorecardTimer: number;
  lastShotResult: string;
  showScorecard: boolean;
}

export interface MultiplayerConnection {
  role: 'host' | 'guest';
  peer: Peer;
  connection: DataConnection;
  sendMessage: (msg: HostMessage | GuestMessage) => void;
  onMessage: (cb: (msg: HostMessage | GuestMessage) => void) => void;
  disconnect: () => void;
}

// ========== SERIALIZATION ==========

export function serializeState(state: GameState): SerializedState {
  return {
    phase: state.phase,
    currentPlayerIdx: state.currentPlayerIdx,
    currentHole: state.currentHole,
    totalHoles: state.totalHoles,
    currentStrokes: state.currentStrokes,
    aimAngle: state.aimAngle,
    power: state.power,
    powerDirection: state.powerDirection,
    powerActive: state.powerActive,
    selectedClubIndex: state.selectedClubIndex,
    ball: state.ball ? { ...state.ball, trail: [] } : null, // skip trail for perf
    players: state.players.map(p => ({ name: p.name, color: p.color, scores: [...p.scores] })),
    wind: { ...state.wind },
    holeIntroTimer: state.holeIntroTimer,
    holeSunkTimer: state.holeSunkTimer,
    scorecardTimer: state.scorecardTimer,
    lastShotResult: state.lastShotResult,
    showScorecard: state.showScorecard,
  };
}

export function applySerializedState(current: GameState, s: SerializedState): GameState {
  return {
    ...current,
    phase: s.phase as any,
    currentPlayerIdx: s.currentPlayerIdx,
    currentHole: s.currentHole,
    totalHoles: s.totalHoles,
    currentStrokes: s.currentStrokes,
    aimAngle: s.aimAngle,
    power: s.power,
    powerDirection: s.powerDirection,
    powerActive: s.powerActive,
    selectedClubIndex: s.selectedClubIndex,
    ball: s.ball,
    players: s.players,
    wind: s.wind,
    holeIntroTimer: s.holeIntroTimer,
    holeSunkTimer: s.holeSunkTimer,
    scorecardTimer: s.scorecardTimer,
    lastShotResult: s.lastShotResult,
    showScorecard: s.showScorecard,
  };
}

// ========== CONNECTION ==========

const PEER_PREFIX = 'golfgame-';

// Local PeerJS server config — falls back to cloud if local server isn't running
const PEER_SERVER_CONFIG = {
  host: window.location.hostname,
  port: 9000,
  path: '/myapp',
};

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
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
                messageHandlers.forEach(h => h(data as GuestMessage));
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
          messageHandlers.forEach(h => h(data as HostMessage));
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

import { useState, useEffect } from 'react';
import { MultiplayerConnection, createHostSession, joinSession } from '../game/multiplayer';

type GameMode = 'menu' | 'local' | 'host' | 'join';

interface SetupScreenProps {
  onStart: (playerNames: string[], totalHoles: number, multiplayer?: MultiplayerConnection) => void;
}

export default function SetupScreen({ onStart }: SetupScreenProps) {
  const [mode, setMode] = useState<GameMode>('menu');
  const [numPlayers, setNumPlayers] = useState(1);
  const [playerNames, setPlayerNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [totalHoles, setTotalHoles] = useState(9);

  // Host state
  const [joinCode, setJoinCode] = useState('');
  const [hostWaiting, setHostWaiting] = useState(false);
  const [hostConnection, setHostConnection] = useState<MultiplayerConnection | null>(null);
  const [hostDestroy, setHostDestroy] = useState<(() => void) | null>(null);
  const [guestName, setGuestName] = useState('');

  // Join state
  const [joinInput, setJoinInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [guestConnection, setGuestConnection] = useState<MultiplayerConnection | null>(null);
  const [waitingForHost, setWaitingForHost] = useState(false);

  const handleStart = () => {
    const names = playerNames.slice(0, numPlayers);
    onStart(names, totalHoles);
  };

  const updateName = (idx: number, name: string) => {
    setPlayerNames((prev) => {
      const updated = [...prev];
      updated[idx] = name;
      return updated;
    });
  };

  // Host: create session
  const handleHost = async () => {
    setMode('host');
    setHostWaiting(true);
    try {
      const session = await createHostSession();
      setJoinCode(session.joinCode);
      setHostDestroy(() => session.destroy);

      const conn = await session.waitForGuest();
      setHostConnection(conn);
      setHostWaiting(false);

      // Listen for guest's join message
      conn.onMessage((msg: any) => {
        if (msg.type === 'join') {
          setGuestName(msg.playerName);
        }
      });
    } catch (err) {
      console.error('Host error:', err);
      setMode('menu');
    }
  };

  // Host: start game with connected guest
  const handleHostStart = () => {
    if (!hostConnection) return;
    const hostName = playerNames[0] || 'Host';
    const names = [hostName, guestName || 'Guest'];
    onStart(names, totalHoles, hostConnection);
  };

  // Join: connect to host
  const handleJoin = async () => {
    if (joinInput.length !== 4) {
      setJoinError('Code must be 4 characters');
      return;
    }
    setJoining(true);
    setJoinError('');
    try {
      const conn = await joinSession(joinInput);
      setGuestConnection(conn);
      setJoining(false);
      setWaitingForHost(true);

      // Send join message
      const myName = playerNames[0] || 'Guest';
      conn.sendMessage({ type: 'join', playerName: myName });

      // Wait for host to start the game
      conn.onMessage((msg: any) => {
        if (msg.type === 'game-start') {
          onStart(
            msg.players.map((p: any) => p.name),
            msg.totalHoles,
            conn
          );
        }
      });
    } catch (err: any) {
      setJoinError(err.message || 'Failed to connect');
      setJoining(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      hostDestroy?.();
      hostConnection?.disconnect();
      guestConnection?.disconnect();
    };
  }, []);

  const playerColors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];

  const cardStyle = {
    background: 'rgba(10, 30, 10, 0.92)',
    border: '2px solid #4ade80',
    padding: '48px 48px',
    minWidth: 420,
    maxWidth: 540,
    boxShadow: '0 0 40px rgba(74,222,128,0.2)',
  };

  const btnStyle = (active: boolean) => ({
    flex: 1,
    padding: '14px 0',
    borderRadius: 10,
    border: `2px solid ${active ? '#4ade80' : 'rgba(255,255,255,0.1)'}`,
    background: active ? 'linear-gradient(135deg, #166534, #15803d)' : 'rgba(255,255,255,0.03)',
    color: active ? '#fff' : '#94a3b8',
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    fontSize: 14,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  const bigBtnStyle = {
    width: '100%',
    padding: '14px 0',
    borderRadius: 10,
    border: '2px solid #4ade80',
    background: 'linear-gradient(135deg, #166534, #15803d)',
    color: '#fff',
    fontFamily: 'monospace',
    fontWeight: 900,
    fontSize: 20,
    cursor: 'pointer',
    letterSpacing: 2,
    boxShadow: '0 0 20px rgba(74,222,128,0.3)',
    transition: 'all 0.15s',
  };

  const labelStyle = { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: 1 };

  // ========== HOST SCREEN ==========
  if (mode === 'host') {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)' }}
      >
        <div className="relative z-10 flex flex-col items-center gap-6 rounded-2xl" style={cardStyle}>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace' }}>HOST GAME</div>

          {/* Your name */}
          <div className="w-full">
            <label style={labelStyle}>Your Name</label>
            <input
              type="text"
              value={playerNames[0]}
              onChange={(e) => updateName(0, e.target.value)}
              maxLength={12}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color: '#ffffff',
                fontFamily: 'monospace',
                fontSize: 14,
                outline: 'none',
                marginTop: 8,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Holes */}
          <div className="w-full">
            <label style={labelStyle}>Round Length</label>
            <div className="flex gap-3 mt-2">
              {[3, 9, 18].map((h) => (
                <button key={h} onClick={() => setTotalHoles(h)} style={btnStyle(totalHoles === h)}>
                  {h} holes
                </button>
              ))}
            </div>
          </div>

          {/* Join code */}
          {joinCode ? (
            <div className="w-full text-center">
              <label style={labelStyle}>Join Code</label>
              <div style={{
                fontSize: 48,
                fontWeight: 900,
                color: '#fbbf24',
                fontFamily: 'monospace',
                letterSpacing: 12,
                marginTop: 8,
                textShadow: '0 0 20px rgba(251,191,36,0.5)',
              }}>
                {joinCode}
              </div>
              <div style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace', marginTop: 4 }}>
                Share this code with your opponent
              </div>
            </div>
          ) : (
            <div style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 13 }}>
              Creating session...
            </div>
          )}

          {/* Connection status */}
          {hostWaiting && joinCode && (
            <div style={{ color: '#fbbf24', fontFamily: 'monospace', fontSize: 13 }}>
              <span className="animate-pulse">⏳ Waiting for opponent to join...</span>
            </div>
          )}

          {hostConnection && (
            <div className="w-full flex flex-col items-center gap-4">
              <div style={{ color: '#4ade80', fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold' }}>
                ✅ {guestName || 'Guest'} connected!
              </div>
              <button onClick={handleHostStart} style={bigBtnStyle}>
                START MATCH ⛳
              </button>
            </div>
          )}

          <button
            onClick={() => { hostDestroy?.(); hostConnection?.disconnect(); setMode('menu'); setJoinCode(''); setHostConnection(null); setHostWaiting(false); }}
            style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', marginTop: 8 }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ========== JOIN SCREEN ==========
  if (mode === 'join') {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)' }}
      >
        <div className="relative z-10 flex flex-col items-center gap-6 rounded-2xl" style={cardStyle}>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace' }}>JOIN GAME</div>

          {/* Your name */}
          <div className="w-full">
            <label style={labelStyle}>Your Name</label>
            <input
              type="text"
              value={playerNames[0]}
              onChange={(e) => updateName(0, e.target.value)}
              maxLength={12}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color: '#ffffff',
                fontFamily: 'monospace',
                fontSize: 14,
                outline: 'none',
                marginTop: 8,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Join code input */}
          {!waitingForHost && (
            <div className="w-full">
              <label style={labelStyle}>Enter Join Code</label>
              <input
                type="text"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="XXXX"
                maxLength={4}
                style={{
                  width: '100%',
                  padding: '16px',
                  borderRadius: 8,
                  border: '2px solid rgba(251,191,36,0.5)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#fbbf24',
                  fontFamily: 'monospace',
                  fontSize: 32,
                  fontWeight: 900,
                  textAlign: 'center',
                  letterSpacing: 12,
                  outline: 'none',
                  marginTop: 8,
                  boxSizing: 'border-box',
                }}
              />
              {joinError && (
                <div style={{ color: '#ef4444', fontFamily: 'monospace', fontSize: 12, marginTop: 6 }}>{joinError}</div>
              )}
            </div>
          )}

          {waitingForHost ? (
            <div style={{ color: '#fbbf24', fontFamily: 'monospace', fontSize: 13 }}>
              <span className="animate-pulse">⏳ Connected! Waiting for host to start...</span>
            </div>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              style={{
                ...bigBtnStyle,
                opacity: joining ? 0.6 : 1,
              }}
            >
              {joining ? 'CONNECTING...' : 'JOIN ⛳'}
            </button>
          )}

          <button
            onClick={() => { guestConnection?.disconnect(); setMode('menu'); setJoinInput(''); setJoinError(''); setWaitingForHost(false); }}
            style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', marginTop: 8 }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ========== LOCAL SETUP SCREEN ==========
  if (mode === 'local') {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)' }}
      >
        <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1200 300" preserveAspectRatio="none" style={{ height: '40%' }}>
          <path d="M0,200 Q200,100 400,180 Q600,260 800,150 Q1000,40 1200,160 L1200,300 L0,300 Z" fill="#2d8a2d" opacity="0.8" />
          <path d="M0,230 Q150,150 350,210 Q550,280 750,190 Q950,100 1200,200 L1200,300 L0,300 Z" fill="#1a5c1a" />
        </svg>

        <div className="relative z-10 flex flex-col items-center gap-8 rounded-2xl" style={cardStyle}>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace' }}>LOCAL GAME</div>

          {/* Number of players */}
          <div className="w-full">
            <label style={labelStyle}>Players</label>
            <div className="flex gap-3 mt-2">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} onClick={() => setNumPlayers(n)} style={btnStyle(numPlayers === n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Player names */}
          <div className="w-full flex flex-col gap-3">
            <label style={labelStyle}>Player Names</label>
            {Array.from({ length: numPlayers }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: playerColors[i], flexShrink: 0 }} />
                <input
                  type="text"
                  value={playerNames[i] ?? `Player ${i + 1}`}
                  onChange={(e) => updateName(i, e.target.value)}
                  maxLength={12}
                  style={{
                    flex: 1, padding: '9px 12px', borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)',
                    color: '#ffffff', fontFamily: 'monospace', fontSize: 14, outline: 'none',
                  }}
                />
              </div>
            ))}
          </div>

          {/* Holes */}
          <div className="w-full">
            <label style={labelStyle}>Round Length</label>
            <div className="flex gap-3 mt-2">
              {[3, 9, 18].map((h) => (
                <button key={h} onClick={() => setTotalHoles(h)} style={btnStyle(totalHoles === h)}>
                  {h} holes
                </button>
              ))}
            </div>
          </div>

          {/* Controls hint */}
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 16px', width: '100%' }}>
            <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Controls</div>
            <div style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', lineHeight: 2 }}>
              <span style={{ color: '#fbbf24' }}>← →</span> Aim &nbsp;|&nbsp; <span style={{ color: '#fbbf24' }}>Q E</span> Club Select<br />
              <span style={{ color: '#4ade80' }}>SPACE</span> Power &amp; Launch<br />
              <span style={{ color: '#4ade80' }}>LMB Hold</span> Power + Drag to Aim<br />
              <span style={{ color: '#64748b' }}>F</span> Scorecard
            </div>
          </div>

          <button onClick={handleStart} style={bigBtnStyle}>TEE OFF! ⛳</button>

          <button
            onClick={() => setMode('menu')}
            style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ========== MAIN MENU ==========
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)' }}
    >
      <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1200 300" preserveAspectRatio="none" style={{ height: '40%' }}>
        <path d="M0,200 Q200,100 400,180 Q600,260 800,150 Q1000,40 1200,160 L1200,300 L0,300 Z" fill="#2d8a2d" opacity="0.8" />
        <path d="M0,230 Q150,150 350,210 Q550,280 750,190 Q950,100 1200,200 L1200,300 L0,300 Z" fill="#1a5c1a" />
      </svg>

      <div className="absolute" style={{ right: '12%', bottom: '38%' }}>
        <div className="relative">
          <div style={{ width: 2, height: 60, background: '#aaa' }} />
          <div style={{ position: 'absolute', top: 0, left: 2, width: 24, height: 16, background: '#ef4444', clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }} />
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 rounded-2xl" style={cardStyle}>
        <div className="text-center">
          <div style={{ fontSize: 42, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace', letterSpacing: '-1px', textShadow: '0 0 20px rgba(74,222,128,0.5)' }}>
            ⛳ GOLF
          </div>
          <div style={{ fontSize: 13, color: '#6ee7b7', fontFamily: 'monospace', marginTop: 2 }}>
            2D Side-Scrolling Golf
          </div>
        </div>

        <div className="w-full flex flex-col gap-3">
          <button onClick={() => setMode('local')} style={bigBtnStyle}>
            LOCAL PLAY
          </button>
          <button
            onClick={handleHost}
            style={{
              ...bigBtnStyle,
              background: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
              border: '2px solid #60a5fa',
              boxShadow: '0 0 20px rgba(96,165,250,0.3)',
            }}
          >
            HOST GAME
          </button>
          <button
            onClick={() => setMode('join')}
            style={{
              ...bigBtnStyle,
              background: 'linear-gradient(135deg, #78350f, #d97706)',
              border: '2px solid #fbbf24',
              boxShadow: '0 0 20px rgba(251,191,36,0.3)',
            }}
          >
            JOIN GAME
          </button>
        </div>
      </div>
    </div>
  );
}

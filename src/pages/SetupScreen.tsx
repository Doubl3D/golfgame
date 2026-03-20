import { useState, useEffect, useRef } from 'react';
import { MultiplayerConnection, HostSession, createHostSession, joinSession } from '../game/multiplayer';
import { Difficulty } from '../game/terrain';

type GameMode = 'menu' | 'local' | 'host' | 'join';

interface SetupScreenProps {
  onStart: (playerNames: string[], totalHoles: number, difficulty: Difficulty, multiplayer?: MultiplayerConnection, joinCode?: string) => void;
}

function getStandardGamepad(): Gamepad | null {
  const gamepads = navigator.getGamepads?.();
  if (!gamepads) return null;
  for (let i = 0; i < gamepads.length; i++) {
    const g = gamepads[i];
    if (g && g.mapping === 'standard') return g;
  }
  for (let i = 0; i < gamepads.length; i++) {
    const g = gamepads[i];
    if (g && g.buttons.length >= 12) return g;
  }
  return null;
}

export default function SetupScreen({ onStart }: SetupScreenProps) {
  const [mode, setMode] = useState<GameMode>('menu');
  const [numPlayers, setNumPlayers] = useState(1);
  const [playerNames, setPlayerNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [totalHoles, setTotalHoles] = useState(9);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [focusIdx, setFocusIdx] = useState(0); // which menu item is focused
  const gpPrevRef = useRef<boolean[]>([]);

  // Host state
  const [joinCode, setJoinCode] = useState('');
  const [hostSession, setHostSession] = useState<HostSession | null>(null);
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [guestCount, setGuestCount] = useState(0);

  // Join state
  const [joinInput, setJoinInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [guestConnection, setGuestConnection] = useState<MultiplayerConnection | null>(null);
  const [waitingForHost, setWaitingForHost] = useState(false);

  const handleStart = () => {
    onStart([playerNames[0] || 'Player 1'], totalHoles, difficulty);
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
    setGuestNames([]);
    setGuestCount(0);
    try {
      const session = await createHostSession();
      setJoinCode(session.joinCode);
      setHostSession(session);

      // Listen for guest count changes
      session.onGuestCountChange((count) => {
        setGuestCount(count);
      });

      // Listen for join messages from guests
      session.connection.onMessage((msg: any) => {
        if (msg.type === 'join') {
          setGuestNames(prev => {
            const updated = [...prev];
            // Use playerIndex to place the name correctly
            updated[msg.playerIndex - 1] = msg.playerName;
            return updated;
          });
        }
      });
    } catch (err) {
      console.error('Host error:', err);
      setMode('menu');
    }
  };

  // Host: start game with all connected guests
  const handleHostStart = () => {
    if (!hostSession || guestCount === 0) return;
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
    const hostName = playerNames[0] || 'Host';
    const names = [hostName];
    for (let i = 0; i < guestCount; i++) {
      names.push(guestNames[i] || `Guest ${i + 1}`);
    }
    hostSession.connection.sendMessage({
      type: 'game-start',
      players: names.map((n, i) => ({ name: n, color: colors[i] })),
      totalHoles,
      difficulty,
    });
    onStart(names, totalHoles, difficulty, hostSession.connection, joinCode);
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

      // Send join message with our player index
      const myName = playerNames[0] || 'Guest';
      conn.sendMessage({ type: 'join', playerName: myName, playerIndex: conn.playerIndex });

      // Wait for host to start the game
      conn.onMessage((msg: any) => {
        if (msg.type === 'game-start') {
          onStart(
            msg.players.map((p: any) => p.name),
            msg.totalHoles,
            msg.difficulty || 'normal',
            conn,
            joinInput.toUpperCase()
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
      hostSession?.destroy();
      guestConnection?.disconnect();
    };
  }, []);

  // Gamepad navigation
  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const gp = getStandardGamepad();
      if (gp) {
        const prev = gpPrevRef.current;
        const pressed = (idx: number) => gp.buttons[idx]?.pressed && !prev[idx];
        const dUp = pressed(12);
        const dDown = pressed(13);
        const dLeft = pressed(14);
        const dRight = pressed(15);
        const aBtn = pressed(0);
        const bBtn = pressed(1);
        // Stick as dpad (with deadzone)
        const stickY = gp.axes[1];
        const stickX = gp.axes[0];
        const stickUp = stickY < -0.5 && !(prev as any)._stickUp;
        const stickDown = stickY > 0.5 && !(prev as any)._stickDown;
        const stickLeft = stickX < -0.5 && !(prev as any)._stickLeft;
        const stickRight = stickX > 0.5 && !(prev as any)._stickRight;

        const up = dUp || stickUp;
        const down = dDown || stickDown;
        const left = dLeft || stickLeft;
        const right = dRight || stickRight;

        if (mode === 'menu') {
          // Menu items: 0=Local, 1=Host, 2=Join
          if (up) setFocusIdx(f => Math.max(0, f - 1));
          if (down) setFocusIdx(f => Math.min(2, f + 1));
          if (aBtn) {
            if (focusIdx === 0) setMode('local');
            else if (focusIdx === 1) handleHost();
            else if (focusIdx === 2) setMode('join');
          }
        } else if (mode === 'local') {
          // Items: 0=holes, 1=difficulty, 2=start, 3=back
          if (up) setFocusIdx(f => Math.max(0, f - 1));
          if (down) setFocusIdx(f => Math.min(3, f + 1));
          if (focusIdx === 0) {
            const holeOpts = [3, 9, 18];
            const curHIdx = holeOpts.indexOf(totalHoles);
            if (left && curHIdx > 0) setTotalHoles(holeOpts[curHIdx - 1]);
            if (right && curHIdx < 2) setTotalHoles(holeOpts[curHIdx + 1]);
          }
          if (focusIdx === 1) {
            const diffOpts: Difficulty[] = ['easy', 'normal', 'expert'];
            const curDIdx = diffOpts.indexOf(difficulty);
            if (left && curDIdx > 0) setDifficulty(diffOpts[curDIdx - 1]);
            if (right && curDIdx < 2) setDifficulty(diffOpts[curDIdx + 1]);
          }
          if (focusIdx === 2 && aBtn) handleStart();
          if (focusIdx === 3 && aBtn) setMode('menu');
          if (bBtn) setMode('menu');
        } else if (mode === 'host') {
          // Items: 0=holes, 1=start, 2=back
          if (up) setFocusIdx(f => Math.max(0, f - 1));
          if (down) setFocusIdx(f => Math.min(2, f + 1));
          if (focusIdx === 0) {
            const holeOpts = [3, 9, 18];
            const curHIdx = holeOpts.indexOf(totalHoles);
            if (left && curHIdx > 0) setTotalHoles(holeOpts[curHIdx - 1]);
            if (right && curHIdx < 2) setTotalHoles(holeOpts[curHIdx + 1]);
          }
          if (focusIdx === 1 && aBtn && guestCount > 0) handleHostStart();
          if (focusIdx === 2 && aBtn) { hostSession?.destroy(); setMode('menu'); setJoinCode(''); setHostSession(null); setGuestNames([]); setGuestCount(0); }
          if (bBtn) { hostSession?.destroy(); setMode('menu'); setJoinCode(''); setHostSession(null); setGuestNames([]); setGuestCount(0); }
        } else if (mode === 'join') {
          if (bBtn) { guestConnection?.disconnect(); setMode('menu'); setJoinInput(''); setJoinError(''); setWaitingForHost(false); }
          // A to join when code is 4 chars
          if (aBtn && joinInput.length === 4 && !waitingForHost) handleJoin();
        }

        gpPrevRef.current = gp.buttons.map(b => b.pressed);
        (gpPrevRef.current as any)._stickUp = stickY < -0.5;
        (gpPrevRef.current as any)._stickDown = stickY > 0.5;
        (gpPrevRef.current as any)._stickLeft = stickX < -0.5;
        (gpPrevRef.current as any)._stickRight = stickX > 0.5;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [mode, focusIdx, totalHoles, numPlayers, joinInput, waitingForHost, guestCount, hostSession, guestConnection]);

  // Reset focus when mode changes
  useEffect(() => {
    setFocusIdx(0);
  }, [mode]);

  const playerColors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];

  // Responsive: detect small screens
  const isSmall = typeof window !== 'undefined' && (window.innerHeight < 500 || window.innerWidth < 500);
  const scale = isSmall ? 0.75 : 1;

  const cardStyle: React.CSSProperties = {
    background: 'rgba(10, 30, 10, 0.92)',
    border: '2px solid #4ade80',
    padding: isSmall ? '12px 16px' : '32px 36px',
    width: '90vw',
    maxWidth: isSmall ? 360 : 500,
    maxHeight: '92dvh',
    overflowY: 'auto' as const,
    boxShadow: '0 0 40px rgba(74,222,128,0.2)',
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: isSmall ? '8px 0' : '12px 0',
    borderRadius: 8,
    border: `2px solid ${active ? '#4ade80' : 'rgba(255,255,255,0.1)'}`,
    background: active ? 'linear-gradient(135deg, #166534, #15803d)' : 'rgba(255,255,255,0.03)',
    color: active ? '#fff' : '#94a3b8',
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    fontSize: isSmall ? 12 : 14,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  const bigBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: isSmall ? '10px 0' : '14px 0',
    borderRadius: 10,
    border: '2px solid #4ade80',
    background: 'linear-gradient(135deg, #166534, #15803d)',
    color: '#fff',
    fontFamily: 'monospace',
    fontWeight: 900,
    fontSize: isSmall ? 16 : 20,
    cursor: 'pointer',
    letterSpacing: 2,
    boxShadow: '0 0 20px rgba(74,222,128,0.3)',
    transition: 'all 0.15s',
  };

  const labelStyle: React.CSSProperties = { color: '#94a3b8', fontSize: isSmall ? 10 : 11, fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: 1 };

  // ========== HOST SCREEN ==========
  if (mode === 'host') {
    return (
      <div
        className="w-full flex flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)', minHeight: '100dvh' }}
      >
        <div className={`relative z-10 flex flex-col items-center ${isSmall ? 'gap-2' : 'gap-5'} rounded-2xl`} style={cardStyle}>
          <div style={{ fontSize: isSmall ? 20 : 28, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace' }}>HOST GAME</div>

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
          <div className="w-full" style={{ outline: focusIdx === 0 ? '2px solid rgba(255,255,255,0.5)' : 'none', outlineOffset: 4, borderRadius: 8 }}>
            <label style={labelStyle}>Round Length {focusIdx === 0 ? '← →' : ''}</label>
            <div className="flex gap-3 mt-2">
              {[3, 9, 18].map((h) => (
                <button key={h} onClick={() => setTotalHoles(h)} style={btnStyle(totalHoles === h)}>
                  {h} holes
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty */}
          <div className="w-full">
            <label style={labelStyle}>Difficulty</label>
            <div className="flex gap-3 mt-2">
              {(['easy', 'normal', 'expert'] as Difficulty[]).map((d) => (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  ...btnStyle(difficulty === d),
                  borderColor: difficulty === d
                    ? (d === 'easy' ? '#4ade80' : d === 'normal' ? '#f59e0b' : '#ef4444')
                    : 'rgba(255,255,255,0.1)',
                }}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>
              {difficulty === 'easy' ? 'Rough patches only' : difficulty === 'normal' ? 'Rough, sand & water hazards' : 'Lots of hazards everywhere'}
            </div>
          </div>

          {/* Join code */}
          {joinCode ? (
            <div className="w-full text-center">
              <label style={labelStyle}>Join Code</label>
              <div style={{
                fontSize: isSmall ? 32 : 48,
                fontWeight: 900,
                color: '#fbbf24',
                fontFamily: 'monospace',
                letterSpacing: isSmall ? 8 : 12,
                marginTop: 4,
                textShadow: '0 0 20px rgba(251,191,36,0.5)',
              }}>
                {joinCode}
              </div>
              <div style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace', marginTop: 4 }}>
                Share this code with other players (up to 3)
              </div>
            </div>
          ) : (
            <div style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 13 }}>
              Creating session...
            </div>
          )}

          {/* Connected players list */}
          <div className="w-full">
            <label style={labelStyle}>Players ({guestCount + 1}/4)</label>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Host (always shown) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: playerColors[0] }} />
                <span style={{ color: '#ffffff', fontFamily: 'monospace', fontSize: 13 }}>
                  {playerNames[0] || 'Host'} <span style={{ color: '#4ade80', fontSize: 10 }}>(you)</span>
                </span>
              </div>
              {/* Connected guests */}
              {Array.from({ length: guestCount }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: playerColors[i + 1] }} />
                  <span style={{ color: '#ffffff', fontFamily: 'monospace', fontSize: 13 }}>
                    {guestNames[i] || `Guest ${i + 1}`} <span style={{ color: '#4ade80', fontSize: 10 }}>connected</span>
                  </span>
                </div>
              ))}
              {/* Empty slots */}
              {Array.from({ length: 3 - guestCount }).map((_, i) => (
                <div key={`empty-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.3 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1px dashed #64748b' }} />
                  <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13 }}>
                    waiting...
                  </span>
                </div>
              ))}
            </div>
          </div>

          {guestCount > 0 && (
            <button onClick={handleHostStart} style={{
              ...bigBtnStyle,
              outline: focusIdx === 1 ? '3px solid #ffffff' : 'none',
              outlineOffset: 2,
            }}>
              START MATCH ({guestCount + 1} players) ⛳
            </button>
          )}

          {guestCount === 0 && joinCode && (
            <div style={{ color: '#fbbf24', fontFamily: 'monospace', fontSize: 13 }}>
              <span className="animate-pulse">Waiting for players to join...</span>
            </div>
          )}

          <button
            onClick={() => { hostSession?.destroy(); setMode('menu'); setJoinCode(''); setHostSession(null); setGuestNames([]); setGuestCount(0); }}
            style={{
              color: focusIdx === 2 ? '#ffffff' : '#64748b', fontFamily: 'monospace', fontSize: 12,
              background: 'none', border: 'none', cursor: 'pointer', marginTop: 8,
              outline: focusIdx === 2 ? '2px solid rgba(255,255,255,0.5)' : 'none', outlineOffset: 2, borderRadius: 4,
            }}
          >
            ← Back {focusIdx === 2 ? '(A)' : ''}
          </button>
        </div>
      </div>
    );
  }

  // ========== JOIN SCREEN ==========
  if (mode === 'join') {
    return (
      <div
        className="w-full flex flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)', minHeight: '100dvh' }}
      >
        <div className={`relative z-10 flex flex-col items-center ${isSmall ? 'gap-2' : 'gap-5'} rounded-2xl`} style={cardStyle}>
          <div style={{ fontSize: isSmall ? 20 : 28, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace' }}>JOIN GAME</div>

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
                  fontSize: isSmall ? 24 : 32,
                  fontWeight: 900,
                  textAlign: 'center',
                  letterSpacing: isSmall ? 8 : 12,
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
              <span className="animate-pulse">Connected! Waiting for host to start...</span>
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
        className="w-full flex flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)', minHeight: '100dvh' }}
      >
        <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1200 300" preserveAspectRatio="none" style={{ height: '40%' }}>
          <path d="M0,200 Q200,100 400,180 Q600,260 800,150 Q1000,40 1200,160 L1200,300 L0,300 Z" fill="#2d8a2d" opacity="0.8" />
          <path d="M0,230 Q150,150 350,210 Q550,280 750,190 Q950,100 1200,200 L1200,300 L0,300 Z" fill="#1a5c1a" />
        </svg>

        <div className={`relative z-10 flex flex-col items-center ${isSmall ? 'gap-2' : 'gap-5'} rounded-2xl`} style={cardStyle}>
          <div style={{ fontSize: isSmall ? 20 : 28, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace' }}>LOCAL GAME</div>

          {/* Player name */}
          <div className="w-full">
            <label style={labelStyle}>Your Name</label>
            <input
              type="text"
              value={playerNames[0]}
              onChange={(e) => updateName(0, e.target.value)}
              maxLength={12}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)',
                color: '#ffffff', fontFamily: 'monospace', fontSize: 14, outline: 'none',
                marginTop: 8, boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Holes */}
          <div className="w-full" style={{ outline: focusIdx === 0 ? '2px solid rgba(255,255,255,0.5)' : 'none', outlineOffset: 4, borderRadius: 8 }}>
            <label style={labelStyle}>Round Length {focusIdx === 0 ? '← →' : ''}</label>
            <div className="flex gap-3 mt-2">
              {[3, 9, 18].map((h) => (
                <button key={h} onClick={() => setTotalHoles(h)} style={btnStyle(totalHoles === h)}>
                  {h} holes
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty */}
          <div className="w-full" style={{ outline: focusIdx === 1 ? '2px solid rgba(255,255,255,0.5)' : 'none', outlineOffset: 4, borderRadius: 8 }}>
            <label style={labelStyle}>Difficulty {focusIdx === 1 ? '← →' : ''}</label>
            <div className="flex gap-3 mt-2">
              {(['easy', 'normal', 'expert'] as Difficulty[]).map((d) => (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  ...btnStyle(difficulty === d),
                  borderColor: difficulty === d
                    ? (d === 'easy' ? '#4ade80' : d === 'normal' ? '#f59e0b' : '#ef4444')
                    : 'rgba(255,255,255,0.1)',
                }}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>
              {difficulty === 'easy' ? 'Rough patches only' : difficulty === 'normal' ? 'Rough, sand & water hazards' : 'Lots of hazards everywhere'}
            </div>
          </div>

          <button onClick={handleStart} style={{
            ...bigBtnStyle,
            outline: focusIdx === 2 ? '3px solid #ffffff' : 'none',
            outlineOffset: 2,
          }}>TEE OFF! ⛳</button>

          <button
            onClick={() => setMode('menu')}
            style={{
              color: focusIdx === 3 ? '#ffffff' : '#64748b', fontFamily: 'monospace', fontSize: 12,
              background: 'none', border: 'none', cursor: 'pointer',
              outline: focusIdx === 3 ? '2px solid rgba(255,255,255,0.5)' : 'none', outlineOffset: 2, borderRadius: 4,
            }}
          >
            ← Back {focusIdx === 3 ? '(A)' : ''}
          </button>
        </div>
      </div>
    );
  }

  // ========== MAIN MENU ==========
  return (
    <div
      className="w-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)', minHeight: '100dvh' }}
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

      <div className={`relative z-10 flex flex-col items-center ${isSmall ? 'gap-3' : 'gap-6'} rounded-2xl`} style={cardStyle}>
        <div className="text-center">
          <div style={{ fontSize: isSmall ? 28 : 42, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace', letterSpacing: '-1px', textShadow: '0 0 20px rgba(74,222,128,0.5)' }}>
            ⛳ GOLF
          </div>
          {!isSmall && <div style={{ fontSize: 13, color: '#6ee7b7', fontFamily: 'monospace', marginTop: 2 }}>
            2D Side-Scrolling Golf
          </div>}
        </div>

        <div className="w-full flex flex-col gap-3">
          <button onClick={() => setMode('local')} style={{
            ...bigBtnStyle,
            outline: focusIdx === 0 ? '3px solid #ffffff' : 'none',
            outlineOffset: 2,
          }}>
            LOCAL PLAY
          </button>
          <button
            onClick={handleHost}
            style={{
              ...bigBtnStyle,
              background: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
              border: '2px solid #60a5fa',
              boxShadow: '0 0 20px rgba(96,165,250,0.3)',
              outline: focusIdx === 1 ? '3px solid #ffffff' : 'none',
              outlineOffset: 2,
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
              outline: focusIdx === 2 ? '3px solid #ffffff' : 'none',
              outlineOffset: 2,
            }}
          >
            JOIN GAME
          </button>
        </div>
      </div>
    </div>
  );
}

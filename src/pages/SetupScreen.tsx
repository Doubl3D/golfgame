import { useState } from 'react';

interface SetupScreenProps {
  onStart: (playerNames: string[], totalHoles: number) => void;
}

export default function SetupScreen({ onStart }: SetupScreenProps) {
  const [numPlayers, setNumPlayers] = useState(1);
  const [playerNames, setPlayerNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [totalHoles, setTotalHoles] = useState(9);

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

  const playerColors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #1a6ba0 0%, #87ceeb 30%, #4ade80 60%, #2d8a2d 100%)' }}
    >
      {/* Animated background hills */}
      <svg
        className="absolute bottom-0 left-0 w-full"
        viewBox="0 0 1200 300"
        preserveAspectRatio="none"
        style={{ height: '40%' }}
      >
        <path d="M0,200 Q200,100 400,180 Q600,260 800,150 Q1000,40 1200,160 L1200,300 L0,300 Z" fill="#2d8a2d" opacity="0.8" />
        <path d="M0,230 Q150,150 350,210 Q550,280 750,190 Q950,100 1200,200 L1200,300 L0,300 Z" fill="#1a5c1a" />
      </svg>

      {/* Flag */}
      <div className="absolute" style={{ right: '12%', bottom: '38%' }}>
        <div className="relative">
          <div style={{ width: 2, height: 60, background: '#aaa' }} />
          <div style={{ position: 'absolute', top: 0, left: 2, width: 24, height: 16, background: '#ef4444', clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }} />
        </div>
      </div>

      {/* Main card */}
      <div
        className="relative z-10 flex flex-col items-center gap-6 px-8 py-8 rounded-2xl"
        style={{
          background: 'rgba(10, 30, 10, 0.92)',
          border: '2px solid #4ade80',
          minWidth: 340,
          maxWidth: 480,
          boxShadow: '0 0 40px rgba(74,222,128,0.2)',
        }}
      >
        {/* Title */}
        <div className="text-center">
          <div style={{ fontSize: 42, fontWeight: 900, color: '#4ade80', fontFamily: 'monospace', letterSpacing: '-1px', textShadow: '0 0 20px rgba(74,222,128,0.5)' }}>
            ⛳ GOLF
          </div>
          <div style={{ fontSize: 13, color: '#6ee7b7', fontFamily: 'monospace', marginTop: 2 }}>
            2D Side-Scrolling Golf
          </div>
        </div>

        {/* Number of players */}
        <div className="w-full">
          <label style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
            Players
          </label>
          <div className="flex gap-2 mt-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setNumPlayers(n)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: `2px solid ${numPlayers === n ? '#4ade80' : 'rgba(255,255,255,0.1)'}`,
                  background: numPlayers === n ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.03)',
                  color: numPlayers === n ? '#4ade80' : '#94a3b8',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  fontSize: 16,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Player names */}
        <div className="w-full flex flex-col gap-2">
          <label style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
            Player Names
          </label>
          {Array.from({ length: numPlayers }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: playerColors[i],
                  flexShrink: 0,
                }}
              />
              <input
                type="text"
                value={playerNames[i] ?? `Player ${i + 1}`}
                onChange={(e) => updateName(i, e.target.value)}
                maxLength={12}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: `1px solid rgba(255,255,255,0.15)`,
                  background: 'rgba(255,255,255,0.05)',
                  color: '#ffffff',
                  fontFamily: 'monospace',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>
          ))}
        </div>

        {/* Holes selection */}
        <div className="w-full">
          <label style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
            Round Length
          </label>
          <div className="flex gap-2 mt-2">
            {[3, 9, 18].map((h) => (
              <button
                key={h}
                onClick={() => setTotalHoles(h)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: `2px solid ${totalHoles === h ? '#4ade80' : 'rgba(255,255,255,0.1)'}`,
                  background: totalHoles === h ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.03)',
                  color: totalHoles === h ? '#4ade80' : '#94a3b8',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  fontSize: 14,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {h} holes
              </button>
            ))}
          </div>
        </div>

        {/* Controls hint */}
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: '10px 14px',
            width: '100%',
          }}
        >
          <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Controls</div>
          <div style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.8 }}>
            <span style={{ color: '#fbbf24' }}>P1:</span> ← → Aim<br />
            <span style={{ color: '#3b82f6' }}>P2:</span> A D Aim<br />
            <span style={{ color: '#4ade80' }}>All:</span> SPACE = Power Meter / Launch<br />
            <span style={{ color: '#4ade80' }}>F</span> = Toggle Scorecard
          </div>
        </div>

        {/* Start button */}
        <button
          onClick={handleStart}
          style={{
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
          }}
        >
          TEE OFF! ⛳
        </button>
      </div>
    </div>
  );
}

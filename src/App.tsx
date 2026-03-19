import { useState, useEffect, useCallback } from 'react';
import SetupScreen from '@/pages/SetupScreen';
import GolfGame from '@/pages/GolfGame';
import { MultiplayerConnection } from './game/multiplayer';
import { Difficulty } from './game/terrain';

type AppState =
  | { screen: 'setup' }
  | { screen: 'game'; playerNames: string[]; totalHoles: number; difficulty: Difficulty; multiplayer?: MultiplayerConnection; joinCode?: string };

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1024);
}

function tryFullscreenAndLandscape() {
  const doc = document.documentElement;
  // Request fullscreen
  if (doc.requestFullscreen) {
    doc.requestFullscreen().catch(() => {});
  } else if ((doc as any).webkitRequestFullscreen) {
    (doc as any).webkitRequestFullscreen();
  }
  // Lock to landscape
  const screen = window.screen as any;
  if (screen.orientation?.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
}

export default function App() {
  const [appState, setAppState] = useState<AppState>({ screen: 'setup' });
  const [showRotatePrompt, setShowRotatePrompt] = useState(false);

  // Check orientation on mobile
  useEffect(() => {
    if (!isMobile()) return;

    const checkOrientation = () => {
      const isPortrait = window.innerHeight > window.innerWidth;
      setShowRotatePrompt(isPortrait);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // On first touch on mobile, go fullscreen + landscape
  const handleFirstInteraction = useCallback(() => {
    if (isMobile()) {
      tryFullscreenAndLandscape();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    document.addEventListener('click', handleFirstInteraction, { once: true });
    return () => {
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('click', handleFirstInteraction);
    };
  }, [handleFirstInteraction]);

  // Rotate prompt overlay
  if (showRotatePrompt) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#000',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontFamily: 'monospace', zIndex: 9999, padding: 32,
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
        <div style={{ fontSize: 20, fontWeight: 'bold', color: '#4ade80', marginBottom: 8 }}>
          Rotate Your Device
        </div>
        <div style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center' }}>
          Please rotate to landscape mode to play
        </div>
        <div style={{
          marginTop: 24, fontSize: 40,
          animation: 'spin 2s ease-in-out infinite',
        }}>
          ↻
        </div>
        <style>{`
          @keyframes spin {
            0%, 100% { transform: rotate(0deg); }
            50% { transform: rotate(90deg); }
          }
        `}</style>
      </div>
    );
  }

  if (appState.screen === 'game') {
    return (
      <GolfGame
        playerNames={appState.playerNames}
        totalHoles={appState.totalHoles}
        difficulty={appState.difficulty}
        multiplayer={appState.multiplayer}
        joinCode={appState.joinCode}
        onBackToMenu={() => {
          appState.multiplayer?.disconnect();
          setAppState({ screen: 'setup' });
        }}
      />
    );
  }

  return (
    <SetupScreen
      onStart={(playerNames, totalHoles, difficulty, multiplayer, joinCode) =>
        setAppState({ screen: 'game', playerNames, totalHoles, difficulty, multiplayer, joinCode })
      }
    />
  );
}

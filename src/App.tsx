import { useState } from 'react';
import SetupScreen from '@/pages/SetupScreen';
import GolfGame from '@/pages/GolfGame';

type AppState =
  | { screen: 'setup' }
  | { screen: 'game'; playerNames: string[]; totalHoles: number };

export default function App() {
  const [appState, setAppState] = useState<AppState>({ screen: 'setup' });

  if (appState.screen === 'game') {
    return (
      <GolfGame
        playerNames={appState.playerNames}
        totalHoles={appState.totalHoles}
        onBackToMenu={() => setAppState({ screen: 'setup' })}
      />
    );
  }

  return (
    <SetupScreen
      onStart={(playerNames, totalHoles) =>
        setAppState({ screen: 'game', playerNames, totalHoles })
      }
    />
  );
}

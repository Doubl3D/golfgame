import { useState } from 'react';
import SetupScreen from '@/pages/SetupScreen';
import GolfGame from '@/pages/GolfGame';
import { MultiplayerConnection } from './game/multiplayer';

type AppState =
  | { screen: 'setup' }
  | { screen: 'game'; playerNames: string[]; totalHoles: number; multiplayer?: MultiplayerConnection };

export default function App() {
  const [appState, setAppState] = useState<AppState>({ screen: 'setup' });

  if (appState.screen === 'game') {
    return (
      <GolfGame
        playerNames={appState.playerNames}
        totalHoles={appState.totalHoles}
        multiplayer={appState.multiplayer}
        onBackToMenu={() => {
          appState.multiplayer?.disconnect();
          setAppState({ screen: 'setup' });
        }}
      />
    );
  }

  return (
    <SetupScreen
      onStart={(playerNames, totalHoles, multiplayer) =>
        setAppState({ screen: 'game', playerNames, totalHoles, multiplayer })
      }
    />
  );
}

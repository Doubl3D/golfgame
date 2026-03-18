import { useEffect, useRef, useCallback, useState } from 'react';
import { GameState, createInitialState, startHole, updateParticles, spawnSandParticles, spawnWaterParticles } from '../game/gameState';
import { stepPhysics, launchBall, createBall } from '../game/physics';
import { getSegmentAt } from '../game/terrain';
import { CLUBS, suggestClub } from '../game/clubs';
import { Camera, updateCamera, drawSky, drawForeground, drawTerrain, drawHoleFlag, drawTeeMarker, drawBall, drawBallMarker, drawAimArrow, drawParticles, drawHUD, drawPowerMeter, drawYardageRuler, drawClubCarousel, drawHoleIntro, drawScorecard, drawHoleSunk, drawGameOver, drawControls } from '../game/renderer';
import { startAmbience, stopAmbience, playSwingSound, playPutterSound, playHoleSunkSound, playSandSound, playWaterSound } from '../game/audio';
import { MultiplayerConnection, NetMessage } from '../game/multiplayer';

interface GolfGameProps {
  playerNames: string[];
  totalHoles: number;
  multiplayer?: MultiplayerConnection;
  onBackToMenu: () => void;
}

export default function GolfGame({ playerNames, totalHoles, multiplayer, onBackToMenu }: GolfGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(createInitialState(playerNames, totalHoles));
  const cameraRef = useRef<Camera>({ x: 0, y: 0 });
  const frameRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const keysRef = useRef<Set<string>>(new Set());
  const aimDelayRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accumRef = useRef<number>(0);
  const disconnectedRef = useRef(false);

  // Multiplayer
  const isMultiplayer = !!multiplayer;
  const isHost = multiplayer?.role === 'host';
  const isGuest = multiplayer?.role === 'guest';
  const myPlayerIdx = isGuest ? 1 : 0;

  // Queue for received shots from the other player
  const pendingShotRef = useRef<{ power: number; aimAngle: number; clubIndex: number } | null>(null);
  const pendingAdvanceRef = useRef(false);

  const isMyTurn = useCallback(() => {
    if (!isMultiplayer) return true;
    return stateRef.current.currentPlayerIdx === myPlayerIdx;
  }, [isMultiplayer, myPlayerIdx]);

  const [disconnected, setDisconnected] = useState(false);

  const getCanvasSize = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const [canvasSize, setCanvasSize] = useState(getCanvasSize);

  useEffect(() => {
    const handleResize = () => setCanvasSize(getCanvasSize());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const sendMsg = useCallback((msg: NetMessage) => {
    multiplayer?.sendMessage(msg);
  }, [multiplayer]);

  // ========== INPUT HANDLERS ==========

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    keysRef.current.add(e.code);
    e.preventDefault();
    startAmbience();

    const state = stateRef.current;

    if (e.code === 'KeyF') {
      stateRef.current = { ...state, showScorecard: !state.showScorecard };
      return;
    }

    if (state.showScorecard) return;

    if (state.phase === 'aiming' && isMyTurn()) {
      if (e.code === 'KeyQ' || e.code === 'ArrowUp') {
        const newIdx = Math.max(0, state.selectedClubIndex - 1);
        const newClub = CLUBS[newIdx];
        const aimingBackward = state.aimAngle > 90;
        stateRef.current = {
          ...state,
          selectedClubIndex: newIdx,
          aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle,
        };
        return;
      }
      if (e.code === 'KeyE' || e.code === 'ArrowDown') {
        const newIdx = Math.min(CLUBS.length - 1, state.selectedClubIndex + 1);
        const newClub = CLUBS[newIdx];
        const aimingBackward = state.aimAngle > 90;
        stateRef.current = {
          ...state,
          selectedClubIndex: newIdx,
          aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle,
        };
        return;
      }
      if (e.code === 'Space') {
        stateRef.current = {
          ...state,
          phase: 'powering',
          power: 0,
          powerDirection: 1,
          powerActive: true,
        };
      }
    } else if (state.phase === 'powering' && isMyTurn()) {
      if (e.code === 'Space') {
        doLaunch();
      }
    } else if (state.phase === 'scorecard') {
      if (isMultiplayer) {
        // In multiplayer, host controls advancement
        if (isHost) {
          sendMsg({ type: 'advance' });
          advanceToNextHole();
        }
        // Guest just signals desire to advance; host will send hole-init
      } else {
        advanceToNextHole();
      }
    } else if (state.phase === 'gameOver') {
      stopAmbience();
      onBackToMenu();
    }
  }, [isMyTurn, sendMsg, isMultiplayer]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysRef.current.delete(e.code);
  }, []);

  const mouseDownRef = useRef<{ x: number; y: number; backward: boolean } | null>(null);
  const mouseHeldRef = useRef(false);
  const rollingFramesRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startAmbience();
    mouseHeldRef.current = true;
    const state = stateRef.current;
    if (state.showScorecard) return;

    if (state.phase === 'aiming' && isMyTurn()) {
      mouseDownRef.current = { x: e.clientX, y: e.clientY, backward: state.aimAngle > 90 };
      stateRef.current = {
        ...state,
        phase: 'powering',
        power: 0,
        powerDirection: 1,
        powerActive: true,
      };
    } else if (state.phase === 'scorecard') {
      if (isMultiplayer) {
        if (isHost) {
          sendMsg({ type: 'advance' });
          advanceToNextHole();
        }
      } else {
        advanceToNextHole();
      }
    } else if (state.phase === 'gameOver') {
      stopAmbience();
      onBackToMenu();
    }
  }, [isMyTurn, sendMsg, isMultiplayer]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const state = stateRef.current;
    if (state.phase !== 'powering' || !mouseDownRef.current) return;
    if (!isMyTurn()) return;

    const dy = mouseDownRef.current.y - e.clientY;
    const sensitivity = 3;
    const clubAngle = CLUBS[state.selectedClubIndex].launchAngle;
    const aimingBackward = mouseDownRef.current.backward;
    const baseAngle = aimingBackward ? 180 - clubAngle : clubAngle;
    const direction = aimingBackward ? -1 : 1;
    const angleOffset = (dy / sensitivity) * direction;
    const newAngle = aimingBackward
      ? Math.max(95, Math.min(175, baseAngle + angleOffset))
      : Math.max(5, Math.min(85, baseAngle + angleOffset));

    stateRef.current = { ...state, aimAngle: newAngle };
  }, [isMyTurn]);

  const handleMouseUp = useCallback(() => {
    mouseHeldRef.current = false;
    const state = stateRef.current;
    if (state.phase === 'powering' && mouseDownRef.current && isMyTurn()) {
      doLaunch();
      mouseDownRef.current = null;
    }
  }, [isMyTurn]);

  // Launch the ball — called when it's MY turn
  function doLaunch() {
    const s = stateRef.current;
    if (!s.ball || !s.holeData) return;
    const club = CLUBS[s.selectedClubIndex];
    const newBall = launchBall(s.ball, s.aimAngle, s.power, s.wind.speed * s.wind.direction, club);
    if (club.name === 'Putter') { playPutterSound(); } else { playSwingSound(); }

    // Send shot to other player
    if (isMultiplayer) {
      sendMsg({ type: 'shot', power: s.power, aimAngle: s.aimAngle, clubIndex: s.selectedClubIndex });
    }

    stateRef.current = {
      ...s,
      ball: newBall,
      phase: 'inFlight',
      powerActive: false,
      currentStrokes: s.currentStrokes + 1,
    };
  }

  // Apply a shot received from the other player
  function applyRemoteShot(power: number, aimAngle: number, clubIndex: number) {
    const s = stateRef.current;
    if (!s.ball || !s.holeData) return;
    const club = CLUBS[clubIndex];
    const newBall = launchBall(s.ball, aimAngle, power, s.wind.speed * s.wind.direction, club);
    if (club.name === 'Putter') { playPutterSound(); } else { playSwingSound(); }
    stateRef.current = {
      ...s,
      ball: newBall,
      aimAngle,
      power,
      selectedClubIndex: clubIndex,
      phase: 'inFlight',
      powerActive: false,
      currentStrokes: s.currentStrokes + 1,
    };
  }

  function advanceToNextHole() {
    const s = stateRef.current;
    const nextHole = s.currentHole + 1;
    if (nextHole > s.totalHoles) {
      stateRef.current = { ...s, phase: 'gameOver' };
    } else {
      if (isHost) {
        // Host generates terrain and sends to guest
        const newState = startHole({ ...s, currentHole: nextHole });
        stateRef.current = newState;
        cameraRef.current = { x: 0, y: 0 };
        if (newState.holeData) {
          sendMsg({ type: 'hole-init', holeIndex: nextHole - 1, holeData: newState.holeData, wind: newState.wind });
        }
      } else if (isGuest) {
        // Guest: will receive hole-init from host — just wait
        stateRef.current = { ...s, phase: 'setup', currentHole: nextHole };
      } else {
        // Local play
        const newState = startHole({ ...s, currentHole: nextHole });
        stateRef.current = newState;
        cameraRef.current = { x: 0, y: 0 };
      }
    }
  }

  // ========== MULTIPLAYER MESSAGE HANDLING ==========
  useEffect(() => {
    if (!multiplayer) return;

    multiplayer.connection.on('close', () => {
      disconnectedRef.current = true;
      setDisconnected(true);
    });

    multiplayer.onMessage((msg: NetMessage) => {
      switch (msg.type) {
        case 'shot': {
          pendingShotRef.current = { power: msg.power, aimAngle: msg.aimAngle, clubIndex: msg.clubIndex };
          break;
        }
        case 'advance': {
          // In lockstep, advance comes from host — guest waits for hole-init
          // For local/host this triggers advancement
          if (isGuest) {
            // Guest just waits for hole-init that follows
          } else {
            pendingAdvanceRef.current = true;
          }
          break;
        }
        case 'hole-init': {
          const state = stateRef.current;
          const newAllHoleData = [...state.allHoleData];
          newAllHoleData[msg.holeIndex] = msg.holeData;
          const updatedState = {
            ...state,
            allHoleData: newAllHoleData,
            wind: msg.wind,
          };
          const newState = startHole({ ...updatedState, currentHole: msg.holeIndex + 1 });
          stateRef.current = { ...newState, wind: msg.wind };
          cameraRef.current = { x: 0, y: 0 };
          break;
        }
        case 'ready': {
          // Guest is ready — send current hole data
          if (isHost) {
            const state = stateRef.current;
            if (state.holeData) {
              sendMsg({
                type: 'hole-init',
                holeIndex: state.currentHole - 1,
                holeData: state.holeData,
                wind: state.wind,
              });
            }
          }
          break;
        }
        case 'game-start': {
          break;
        }
      }
    });

    // Guest: signal ready so host sends hole data
    if (isGuest) {
      sendMsg({ type: 'ready' });
    }
  }, [multiplayer, isHost, isGuest]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Start first hole
  useEffect(() => {
    lastTimeRef.current = 0;
    accumRef.current = 0;
    if (!isGuest) {
      stateRef.current = startHole(stateRef.current);
    }
    // Guest waits for hole-init from host
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const FIXED_DT = 1000 / 90;
    const MAX_FRAME_TIME = 100;

    const tick = (timestamp: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = timestamp;
      const elapsed = Math.min(timestamp - lastTimeRef.current, MAX_FRAME_TIME);
      lastTimeRef.current = timestamp;
      accumRef.current += elapsed;

      const { width, height } = canvas;
      let state = stateRef.current;
      const keys = keysRef.current;

      if (!state.holeData || !state.ball) {
        ctx.clearRect(0, 0, width, height);
        drawSky(ctx, width, height, cameraRef.current.x);
        if (isGuest && state.phase === 'setup') {
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 16px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Waiting for host...', width / 2, height / 2);
        }
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      const { holeData } = state;

      // Process pending remote shot
      if (pendingShotRef.current && state.phase === 'aiming' && !isMyTurn()) {
        const shot = pendingShotRef.current;
        pendingShotRef.current = null;
        applyRemoteShot(shot.power, shot.aimAngle, shot.clubIndex);
        state = stateRef.current;
      }

      // Process pending advance
      if (pendingAdvanceRef.current && state.phase === 'scorecard') {
        pendingAdvanceRef.current = false;
        advanceToNextHole();
        state = stateRef.current;
      }

      // Run fixed-step game logic — IDENTICAL on both host and guest
      while (accumRef.current >= FIXED_DT) {
        accumRef.current -= FIXED_DT;
        frameCountRef.current++;
        state = stateRef.current;

      // Handle aim key input (only when it's my turn)
      if (state.phase === 'aiming' && isMyTurn()) {
        aimDelayRef.current = Math.max(0, aimDelayRef.current - 1);
        const aimSpeed = 1.2;

        let dAngle = 0;
        if (keys.has('ArrowLeft') || keys.has('KeyA')) dAngle = aimSpeed;
        if (keys.has('ArrowRight') || keys.has('KeyD')) dAngle = -aimSpeed;

        if (dAngle !== 0) {
          const raw = state.aimAngle + dAngle;
          const newAngle = Math.max(5, Math.min(175, raw));
          stateRef.current = { ...state, aimAngle: newAngle };
          state = stateRef.current;
        }
      }

      // Power meter animation
      if (state.phase === 'powering') {
        const POWER_SPEED = 0.008;
        const ballSeg = state.ball && state.holeData
          ? getSegmentAt(state.holeData.segments, state.ball.x)
          : null;
        const POWER_CAP = ballSeg?.type === 'sand' ? 0.5 : 1.0;
        let newPower = state.power + POWER_SPEED * state.powerDirection;
        let newDir = state.powerDirection;
        if (newPower >= POWER_CAP) { newPower = POWER_CAP; newDir = -1; }
        if (newPower <= 0) { newPower = 0; newDir = 1; }
        stateRef.current = { ...state, power: newPower, powerDirection: newDir };
        state = stateRef.current;
      }

      // Physics update — runs on BOTH host and guest
      if (state.phase === 'inFlight' || state.phase === 'rolling') {
        let ball = state.ball!;
        let newParticles = [...state.particles];
        let landed = false;
        let inHole = false;
        let inWater = false;

        if (state.phase === 'rolling') {
          rollingFramesRef.current++;
        } else {
          rollingFramesRef.current = 0;
        }
        const autoFastForward = rollingFramesRef.current > 180;
        // In multiplayer, no manual fast-forward — both sides must step identically
        const simSpeed = isMultiplayer
          ? (autoFastForward ? 6 : 1)
          : ((mouseHeldRef.current || autoFastForward) ? 6 : 1);
        for (let step = 0; step < simSpeed; step++) {
          const result = stepPhysics(ball, holeData.terrain, holeData.segments, holeData.holeX, holeData.holeY, state.wind.speed * state.wind.direction);
          ball = result.ball;

          if (result.inHole) { inHole = true; break; }
          if (result.inWater) {
            inWater = true;
            newParticles = [...newParticles, ...spawnWaterParticles(ball.x, ball.y)];
            break;
          }
          if (result.inSand && result.bounced) {
            newParticles = [...newParticles, ...spawnSandParticles(ball.x, ball.y)];
            playSandSound();
          }
          if (ball.atRest) { landed = true; break; }
        }

        newParticles = updateParticles(newParticles);

        // Helper: find next unsunk player
        const findNextPlayer = () => {
          const numPlayers = state.players.length;
          for (let i = 1; i <= numPlayers; i++) {
            const idx = (state.currentPlayerIdx + i) % numPlayers;
            if (!state.playerSunk[idx]) return idx;
          }
          return -1;
        };

        // Helper: switch to a player
        const switchToPlayer = (nextIdx: number) => {
          const nextBall = state.playerBalls[nextIdx];
          if (!nextBall) return;
          const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
          const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - nextBall.x) * ypp));
          const sugIdx = suggestClub(ydsLeft);
          const pastHole = nextBall.x > holeData.holeX;
          const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
          stateRef.current = {
            ...state,
            currentPlayerIdx: nextIdx,
            ball: { ...nextBall, atRest: true, rolling: false, inFlight: false, vx: 0, vy: 0 },
            currentStrokes: state.playerStrokes[nextIdx],
            phase: 'aiming',
            particles: newParticles,
            selectedClubIndex: sugIdx,
            aimAngle: sugAngle,
          };
        };

        if (inHole) {
          playHoleSunkSound();
          const updatedPlayers = state.players.map((p, i) =>
            i === state.currentPlayerIdx
              ? { ...p, scores: [...p.scores, state.currentStrokes] }
              : p
          );
          const updatedSunk = [...state.playerSunk];
          updatedSunk[state.currentPlayerIdx] = true;
          const updatedPlayerStrokes = [...state.playerStrokes];
          updatedPlayerStrokes[state.currentPlayerIdx] = state.currentStrokes;

          const allSunk = updatedSunk.every(s => s);
          stateRef.current = {
            ...state, ball, phase: 'holeSunk',
            holeSunkTimer: (allSunk || state.players.length === 1) ? 180 : 120,
            particles: newParticles, players: updatedPlayers,
            playerSunk: updatedSunk, playerStrokes: updatedPlayerStrokes,
          };
        } else if (inWater) {
          playWaterSound();
          const penaltyStrokes = state.currentStrokes + 1;
          const updatedPlayerStrokes = [...state.playerStrokes];
          updatedPlayerStrokes[state.currentPlayerIdx] = penaltyStrokes;
          const safeBall = { ...ball, atRest: true, rolling: false, inFlight: false, vx: 0, vy: 0 };
          const updatedPlayerBalls = [...state.playerBalls];
          updatedPlayerBalls[state.currentPlayerIdx] = safeBall;

          if (isMultiplayer && state.players.length > 1) {
            const nextIdx = findNextPlayer();
            if (nextIdx >= 0 && nextIdx !== state.currentPlayerIdx) {
              state = { ...state, currentStrokes: penaltyStrokes, playerStrokes: updatedPlayerStrokes, playerBalls: updatedPlayerBalls, particles: newParticles };
              stateRef.current = state;
              switchToPlayer(nextIdx);
            } else {
              const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
              const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - safeBall.x) * ypp));
              const sugIdx = suggestClub(ydsLeft);
              const pastHole = safeBall.x > holeData.holeX;
              const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
              stateRef.current = {
                ...state, ball: safeBall, phase: 'aiming', currentStrokes: penaltyStrokes,
                particles: newParticles, selectedClubIndex: sugIdx, aimAngle: sugAngle,
                playerStrokes: updatedPlayerStrokes, playerBalls: updatedPlayerBalls,
              };
            }
          } else {
            const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
            const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - ball.x) * ypp));
            const sugIdx = suggestClub(ydsLeft);
            const pastHole = ball.x > holeData.holeX;
            const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
            stateRef.current = {
              ...state, ball, phase: 'aiming', currentStrokes: penaltyStrokes,
              particles: newParticles, selectedClubIndex: sugIdx, aimAngle: sugAngle,
              playerStrokes: updatedPlayerStrokes, playerBalls: updatedPlayerBalls,
            };
          }
        } else if (landed) {
          const updatedPlayerBalls = [...state.playerBalls];
          updatedPlayerBalls[state.currentPlayerIdx] = { ...ball };
          const updatedPlayerStrokes = [...state.playerStrokes];
          updatedPlayerStrokes[state.currentPlayerIdx] = state.currentStrokes;

          if (isMultiplayer && state.players.length > 1) {
            const nextIdx = findNextPlayer();
            if (nextIdx >= 0 && nextIdx !== state.currentPlayerIdx) {
              state = { ...state, playerBalls: updatedPlayerBalls, playerStrokes: updatedPlayerStrokes, particles: newParticles };
              stateRef.current = state;
              switchToPlayer(nextIdx);
            } else {
              const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
              const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - ball.x) * ypp));
              const sugIdx = suggestClub(ydsLeft);
              const pastHole = ball.x > holeData.holeX;
              const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
              stateRef.current = {
                ...state, ball, phase: 'aiming', particles: newParticles,
                selectedClubIndex: sugIdx, aimAngle: sugAngle,
                playerBalls: updatedPlayerBalls, playerStrokes: updatedPlayerStrokes,
              };
            }
          } else {
            const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
            const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - ball.x) * ypp));
            const sugIdx = suggestClub(ydsLeft);
            const pastHole = ball.x > holeData.holeX;
            const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
            stateRef.current = {
              ...state, ball, phase: 'aiming', particles: newParticles,
              selectedClubIndex: sugIdx, aimAngle: sugAngle,
              playerBalls: updatedPlayerBalls, playerStrokes: updatedPlayerStrokes,
            };
          }
        } else {
          const newPhase = ball.rolling ? 'rolling' : 'inFlight';
          stateRef.current = { ...state, ball, phase: newPhase, particles: newParticles };
        }
        state = stateRef.current;
      }

      // Handle timers
      if (state.phase === 'holeIntro') {
        const newTimer = state.holeIntroTimer - 1;
        if (newTimer <= 0) {
          const introSugIdx = suggestClub(holeData.distance);
          stateRef.current = { ...state, phase: 'aiming', holeIntroTimer: 0, selectedClubIndex: introSugIdx, aimAngle: CLUBS[introSugIdx].launchAngle };
          state = stateRef.current;
        } else {
          stateRef.current = { ...state, holeIntroTimer: newTimer };
          state = stateRef.current;
        }
      }

      if (state.phase === 'holeSunk') {
        const newTimer = state.holeSunkTimer - 1;
        if (newTimer <= 0) {
          const allSunk = state.playerSunk.every(s => s);
          if (allSunk || state.players.length === 1) {
            stateRef.current = { ...state, phase: 'scorecard', holeSunkTimer: 0 };
            state = stateRef.current;
          } else {
            // Switch to next unsunk player
            const nextIdx = (() => {
              for (let i = 1; i <= state.players.length; i++) {
                const idx = (state.currentPlayerIdx + i) % state.players.length;
                if (!state.playerSunk[idx]) return idx;
              }
              return -1;
            })();
            if (nextIdx >= 0) {
              const nextBall = state.playerBalls[nextIdx];
              if (nextBall) {
                const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
                const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - nextBall.x) * ypp));
                const sugIdx = suggestClub(ydsLeft);
                const pastHole = nextBall.x > holeData.holeX;
                const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
                stateRef.current = {
                  ...state, currentPlayerIdx: nextIdx,
                  ball: { ...nextBall, atRest: true, rolling: false, inFlight: false, vx: 0, vy: 0 },
                  currentStrokes: state.playerStrokes[nextIdx],
                  phase: 'aiming', holeSunkTimer: 0,
                  selectedClubIndex: sugIdx, aimAngle: sugAngle,
                };
                state = stateRef.current;
              }
            } else {
              stateRef.current = { ...state, phase: 'scorecard', holeSunkTimer: 0 };
              state = stateRef.current;
            }
          }
        } else {
          stateRef.current = { ...state, holeSunkTimer: newTimer };
          state = stateRef.current;
        }
      }

      } // end fixed-timestep while loop

      // === RENDERING ===
      state = stateRef.current;
      const frame = frameCountRef.current;

      // Camera
      if (state.phase === 'holeIntro') {
        const totalIntroTicks = 270;
        const progress = 1 - (state.holeIntroTimer / totalIntroTicks);
        const eased = 1 - Math.pow(1 - progress, 3);
        const pinCamX = Math.max(0, Math.min(holeData.holeX - width * 0.6, holeData.width - width));
        const teeCamX = Math.max(0, holeData.teeX - width * 0.3);
        const introCamX = pinCamX + (teeCamX - pinCamX) * eased;
        cameraRef.current = { x: introCamX, y: 0 };
      } else if (state.ball) {
        cameraRef.current = updateCamera(cameraRef.current, state.ball, width, height, holeData.width);
      }
      const camera = cameraRef.current;

      ctx.clearRect(0, 0, width, height);
      drawSky(ctx, width, height, cameraRef.current.x);
      drawTerrain(ctx, holeData, camera, width, height);
      drawTeeMarker(ctx, holeData.teeX, holeData.teeY, camera);
      drawHoleFlag(ctx, holeData.holeX, holeData.holeY, camera, frame);
      drawParticles(ctx, state.particles, camera);

      // Draw other players' ball markers (before active ball so active is on top)
      for (let pi = 0; pi < state.players.length; pi++) {
        if (pi === state.currentPlayerIdx) continue; // skip active player
        const otherBall = state.playerBalls[pi];
        if (otherBall && !state.playerSunk[pi]) {
          drawBallMarker(ctx, otherBall, camera, state.players[pi].color, state.players[pi].name);
        }
      }

      if (state.ball) {
        drawBall(ctx, state.ball, camera, state.players[state.currentPlayerIdx]?.color ?? '#ffffff');
        if ((state.phase === 'aiming' || state.phase === 'powering') && isMyTurn()) {
          drawAimArrow(ctx, state.ball, state.aimAngle, camera);
        }
      }

      drawHUD(ctx, state, width);
      drawControls(ctx, state, width, height);

      if ((state.phase === 'aiming' || state.phase === 'powering') && isMyTurn()) {
        drawClubCarousel(ctx, state.selectedClubIndex, width, height);
        if (state.ball && state.holeData) {
          drawYardageRuler(ctx, state.ball, state.holeData, width, height);
        }
        const ballSeg = state.ball && state.holeData
          ? getSegmentAt(state.holeData.segments, state.ball.x)
          : null;
        const renderPowerCap = ballSeg?.type === 'sand' ? 0.5 : 1.0;
        drawPowerMeter(ctx, state.power, state.phase === 'powering', width, height, renderPowerCap);
      }

      // When it's NOT my turn and phase is aiming, show waiting indicator
      if (isMultiplayer && state.phase === 'aiming' && !isMyTurn()) {
        const otherPlayer = state.players[state.currentPlayerIdx];
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(width / 2 - 120, height / 2 - 30, 240, 50);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${otherPlayer?.name ?? 'Opponent'} is aiming...`, width / 2, height / 2);
        ctx.restore();
      }

      if ((state.phase === 'inFlight' || state.phase === 'rolling') && state.ball && state.holeData) {
        drawYardageRuler(ctx, state.ball, state.holeData, width, height);
        if (mouseHeldRef.current || rollingFramesRef.current > 180) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(width / 2 - 50, height - 40, 100, 24);
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('\u23e9 6x Speed', width / 2, height - 23);
        }
      }

      if (state.phase === 'holeIntro') {
        const totalIntroTicks = 270;
        const introProgress = 1 - (state.holeIntroTimer / totalIntroTicks);
        const alpha = Math.min(1, state.holeIntroTimer > 30 ? 1 : state.holeIntroTimer / 30);
        drawHoleIntro(ctx, holeData, state.currentHole, width, height, alpha, camera, introProgress);
      }

      if (state.phase === 'holeSunk') {
        drawHoleSunk(ctx, state, width, height);
      }

      if (state.showScorecard || state.phase === 'scorecard') {
        drawScorecard(ctx, state, width, height);
        if (state.phase === 'scorecard') {
          ctx.fillStyle = '#4ade80';
          ctx.font = 'bold 14px monospace';
          ctx.textAlign = 'center';
          const scorecardMsg = (isMultiplayer && isGuest) ? 'Waiting for host to continue...' : 'Press SPACE or click for next hole';
          ctx.fillText(scorecardMsg, width / 2, height - 30);
        }
      }

      if (state.phase === 'gameOver') {
        drawGameOver(ctx, state, width, height);
      }

      // Multiplayer turn indicator during active play
      if (isMultiplayer && (state.phase === 'powering' || state.phase === 'inFlight' || state.phase === 'rolling')) {
        const currentPlayer = state.players[state.currentPlayerIdx];
        const turnText = isMyTurn() ? 'YOUR SHOT' : `${currentPlayer?.name ?? 'Opponent'}'s shot`;
        const turnColor = isMyTurn() ? '#4ade80' : '#fbbf24';
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(width / 2 - 80, 50, 160, 26);
        ctx.fillStyle = turnColor;
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(turnText, width / 2, 68);
        ctx.restore();
      }

      // Disconnected overlay
      if (disconnectedRef.current) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('DISCONNECTED', width / 2, height / 2 - 20);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px monospace';
        ctx.fillText('Your opponent has left the game', width / 2, height / 2 + 15);
        ctx.fillStyle = '#4ade80';
        ctx.fillText('Click to return to menu', width / 2, height / 2 + 45);
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [canvasSize]);

  const handleCanvasClick = useCallback(() => {
    if (disconnectedRef.current) {
      stopAmbience();
      onBackToMenu();
    }
  }, [onBackToMenu]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
        className="block cursor-crosshair"
        style={{ touchAction: 'none' }}
      />
      <button
        onClick={() => { stopAmbience(); multiplayer?.disconnect(); onBackToMenu(); }}
        className="absolute top-3 right-3 text-xs text-white/60 hover:text-white/90 bg-black/40 px-3 py-1 rounded"
      >
        Menu
      </button>
    </div>
  );
}

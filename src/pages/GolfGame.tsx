import { useEffect, useRef, useCallback, useState } from 'react';
import { GameState, createInitialState, startHole, updateParticles, spawnSandParticles, spawnWaterParticles } from '../game/gameState';
import { stepPhysics, launchBall } from '../game/physics';
import { getSegmentAt } from '../game/terrain';
import { CLUBS, suggestClub } from '../game/clubs';
import { Camera, updateCamera, drawSky, drawForeground, drawTerrain, drawHoleFlag, drawTeeMarker, drawBall, drawAimArrow, drawParticles, drawHUD, drawPowerMeter, drawYardageRuler, drawClubCarousel, drawHoleIntro, drawScorecard, drawHoleSunk, drawGameOver, drawControls } from '../game/renderer';
import { startAmbience, stopAmbience, playSwingSound, playPutterSound, playHoleSunkSound, playSandSound, playWaterSound } from '../game/audio';
import { MultiplayerConnection, HostMessage, GuestMessage, InputAction, serializeState, applySerializedState } from '../game/multiplayer';

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
  const lastBroadcastRef = useRef<number>(0);
  const disconnectedRef = useRef(false);

  // Multiplayer helpers
  const isMultiplayer = !!multiplayer;
  const isHost = multiplayer?.role === 'host';
  const isGuest = multiplayer?.role === 'guest';
  // In multiplayer, host is player 0, guest is player 1
  const myPlayerIdx = isGuest ? 1 : 0;

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

  // Send state to guest (host only), throttled
  const broadcastState = useCallback(() => {
    if (!isHost || !multiplayer) return;
    const now = performance.now();
    if (now - lastBroadcastRef.current < 55) return; // ~18/sec
    lastBroadcastRef.current = now;
    const msg: HostMessage = { type: 'state-update', state: serializeState(stateRef.current) };
    multiplayer.sendMessage(msg);
  }, [isHost, multiplayer]);

  // Send hole data to guest (host only)
  const broadcastHoleData = useCallback(() => {
    if (!isHost || !multiplayer) return;
    const state = stateRef.current;
    if (!state.holeData) return;
    const msg: HostMessage = {
      type: 'hole-data',
      holeIndex: state.currentHole - 1,
      holeData: state.holeData,
    };
    multiplayer.sendMessage(msg);
  }, [isHost, multiplayer]);

  // Host: send game-start message after initialization
  const sendGameStart = useCallback(() => {
    if (!isHost || !multiplayer) return;
    const state = stateRef.current;
    const msg: HostMessage = {
      type: 'game-start',
      players: state.players.map(p => ({ name: p.name, color: p.color })),
      totalHoles: state.totalHoles,
    };
    multiplayer.sendMessage(msg);
  }, [isHost, multiplayer]);

  // Guest sends input action instead of mutating state directly
  const sendInput = useCallback((action: InputAction) => {
    if (!isGuest || !multiplayer) return;
    const msg: GuestMessage = { type: 'input-action', action };
    multiplayer.sendMessage(msg);
  }, [isGuest, multiplayer]);

  // ========== INPUT HANDLERS ==========

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    keysRef.current.add(e.code);
    e.preventDefault();
    startAmbience();

    const state = stateRef.current;

    // Toggle scorecard
    if (e.code === 'KeyF') {
      stateRef.current = { ...state, showScorecard: !state.showScorecard };
      return;
    }

    if (state.showScorecard) return;

    if (state.phase === 'aiming' && isMyTurn()) {
      if (e.code === 'KeyQ' || e.code === 'ArrowUp') {
        const newIdx = Math.max(0, state.selectedClubIndex - 1);
        if (isGuest) {
          sendInput({ action: 'club-select', clubIndex: newIdx });
          return;
        }
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
        if (isGuest) {
          sendInput({ action: 'club-select', clubIndex: newIdx });
          return;
        }
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
        if (isGuest) {
          sendInput({ action: 'start-power' });
          return;
        }
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
        const s = stateRef.current;
        if (!s.ball || !s.holeData) return;
        if (isGuest) {
          sendInput({ action: 'launch', power: s.power, aimAngle: s.aimAngle, clubIndex: s.selectedClubIndex });
          return;
        }
        const club = CLUBS[s.selectedClubIndex];
        const newBall = launchBall(s.ball, s.aimAngle, s.power, s.wind.speed * s.wind.direction, club);
        if (club.name === 'Putter') { playPutterSound(); } else { playSwingSound(); }
        stateRef.current = {
          ...s,
          ball: newBall,
          phase: 'inFlight',
          powerActive: false,
          currentStrokes: s.currentStrokes + 1,
        };
      }
    } else if (state.phase === 'holeSunk' || state.phase === 'scorecard') {
      if (isGuest) {
        sendInput({ action: 'advance' });
        return;
      }
      advanceToNextHole();
    } else if (state.phase === 'gameOver') {
      stopAmbience();
      onBackToMenu();
    }
  }, [isGuest, isHost, sendInput, isMyTurn]);

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
      if (isGuest) {
        sendInput({ action: 'start-power' });
        return;
      }
      stateRef.current = {
        ...state,
        phase: 'powering',
        power: 0,
        powerDirection: 1,
        powerActive: true,
      };
    } else if (state.phase === 'holeSunk' || state.phase === 'scorecard') {
      if (isGuest) {
        sendInput({ action: 'advance' });
        return;
      }
      advanceToNextHole();
    } else if (state.phase === 'gameOver') {
      stopAmbience();
      onBackToMenu();
    }
  }, [isGuest, isHost, sendInput, isMyTurn]);

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

    if (isGuest) {
      sendInput({ action: 'aim', angle: newAngle });
      return;
    }
    stateRef.current = { ...state, aimAngle: newAngle };
  }, [isGuest, sendInput, isMyTurn]);

  const handleMouseUp = useCallback(() => {
    mouseHeldRef.current = false;
    const state = stateRef.current;
    if (state.phase === 'powering' && mouseDownRef.current && isMyTurn()) {
      const s = stateRef.current;
      if (!s.ball || !s.holeData) {
        mouseDownRef.current = null;
        return;
      }
      if (isGuest) {
        sendInput({ action: 'launch', power: s.power, aimAngle: s.aimAngle, clubIndex: s.selectedClubIndex });
        mouseDownRef.current = null;
        return;
      }
      const club = CLUBS[s.selectedClubIndex];
      const newBall = launchBall(s.ball, s.aimAngle, s.power, s.wind.speed * s.wind.direction, club);
      if (club.name === 'Putter') { playPutterSound(); } else { playSwingSound(); }
      stateRef.current = {
        ...s,
        ball: newBall,
        phase: 'inFlight',
        powerActive: false,
        currentStrokes: s.currentStrokes + 1,
      };
      mouseDownRef.current = null;
    }
  }, [isGuest, isHost, sendInput, isMyTurn]);

  function advanceToNextHole() {
    const s = stateRef.current;
    const nextHole = s.currentHole + 1;
    if (nextHole > s.totalHoles) {
      stateRef.current = { ...s, phase: 'gameOver' };
    } else {
      const newState = startHole({ ...s, currentHole: nextHole });
      stateRef.current = newState;
      cameraRef.current = { x: 0, y: 0 };
      // Send hole data to guest
      if (isHost) {
        setTimeout(() => {
          broadcastHoleData();
          broadcastState();
        }, 50);
      }
    }
  }

  // ========== MULTIPLAYER MESSAGE HANDLING ==========
  useEffect(() => {
    if (!multiplayer) return;

    // Handle disconnect
    const checkDisconnect = () => {
      multiplayer.connection.on('close', () => {
        disconnectedRef.current = true;
        setDisconnected(true);
      });
    };
    checkDisconnect();

    if (isHost) {
      // Host receives guest inputs
      multiplayer.onMessage((msg: any) => {
        if (msg.type !== 'input-action') return;
        const action: InputAction = msg.action;
        const state = stateRef.current;

        switch (action.action) {
          case 'aim': {
            stateRef.current = { ...state, aimAngle: action.angle };
            break;
          }
          case 'club-select': {
            const newClub = CLUBS[action.clubIndex];
            const aimingBackward = state.aimAngle > 90;
            stateRef.current = {
              ...state,
              selectedClubIndex: action.clubIndex,
              aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle,
            };
            break;
          }
          case 'start-power': {
            if (state.phase === 'aiming') {
              stateRef.current = {
                ...state,
                phase: 'powering',
                power: 0,
                powerDirection: 1,
                powerActive: true,
              };
            }
            break;
          }
          case 'launch': {
            if (state.phase === 'powering' && state.ball && state.holeData) {
              const club = CLUBS[action.clubIndex];
              const newBall = launchBall(state.ball, action.aimAngle, action.power, state.wind.speed * state.wind.direction, club);
              if (club.name === 'Putter') { playPutterSound(); } else { playSwingSound(); }
              stateRef.current = {
                ...state,
                ball: newBall,
                aimAngle: action.aimAngle,
                power: action.power,
                selectedClubIndex: action.clubIndex,
                phase: 'inFlight',
                powerActive: false,
                currentStrokes: state.currentStrokes + 1,
              };
            }
            break;
          }
          case 'advance': {
            if (state.phase === 'holeSunk' || state.phase === 'scorecard') {
              advanceToNextHole();
            }
            break;
          }
        }
      });

      // Send game-start and initial hole data
      sendGameStart();
      setTimeout(() => {
        broadcastHoleData();
        broadcastState();
      }, 100);
    }

    if (isGuest) {
      // Guest receives state updates and hole data
      multiplayer.onMessage((msg: any) => {
        if (msg.type === 'state-update') {
          const current = stateRef.current;
          const prevPhase = current.phase;
          stateRef.current = applySerializedState(current, msg.state);

          // Play sounds based on phase transitions
          const newPhase = msg.state.phase;
          if (prevPhase !== 'holeSunk' && newPhase === 'holeSunk') playHoleSunkSound();
          if (prevPhase !== 'inFlight' && newPhase === 'inFlight') {
            const club = CLUBS[msg.state.selectedClubIndex];
            if (club?.name === 'Putter') playPutterSound(); else playSwingSound();
          }
        } else if (msg.type === 'hole-data') {
          const state = stateRef.current;
          const newAllHoleData = [...state.allHoleData];
          newAllHoleData[msg.holeIndex] = msg.holeData;
          stateRef.current = {
            ...state,
            allHoleData: newAllHoleData,
            holeData: msg.holeData,
          };
        }
      });
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
    stateRef.current = startHole(stateRef.current);
    // If host, send initial hole data after a small delay
    if (isHost) {
      setTimeout(() => {
        broadcastHoleData();
        broadcastState();
      }, 200);
    }
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
        // Guest waiting for hole data
        if (isGuest) {
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 16px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Waiting for host...', width / 2, height / 2);
        }
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      const { holeData } = state;

      // Guest: skip physics sim, just render received state
      if (isGuest) {
        accumRef.current = 0; // don't accumulate
      }

      // Run fixed-step game logic (host + local only)
      while (accumRef.current >= FIXED_DT) {
        accumRef.current -= FIXED_DT;
        frameCountRef.current++;
        state = stateRef.current;

      // Handle aim key input
      if (state.phase === 'aiming' && isMyTurn()) {
        aimDelayRef.current = Math.max(0, aimDelayRef.current - 1);
        const aimSpeed = 1.2;

        let dAngle = 0;
        if (keys.has('ArrowLeft') || keys.has('KeyA')) dAngle = aimSpeed;
        if (keys.has('ArrowRight') || keys.has('KeyD')) dAngle = -aimSpeed;

        if (dAngle !== 0) {
          const raw = state.aimAngle + dAngle;
          const newAngle = Math.max(5, Math.min(175, raw));
          if (isGuest) {
            sendInput({ action: 'aim', angle: newAngle });
          } else {
            stateRef.current = { ...state, aimAngle: newAngle };
            state = stateRef.current;
          }
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

      // Physics update
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
        const simSpeed = (mouseHeldRef.current || autoFastForward) ? 6 : 1;
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

        if (inHole) {
          playHoleSunkSound();
          const updatedPlayers = state.players.map((p, i) =>
            i === state.currentPlayerIdx
              ? { ...p, scores: [...p.scores, state.currentStrokes] }
              : p
          );
          stateRef.current = {
            ...state, ball, phase: 'holeSunk', holeSunkTimer: 180,
            particles: newParticles, players: updatedPlayers,
          };
        } else if (inWater) {
          playWaterSound();
          const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
          const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - ball.x) * ypp));
          const sugIdx = suggestClub(ydsLeft);
          const pastHole = ball.x > holeData.holeX;
          const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
          stateRef.current = {
            ...state, ball, phase: 'aiming', currentStrokes: state.currentStrokes + 1,
            particles: newParticles, selectedClubIndex: sugIdx, aimAngle: sugAngle,
          };
        } else if (landed) {
          const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
          const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - ball.x) * ypp));
          const sugIdx = suggestClub(ydsLeft);
          const pastHole = ball.x > holeData.holeX;
          const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
          stateRef.current = {
            ...state, ball, phase: 'aiming', particles: newParticles,
            selectedClubIndex: sugIdx, aimAngle: sugAngle,
          };
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
          const nextPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
          if (nextPlayerIdx === 0) {
            stateRef.current = { ...state, phase: 'scorecard', holeSunkTimer: 0 };
            state = stateRef.current;
          } else {
            const nextBall = { x: holeData.teeX, y: holeData.teeY - 10, vx: 0, vy: 0, inFlight: false, rolling: false, atRest: true, trail: [], lastSafeX: holeData.teeX, lastSafeY: holeData.teeY - 10, waterPenalty: false, launchAngle: 0, spin: 0 };
            const nextSugIdx = suggestClub(holeData.distance);
            stateRef.current = {
              ...state, currentPlayerIdx: nextPlayerIdx, ball: nextBall,
              phase: 'aiming', currentStrokes: 0, holeSunkTimer: 0,
              selectedClubIndex: nextSugIdx, aimAngle: CLUBS[nextSugIdx].launchAngle,
            };
            state = stateRef.current;
          }
        } else {
          stateRef.current = { ...state, holeSunkTimer: newTimer };
          state = stateRef.current;
        }
      }

      // Host: broadcast state periodically
      if (isHost) broadcastState();

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

      if (state.ball) {
        drawBall(ctx, state.ball, camera, state.players[state.currentPlayerIdx]?.color ?? '#ffffff');
        if (state.phase === 'aiming' || state.phase === 'powering') {
          drawAimArrow(ctx, state.ball, state.aimAngle, camera);
        }
      }

      drawHUD(ctx, state, width);
      drawControls(ctx, state, width, height);

      if (state.phase === 'aiming' || state.phase === 'powering') {
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
          ctx.fillText('Press SPACE or ENTER for next hole', width / 2, height - 30);
        }
      }

      if (state.phase === 'gameOver') {
        drawGameOver(ctx, state, width, height);
      }

      // Multiplayer turn indicator
      if (isMultiplayer && (state.phase === 'aiming' || state.phase === 'powering')) {
        const currentPlayer = state.players[state.currentPlayerIdx];
        const turnText = isMyTurn()
          ? 'YOUR TURN'
          : `${currentPlayer?.name ?? 'Opponent'}'s turn`;
        const turnColor = isMyTurn() ? '#4ade80' : '#fbbf24';

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(width / 2 - 100, 50, 200, 30);
        ctx.fillStyle = turnColor;
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(turnText, width / 2, 70);
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

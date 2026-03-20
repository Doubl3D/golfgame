import { useEffect, useRef, useCallback, useState } from 'react';
import { GameState, createInitialState, startHole, updateParticles, spawnSandParticles, spawnWaterParticles } from '../game/gameState';
import { Ball, stepPhysics, launchBall, createBall } from '../game/physics';
import { getSegmentAt, getTerrainY, Difficulty, TerrainSegment, PracticeType, generatePracticeRange } from '../game/terrain';
import { CLUBS, suggestClub, getSandPowerCap } from '../game/clubs';
import { Camera, updateCamera, uiScale, drawSky, drawForeground, drawTerrain, drawHoleFlag, drawTeeMarker, drawBall, drawBallMarker, drawAimArrow, drawParticles, drawHUD, drawWindIndicator, drawPowerMeter, drawYardageRuler, drawClubCarousel, getClubCarouselLayout, drawHoleIntro, drawScorecard, drawHoleSunk, drawGameOver, drawControls, setLastInputMode, drawPracticeYardageMarkers } from '../game/renderer';
import { startAmbience, stopAmbience, playSwingSound, playPutterSound, playHoleSunkSound, playSandSound, playWaterSound, isMuted, toggleMute, areBirdsEnabled, toggleBirds } from '../game/audio';
import { MultiplayerConnection, NetMessage, rejoinSession } from '../game/multiplayer';

interface GolfGameProps {
  playerNames: string[];
  totalHoles: number;
  difficulty: Difficulty;
  multiplayer?: MultiplayerConnection;
  joinCode?: string;
  practiceType?: PracticeType;
  onBackToMenu: () => void;
}

export default function GolfGame({ playerNames, totalHoles, difficulty, multiplayer, joinCode, practiceType, onBackToMenu }: GolfGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(createInitialState(playerNames, totalHoles, difficulty));
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
  const myPlayerIdx = multiplayer?.playerIndex ?? 0;

  // Queue for received shots from the other player
  const pendingShotRef = useRef<{ power: number; aimAngle: number; clubIndex: number } | null>(null);
  const pendingAdvanceRef = useRef(false);
  const droppedPlayersRef = useRef<Set<number>>(new Set()); // playerIndex values of dropped players
  const joinCodeRef = useRef<string>(''); // for guest rejoin
  const multiplayerRef = useRef(multiplayer); // mutable ref for reconnection
  multiplayerRef.current = multiplayer;

  const isMyTurn = useCallback(() => {
    if (!isMultiplayer) return true;
    return stateRef.current.currentPlayerIdx === myPlayerIdx;
  }, [isMultiplayer, myPlayerIdx]);

  const [disconnected, setDisconnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [droppedNames, setDroppedNames] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muted, setMuted] = useState(isMuted());
  const [birdsOn, setBirdsOn] = useState(areBirdsEnabled());
  const [windEnabled, setWindEnabled] = useState(true);

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

  // ========== HELPERS ==========

  /** Returns true if the current player's ball is sitting on sand */
  function isBallOnSand(): boolean {
    const state = stateRef.current;
    if (!state.holeData || !state.ball) return false;
    const seg = getSegmentAt(state.holeData.segments, state.ball.x);
    return seg.type === 'sand';
  }

  /** Clamp club index, skipping putter when on sand */
  function clampClubIndex(idx: number): number {
    const maxIdx = isBallOnSand() ? CLUBS.length - 2 : CLUBS.length - 1;
    return Math.max(0, Math.min(maxIdx, idx));
  }

  /** Suggest club and clamp putter if on sand */
  function suggestClubClamped(ydsLeft: number, segments: TerrainSegment[], ballX: number): number {
    let idx = suggestClub(ydsLeft);
    const seg = getSegmentAt(segments, ballX);
    if (seg.type === 'sand' && idx === CLUBS.length - 1) {
      idx = CLUBS.length - 2; // Sand Wedge instead of Putter
    }
    return idx;
  }

  // ========== INPUT HANDLERS ==========

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    keysRef.current.add(e.code);
    e.preventDefault();
    startAmbience();
    setLastInputMode('keyboard');

    const state = stateRef.current;

    if (e.code === 'KeyF' && !practiceType) {
      stateRef.current = { ...state, showScorecard: !state.showScorecard };
      return;
    }

    if (state.showScorecard) return;

    if (state.phase === 'aiming' && isMyTurn()) {
      if (e.code === 'ArrowUp') {
        const newIdx = clampClubIndex(state.selectedClubIndex - 1);
        const newClub = CLUBS[newIdx];
        const aimingBackward = state.aimAngle > 90;
        stateRef.current = {
          ...state,
          selectedClubIndex: newIdx,
          aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle,
        };
        return;
      }
      if (e.code === 'ArrowDown') {
        const newIdx = clampClubIndex(state.selectedClubIndex + 1);
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
  const practiceLandingXRef = useRef<number | null>(null);
  const isTouchDevice = useRef(false);

  // Gamepad state
  const gamepadPrevRef = useRef<{ buttons: boolean[] }>({ buttons: [] });
  const gamepadAimHeld = useRef(false);

  // Shared pointer-down logic (mouse & touch)
  function handlePointerDown(clientX: number, clientY: number) {
    startAmbience();
    mouseHeldRef.current = true;
    const state = stateRef.current;
    if (state.showScorecard) return;

    // Check if click/touch hit a club arrow button (during aiming)
    if (state.phase === 'aiming' && isMyTurn()) {
      const canvas = canvasRef.current;
      if (canvas) {
        const w = canvas.width;
        const h = canvas.height;
        const { size: clubSize, x: clubX, y: clubY, btnSize, btnGap, dnExtraOffset } = getClubCarouselLayout(h);

        // Up arrow button (longer club)
        const upY = clubY - btnSize - btnGap;
        if (clientX >= clubX && clientX <= clubX + clubSize && clientY >= upY && clientY <= upY + btnSize) {
          const newIdx = clampClubIndex(state.selectedClubIndex - 1);
          const newClub = CLUBS[newIdx];
          const aimingBackward = state.aimAngle > 90;
          stateRef.current = { ...state, selectedClubIndex: newIdx, aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle };
          return;
        }
        // Down arrow button (shorter club)
        const dnY = clubY + clubSize + btnGap + dnExtraOffset;
        if (clientX >= clubX && clientX <= clubX + clubSize && clientY >= dnY && clientY <= dnY + btnSize) {
          const newIdx = clampClubIndex(state.selectedClubIndex + 1);
          const newClub = CLUBS[newIdx];
          const aimingBackward = state.aimAngle > 90;
          stateRef.current = { ...state, selectedClubIndex: newIdx, aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle };
          return;
        }
      }
    }

    if (state.phase === 'aiming' && isMyTurn()) {
      mouseDownRef.current = { x: clientX, y: clientY, backward: state.aimAngle > 90 };
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
  }

  function handlePointerMove(clientX: number, clientY: number) {
    const state = stateRef.current;
    if (state.phase !== 'powering' || !mouseDownRef.current) return;
    if (!isMyTurn()) return;

    const dy = mouseDownRef.current.y - clientY;
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
  }

  function handlePointerUp() {
    mouseHeldRef.current = false;
    const state = stateRef.current;
    if (state.phase === 'powering' && mouseDownRef.current && isMyTurn()) {
      doLaunch();
      mouseDownRef.current = null;
    }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setLastInputMode('mouse');
    handlePointerDown(e.clientX, e.clientY);
  }, [isMyTurn, sendMsg, isMultiplayer]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    handlePointerMove(e.clientX, e.clientY);
  }, [isMyTurn]);

  const handleMouseUp = useCallback(() => {
    handlePointerUp();
  }, [isMyTurn]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    isTouchDevice.current = true;
    setLastInputMode('touch');
    const touch = e.touches[0];
    if (touch) handlePointerDown(touch.clientX, touch.clientY);
  }, [isMyTurn, sendMsg, isMultiplayer]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (touch) handlePointerMove(touch.clientX, touch.clientY);
  }, [isMyTurn]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handlePointerUp();
  }, [isMyTurn]);

  // Launch the ball — called when it's MY turn
  function doLaunch() {
    const s = stateRef.current;
    if (!s.ball || !s.holeData) return;
    practiceLandingXRef.current = null;
    const club = CLUBS[s.selectedClubIndex];
    const launchSeg = getSegmentAt(s.holeData.segments, s.ball.x);
    const onSand = launchSeg.type === 'sand';
    const newBall = launchBall(s.ball, s.aimAngle, s.power, s.wind.speed * s.wind.direction, club, onSand);
    if (club.name === 'Putter') { playPutterSound(); } else { playSwingSound(); }

    // Sand splash when hitting from sand
    let particles = [...s.particles];
    if (onSand && club.name !== 'Putter') {
      particles = [...particles, ...spawnSandParticles(s.ball.x, s.ball.y)];
      playSandSound();
    }

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
      particles,
    };
  }

  // Apply a shot received from the other player
  function applyRemoteShot(power: number, aimAngle: number, clubIndex: number) {
    const s = stateRef.current;
    if (!s.ball || !s.holeData) return;
    const club = CLUBS[clubIndex];
    const launchSeg = getSegmentAt(s.holeData.segments, s.ball.x);
    const onSand = launchSeg.type === 'sand';
    const newBall = launchBall(s.ball, aimAngle, power, s.wind.speed * s.wind.direction, club, onSand);
    if (club.name === 'Putter') { playPutterSound(); } else { playSwingSound(); }

    // Sand splash when hitting from sand
    let particles = [...s.particles];
    if (onSand && club.name !== 'Putter') {
      particles = [...particles, ...spawnSandParticles(s.ball.x, s.ball.y)];
      playSandSound();
    }

    stateRef.current = {
      ...s,
      ball: newBall,
      aimAngle,
      power,
      selectedClubIndex: clubIndex,
      phase: 'inFlight',
      powerActive: false,
      currentStrokes: s.currentStrokes + 1,
      particles,
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
  function setupMessageHandlers(conn: MultiplayerConnection) {
    conn.onMessage((msg: NetMessage) => {
      switch (msg.type) {
        case 'shot': {
          pendingShotRef.current = { power: msg.power, aimAngle: msg.aimAngle, clubIndex: msg.clubIndex };
          break;
        }
        case 'advance': {
          if (isGuest) {
            // Guest waits for hole-init
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
          if (isHost) {
            const state = stateRef.current;
            if (state.holeData) {
              conn.sendMessage({
                type: 'hole-init',
                holeIndex: state.currentHole - 1,
                holeData: state.holeData,
                wind: state.wind,
              });
            }
          }
          break;
        }
        case 'player-dropped': {
          droppedPlayersRef.current.add(msg.playerIndex);
          const name = stateRef.current.players[msg.playerIndex]?.name ?? `Player ${msg.playerIndex + 1}`;
          setDroppedNames(prev => [...prev.filter(n => n !== name), name]);
          break;
        }
        case 'player-rejoined': {
          droppedPlayersRef.current.delete(msg.playerIndex);
          const name = stateRef.current.players[msg.playerIndex]?.name ?? `Player ${msg.playerIndex + 1}`;
          setDroppedNames(prev => prev.filter(n => n !== name));
          // Host sends current hole data to rejoined player
          if (isHost) {
            const state = stateRef.current;
            if (state.holeData) {
              conn.sendMessage({
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
  }

  useEffect(() => {
    if (!multiplayer) return;

    multiplayer.connection.on('close', () => {
      if (isGuest && !disconnectedRef.current) {
        // Guest lost connection — attempt auto-reconnect
        disconnectedRef.current = true;
        setReconnecting(true);
        const code = joinCodeRef.current;
        const slot = myPlayerIdx - 1; // slotIndex is 0-based
        let attempts = 0;
        const tryReconnect = () => {
          attempts++;
          console.log(`[MP:GUEST] Reconnect attempt ${attempts}...`);
          rejoinSession(code, slot).then((newConn) => {
            console.log(`[MP:GUEST] ✅ Reconnected!`);
            disconnectedRef.current = false;
            setReconnecting(false);
            setDisconnected(false);
            multiplayerRef.current = newConn;
            // Re-register message handlers by sending ready
            newConn.sendMessage({ type: 'ready', playerIndex: myPlayerIdx });
            // Set up message handling on new connection
            setupMessageHandlers(newConn);
          }).catch(() => {
            if (attempts < 5) {
              setTimeout(tryReconnect, 2000);
            } else {
              setReconnecting(false);
              setDisconnected(true);
            }
          });
        };
        setTimeout(tryReconnect, 1000);
      } else {
        disconnectedRef.current = true;
        setDisconnected(true);
      }
    });

    setupMessageHandlers(multiplayer);

    // Guest: signal ready so host sends hole data
    if (isGuest) {
      sendMsg({ type: 'ready', playerIndex: myPlayerIdx });
    }
  }, [multiplayer, isHost, isGuest]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    const onGpConnect = (e: GamepadEvent) => console.log('[GAMEPAD] Connected:', e.gamepad.id, 'index:', e.gamepad.index, 'buttons:', e.gamepad.buttons.length, 'axes:', e.gamepad.axes.length);
    const onGpDisconnect = (e: GamepadEvent) => console.log('[GAMEPAD] Disconnected:', e.gamepad.id);
    window.addEventListener('gamepadconnected', onGpConnect);
    window.addEventListener('gamepaddisconnected', onGpDisconnect);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('gamepadconnected', onGpConnect);
      window.removeEventListener('gamepaddisconnected', onGpDisconnect);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Helper: set up practice range terrain
  function startPracticeRound() {
    const holeData = generatePracticeRange(practiceType!, window.innerHeight);
    const ball = createBall(holeData.teeX, holeData.teeY - 10);
    const sugIdx = practiceType === 'putting' ? CLUBS.length - 1 : 0; // putter for putting, driver for range
    stateRef.current = {
      ...stateRef.current,
      phase: 'aiming',
      holeData,
      ball,
      aimAngle: CLUBS[sugIdx].launchAngle,
      selectedClubIndex: sugIdx,
      currentStrokes: 0,
      particles: [],
      playerBalls: [ball],
      playerStrokes: [0],
      playerSunk: [false],
    };
    cameraRef.current = { x: 0, y: 0 };
  }

  // Start first hole
  useEffect(() => {
    lastTimeRef.current = 0;
    accumRef.current = 0;
    if (joinCode) joinCodeRef.current = joinCode;
    if (practiceType) {
      startPracticeRound();
    } else if (!isGuest) {
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

    // Gamepad: returns pressed state for each button (true = just pressed this frame)
    function pollGamepad() {
      const gamepads = navigator.getGamepads?.();
      if (!gamepads) return null;
      // Prefer a standard gamepad (has mapping === 'standard') over other devices like headsets
      let gp: Gamepad | null = null;
      for (let i = 0; i < gamepads.length; i++) {
        const g = gamepads[i];
        if (g && g.mapping === 'standard') { gp = g; break; }
      }
      if (!gp) {
        // Fallback: any gamepad with enough buttons (skip headsets etc)
        for (let i = 0; i < gamepads.length; i++) {
          const g = gamepads[i];
          if (g && g.buttons.length >= 12) { gp = g; break; }
        }
      }
      if (!gp) return null;

      const prev = gamepadPrevRef.current;
      const pressed = (idx: number) => gp.buttons[idx]?.pressed && !prev.buttons[idx];
      const held = (idx: number) => !!gp.buttons[idx]?.pressed;

      const result = {
        // Standard gamepad mapping (Xbox):
        // 0=A, 1=B, 2=X, 3=Y, 4=LB, 5=RB, 6=LT, 7=RT
        // 8=Back, 9=Start, 12=DUp, 13=DDown, 14=DLeft, 15=DRight
        aPressed: pressed(0),      // A = space (start power / confirm)
        bHeld: held(1),            // B = fast forward
        yPressed: pressed(3),      // Y = toggle scorecard
        lbPressed: pressed(4),     // LB = club up
        rbPressed: pressed(5),     // RB = club down
        dLeft: held(14),           // D-pad left = aim left
        dRight: held(15),          // D-pad right = aim right
        dUp: pressed(12),          // D-pad up = club up (alt)
        dDown: pressed(13),        // D-pad down = club down (alt)
        // Left stick
        stickX: Math.abs(gp.axes[0]) > 0.15 ? gp.axes[0] : 0,
        stickY: Math.abs(gp.axes[1]) > 0.15 ? gp.axes[1] : 0,
        anyButton: gp.buttons.some(b => b.pressed),
      };

      // Save current button state for next frame edge detection
      gamepadPrevRef.current = { buttons: gp.buttons.map(b => b.pressed) };
      if (result.anyButton || Math.abs(result.stickX) > 0.3 || Math.abs(result.stickY) > 0.3) {
        setLastInputMode('gamepad');
      }
      return result;
    }

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

      // Poll gamepad
      const gp = pollGamepad();
      if (gp) {
        // Gamepad held B = fast forward (like mouse hold)
        mouseHeldRef.current = mouseHeldRef.current || gp.bHeld;
        if (!gp.bHeld && !mouseDownRef.current) mouseHeldRef.current = false;
      }

      // Handle aim key/touch/gamepad input (only when it's my turn)
      if (state.phase === 'aiming' && isMyTurn()) {
        aimDelayRef.current = Math.max(0, aimDelayRef.current - 1);
        const aimSpeed = 1.2;

        let dAngle = 0;
        if (keys.has('ArrowLeft') || keys.has('KeyA')) dAngle = aimSpeed;
        if (keys.has('ArrowRight') || keys.has('KeyD')) dAngle = -aimSpeed;

        // Gamepad aim: left stick or d-pad
        if (gp) {
          if (gp.dLeft || gp.stickX < -0.15) dAngle = aimSpeed * (gp.stickX < -0.15 ? Math.abs(gp.stickX) : 1);
          if (gp.dRight || gp.stickX > 0.15) dAngle = -aimSpeed * (gp.stickX > 0.15 ? gp.stickX : 1);

          // Club selection: LB/RB or D-pad up/down
          if (gp.lbPressed || gp.dUp) {
            const newIdx = clampClubIndex(state.selectedClubIndex - 1);
            const newClub = CLUBS[newIdx];
            const aimingBackward = state.aimAngle > 90;
            stateRef.current = { ...state, selectedClubIndex: newIdx, aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle };
            state = stateRef.current;
          }
          if (gp.rbPressed || gp.dDown) {
            const newIdx = clampClubIndex(state.selectedClubIndex + 1);
            const newClub = CLUBS[newIdx];
            const aimingBackward = state.aimAngle > 90;
            stateRef.current = { ...state, selectedClubIndex: newIdx, aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle };
            state = stateRef.current;
          }

          // A button = start power meter
          if (gp.aPressed) {
            startAmbience();
            stateRef.current = { ...state, phase: 'powering', power: 0, powerDirection: 1, powerActive: true };
            state = stateRef.current;
          }

          // Y = toggle scorecard
          if (gp.yPressed) {
            stateRef.current = { ...state, showScorecard: !state.showScorecard };
            state = stateRef.current;
          }
        }

        if (dAngle !== 0) {
          const raw = state.aimAngle + dAngle;
          const newAngle = Math.max(5, Math.min(175, raw));
          stateRef.current = { ...state, aimAngle: newAngle };
          state = stateRef.current;
        }
      } else if (state.phase === 'powering' && isMyTurn() && gp?.aPressed) {
        // A button = confirm shot
        doLaunch();
        state = stateRef.current;
      } else if (state.phase === 'scorecard' && gp?.aPressed) {
        if (isMultiplayer) {
          if (isHost) { sendMsg({ type: 'advance' }); advanceToNextHole(); }
        } else {
          advanceToNextHole();
        }
        state = stateRef.current;
      } else if (state.phase === 'gameOver' && gp?.aPressed) {
        stopAmbience();
        onBackToMenu();
      }

      // Gamepad Y for scorecard toggle (works in any phase)
      if (gp?.yPressed && state.phase !== 'aiming') {
        stateRef.current = { ...state, showScorecard: !state.showScorecard };
        state = stateRef.current;
      }

      // Gamepad stick Y for fine aim during powering
      if (state.phase === 'powering' && isMyTurn() && gp && Math.abs(gp.stickY) > 0.15) {
        const aimingBackward = state.aimAngle > 90;
        const aimAdjust = -gp.stickY * 0.8; // stick up = higher angle
        const newAngle = aimingBackward
          ? Math.max(95, Math.min(175, state.aimAngle + aimAdjust))
          : Math.max(5, Math.min(85, state.aimAngle + aimAdjust));
        stateRef.current = { ...state, aimAngle: newAngle };
        state = stateRef.current;
      }

      // Power meter animation
      if (state.phase === 'powering') {
        const POWER_SPEED = 0.008;
        const ballSeg = state.ball && state.holeData
          ? getSegmentAt(state.holeData.segments, state.ball.x)
          : null;
        const POWER_CAP = ballSeg?.type === 'sand' ? getSandPowerCap(state.selectedClubIndex) : ballSeg?.type === 'rough' ? 0.75 : 1.0;
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
        // In multiplayer, no manual fast-forward — both sides must step identically
        const simSpeed = isMultiplayer
          ? 1
          : (mouseHeldRef.current ? 6 : 1);
        let prevInFlight = ball.inFlight;
        for (let step = 0; step < simSpeed; step++) {
          const result = stepPhysics(ball, holeData.terrain, holeData.segments, holeData.holeX, holeData.holeY, state.wind.speed * state.wind.direction);
          // Track first landing position for practice range
          if (practiceType && prevInFlight && result.bounced && practiceLandingXRef.current === null) {
            practiceLandingXRef.current = result.ball.x;
          }
          prevInFlight = result.ball.inFlight;
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

        // Helper: find next unsunk, non-dropped player
        const findNextPlayer = () => {
          const numPlayers = state.players.length;
          for (let i = 1; i <= numPlayers; i++) {
            const idx = (state.currentPlayerIdx + i) % numPlayers;
            if (!state.playerSunk[idx] && !droppedPlayersRef.current.has(idx)) return idx;
          }
          return -1;
        };

        // Helper: switch to a player
        const switchToPlayer = (nextIdx: number) => {
          const nextBall = state.playerBalls[nextIdx];
          if (!nextBall) return;
          const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
          const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - nextBall.x) * ypp));
          const sugIdx = suggestClubClamped(ydsLeft, holeData.segments, nextBall.x);
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

          stateRef.current = {
            ...state, ball: safeBall, phase: 'settled', settledTimer: 90, // ~1 second at 90fps
            currentStrokes: penaltyStrokes, particles: newParticles,
            playerStrokes: updatedPlayerStrokes, playerBalls: updatedPlayerBalls,
          };
        } else if (landed) {
          const updatedPlayerBalls = [...state.playerBalls];
          updatedPlayerBalls[state.currentPlayerIdx] = { ...ball };
          const updatedPlayerStrokes = [...state.playerStrokes];
          updatedPlayerStrokes[state.currentPlayerIdx] = state.currentStrokes;

          stateRef.current = {
            ...state, ball, phase: 'settled', settledTimer: practiceType ? (practiceType === 'putting' ? 135 : 270) : 90,
            particles: newParticles,
            playerBalls: updatedPlayerBalls, playerStrokes: updatedPlayerStrokes,
          };
        } else {
          // Ball still moving — stay in flight/rolling
          const newPhase = ball.rolling ? 'rolling' : 'inFlight';
          stateRef.current = { ...state, ball, phase: newPhase, particles: newParticles };
        }

        state = stateRef.current;
      }

      // Handle settled phase countdown
      if (state.phase === 'settled') {
        stateRef.current = {
          ...state,
          settledTimer: state.settledTimer - 1,
          particles: updateParticles(state.particles),
        };
        state = stateRef.current;

        if (state.settledTimer <= 0) {
          // Practice mode: reset to tee
          if (practiceType) {
            if (practiceType === 'putting') {
              // Putting: regenerate green for variety
              startPracticeRound();
            } else {
              // Range: reset ball to tee, keep same terrain
              const teeBall = createBall(holeData.teeX, holeData.teeY - 10);
              const sugIdx = 0; // Driver
              stateRef.current = {
                ...state,
                ball: teeBall,
                phase: 'aiming',
                selectedClubIndex: sugIdx,
                aimAngle: CLUBS[sugIdx].launchAngle,
                currentStrokes: 0,
                particles: [],
                playerBalls: [teeBall],
                playerStrokes: [0],
              };
            }
            state = stateRef.current;
          } else {

          const ball = state.ball!;

          // Find next unsunk player (for multiplayer turn switch)
          const findNext = () => {
            const n = state.players.length;
            for (let i = 1; i <= n; i++) {
              const idx = (state.currentPlayerIdx + i) % n;
              if (!state.playerSunk[idx] && !droppedPlayersRef.current.has(idx)) return idx;
            }
            return -1;
          };

          const transitionToAiming = (aimBall: Ball) => {
            const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
            const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - aimBall.x) * ypp));
            const sugIdx = suggestClubClamped(ydsLeft, holeData.segments, aimBall.x);
            const pastHole = aimBall.x > holeData.holeX;
            const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
            stateRef.current = {
              ...state, ball: aimBall, phase: 'aiming',
              selectedClubIndex: sugIdx, aimAngle: sugAngle,
            };
          };

          if (isMultiplayer && state.players.length > 1) {
            const nextIdx = findNext();
            if (nextIdx >= 0 && nextIdx !== state.currentPlayerIdx) {
              const nextBall = state.playerBalls[nextIdx];
              if (nextBall) {
                const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
                const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - nextBall.x) * ypp));
                const sugIdx = suggestClubClamped(ydsLeft, holeData.segments, nextBall.x);
                const pastHole = nextBall.x > holeData.holeX;
                const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
                stateRef.current = {
                  ...state,
                  currentPlayerIdx: nextIdx,
                  ball: { ...nextBall, atRest: true, rolling: false, inFlight: false, vx: 0, vy: 0 },
                  currentStrokes: state.playerStrokes[nextIdx],
                  phase: 'aiming',
                  selectedClubIndex: sugIdx, aimAngle: sugAngle,
                };
              }
            } else {
              transitionToAiming(ball);
            }
          } else {
            transitionToAiming(ball);
          }
        } // end else (non-practice)
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
          // Practice mode: regenerate instead of scorecard
          if (practiceType) {
            startPracticeRound();
            state = stateRef.current;
          } else {
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
                const sugIdx = suggestClubClamped(ydsLeft, holeData.segments, nextBall.x);
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
          } // end else (non-practice holeSunk)
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
      const onTee = state.phase === 'aiming' && state.currentStrokes === 0;
      drawTeeMarker(ctx, holeData.teeX, holeData.teeY, camera, practiceType ? undefined : state.currentHole, practiceType ? undefined : holeData.par, onTee, practiceType ? undefined : holeData.distance);
      if (!practiceType || practiceType === 'putting') {
        drawHoleFlag(ctx, holeData.holeX, holeData.holeY, camera, frame);
      }
      if (practiceType && practiceType !== 'putting') {
        drawPracticeYardageMarkers(ctx, holeData, camera, width, height);
      }
      drawParticles(ctx, state.particles, camera);

      // Draw other players' ball markers (before active ball so active is on top)
      // Skip markers for balls still on the tee
      for (let pi = 0; pi < state.players.length; pi++) {
        if (pi === state.currentPlayerIdx) continue; // skip active player
        const otherBall = state.playerBalls[pi];
        if (otherBall && !state.playerSunk[pi]) {
          const onTee = Math.abs(otherBall.x - holeData.teeX) < 5 && Math.abs(otherBall.y - (holeData.teeY - 10)) < 5;
          if (!onTee) {
            drawBallMarker(ctx, otherBall, camera, state.players[pi].color, state.players[pi].name);
          }
        }
      }

      if (state.ball) {
        drawBall(ctx, state.ball, camera, state.players[state.currentPlayerIdx]?.color ?? '#ffffff');
        if ((state.phase === 'aiming' || state.phase === 'powering') && isMyTurn()) {
          drawAimArrow(ctx, state.ball, state.aimAngle, camera);
        }
        // Practice range: show air landing marker as soon as ball bounces, roll marker when settled
        if (practiceType && practiceType !== 'putting' && (state.phase === 'inFlight' || state.phase === 'rolling' || state.phase === 'settled')) {
          const pixelsPerYard = 6.5;
          const s = uiScale(height);
          const fontSize = Math.round(14 * s);
          const px = Math.round(6 * s);
          const py = Math.round(4 * s);
          ctx.font = `bold ${fontSize}px monospace`;
          ctx.textAlign = 'center';

          const drawMarker = (screenX: number, screenY: number, label: string, color: string) => {
            const tw = ctx.measureText(label).width;
            const arrowH = Math.round(14 * s);
            const arrowW = Math.round(10 * s);
            const gap = Math.round(4 * s);
            const boxH = fontSize + py * 2;
            const boxTop = screenY - arrowH - gap - boxH;
            const bx = screenX - tw / 2 - px;
            // Label background
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.beginPath();
            ctx.roundRect(bx, boxTop, tw + px * 2, boxH, Math.round(4 * s));
            ctx.fill();
            // Label text
            ctx.fillStyle = color;
            ctx.fillText(label, screenX, boxTop + fontSize + py);
            // Arrow pointing down to the spot
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(screenX - arrowW, screenY - arrowH);
            ctx.lineTo(screenX + arrowW, screenY - arrowH);
            ctx.closePath();
            ctx.fill();
            // Arrow outline
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = Math.round(2.5 * s);
            ctx.stroke();
          };

          // Air landing marker — show as soon as ball first bounces
          let airMarkerSx: number | null = null;
          let airMarkerY: number | null = null;
          if (practiceLandingXRef.current !== null) {
            const airYds = Math.round(Math.abs(practiceLandingXRef.current - holeData.teeX) / pixelsPerYard);
            const landTerrainY = getTerrainY(holeData.terrain, practiceLandingXRef.current);
            airMarkerSx = practiceLandingXRef.current - camera.x;
            airMarkerY = landTerrainY;
            drawMarker(airMarkerSx, airMarkerY, `${airYds}`, '#93c5fd');
          }

          // Total distance marker — only show when ball has settled
          if (state.phase === 'settled') {
            const totalYds = Math.round(Math.abs(state.ball.x - holeData.teeX) / pixelsPerYard);
            const ballSx = state.ball.x - camera.x;
            const rollYds = practiceLandingXRef.current !== null
              ? Math.round(Math.abs(state.ball.x - practiceLandingXRef.current) / pixelsPerYard)
              : 0;
            const rolledBack = practiceLandingXRef.current !== null && state.ball.x < practiceLandingXRef.current;
            const totalLabel = rollYds > 0 ? `${totalYds} (${rolledBack ? '-' : '+'}${rollYds})` : `${totalYds}`;
            // Offset upward if too close to air marker
            let rollMarkerY = state.ball.y;
            if (airMarkerSx !== null && airMarkerY !== null) {
              const dist = Math.abs(ballSx - airMarkerSx);
              if (dist < Math.round(60 * s)) {
                rollMarkerY = airMarkerY - Math.round(50 * s);
              }
            }
            drawMarker(ballSx, rollMarkerY, totalLabel, '#fbbf24');
          }
        }
      }

      drawHUD(ctx, state, width, height);
      drawControls(ctx, state, width, height);

      if ((state.phase === 'aiming' || state.phase === 'powering') && isMyTurn()) {
        drawClubCarousel(ctx, state.selectedClubIndex, width, height);
        drawWindIndicator(ctx, state, width, height);
        if (state.ball && state.holeData && (!practiceType || practiceType === 'putting')) {
          drawYardageRuler(ctx, state.ball, state.holeData, width, height, state.players[state.currentPlayerIdx]?.color);
        }
        const ballSeg = state.ball && state.holeData
          ? getSegmentAt(state.holeData.segments, state.ball.x)
          : null;
        const renderPowerCap = ballSeg?.type === 'sand' ? getSandPowerCap(state.selectedClubIndex) : ballSeg?.type === 'rough' ? 0.75 : 1.0;
        drawPowerMeter(ctx, state.power, state.phase === 'powering', width, height, renderPowerCap);
      }

      // When it's NOT my turn and phase is aiming, show waiting indicator
      if (isMultiplayer && state.phase === 'aiming' && !isMyTurn()) {
        const otherPlayer = state.players[state.currentPlayerIdx];
        const s = uiScale(height);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const bw = Math.round(200*s);
        ctx.fillRect(width / 2 - bw/2, height / 2 - Math.round(20*s), bw, Math.round(36*s));
        ctx.fillStyle = '#fbbf24';
        ctx.font = `bold ${Math.round(14*s)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${otherPlayer?.name ?? 'Opponent'} is aiming...`, width / 2, height / 2);
        ctx.restore();
      }

      if ((state.phase === 'inFlight' || state.phase === 'rolling') && state.ball && state.holeData) {
        if (!practiceType || practiceType === 'putting') {
          drawYardageRuler(ctx, state.ball, state.holeData, width, height, state.players[state.currentPlayerIdx]?.color);
        }
        if (mouseHeldRef.current) {
          const s = uiScale(height);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(width / 2 - Math.round(40*s), height - Math.round(32*s), Math.round(80*s), Math.round(20*s));
          ctx.fillStyle = '#fbbf24';
          ctx.font = `bold ${Math.round(10*s)}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText('\u23e9 6x Speed', width / 2, height - Math.round(18*s));
        }
      }

      if (state.phase === 'holeIntro' && !practiceType) {
        const totalIntroTicks = 270;
        const introProgress = 1 - (state.holeIntroTimer / totalIntroTicks);
        const alpha = Math.min(1, state.holeIntroTimer > 30 ? 1 : state.holeIntroTimer / 30);
        drawHoleIntro(ctx, holeData, state.currentHole, width, height, alpha, camera, introProgress);
      }

      if (state.phase === 'holeSunk') {
        drawHoleSunk(ctx, state, width, height);
      }

      // Practice mode label
      if (practiceType) {
        const s = uiScale(height);
        const labels: Record<PracticeType, string> = {
          fairway: 'DRIVING RANGE',
          rough: 'ROUGH PRACTICE',
          sand: 'BUNKER PRACTICE',
          putting: 'PUTTING GREEN',
        };
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        const labelW = Math.round(160 * s);
        ctx.fillRect(width / 2 - labelW / 2, Math.round(8 * s), labelW, Math.round(24 * s));
        ctx.fillStyle = '#4ade80';
        ctx.font = `bold ${Math.round(12 * s)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(labels[practiceType], width / 2, Math.round(24 * s));
      }

      if (!practiceType && (state.showScorecard || state.phase === 'scorecard')) {
        drawScorecard(ctx, state, width, height);
        if (state.phase === 'scorecard') {
          const s = uiScale(height);
          ctx.fillStyle = '#4ade80';
          ctx.font = `bold ${Math.round(12*s)}px monospace`;
          ctx.textAlign = 'center';
          const scorecardMsg = (isMultiplayer && isGuest) ? 'Waiting for host to continue...' : 'Press SPACE or tap for next hole';
          ctx.fillText(scorecardMsg, width / 2, height - Math.round(20*s));
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
        const s = uiScale(height);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(width / 2 - Math.round(70*s), Math.round(40*s), Math.round(140*s), Math.round(22*s));
        ctx.fillStyle = turnColor;
        ctx.font = `bold ${Math.round(11*s)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(turnText, width / 2, Math.round(56*s));
        ctx.restore();
      }

      // Reconnecting overlay
      if (reconnecting) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('RECONNECTING...', width / 2, height / 2 - 10);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px monospace';
        ctx.fillText('Attempting to rejoin the game', width / 2, height / 2 + 20);
      }
      // Disconnected overlay (unrecoverable)
      else if (disconnectedRef.current) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('DISCONNECTED', width / 2, height / 2 - 20);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px monospace';
        ctx.fillText('Connection lost', width / 2, height / 2 + 15);
        ctx.fillStyle = '#4ade80';
        ctx.fillText('Click to return to menu', width / 2, height / 2 + 45);
      }
      // Dropped player banner (shown to remaining players)
      if (droppedPlayersRef.current.size > 0 && !disconnectedRef.current && !reconnecting) {
        const names = Array.from(droppedPlayersRef.current).map(idx =>
          stateRef.current.players[idx]?.name ?? `Player ${idx + 1}`
        ).join(', ');
        ctx.save();
        ctx.fillStyle = 'rgba(239,68,68,0.85)';
        ctx.fillRect(width / 2 - 160, 100, 320, 28);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`⚠ ${names} disconnected — skipping turns`, width / 2, 118);
        ctx.restore();
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
      return;
    }
    if (stateRef.current.showScorecard) {
      stateRef.current = { ...stateRef.current, showScorecard: false };
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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={handleCanvasClick}
        onContextMenu={(e) => e.preventDefault()}
        className="block cursor-crosshair"
        style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
      />
      {/* Hamburger menu button */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="absolute bottom-4 right-4 w-12 h-12 flex flex-col items-center justify-center gap-1.5 bg-black/50 hover:bg-black/70 rounded-lg border border-white/20"
      >
        <span className="block w-6 h-0.5 bg-white/80" />
        <span className="block w-6 h-0.5 bg-white/80" />
        <span className="block w-6 h-0.5 bg-white/80" />
      </button>

      {/* Menu overlay */}
      {menuOpen && (
        <div className="absolute bottom-18 right-4 bg-black/85 border border-white/20 rounded-lg p-3 flex flex-col gap-2 min-w-[160px]">
          <button
            onClick={() => {
              const nowMuted = toggleMute();
              setMuted(nowMuted);
            }}
            className="text-left text-sm text-white/90 hover:text-white px-3 py-2 rounded hover:bg-white/10"
          >
            {muted ? 'Sound: OFF' : 'Sound: ON'}
          </button>
          <button
            onClick={() => {
              const on = toggleBirds();
              setBirdsOn(on);
            }}
            className="text-left text-sm text-white/90 hover:text-white px-3 py-2 rounded hover:bg-white/10"
          >
            {birdsOn ? 'Birds: ON' : 'Birds: OFF'}
          </button>
          {practiceType && (
            <button
              onClick={() => {
                const nowEnabled = !windEnabled;
                setWindEnabled(nowEnabled);
                if (!nowEnabled) {
                  stateRef.current = { ...stateRef.current, wind: { speed: 0, direction: 0, label: 'Calm' } };
                }
              }}
              className="text-left text-sm text-white/90 hover:text-white px-3 py-2 rounded hover:bg-white/10"
            >
              {windEnabled ? 'Wind: ON' : 'Wind: OFF'}
            </button>
          )}
          {!practiceType && (
            <button
              onClick={() => {
                stateRef.current = { ...stateRef.current, showScorecard: !stateRef.current.showScorecard };
                setMenuOpen(false);
              }}
              className="text-left text-sm text-white/90 hover:text-white px-3 py-2 rounded hover:bg-white/10"
            >
              Scorecard
            </button>
          )}
          <div className="border-t border-white/10 my-1" />
          <button
            onClick={() => {
              stopAmbience();
              multiplayer?.disconnect();
              onBackToMenu();
            }}
            className="text-left text-sm text-red-400 hover:text-red-300 px-3 py-2 rounded hover:bg-white/10"
          >
            End Round
          </button>
        </div>
      )}
    </div>
  );
}

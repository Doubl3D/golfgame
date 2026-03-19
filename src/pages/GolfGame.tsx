import { useEffect, useRef, useCallback, useState } from 'react';
import { GameState, createInitialState, startHole, updateParticles, spawnSandParticles, spawnWaterParticles } from '../game/gameState';
import { stepPhysics, launchBall, createBall } from '../game/physics';
import { getSegmentAt, Difficulty } from '../game/terrain';
import { CLUBS, suggestClub } from '../game/clubs';
import { Camera, updateCamera, uiScale, drawSky, drawForeground, drawTerrain, drawHoleFlag, drawTeeMarker, drawBall, drawBallMarker, drawAimArrow, drawParticles, drawHUD, drawPowerMeter, drawYardageRuler, drawClubCarousel, drawHoleIntro, drawScorecard, drawHoleSunk, drawGameOver, drawControls, drawTouchControls } from '../game/renderer';
import { startAmbience, stopAmbience, playSwingSound, playPutterSound, playHoleSunkSound, playSandSound, playWaterSound } from '../game/audio';
import { MultiplayerConnection, NetMessage, rejoinSession } from '../game/multiplayer';

interface GolfGameProps {
  playerNames: string[];
  totalHoles: number;
  difficulty: Difficulty;
  multiplayer?: MultiplayerConnection;
  joinCode?: string;
  onBackToMenu: () => void;
}

export default function GolfGame({ playerNames, totalHoles, difficulty, multiplayer, joinCode, onBackToMenu }: GolfGameProps) {
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
  const isTouchDevice = useRef(false);
  const touchAimRef = useRef<'left' | 'right' | null>(null);

  // Gamepad state
  const gamepadPrevRef = useRef<{ buttons: boolean[] }>({ buttons: [] });
  const gamepadAimHeld = useRef(false);

  // Shared pointer-down logic (mouse & touch)
  function handlePointerDown(clientX: number, clientY: number) {
    startAmbience();
    mouseHeldRef.current = true;
    const state = stateRef.current;
    if (state.showScorecard) return;

    // Check if touch hit a UI button (only on touch devices during aiming)
    if (isTouchDevice.current && state.phase === 'aiming' && isMyTurn()) {
      const canvas = canvasRef.current;
      if (canvas) {
        const w = canvas.width;
        const h = canvas.height;
        const btnSize = 56;
        const btnMargin = 12;

        // Club up button: above club carousel
        const clubUpX = 16, clubUpY = h - 140 - btnSize - btnMargin;
        if (clientX >= clubUpX && clientX <= clubUpX + btnSize && clientY >= clubUpY && clientY <= clubUpY + btnSize) {
          const newIdx = Math.max(0, state.selectedClubIndex - 1);
          const newClub = CLUBS[newIdx];
          const aimingBackward = state.aimAngle > 90;
          stateRef.current = { ...state, selectedClubIndex: newIdx, aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle };
          return;
        }
        // Club down button: below club carousel
        const clubDnX = 16, clubDnY = h - 140 + 64 + btnMargin;
        if (clientX >= clubDnX && clientX <= clubDnX + btnSize && clientY >= clubDnY && clientY <= clubDnY + btnSize) {
          const newIdx = Math.min(CLUBS.length - 1, state.selectedClubIndex + 1);
          const newClub = CLUBS[newIdx];
          const aimingBackward = state.aimAngle > 90;
          stateRef.current = { ...state, selectedClubIndex: newIdx, aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle };
          return;
        }
        // Aim left button: bottom-right area
        const aimBtnY = h - btnSize - btnMargin;
        const aimLeftX = w - btnSize * 2 - btnMargin * 2;
        if (clientX >= aimLeftX && clientX <= aimLeftX + btnSize && clientY >= aimBtnY && clientY <= aimBtnY + btnSize) {
          touchAimRef.current = 'left';
          return;
        }
        // Aim right button
        const aimRightX = w - btnSize - btnMargin;
        if (clientX >= aimRightX && clientX <= aimRightX + btnSize && clientY >= aimBtnY && clientY <= aimBtnY + btnSize) {
          touchAimRef.current = 'right';
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
    touchAimRef.current = null;
    const state = stateRef.current;
    if (state.phase === 'powering' && mouseDownRef.current && isMyTurn()) {
      doLaunch();
      mouseDownRef.current = null;
    }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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

  // Start first hole
  useEffect(() => {
    lastTimeRef.current = 0;
    accumRef.current = 0;
    if (joinCode) joinCodeRef.current = joinCode;
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
        if (keys.has('ArrowLeft') || keys.has('KeyA') || touchAimRef.current === 'left') dAngle = aimSpeed;
        if (keys.has('ArrowRight') || keys.has('KeyD') || touchAimRef.current === 'right') dAngle = -aimSpeed;

        // Gamepad aim: left stick or d-pad
        if (gp) {
          if (gp.dLeft || gp.stickX < -0.15) dAngle = aimSpeed * (gp.stickX < -0.15 ? Math.abs(gp.stickX) : 1);
          if (gp.dRight || gp.stickX > 0.15) dAngle = -aimSpeed * (gp.stickX > 0.15 ? gp.stickX : 1);

          // Club selection: LB/RB or D-pad up/down
          if (gp.lbPressed || gp.dUp) {
            const newIdx = Math.max(0, state.selectedClubIndex - 1);
            const newClub = CLUBS[newIdx];
            const aimingBackward = state.aimAngle > 90;
            stateRef.current = { ...state, selectedClubIndex: newIdx, aimAngle: aimingBackward ? 180 - newClub.launchAngle : newClub.launchAngle };
            state = stateRef.current;
          }
          if (gp.rbPressed || gp.dDown) {
            const newIdx = Math.min(CLUBS.length - 1, state.selectedClubIndex + 1);
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
        const POWER_CAP = ballSeg?.type === 'sand' ? 0.5 : ballSeg?.type === 'rough' ? 0.75 : 1.0;
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

      drawHUD(ctx, state, width, height);
      drawControls(ctx, state, width, height);
      if (isTouchDevice.current) {
        drawTouchControls(ctx, state, width, height);
      }

      if ((state.phase === 'aiming' || state.phase === 'powering') && isMyTurn()) {
        drawClubCarousel(ctx, state.selectedClubIndex, width, height);
        if (state.ball && state.holeData) {
          drawYardageRuler(ctx, state.ball, state.holeData, width, height);
        }
        const ballSeg = state.ball && state.holeData
          ? getSegmentAt(state.holeData.segments, state.ball.x)
          : null;
        const renderPowerCap = ballSeg?.type === 'sand' ? 0.5 : ballSeg?.type === 'rough' ? 0.75 : 1.0;
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
        drawYardageRuler(ctx, state.ball, state.holeData, width, height);
        if (mouseHeldRef.current || rollingFramesRef.current > 180) {
          const s = uiScale(height);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(width / 2 - Math.round(40*s), height - Math.round(32*s), Math.round(80*s), Math.round(20*s));
          ctx.fillStyle = '#fbbf24';
          ctx.font = `bold ${Math.round(10*s)}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText('\u23e9 6x Speed', width / 2, height - Math.round(18*s));
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
      <button
        onClick={() => { stopAmbience(); multiplayer?.disconnect(); onBackToMenu(); }}
        className="absolute top-3 right-3 text-xs text-white/60 hover:text-white/90 bg-black/40 px-3 py-1 rounded"
      >
        Menu
      </button>
    </div>
  );
}

import { useEffect, useRef, useCallback, useState } from 'react';
import { GameState, createInitialState, startHole, updateParticles, spawnSandParticles, spawnWaterParticles } from '../game/gameState';
import { stepPhysics, launchBall } from '../game/physics';
import { getSegmentAt } from '../game/terrain';
import { CLUBS, suggestClub } from '../game/clubs';
import { Camera, updateCamera, drawSky, drawForeground, drawTerrain, drawHoleFlag, drawTeeMarker, drawBall, drawAimArrow, drawParticles, drawHUD, drawPowerMeter, drawYardageRuler, drawClubCarousel, drawHoleIntro, drawScorecard, drawHoleSunk, drawGameOver, drawControls } from '../game/renderer';
import { startAmbience, stopAmbience, playHoleSunkSound, playSandSound, playWaterSound } from '../game/audio';

interface GolfGameProps {
  playerNames: string[];
  totalHoles: number;
  onBackToMenu: () => void;
}

export default function GolfGame({ playerNames, totalHoles, onBackToMenu }: GolfGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(createInitialState(playerNames, totalHoles));
  const cameraRef = useRef<Camera>({ x: 0, y: 0 });
  const frameRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const keysRef = useRef<Set<string>>(new Set());
  const aimDelayRef = useRef<number>(0);

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

    if (state.phase === 'aiming') {
      // Club selection: Q/E or ArrowUp/ArrowDown cycle through clubs
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
    } else if (state.phase === 'powering') {
      if (e.code === 'Space') {
        const s = stateRef.current;
        if (!s.ball || !s.holeData) return;
        const club = CLUBS[s.selectedClubIndex];
        const newBall = launchBall(s.ball, s.aimAngle, s.power, s.wind.speed * s.wind.direction, club);
        const ypp = s.holeData.distance / (s.holeData.holeX - s.holeData.teeX);
        console.log('[LAUNCH]', club.name, 'power='+s.power.toFixed(2), 'angle='+s.aimAngle, 'vx='+newBall.vx.toFixed(1), 'vy='+newBall.vy.toFixed(1), 'ypp='+ypp.toFixed(4));
        (window as any).__ballDebug = { startX: newBall.x, ypp, frames: 0, maxHeight: 0, teeY: s.holeData.terrain[Math.floor(s.ball.x)] };
        stateRef.current = {
          ...s,
          ball: newBall,
          phase: 'inFlight',
          powerActive: false,
          currentStrokes: s.currentStrokes + 1,
        };
      }
    } else if (state.phase === 'holeSunk' || state.phase === 'scorecard') {
      advanceToNextHole();
    } else if (state.phase === 'gameOver') {
      stopAmbience();
      onBackToMenu();
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysRef.current.delete(e.code);
  }, []);

  const mouseDownRef = useRef<{ x: number; y: number; backward: boolean } | null>(null);
  const mouseHeldRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startAmbience();
    mouseHeldRef.current = true;
    const state = stateRef.current;
    if (state.showScorecard) return;

    if (state.phase === 'aiming') {
      mouseDownRef.current = { x: e.clientX, y: e.clientY, backward: state.aimAngle > 90 };
      stateRef.current = {
        ...state,
        phase: 'powering',
        power: 0,
        powerDirection: 1,
        powerActive: true,
      };
    } else if (state.phase === 'holeSunk' || state.phase === 'scorecard') {
      advanceToNextHole();
    } else if (state.phase === 'gameOver') {
      stopAmbience();
      onBackToMenu();
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const state = stateRef.current;
    if (state.phase !== 'powering' || !mouseDownRef.current) return;

    const dy = mouseDownRef.current.y - e.clientY;
    const sensitivity = 3;
    const clubAngle = CLUBS[state.selectedClubIndex].launchAngle;
    // Detect if we started aimed backward (past the hole)
    const aimingBackward = mouseDownRef.current.backward;
    const baseAngle = aimingBackward ? 180 - clubAngle : clubAngle;
    // When aimed backward, invert mouse: drag up = toward 90° (higher arc), drag down = toward 175° (flatter)
    const direction = aimingBackward ? -1 : 1;
    const angleOffset = (dy / sensitivity) * direction;
    const newAngle = aimingBackward
      ? Math.max(95, Math.min(175, baseAngle + angleOffset))
      : Math.max(5, Math.min(85, baseAngle + angleOffset));

    stateRef.current = { ...state, aimAngle: newAngle };
  }, []);

  const handleMouseUp = useCallback(() => {
    mouseHeldRef.current = false;
    const state = stateRef.current;
    if (state.phase === 'powering' && mouseDownRef.current) {
      const s = stateRef.current;
      if (!s.ball || !s.holeData) {
        mouseDownRef.current = null;
        return;
      }
      const club = CLUBS[s.selectedClubIndex];
      const newBall = launchBall(s.ball, s.aimAngle, s.power, s.wind.speed * s.wind.direction, club);
      const ypp = s.holeData.distance / (s.holeData.holeX - s.holeData.teeX);
      console.log('[LAUNCH]', club.name, 'power='+s.power.toFixed(2), 'angle='+s.aimAngle.toFixed(1), 'vx='+newBall.vx.toFixed(1), 'vy='+newBall.vy.toFixed(1), 'ypp='+ypp.toFixed(4));
      (window as any).__ballDebug = { startX: newBall.x, ypp, frames: 0, maxHeight: 0, teeY: s.holeData.terrain[Math.floor(s.ball.x)] };
      stateRef.current = {
        ...s,
        ball: newBall,
        phase: 'inFlight',
        powerActive: false,
        currentStrokes: s.currentStrokes + 1,
      };
      mouseDownRef.current = null;
    }
  }, []);

  function advanceToNextHole() {
    const s = stateRef.current;
    const nextHole = s.currentHole + 1;
    if (nextHole > s.totalHoles) {
      stateRef.current = { ...s, phase: 'gameOver' };
    } else {
      const newState = startHole({ ...s, currentHole: nextHole });
      stateRef.current = newState;
      cameraRef.current = { x: 0, y: 0 };
    }
  }

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
    stateRef.current = startHole(stateRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = () => {
      frameCountRef.current++;
      const frame = frameCountRef.current;
      const { width, height } = canvas;
      let state = stateRef.current;
      const keys = keysRef.current;

      ctx.clearRect(0, 0, width, height);
      drawSky(ctx, width, height, cameraRef.current.x);

      if (!state.holeData || !state.ball) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      const { holeData } = state;

      // Update camera
      cameraRef.current = updateCamera(cameraRef.current, state.ball, width, height, holeData.width);
      const camera = cameraRef.current;

      // Handle aim key input
      if (state.phase === 'aiming') {
        aimDelayRef.current = Math.max(0, aimDelayRef.current - 1);
        const aimSpeed = 1.2;

        const playerIdx = state.currentPlayerIdx;
        let dAngle = 0;

        if (playerIdx === 0) {
          if (keys.has('ArrowLeft') || keys.has('KeyA')) dAngle = aimSpeed;
          if (keys.has('ArrowRight') || keys.has('KeyD')) dAngle = -aimSpeed;
        } else if (playerIdx === 1) {
          if (keys.has('KeyA')) dAngle = aimSpeed;
          if (keys.has('KeyD')) dAngle = -aimSpeed;
        } else {
          if (keys.has('ArrowLeft') || keys.has('KeyA')) dAngle = aimSpeed;
          if (keys.has('ArrowRight') || keys.has('KeyD')) dAngle = -aimSpeed;
        }

        if (dAngle !== 0) {
          // Clamp to upper semicircle only (5°–175°), so aiming stays above ground
          const raw = state.aimAngle + dAngle;
          const newAngle = Math.max(5, Math.min(175, raw));
          stateRef.current = { ...state, aimAngle: newAngle };
          state = stateRef.current;
        }
      }

      // Power meter animation
      if (state.phase === 'powering') {
        const POWER_SPEED = 0.008;
        // Sand bunker: cap at 50% power
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

      // Physics update (multiple sub-steps)
      if (state.phase === 'inFlight' || state.phase === 'rolling') {
        let ball = state.ball!;
        let newParticles = [...state.particles];
        let landed = false;
        let inHole = false;
        let inWater = false;

        const simSpeed = mouseHeldRef.current ? 6 : 1;
        for (let step = 0; step < simSpeed; step++) {
          const result = stepPhysics(ball, holeData.terrain, holeData.segments, holeData.holeX, holeData.holeY, state.wind.speed * state.wind.direction);
          ball = result.ball;

          if (result.inHole) {
            inHole = true;
            break;
          }
          if (result.inWater) {
            inWater = true;
            newParticles = [...newParticles, ...spawnWaterParticles(ball.x, ball.y)];
            break;
          }
          if (result.inSand && result.bounced) {
            newParticles = [...newParticles, ...spawnSandParticles(ball.x, ball.y)];
            playSandSound();
          }
          if (ball.atRest) {
            landed = true;
            break;
          }
        }

        newParticles = updateParticles(newParticles);

        // Debug: track ball flight
        const dbg = (window as any).__ballDebug;
        if (dbg) {
          dbg.frames++;
          const heightAboveTee = dbg.teeY - ball.y;
          if (heightAboveTee > dbg.maxHeight) dbg.maxHeight = heightAboveTee;
          if (ball.atRest || landed || inHole || inWater) {
            const totalPx = Math.abs(ball.x - dbg.startX);
            const totalYds = Math.round(totalPx * dbg.ypp);
            console.log('[LANDED]', 'dist=' + totalYds + 'yds (' + Math.round(totalPx) + 'px)', 'maxHeight=' + Math.round(dbg.maxHeight) + 'px', 'frames=' + dbg.frames, 'inFlight=' + ball.inFlight, 'rolling=' + ball.rolling, 'atRest=' + ball.atRest, 'finalVx=' + ball.vx.toFixed(1));
            (window as any).__ballDebug = null;
          } else if (dbg.frames <= 5 || dbg.frames % 30 === 0) {
            console.log('[FLIGHT f' + dbg.frames + ']', 'x=' + Math.round(ball.x), 'y=' + Math.round(ball.y), 'vx=' + ball.vx.toFixed(1), 'vy=' + ball.vy.toFixed(1), 'inFlight=' + ball.inFlight, 'rolling=' + ball.rolling, 'heightAboveTee=' + Math.round(heightAboveTee));
          }
        }

        if (inHole) {
          // Record score
          playHoleSunkSound();
          const updatedPlayers = state.players.map((p, i) =>
            i === state.currentPlayerIdx
              ? { ...p, scores: [...p.scores, state.currentStrokes] }
              : p
          );
          stateRef.current = {
            ...state,
            ball,
            phase: 'holeSunk',
            holeSunkTimer: 180,
            particles: newParticles,
            players: updatedPlayers,
          };
        } else if (inWater) {
          playWaterSound();
          const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
          const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - ball.x) * ypp));
          const sugIdx = suggestClub(ydsLeft);
          const pastHole = ball.x > holeData.holeX;
          const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
          stateRef.current = {
            ...state,
            ball,
            phase: 'aiming',
            currentStrokes: state.currentStrokes + 1,
            particles: newParticles,
            selectedClubIndex: sugIdx,
            aimAngle: sugAngle,
          };
        } else if (landed) {
          const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
          const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - ball.x) * ypp));
          const sugIdx = suggestClub(ydsLeft);
          const pastHole = ball.x > holeData.holeX;
          const sugAngle = pastHole ? 180 - CLUBS[sugIdx].launchAngle : CLUBS[sugIdx].launchAngle;
          stateRef.current = {
            ...state,
            ball,
            phase: 'aiming',
            particles: newParticles,
            selectedClubIndex: sugIdx,
            aimAngle: sugAngle,
          };
        } else {
          const newPhase = ball.rolling ? 'rolling' : 'inFlight';
          stateRef.current = {
            ...state,
            ball,
            phase: newPhase,
            particles: newParticles,
          };
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
          // Advance to next player or next hole
          const nextPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
          if (nextPlayerIdx === 0) {
            // All players done this hole
            stateRef.current = { ...state, phase: 'scorecard', holeSunkTimer: 0 };
            state = stateRef.current;
          } else {
            // Next player's turn on same hole
            const nextBall = { x: holeData.teeX, y: holeData.teeY - 10, vx: 0, vy: 0, inFlight: false, rolling: false, atRest: true, trail: [], lastSafeX: holeData.teeX, lastSafeY: holeData.teeY - 10, waterPenalty: false, launchAngle: 0, spin: 0 };
            const nextSugIdx = suggestClub(holeData.distance);
            stateRef.current = {
              ...state,
              currentPlayerIdx: nextPlayerIdx,
              ball: nextBall,
              phase: 'aiming',
              currentStrokes: 0,
              holeSunkTimer: 0,
              selectedClubIndex: nextSugIdx,
              aimAngle: CLUBS[nextSugIdx].launchAngle,
            };
            state = stateRef.current;
          }
        } else {
          stateRef.current = { ...state, holeSunkTimer: newTimer };
          state = stateRef.current;
        }
      }

      // Draw
      drawTerrain(ctx, holeData, camera, width, height);
      drawTeeMarker(ctx, holeData.teeX, holeData.teeY, camera);
      drawHoleFlag(ctx, holeData.holeX, holeData.holeY, camera, frame);
      drawParticles(ctx, state.particles, camera);

      // Foreground parallax (draw after terrain, before ball)
      const camMidX = Math.floor(camera.x + width / 2);
      const surfaceY = holeData.terrain[Math.min(camMidX, holeData.terrain.length - 1)] ?? height * 0.6;
      drawForeground(ctx, width, height, camera.x, surfaceY);

      if (state.ball) {
        drawBall(ctx, state.ball, camera, state.players[state.currentPlayerIdx]?.color ?? '#ffffff');
        if (state.phase === 'aiming' || state.phase === 'powering') {
          drawAimArrow(ctx, state.ball, state.aimAngle, camera);
        }
      }

      // HUD
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
        if (mouseHeldRef.current) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(width / 2 - 50, height - 40, 100, 24);
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⏩ 6x Speed', width / 2, height - 23);
        }
      }

      if (state.phase === 'holeIntro') {
        const alpha = Math.min(1, state.holeIntroTimer > 30 ? 1 : state.holeIntroTimer / 30);
        drawHoleIntro(ctx, holeData, state.currentHole, width, height, alpha);
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

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [canvasSize]);

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
        className="block cursor-crosshair"
        style={{ touchAction: 'none' }}
      />
      <button
        onClick={() => { stopAmbience(); onBackToMenu(); }}
        className="absolute top-3 right-3 text-xs text-white/60 hover:text-white/90 bg-black/40 px-3 py-1 rounded"
      >
        Menu
      </button>
    </div>
  );
}

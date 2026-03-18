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
        stateRef.current = {
          ...state,
          selectedClubIndex: newIdx,
          aimAngle: newClub.launchAngle,
        };
        return;
      }
      if (e.code === 'KeyE' || e.code === 'ArrowDown') {
        const newIdx = Math.min(CLUBS.length - 1, state.selectedClubIndex + 1);
        const newClub = CLUBS[newIdx];
        stateRef.current = {
          ...state,
          selectedClubIndex: newIdx,
          aimAngle: newClub.launchAngle,
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
        stateRef.current = {
          ...s,
          ball: newBall,
          phase: 'inFlight',
          powerActive: false,
          currentStrokes: s.currentStrokes + 1,
        };
      }
    } else if (state.phase === 'holeSunk' || state.phase === 'scorecard') {
      if (e.code === 'Space' || e.code === 'Enter') {
        advanceToNextHole();
      }
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysRef.current.delete(e.code);
  }, []);

  const handleClick = useCallback(() => {
    startAmbience();
    const state = stateRef.current;
    if (state.showScorecard) return;

    if (state.phase === 'aiming') {
      stateRef.current = {
        ...state,
        phase: 'powering',
        power: 0,
        powerDirection: 1,
        powerActive: true,
      };
    } else if (state.phase === 'powering') {
      const s = stateRef.current;
      if (!s.ball || !s.holeData) return;
      const newBall = launchBall(s.ball, s.aimAngle, s.power, s.wind.speed * s.wind.direction);
      stateRef.current = {
        ...s,
        ball: newBall,
        phase: 'inFlight',
        powerActive: false,
        currentStrokes: s.currentStrokes + 1,
      };
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

        for (let step = 0; step < 1; step++) {
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
          stateRef.current = {
            ...state,
            ball,
            phase: 'aiming',
            currentStrokes: state.currentStrokes + 1,
            particles: newParticles,
            selectedClubIndex: sugIdx,
            aimAngle: CLUBS[sugIdx].launchAngle,
          };
        } else if (landed) {
          const ypp = holeData.distance / (holeData.holeX - holeData.teeX);
          const ydsLeft = Math.max(0, Math.round(Math.abs(holeData.holeX - ball.x) * ypp));
          const sugIdx = suggestClub(ydsLeft);
          stateRef.current = {
            ...state,
            ball,
            phase: 'aiming',
            particles: newParticles,
            selectedClubIndex: sugIdx,
            aimAngle: CLUBS[sugIdx].launchAngle,
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
        onClick={handleClick}
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

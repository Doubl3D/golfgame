import { HoleData, generateHole } from './terrain';
import { Ball, createBall } from './physics';
import { CLUBS, suggestClub } from './clubs';

export interface Player {
  name: string;
  color: string;
  scores: number[]; // strokes per hole
}

export type GamePhase =
  | 'setup'
  | 'holeIntro'
  | 'aiming'
  | 'powering'
  | 'inFlight'
  | 'rolling'
  | 'holeSunk'
  | 'scorecard'
  | 'gameOver';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  radius: number;
  type: 'sand' | 'water' | 'general';
}

export interface Wind {
  speed: number; // px/frame equivalent
  direction: number; // -1 to 1 (left to right)
  label: string;
}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  currentPlayerIdx: number;
  currentHole: number;
  totalHoles: number;
  allHoleData: HoleData[];
  holeData: HoleData | null;
  ball: Ball | null;
  aimAngle: number; // degrees, 0 = right
  power: number; // 0-1
  powerDirection: number; // 1 or -1
  powerActive: boolean;
  currentStrokes: number;
  showScorecard: boolean;
  particles: Particle[];
  wind: Wind;
  holeIntroTimer: number;
  holeSunkTimer: number;
  scorecardTimer: number;
  lastShotResult: string;
  selectedClubIndex: number;
}

function randomWind(): Wind {
  const speed = Math.random() * 8 + 1;
  const direction = Math.random() > 0.5 ? 1 : -1;
  const cardinal = direction > 0 ? 'E' : 'W';
  return {
    speed,
    direction,
    label: `${cardinal} ${speed.toFixed(1)} mph`,
  };
}

export function createInitialState(
  playerNames: string[],
  totalHoles: number
): GameState {
  const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
  const players: Player[] = playerNames.map((name, i) => ({
    name,
    color: colors[i] ?? '#ffffff',
    scores: [],
  }));

  // Pre-generate ALL hole terrain up front so there are no loading hitches mid-game
  const allHoleData: HoleData[] = Array.from({ length: totalHoles }, (_, i) =>
    generateHole(i + 1)
  );

  return {
    phase: 'setup',
    players,
    currentPlayerIdx: 0,
    currentHole: 1,
    totalHoles,
    allHoleData,
    holeData: null,
    ball: null,
    aimAngle: 25,
    power: 0,
    powerDirection: 1,
    powerActive: false,
    currentStrokes: 0,
    showScorecard: false,
    particles: [],
    wind: randomWind(),
    holeIntroTimer: 0,
    holeSunkTimer: 0,
    scorecardTimer: 0,
    lastShotResult: '',
    selectedClubIndex: 0,
  };
}

export function startHole(state: GameState): GameState {
  // Use pre-generated terrain cache — no on-the-fly generation
  const holeData = state.allHoleData[state.currentHole - 1] ?? generateHole(state.currentHole);
  const ball = createBall(holeData.teeX, holeData.teeY - 10);
  const suggested = suggestClub(holeData.distance);
  return {
    ...state,
    phase: 'holeIntro',
    holeData,
    ball,
    aimAngle: CLUBS[suggested].launchAngle,
    power: 0,
    powerDirection: 1,
    powerActive: false,
    currentStrokes: 0,
    holeIntroTimer: 180,
    wind: randomWind(),
    particles: [],
    lastShotResult: '',
    selectedClubIndex: suggested,
  };
}

export function getScoreLabel(strokes: number, par: number): string {
  const diff = strokes - par;
  if (strokes === 1) return 'Hole in One!';
  if (diff <= -3) return 'Albatross';
  if (diff === -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  if (diff === 2) return 'Double Bogey';
  return `+${diff}`;
}

export function getScoreColor(strokes: number, par: number): string {
  const diff = strokes - par;
  if (diff < 0) return '#fbbf24'; // gold for under par
  if (diff === 0) return '#22c55e'; // green for par
  return '#ef4444'; // red for over par
}

export function spawnSandParticles(x: number, y: number): Particle[] {
  return Array.from({ length: 12 }, () => ({
    x: x + (Math.random() - 0.5) * 20,
    y,
    vx: (Math.random() - 0.5) * 4,
    vy: -(Math.random() * 3 + 1),
    life: 40 + Math.random() * 20,
    maxLife: 60,
    color: `hsl(${35 + Math.random() * 20}, 70%, ${60 + Math.random() * 20}%)`,
    radius: 2 + Math.random() * 3,
    type: 'sand' as const,
  }));
}

export function spawnWaterParticles(x: number, y: number): Particle[] {
  return Array.from({ length: 16 }, () => ({
    x: x + (Math.random() - 0.5) * 30,
    y,
    vx: (Math.random() - 0.5) * 5,
    vy: -(Math.random() * 5 + 2),
    life: 35 + Math.random() * 20,
    maxLife: 55,
    color: `hsl(200, ${60 + Math.random() * 30}%, ${50 + Math.random() * 30}%)`,
    radius: 2 + Math.random() * 4,
    type: 'water' as const,
  }));
}

export function updateParticles(particles: Particle[]): Particle[] {
  return particles
    .map((p) => ({
      ...p,
      x: p.x + p.vx,
      y: p.y + p.vy,
      vy: p.vy + 0.15,
      life: p.life - 1,
    }))
    .filter((p) => p.life > 0);
}

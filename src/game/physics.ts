import { getTerrainY, getTerrainSlope, getSegmentAt, TerrainSegment } from './terrain';

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  inFlight: boolean;
  rolling: boolean;
  atRest: boolean;
  trail: Array<{ x: number; y: number; alpha: number }>;
  lastSafeX: number;
  lastSafeY: number;
  waterPenalty: boolean;
}

export interface PhysicsResult {
  ball: Ball;
  inHole: boolean;
  inWater: boolean;
  inSand: boolean;
  bounced: boolean;
}

const GRAVITY = 0.15;
const BOUNCE_DAMPEN = 0.42;
const ROLL_STOP_THRESHOLD = 0.08;
const MAX_TRAIL = 60;

export function createBall(x: number, y: number): Ball {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    inFlight: false,
    rolling: false,
    atRest: true,
    trail: [],
    lastSafeX: x,
    lastSafeY: y,
    waterPenalty: false,
  };
}

export function launchBall(
  ball: Ball,
  angleDeg: number,
  power: number,
  windX: number
): Ball {
  const angleRad = (angleDeg * Math.PI) / 180;
  const maxPower = 13;
  const speed = power * maxPower;
  return {
    ...ball,
    vx: Math.cos(-angleRad) * speed + windX * 0.1,
    vy: Math.sin(-angleRad) * speed,
    inFlight: true,
    rolling: false,
    atRest: false,
    trail: [],
    waterPenalty: false,
    lastSafeX: ball.x,
    lastSafeY: ball.y,
  };
}

export function stepPhysics(
  ball: Ball,
  terrain: number[],
  segments: TerrainSegment[],
  holeX: number,
  holeY: number,
  windX: number
): PhysicsResult {
  if (ball.atRest) {
    return { ball, inHole: false, inWater: false, inSand: false, bounced: false };
  }

  let { x, y, vx, vy } = ball;
  let inFlight = ball.inFlight;
  let rolling = ball.rolling;
  let bounced = false;
  let inHole = false;
  let inWater = false;
  let inSand = false;

  // Apply wind only in flight
  if (inFlight) {
    vx += windX * 0.003;
    vy += GRAVITY;
  } else if (rolling) {
    vy += GRAVITY * 0.5;
  }

  x += vx;
  y += vy;

  // Clamp x to terrain
  const clampedX = Math.max(0, Math.min(x, terrain.length - 1));
  const terrainY = getTerrainY(terrain, clampedX);
  const segment = getSegmentAt(segments, clampedX);

  // Check hole proximity
  const holeDist = Math.sqrt((x - holeX) ** 2 + (y - holeY) ** 2);
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (holeDist < 18 && speed < 12) {
    inHole = true;
    return {
      ball: { ...ball, x: holeX, y: holeY, vx: 0, vy: 0, atRest: true, inFlight: false, rolling: false },
      inHole: true,
      inWater: false,
      inSand: false,
      bounced: false,
    };
  }

  // Water hazard
  if (segment.type === 'water' && y >= terrainY - 5) {
    inWater = true;
    return {
      ball: {
        ...ball,
        x: ball.lastSafeX,
        y: ball.lastSafeY,
        vx: 0,
        vy: 0,
        atRest: true,
        inFlight: false,
        rolling: false,
        waterPenalty: true,
      },
      inHole: false,
      inWater: true,
      inSand: false,
      bounced: false,
    };
  }

  // Ground collision
  if (y >= terrainY) {
    y = terrainY;
    bounced = vy > 1;

    if (inFlight) {
      // Bounce
      const slope = getTerrainSlope(terrain, clampedX);
      const nx = -slope;
      const ny = 1;
      const len = Math.sqrt(nx * nx + ny * ny);
      const ndx = nx / len;
      const ndy = ny / len;
      const dot = vx * ndx + vy * ndy;
      const dampFactor = segment.type === 'sand' ? 0.2 : BOUNCE_DAMPEN;
      vx = (vx - 2 * dot * ndx) * dampFactor * segment.friction;
      vy = (vy - 2 * dot * ndy) * dampFactor * segment.friction;

      if (Math.abs(vy) < 1.5 && Math.abs(vx) < 3) {
        inFlight = false;
        rolling = true;
        vy = 0;
      }
    } else if (rolling) {
      vy = 0;
      const slope = getTerrainSlope(terrain, clampedX);
      vx += slope * 0.4; // roll with slope
      vx *= segment.friction * 0.96; // rolling friction

      if (segment.type === 'sand') {
        vx *= 0.8;
        inSand = true;
      }

      if (Math.abs(vx) < ROLL_STOP_THRESHOLD) {
        vx = 0;
        rolling = false;
        return {
          ball: {
            ...ball,
            x,
            y: terrainY,
            vx: 0,
            vy: 0,
            inFlight: false,
            rolling: false,
            atRest: true,
            trail: ball.trail,
            lastSafeX: x,
            lastSafeY: terrainY,
          },
          inHole: false,
          inWater: false,
          inSand,
          bounced: false,
        };
      }
    }
  }

  // Update trail
  const newTrail = [...ball.trail, { x, y, alpha: 0.8 }]
    .slice(-MAX_TRAIL)
    .map((p, i, arr) => ({ ...p, alpha: (i / arr.length) * 0.6 }));

  const lastSafeX = segment.type !== 'water' ? x : ball.lastSafeX;
  const lastSafeY = segment.type !== 'water' ? y : ball.lastSafeY;

  return {
    ball: {
      ...ball,
      x,
      y,
      vx,
      vy,
      inFlight,
      rolling,
      atRest: false,
      trail: newTrail,
      lastSafeX,
      lastSafeY,
    },
    inHole,
    inWater,
    inSand,
    bounced,
  };
}

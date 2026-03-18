import { getTerrainY, getTerrainSlope, getSegmentAt, TerrainSegment } from './terrain';
import { Club } from './clubs';

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
  launchAngle: number; // degrees, 0 = flat, 90 = straight up
  spin: number; // rad/s — positive = backspin, negative = topspin
}

export interface PhysicsResult {
  ball: Ball;
  inHole: boolean;
  inWater: boolean;
  inSand: boolean;
  bounced: boolean;
}

const GRAVITY = 0.18;
const BOUNCE_DAMPEN = 0.45;
const ROLL_STOP_THRESHOLD = 0.15;
const MAX_TRAIL = 60;
const DRAG_COEFFICIENT = 0.0005;   // quadratic air drag
const LIFT_COEFFICIENT = 0.0012;   // Magnus lift from backspin
const SPIN_DECAY_FLIGHT = 0.997;   // spin decays slowly in air
const SPIN_DECAY_ROLL = 0.92;      // spin decays fast on ground
const SUB_STEPS = 3;               // physics sub-steps per frame

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
    launchAngle: 0,
    spin: 0,
  };
}

export function launchBall(
  ball: Ball,
  angleDeg: number,
  power: number,
  windX: number,
  club?: Club
): Ball {
  const angleRad = (angleDeg * Math.PI) / 180;
  const maxPower = club ? club.maxPower : 14;
  const speed = power * maxPower;

  // Spin based on club spin factor — wedges impart heavy backspin, putter/driver very little
  const spinFactor = club ? club.spinFactor : 0.5;
  const angleFactor = (angleDeg - 10) / 80;
  const spinAmount = angleFactor * power * 8 * spinFactor;

  return {
    ...ball,
    vx: Math.cos(-angleRad) * speed + windX * 0.1,
    vy: Math.sin(-angleRad) * speed,
    inFlight: club?.name === 'Putter' ? false : true,
    rolling: club?.name === 'Putter' ? true : false,
    atRest: false,
    trail: [],
    waterPenalty: false,
    lastSafeX: ball.x,
    lastSafeY: ball.y,
    launchAngle: angleDeg,
    spin: spinAmount,
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

  let { x, y, vx, vy, spin } = ball;
  let inFlight = ball.inFlight;
  let rolling = ball.rolling;
  let bounced = false;
  let inHole = false;
  let inWater = false;
  let inSand = false;

  const dt = 1 / SUB_STEPS;

  for (let step = 0; step < SUB_STEPS; step++) {
    if (inFlight) {
      // --- Air physics ---
      const speed = Math.sqrt(vx * vx + vy * vy);

      // Quadratic air drag: F_drag = -c * v * |v|
      if (speed > 0.01) {
        const dragX = -DRAG_COEFFICIENT * vx * speed;
        const dragY = -DRAG_COEFFICIENT * vy * speed;
        vx += dragX * dt;
        vy += dragY * dt;
      }

      // Magnus lift from backspin (perpendicular to velocity, upward for backspin)
      // Backspin (spin > 0) creates upward lift, topspin creates downward force
      if (speed > 0.5 && Math.abs(spin) > 0.1) {
        // Lift perpendicular to velocity direction — cross product in 2D
        // Velocity unit vector: (vx/speed, vy/speed)
        // Perpendicular (leftward/upward for backspin): (-vy/speed, vx/speed)
        const liftMag = LIFT_COEFFICIENT * spin * speed;
        vx += (-vy / speed) * liftMag * dt;
        vy += (vx / speed) * liftMag * dt;
      }

      // Gravity
      vy += GRAVITY * dt;

      // Wind pushes horizontally
      vx += windX * 0.003 * dt;

      // Spin decays in air
      spin *= Math.pow(SPIN_DECAY_FLIGHT, dt);

    } else if (rolling) {
      // --- Ground rolling physics ---
      vy += GRAVITY * 0.5 * dt;
    }

    // Integrate position
    x += vx * dt;
    y += vy * dt;

    // Clamp x to terrain bounds
    x = Math.max(0, Math.min(x, terrain.length - 1));
    const terrainY = getTerrainY(terrain, x);
    const segment = getSegmentAt(segments, x);

    // Check hole proximity — ball must be slow enough to drop in
    const holeDist = Math.sqrt((x - holeX) ** 2 + (y - holeY) ** 2);
    const curSpeed = Math.sqrt(vx * vx + vy * vy);
    if (holeDist < 18 && curSpeed < 10) {
      return {
        ball: { ...ball, x: holeX, y: holeY, vx: 0, vy: 0, atRest: true, inFlight: false, rolling: false, spin: 0 },
        inHole: true,
        inWater: false,
        inSand: false,
        bounced: false,
      };
    }

    // Water hazard
    if (segment.type === 'water' && y >= terrainY - 5) {
      return {
        ball: {
          ...ball,
          x: ball.lastSafeX,
          y: ball.lastSafeY,
          vx: 0, vy: 0,
          atRest: true, inFlight: false, rolling: false,
          waterPenalty: true, spin: 0,
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

      if (inFlight) {
        bounced = vy > 1;

        // Surface normal from terrain slope
        const slope = getTerrainSlope(terrain, x);
        const nx = -slope;
        const ny = 1;
        const len = Math.sqrt(nx * nx + ny * ny);
        const ndx = nx / len;
        const ndy = ny / len;

        // Reflect velocity about surface normal
        const dot = vx * ndx + vy * ndy;

        // Coefficient of restitution depends on surface and impact angle
        // Steep impact (velocity aligned with normal) = more energy lost
        const impactSpeed = Math.sqrt(vx * vx + vy * vy);
        const normalComponent = Math.abs(dot) / (impactSpeed + 0.001);
        // normalComponent near 1 = head-on impact, near 0 = glancing
        const baseCOR = segment.type === 'sand' ? 0.18 : BOUNCE_DAMPEN;
        // Glancing impacts keep more energy, head-on impacts lose more
        const cor = baseCOR * (1 - normalComponent * 0.3);

        vx = (vx - 2 * dot * ndx) * cor;
        vy = (vy - 2 * dot * ndy) * cor;

        // Backspin effect on bounce: reduces forward velocity on landing
        if (spin > 0.5) {
          const spinBrake = Math.min(0.5, spin * 0.06);
          vx -= Math.sign(vx) * Math.abs(vx) * spinBrake;
          // Backspin also adds a bit of upward kick (ball checks up)
          vy -= spin * 0.03;
        }
        // Topspin effect: ball shoots forward and stays low
        if (spin < -0.5) {
          const spinBoost = Math.min(0.3, Math.abs(spin) * 0.04);
          vx += Math.sign(vx) * Math.abs(vx) * spinBoost;
        }

        // Bounce transfers some energy to spin change
        spin *= 0.6; // big spin loss on bounce

        // Sand kills bounce significantly
        if (segment.type === 'sand') {
          vx *= 0.5;
          vy *= 0.3;
          inSand = true;
        }

        // Transition to rolling when bounce energy is low
        if (Math.abs(vy) < 1.5 && Math.abs(vx) < 5) {
          inFlight = false;
          rolling = true;
          vy = 0;
        }
      } else if (rolling) {
        vy = 0;
        const slope = getTerrainSlope(terrain, x);

        // Slope acceleration — reduced multiplier so hills don't launch the ball
        const slopeForce = Math.max(-0.12, Math.min(0.12, slope * 0.25));
        vx += slopeForce * dt;

        // Rolling uphill costs extra energy (convert kinetic to potential)
        // If ball moves right (vx > 0) and slope is negative (uphill right), or vice versa
        const goingUphill = (vx > 0 && slope < -0.01) || (vx < 0 && slope > 0.01);
        if (goingUphill) {
          const uphillDrag = 1 - Math.min(0.15, Math.abs(slope) * 0.4);
          vx *= Math.pow(uphillDrag, dt);
        }

        // Surface friction — lower values = more friction = ball stops faster
        const baseFriction = segment.type === 'green' ? 0.89
          : segment.type === 'fringe' ? 0.86
          : segment.type === 'fairway' ? 0.83
          : segment.type === 'rough' ? 0.72
          : segment.type === 'sand' ? 0.50
          : 0.80;

        // Remaining backspin adds extra braking during roll
        if (spin > 0.3) {
          const spinBrake = 1 - Math.min(0.08, spin * 0.01);
          vx *= spinBrake;
        }

        vx *= Math.pow(baseFriction, dt);

        // Spin decays fast on ground
        spin *= Math.pow(SPIN_DECAY_ROLL, dt);

        if (segment.type === 'sand') {
          inSand = true;
        }

        // More generous stop threshold on slopes — ball settles on mild hills
        if (Math.abs(vx) < ROLL_STOP_THRESHOLD && Math.abs(slopeForce) < 0.04) {
          return {
            ball: {
              ...ball,
              x, y: terrainY,
              vx: 0, vy: 0,
              inFlight: false, rolling: false, atRest: true,
              trail: ball.trail,
              lastSafeX: x, lastSafeY: terrainY,
              spin: 0,
            },
            inHole: false,
            inWater: false,
            inSand,
            bounced: false,
          };
        }
      }
    }
  }

  // Update trail
  const newTrail = [...ball.trail, { x, y, alpha: 0.8 }]
    .slice(-MAX_TRAIL)
    .map((p, i, arr) => ({ ...p, alpha: (i / arr.length) * 0.6 }));

  const segment = getSegmentAt(segments, x);
  const lastSafeX = segment.type !== 'water' ? x : ball.lastSafeX;
  const lastSafeY = segment.type !== 'water' ? y : ball.lastSafeY;

  return {
    ball: {
      ...ball,
      x, y, vx, vy, spin,
      inFlight, rolling,
      atRest: false,
      trail: newTrail,
      lastSafeX, lastSafeY,
    },
    inHole: false,
    inWater: inWater,
    inSand,
    bounced,
  };
}

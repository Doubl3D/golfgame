import { getTerrainY, getTerrainSlope, getSegmentAt, TerrainSegment } from './terrain';
import { Club, CLUBS } from './clubs';

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
const LIFT_COEFFICIENT = 0.0004;   // Magnus lift from backspin (subtle in air)
const SPIN_DECAY_FLIGHT = 0.997;   // spin decays slowly in air
const SPIN_DECAY_ROLL = 0.95;      // spin decays on ground but persists enough to grip
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
  club?: Club,
  inSand?: boolean
): Ball {
  const angleRad = (angleDeg * Math.PI) / 180;
  const maxPower = club ? club.maxPower : 14;
  const speed = power * maxPower;

  // Spin is driven by club type and launch angle
  // No spin out of sand — the sand kills all spin
  // Positive = backspin (stops/reverses), negative = topspin (forward roll)
  let spinAmount = 0;
  if (!inSand && club) {
    // Normalize angle: 0 = lowest possible, 1 = highest possible
    // Typical range is ~3° (putter) to ~80° (max lofted wedge aim)
    const t = Math.max(0, Math.min(1, (angleDeg - 5) / 70)); // 0=low, 1=high

    const clubIdx = CLUBS.indexOf(club);

    if (clubIdx <= 2) {
      // Woods: never backspin, more topspin at low angles
      // t=0 → strong topspin (-8), t=1 → mild topspin (-1)
      spinAmount = -(1 + (1 - t) * 7);
    } else if (clubIdx <= 5) {
      // 3i-5i: no backspin, some topspin at low angles
      // t=0 → moderate topspin (-5), t=1 → zero
      spinAmount = -(1 - t) * 5;
    } else if (clubIdx <= 9) {
      // 6i-9i: backspin at high angles, none mid, slight topspin low
      // t=0 → mild topspin (-2), t=0.5 → 0, t=1 → backspin (+4)
      spinAmount = (t - 0.4) * 7;
    } else if (clubIdx <= 11) {
      // PW, SW: massive backspin at high angles, some mid, none low
      // t=0 → 0, t=0.5 → moderate backspin (+6), t=1 → heavy backspin (+20)
      spinAmount = t * t * 20;
    }
    // Putter (idx 12): no spin (spinAmount stays 0)

    spinAmount *= power; // scale by power
  }

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
    // Putts (launchAngle ≤ 5) sink more easily; other clubs need to be crawling
    const holeDist = Math.sqrt((x - holeX) ** 2 + (y - holeY) ** 2);
    const curSpeed = Math.sqrt(vx * vx + vy * vy);
    const isPuttShot = ball.launchAngle <= 5;
    const sinkSpeed = inFlight ? (isPuttShot ? 10 : 2) : (isPuttShot ? 4 : 1);
    if (holeDist < 18 && curSpeed < sinkSpeed) {
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
        const baseCOR = segment.type === 'sand' ? 0.25 : BOUNCE_DAMPEN;
        // Glancing impacts keep more energy, head-on impacts lose more
        const cor = baseCOR * (1 - normalComponent * 0.3);

        vx = (vx - 2 * dot * ndx) * cor;
        vy = (vy - 2 * dot * ndy) * cor;

        // Backspin effect on bounce: reduces forward velocity on landing
        // Ball always launches rightward (positive vx), so origDir is always 1
        const origDir = 1;
        if (spin > 0.5) {
          // Only brake if still moving in original direction
          if (vx > 0.1) {
            const spinBrake = Math.min(0.90, spin * 0.18);
            vx -= Math.abs(vx) * spinBrake;
            // High spin reverses the ball on bounce
            if (spin > 2.0) {
              const reversePower = (spin - 2.0) * 0.25;
              vx -= reversePower;
            }
          }
          // First reversal: reduce spin once
          if (vx < 0 && ball.vx >= 0) {
            spin *= 0.6;
          }
          // Backspin checks the ball up on landing
          vy -= spin * 0.06;
        }
        // Topspin flattens the bounce — ball stays low, no forward burst
        if (spin < -0.5) {
          vy *= 0.6;
        }

        // Bounce retains nearly all spin so it carries into the roll phase
        spin *= 0.95;

        // Sand kills bounce significantly
        if (segment.type === 'sand') {
          vx *= 0.65;
          vy *= 0.45;
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
        // Putted balls (launchAngle ≤ 5) roll much more freely on green/fringe
        const isPutt = ball.launchAngle <= 5;
        const baseFriction = segment.type === 'green' ? (isPutt ? 0.985 : 0.92)
          : segment.type === 'fringe' ? (isPutt ? 0.94 : 0.88)
          : segment.type === 'fairway' ? 0.90
          : segment.type === 'rough' ? 0.55
          : segment.type === 'sand' ? 0.50
          : 0.80;

        // Remaining backspin during roll — origDir is always rightward
        if (spin > 0.3) {
          if (vx > 0.1) {
            // Still moving forward — brake and try to reverse
            const spinBrake = 1 - Math.min(0.50, spin * 0.12);
            vx *= spinBrake;
            if (spin > 0.8) {
              vx -= spin * 0.12;
            }
          } else {
            // Already reversed — spin drives ball backward
            vx -= spin * 0.04;
            spin *= 0.97;
          }
        }
        // Topspin during roll: reduces friction rather than adding force
        // This makes the ball roll further without a sudden burst
        if (spin < -0.5) {
          const frictionReduction = Math.min(0.08, Math.abs(spin) * 0.012);
          vx *= (1 + frictionReduction);
        }

        vx *= Math.pow(baseFriction, dt);

        // Spin decays fast on ground
        spin *= Math.pow(SPIN_DECAY_ROLL, dt);

        if (segment.type === 'sand') {
          inSand = true;
        }

        // Don't stop if backspin still wants to move the ball
        // Spin actively pushes the ball backward when nearly stopped
        if (Math.abs(vx) < ROLL_STOP_THRESHOLD && spin > 1.0) {
          vx = -spin * 0.08;
        }

        // More generous stop threshold on slopes — ball settles on mild hills
        if (Math.abs(vx) < ROLL_STOP_THRESHOLD && Math.abs(slopeForce) < 0.04 && Math.abs(spin) < 1.0) {
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
  // Use terrain ground level (not ball's airborne y) so water recovery places ball on ground
  const lastSafeX = segment.type !== 'water' ? x : ball.lastSafeX;
  const lastSafeY = segment.type !== 'water' ? getTerrainY(terrain, x) : ball.lastSafeY;

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

import { HoleData, getSegmentAt } from './terrain';
import { Ball } from './physics';
import { GameState, Particle } from './gameState';
import { Club, CLUBS } from './clubs';

/** UI scale factor — 1.0 at 800px height, scales down for small screens, up for large */
export function uiScale(canvasHeight: number): number {
  return Math.max(0.55, Math.min(1.2, canvasHeight / 800));
}

export interface Camera {
  x: number; // world x at left edge of screen
  y: number;
}

export function updateCamera(
  camera: Camera,
  ball: Ball,
  canvasWidth: number,
  canvasHeight: number,
  terrainWidth: number
): Camera {
  const targetX = ball.x - canvasWidth * 0.4;
  const clampedX = Math.max(0, Math.min(targetX, terrainWidth - canvasWidth));
  return {
    x: camera.x + (clampedX - camera.x) * 0.1,
    y: camera.y,
  };
}

export function worldToScreen(
  wx: number,
  wy: number,
  camera: Camera,
  canvasHeight: number
): { sx: number; sy: number } {
  return {
    sx: wx - camera.x,
    sy: wy,
  };
}

export function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, cameraX: number = 0) {
  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.75);
  grad.addColorStop(0, '#4a90c8');
  grad.addColorStop(0.5, '#87ceeb');
  grad.addColorStop(1, '#c8e8f5');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // === PARALLAX BACKGROUND LAYER 1: distant misty mountains ===
  const mx = cameraX * 0.05;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#7ea8c8';
  ctx.beginPath();
  const mPeaks = [
    { x: -300, y: h * 0.72 },
    { x: -100, y: h * 0.52 },
    { x:  150, y: h * 0.61 },
    { x:  380, y: h * 0.44 },
    { x:  560, y: h * 0.57 },
    { x:  750, y: h * 0.40 },
    { x:  950, y: h * 0.58 },
    { x: 1100, y: h * 0.48 },
    { x: 1300, y: h * 0.63 },
    { x: 1500, y: h * 0.46 },
    { x: 1700, y: h * 0.66 },
    { x: 1900, y: h * 0.72 },
  ];
  ctx.moveTo(-mx + mPeaks[0].x, h);
  for (const p of mPeaks) {
    ctx.lineTo(p.x - mx, p.y);
  }
  ctx.lineTo(mPeaks[mPeaks.length - 1].x - mx, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // === PARALLAX BACKGROUND LAYER 2: mid-ground tree line ===
  const tx2 = cameraX * 0.10;
  ctx.save();
  ctx.globalAlpha = 0.70;
  ctx.fillStyle = '#2e6b2e';
  const treeBaseY = h * 0.85;
  const treeSpacing = 55;
  // Calculate which world-space tree slots are visible
  const firstSlot = Math.floor((tx2 - treeSpacing * 3) / treeSpacing);
  const lastSlot = Math.ceil((tx2 + w + treeSpacing * 3) / treeSpacing);
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    // Use slot (world position) for stable pseudo-random offset
    const hash = ((slot * 2654435761) >>> 0);
    const jitter = ((hash % 13) - 6) * 5;
    const worldX = slot * treeSpacing + jitter;
    const screenX = worldX - tx2;
    if (screenX < -80 || screenX > w + 80) continue;
    const treeH = 60 + ((hash >> 8) % 5) * 14;
    const treeW = treeH * 0.55;
    // Three stacked triangles for a pine silhouette
    for (let tier = 0; tier < 3; tier++) {
      const tierTop = treeBaseY - treeH + tier * treeH * 0.32;
      const tierW   = treeW * (1 - tier * 0.22);
      ctx.beginPath();
      ctx.moveTo(screenX, tierTop);
      ctx.lineTo(screenX + tierW / 2, treeBaseY - treeH * 0.28 + tier * treeH * 0.32);
      ctx.lineTo(screenX - tierW / 2, treeBaseY - treeH * 0.28 + tier * treeH * 0.32);
      ctx.closePath();
      ctx.fill();
    }
    // Trunk
    ctx.fillStyle = '#3d2b1a';
    ctx.fillRect(screenX - 3, treeBaseY - treeH * 0.20, 6, treeH * 0.20);
    ctx.fillStyle = '#2e6b2e';
  }
  ctx.restore();

  // === PARALLAX BACKGROUND LAYER 3: near rolling hills ===
  const hx = cameraX * 0.18;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#3d8c3d';
  ctx.beginPath();
  const hillW = 260;
  const hillCount = Math.ceil(w / hillW) + 4;
  const hillOffset = ((-hx) % hillW + hillW) % hillW;
  ctx.moveTo(hillOffset - hillW * 2, h);
  for (let i = -2; i < hillCount; i++) {
    const hcx = hillOffset + i * hillW - hillW * 2;
    const hcy = h * 0.88 - Math.sin(i * 1.1 + 0.7) * h * 0.08 - Math.sin(i * 2.3) * h * 0.03;
    ctx.quadraticCurveTo(hcx,            h * 0.92, hcx + hillW / 2, hcy);
    ctx.quadraticCurveTo(hcx + hillW,    h * 0.92, hcx + hillW * 1.5, hcy + h * 0.03);
  }
  ctx.lineTo(w + 200, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // === CLOUDS — per-cloud parallax based on y-distance from camera ===
  // Higher clouds (smaller y) move slower; lower clouds (larger y) move faster
  const allClouds = [
    // Far layer — small, high, faint
    { ox: 60,  y: h * 0.12, r: 18, alpha: 0.55 },
    { ox: 240, y: h * 0.09, r: 22, alpha: 0.55 },
    { ox: 450, y: h * 0.14, r: 16, alpha: 0.55 },
    { ox: 650, y: h * 0.11, r: 20, alpha: 0.55 },
    { ox: 850, y: h * 0.08, r: 18, alpha: 0.55 },
    { ox: 1100,y: h * 0.13, r: 24, alpha: 0.55 },
    { ox: 1350,y: h * 0.10, r: 19, alpha: 0.55 },
    { ox: 1600,y: h * 0.07, r: 21, alpha: 0.55 },
    // Mid layer — medium size
    { ox: 120, y: h * 0.20, r: 30, alpha: 0.80 },
    { ox: 330, y: h * 0.17, r: 38, alpha: 0.80 },
    { ox: 570, y: h * 0.22, r: 28, alpha: 0.80 },
    { ox: 790, y: h * 0.16, r: 42, alpha: 0.80 },
    { ox: 980, y: h * 0.21, r: 34, alpha: 0.80 },
    { ox: 1250,y: h * 0.18, r: 36, alpha: 0.80 },
    { ox: 1500,y: h * 0.15, r: 32, alpha: 0.80 },
    // Near layer — big, vivid
    { ox: 80,  y: h * 0.28, r: 48, alpha: 0.92 },
    { ox: 400, y: h * 0.25, r: 55, alpha: 0.92 },
    { ox: 720, y: h * 0.30, r: 44, alpha: 0.92 },
    { ox: 1050,y: h * 0.27, r: 52, alpha: 0.92 },
    { ox: 1380,y: h * 0.29, r: 46, alpha: 0.92 },
  ];

  for (const c of allClouds) {
    // Parallax rate: 0.06 at very top (y≈0) up to 0.42 at y≈h*0.35
    const depthRatio = c.y / (h * 0.35);
    const parallaxRate = 0.06 + depthRatio * 0.36;
    const shift = cameraX * parallaxRate;
    const sx = ((c.ox - shift % (w + 400) + (w + 400) * 4) % (w + 400)) - 100;
    drawCloud(ctx, sx, c.y, c.r, `rgba(255,255,255,${c.alpha})`);
  }

}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number, color: string
) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.9, y + 3, r * 0.75, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x - r * 0.75, y + 4, r * 0.65, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.3, y - r * 0.4, r * 0.6, 0, Math.PI * 2); ctx.fill();
}


export function drawForeground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cameraX: number,
  terrain: number[],
  segments: import('./terrain').TerrainSegment[]
) {
  // === GRASS TUFTS: decorative clumps anchored to terrain surface ===
  ctx.save();
  ctx.globalAlpha = 0.8;

  const startX = Math.max(0, Math.floor(cameraX));
  const endX = Math.min(terrain.length - 1, Math.floor(cameraX + w));
  const tuftSpacing = 24;

  // Use a seeded pattern so tufts are stable as camera scrolls
  for (let wx = startX - (startX % tuftSpacing); wx < endX + tuftSpacing; wx += tuftSpacing) {
    if (wx < 0 || wx >= terrain.length) continue;

    // Pseudo-random offset per tuft so they don't look gridded
    const hash = ((wx * 2654435761) >>> 0) % 1000;
    const offsetX = (hash % 16) - 8;
    const worldX = wx + offsetX;
    if (worldX < 0 || worldX >= terrain.length) continue;

    // Check segment — only draw on grass surfaces
    const seg = segments.find(s => worldX >= s.startX && worldX < s.endX);
    if (!seg || seg.type === 'water' || seg.type === 'sand') continue;

    const screenX = worldX - cameraX;
    const surfaceY = terrain[Math.floor(worldX)];

    // Short stubby grass — thicker strokes, less height
    const baseHeight = seg.type === 'rough' ? 7 : seg.type === 'fairway' ? 5 : seg.type === 'fringe' ? 4 : 3;
    const tint = seg.type === 'rough' ? '#1a5c1a' : '#1a4d1a';

    ctx.strokeStyle = tint;
    ctx.lineWidth = 2;

    // Dense cluster of short blades
    const bladeCount = seg.type === 'rough' ? 4 : 3;
    for (let b = -bladeCount; b <= bladeCount; b++) {
      const bx = screenX + b * 3;
      const blen = baseHeight + (hash % 3);
      const curve = b * 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, surfaceY);
      ctx.lineTo(bx + curve * 0.5, surfaceY - blen);
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  holeData: HoleData,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number
) {
  const { terrain, segments } = holeData;
  const startX = Math.floor(camera.x);
  const endX = Math.ceil(camera.x + canvasWidth);

  // -- Undercoat: solid dark-earth base for the full visible terrain strip.
  // This fills any 1-px cracks that could appear between adjacent segments.
  ctx.beginPath();
  ctx.moveTo(0, canvasHeight);
  for (let x = startX; x <= endX; x++) {
    const y = terrain[Math.min(x, terrain.length - 1)] ?? canvasHeight;
    ctx.lineTo(x - camera.x, y);
  }
  ctx.lineTo(endX - camera.x, canvasHeight);
  ctx.closePath();
  ctx.fillStyle = '#3d2b1a';
  ctx.fill();

  // Draw terrain by segment type — all boundaries are integers, so segments tile flush
  for (const seg of segments) {
    const sx = Math.max(startX, Math.floor(seg.startX));
    const ex = Math.min(endX, Math.ceil(seg.endX));
    if (sx >= ex) continue;

    ctx.beginPath();
    ctx.moveTo(sx - camera.x, canvasHeight);

    for (let x = sx; x <= ex; x++) {
      const y = terrain[Math.min(x, terrain.length - 1)] ?? canvasHeight;
      ctx.lineTo(x - camera.x, y);
    }

    ctx.lineTo(ex - camera.x, canvasHeight);
    ctx.closePath();

    if (seg.type === 'water') {
      // Blue water with depth gradient
      const waterGrad = ctx.createLinearGradient(0, 180, 0, canvasHeight);
      waterGrad.addColorStop(0, '#1a6fa0');   // bright blue surface
      waterGrad.addColorStop(0.2, '#145a85');
      waterGrad.addColorStop(0.5, '#0d3d5c');  // deeper blue
      waterGrad.addColorStop(1, '#061e2e');
      ctx.fillStyle = waterGrad;
      ctx.fill();

      // Animated wave highlights on the surface
      const time = Date.now() * 0.002;
      ctx.strokeStyle = 'rgba(120,200,255,0.4)';
      ctx.lineWidth = 1.5;
      for (let wx = sx; wx < ex; wx += 14) {
        const wy = terrain[Math.min(wx, terrain.length - 1)] ?? 0;
        const wave = Math.sin(time + wx * 0.05) * 2;
        ctx.beginPath();
        ctx.moveTo(wx - camera.x, wy + wave + 2);
        ctx.quadraticCurveTo(wx + 7 - camera.x, wy + wave - 1, wx + 14 - camera.x, wy + wave + 2);
        ctx.stroke();
      }

      // Second wave layer, offset
      ctx.strokeStyle = 'rgba(180,230,255,0.25)';
      for (let wx = sx + 7; wx < ex; wx += 20) {
        const wy = terrain[Math.min(wx, terrain.length - 1)] ?? 0;
        const wave = Math.sin(time * 0.8 + wx * 0.03 + 2) * 1.5;
        ctx.beginPath();
        ctx.moveTo(wx - camera.x, wy + wave + 5);
        ctx.quadraticCurveTo(wx + 10 - camera.x, wy + wave + 3, wx + 20 - camera.x, wy + wave + 5);
        ctx.stroke();
      }

      // Subtle shimmer dots
      ctx.fillStyle = 'rgba(150,220,255,0.2)';
      for (let wx = sx + 10; wx < ex - 10; wx += 35) {
        const wy = terrain[Math.min(wx, terrain.length - 1)] ?? 0;
        const shimX = wx + Math.sin(wx * 0.1 + time * 1.2) * 6;
        const shimY = wy + 8 + Math.sin(wx * 0.15 + time) * 4;
        ctx.beginPath();
        ctx.arc(shimX - camera.x, shimY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Gradient starts slightly above the terrain surface so the segment colour
      // is vivid right at the top edge of the polygon, not washed out.
      const grad = ctx.createLinearGradient(0, 350, 0, canvasHeight);
      grad.addColorStop(0, seg.color);
      grad.addColorStop(0.25, adjustColor(seg.color, -15));
      grad.addColorStop(0.65, adjustColor(seg.color, -40));
      grad.addColorStop(1, '#3d2b1a');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Grass blades on non-water terrain
    if (seg.type !== 'water' && seg.type !== 'sand') {
      const grassHeight = seg.type === 'rough' ? 8 : seg.type === 'green' ? 2 : 4;
      ctx.strokeStyle = adjustColor(seg.color, 20);
      ctx.lineWidth = 1;
      for (let gx = sx; gx < ex; gx += 4) {
        const gy = terrain[Math.min(gx, terrain.length - 1)] ?? 0;
        ctx.beginPath();
        ctx.moveTo(gx - camera.x, gy);
        ctx.lineTo(gx + 1 - camera.x, gy - grassHeight);
        ctx.stroke();
      }
    }
  }
}

function adjustColor(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex;
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + amount));
  return `rgb(${r},${g},${b})`;
}

export function drawHoleFlag(
  ctx: CanvasRenderingContext2D,
  holeX: number,
  holeY: number,
  camera: Camera,
  time: number
) {
  const sx = holeX - camera.x;
  const sy = holeY;

  // Hole cup
  ctx.beginPath();
  ctx.ellipse(sx, sy + 3, 10, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();

  // Flag pole
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, sy - 60);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Animated flag
  const wave = Math.sin(time * 0.05) * 5;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 60);
  ctx.quadraticCurveTo(sx + 15 + wave, sy - 52, sx + 28, sy - 45 + wave * 0.5);
  ctx.lineTo(sx + 15 + wave * 0.5, sy - 38);
  ctx.quadraticCurveTo(sx + 10, sy - 44 + wave, sx, sy - 48);
  ctx.fillStyle = '#ef4444';
  ctx.fill();
}

export function drawTeeMarker(
  ctx: CanvasRenderingContext2D,
  teeX: number,
  teeY: number,
  camera: Camera,
  holeNumber?: number,
  par?: number,
  showTee?: boolean,
  distance?: number
) {
  const sx = teeX - camera.x;

  // Golf tee peg
  if (showTee) {
    ctx.fillStyle = '#d4a050';
    // Tee stem
    ctx.fillRect(sx - 1.5, teeY - 10, 3, 10);
    // Tee cup
    ctx.beginPath();
    ctx.moveTo(sx - 5, teeY - 10);
    ctx.lineTo(sx - 2, teeY - 7);
    ctx.lineTo(sx + 2, teeY - 7);
    ctx.lineTo(sx + 5, teeY - 10);
    ctx.closePath();
    ctx.fill();
  }

  // Draw hole sign to the left of the tee
  if (holeNumber !== undefined && par !== undefined) {
    const signX = sx - 40;
    const postH = 45;
    const signW = 42;
    const signH = 38;

    // Wooden post
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(signX - 2, teeY - postH, 4, postH);

    // Sign board
    ctx.fillStyle = '#f5f0e0';
    ctx.beginPath();
    ctx.roundRect(signX - signW / 2, teeY - postH - signH + 2, signW, signH, 3);
    ctx.fill();
    ctx.strokeStyle = '#5a4a2a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Hole number
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${holeNumber}`, signX, teeY - postH - 22);

    // Par
    ctx.font = '9px monospace';
    ctx.fillStyle = '#666';
    ctx.fillText(`Par ${par}`, signX, teeY - postH - 12);

    // Yardage
    if (distance !== undefined) {
      ctx.fillText(`${distance} yds`, signX, teeY - postH - 2);
    }
  }
}

export function drawPracticeYardageMarkers(
  ctx: CanvasRenderingContext2D,
  holeData: HoleData,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number
) {
  const { terrain, teeX } = holeData;
  const pixelsPerYard = 6.5;
  const s = uiScale(canvasHeight);

  // Draw markers at 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, etc.
  for (let yds = 25; yds <= 500; yds += 25) {
    const markerX = teeX + yds * pixelsPerYard;
    if (markerX >= terrain.length) break;

    const screenX = markerX - camera.x;
    if (screenX < -20 || screenX > canvasWidth + 20) continue;

    const terrainY = terrain[Math.min(Math.floor(markerX), terrain.length - 1)] ?? canvasHeight;

    // Vertical marker line
    const isMajor = yds % 50 === 0;
    const lineH = isMajor ? 12 : 6;
    ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(screenX, terrainY - lineH);
    ctx.lineTo(screenX, terrainY);
    ctx.stroke();

    // Yardage text for major markers (every 50 yds)
    if (isMajor) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `bold ${Math.round(10 * s)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${yds}`, screenX, terrainY - lineH - 4);
    }
  }
}

export function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: Ball,
  camera: Camera,
  playerColor: string
) {
  const sx = ball.x - camera.x;
  const sy = ball.y;

  // Trail
  for (let i = 0; i < ball.trail.length; i++) {
    const t = ball.trail[i];
    ctx.beginPath();
    ctx.arc(t.x - camera.x, t.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${t.alpha * 0.5})`;
    ctx.fill();
  }

  // Shadow
  ctx.beginPath();
  ctx.ellipse(sx, sy + 4, 7, 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();

  // Ball
  const ballGrad = ctx.createRadialGradient(sx - 2, sy - 2, 1, sx, sy, 7);
  ballGrad.addColorStop(0, '#ffffff');
  ballGrad.addColorStop(0.6, playerColor);
  ballGrad.addColorStop(1, adjustColor(playerColor, -40));
  ctx.beginPath();
  ctx.arc(sx, sy, 7, 0, Math.PI * 2);
  ctx.fillStyle = ballGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawBallMarker(
  ctx: CanvasRenderingContext2D,
  ball: Ball,
  camera: Camera,
  playerColor: string,
  playerName: string
) {
  const sx = ball.x - camera.x;
  const sy = ball.y;

  // Small colored diamond marker
  ctx.save();
  ctx.globalAlpha = 0.75;

  // Diamond shape
  const size = 5;
  ctx.beginPath();
  ctx.moveTo(sx, sy - size);
  ctx.lineTo(sx + size, sy);
  ctx.lineTo(sx, sy + size);
  ctx.lineTo(sx - size, sy);
  ctx.closePath();
  ctx.fillStyle = playerColor;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Player name label above marker
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = playerColor;
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(playerName, sx, sy - size - 4);

  ctx.restore();
}

export function drawAimArrow(
  ctx: CanvasRenderingContext2D,
  ball: Ball,
  aimAngle: number,
  camera: Camera
) {
  const sx = ball.x - camera.x;
  const sy = ball.y;
  const angleRad = (aimAngle * Math.PI) / 180;
  const len = 60;

  const ex = sx + Math.cos(-angleRad) * len;
  const ey = sy + Math.sin(-angleRad) * len;

  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(255,255,0,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead
  const arrowAngle = Math.atan2(ey - sy, ex - sx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - 10 * Math.cos(arrowAngle - 0.4), ey - 10 * Math.sin(arrowAngle - 0.4));
  ctx.lineTo(ex - 10 * Math.cos(arrowAngle + 0.4), ey - 10 * Math.sin(arrowAngle + 0.4));
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,0,0.9)';
  ctx.fill();
  ctx.restore();
}

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  camera: Camera
) {
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.beginPath();
    ctx.arc(p.x - camera.x, p.y, p.radius * alpha, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

export function drawHUD(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight?: number
) {
  const player = state.players[state.currentPlayerIdx];
  if (!player || !state.holeData) return;

  // HUD is now just the wind indicator, positioned next to the club carousel
  // (info box removed — hole/par/strokes/distance shown elsewhere)
}

export function drawWindIndicator(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight: number
) {
  if (!state.holeData) return;

  const s = uiScale(canvasHeight);
  const m = Math.round;

  // Position: right of club carousel
  const clubSize = m(56 * s);
  const x = m(12 * s) + clubSize + m(8 * s);
  const y = canvasHeight - m(120 * s);
  const size = clubSize; // square, same height as club selector

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(ctx, x, y, size, size, m(8*s));
  ctx.fill();
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = m(2*s);
  roundRect(ctx, x, y, size, size, m(8*s));
  ctx.stroke();

  // "WIND" label
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${m(12*s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('WIND', x + size/2, y + m(14*s));

  // Determine arrow count: 1 = light, 2 = strong, 3 = crazy
  const speed = state.wind.speed;
  const numArrows = speed >= 6 ? 3 : speed >= 3 ? 2 : 1;
  const arrowDir = state.wind.direction;
  const centerX = x + size / 2;
  const centerY = y + size / 2 + m(2*s);
  const arrowW = m(10 * s);  // width of each chevron (back to tip)
  const arrowH = m(8 * s);   // half-height of chevron
  const step = m(8 * s);     // spacing between arrow origins

  // Total span from first arrow back to last arrow tip
  const totalSpan = (numArrows - 1) * step + arrowW;
  // Offset so the group is centered in the box
  const groupStart = centerX - (totalSpan / 2) * arrowDir;

  for (let i = 0; i < numArrows; i++) {
    const ax = groupStart + i * step * arrowDir;
    ctx.beginPath();
    ctx.moveTo(ax + arrowW * arrowDir, centerY);                 // tip
    ctx.lineTo(ax - arrowW * 0.3 * arrowDir, centerY - arrowH); // top back
    ctx.lineTo(ax, centerY);                                      // notch
    ctx.lineTo(ax - arrowW * 0.3 * arrowDir, centerY + arrowH); // bottom back
    ctx.closePath();
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = m(1.5*s);
    ctx.stroke();
  }

  // Speed label (just the number)
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${m(10*s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(`${speed.toFixed(1)} mph`, x + size/2, y + size - m(4*s));
}

// Layout constants for club carousel (shared with hit-testing)
export function getClubCarouselLayout(canvasHeight: number) {
  const s = uiScale(canvasHeight);
  const m = Math.round;
  const size = m(56 * s);
  const x = m(12 * s);
  const y = canvasHeight - m(120 * s);
  const btnSize = m(24 * s);
  const btnGap = m(6 * s);
  const dnExtraOffset = m(14 * s); // extra offset for club name text between selector and down button
  return { s, size, x, y, btnSize, btnGap, dnExtraOffset };
}

export function drawClubCarousel(
  ctx: CanvasRenderingContext2D,
  selectedIndex: number,
  canvasWidth: number,
  canvasHeight: number
) {
  const { s, size, x, y, btnSize, btnGap } = getClubCarouselLayout(canvasHeight);
  const m = Math.round;
  const club = CLUBS[selectedIndex];

  // Up arrow button (longer club)
  const upY = y - btnSize - btnGap;
  ctx.fillStyle = selectedIndex > 0 ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)';
  roundRect(ctx, x, upY, size, btnSize, m(6*s));
  ctx.fill();
  if (selectedIndex > 0) {
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = m(1.5*s);
    roundRect(ctx, x, upY, size, btnSize, m(6*s));
    ctx.stroke();
  }
  ctx.fillStyle = selectedIndex > 0 ? '#ffffff' : '#555';
  ctx.font = `bold ${m(14*s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('▲', x + size/2, upY + btnSize/2 + m(5*s));

  // Square background
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(ctx, x, y, size, size, m(8*s));
  ctx.fill();
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = m(2*s);
  roundRect(ctx, x, y, size, size, m(8*s));
  ctx.stroke();

  // Club short name
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${m(20*s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(club.shortName, x + size/2, y + m(26*s));

  // Range
  ctx.fillStyle = '#4ade80';
  ctx.font = `bold ${m(11*s)}px monospace`;
  ctx.fillText(`${club.maxRange}y`, x + size/2, y + m(42*s));

  // Club name below selector, above down arrow
  ctx.fillStyle = '#94a3b8';
  ctx.font = `${m(10*s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(club.name, x + size/2, y + size + m(12*s));

  // Down arrow button (shorter club)
  const dnY = y + size + btnGap + m(14*s);
  ctx.fillStyle = selectedIndex < CLUBS.length - 1 ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)';
  roundRect(ctx, x, dnY, size, btnSize, m(6*s));
  ctx.fill();
  if (selectedIndex < CLUBS.length - 1) {
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = m(1.5*s);
    roundRect(ctx, x, dnY, size, btnSize, m(6*s));
    ctx.stroke();
  }
  ctx.fillStyle = selectedIndex < CLUBS.length - 1 ? '#ffffff' : '#555';
  ctx.font = `bold ${m(14*s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('▼', x + size/2, dnY + btnSize/2 + m(5*s));
}

export function drawYardageRuler(
  ctx: CanvasRenderingContext2D,
  ball: Ball,
  holeData: HoleData,
  canvasWidth: number,
  canvasHeight: number,
  playerColor: string = '#ffffff'
) {
  const pixelDist = Math.abs(holeData.holeX - ball.x);
  const yardsPerPixel = holeData.distance / (holeData.holeX - holeData.teeX);
  const yardsRemaining = Math.max(0, Math.round(pixelDist * yardsPerPixel));

  const s = uiScale(canvasHeight);
  const m = Math.round;
  const totalW = m(200*s);
  const barH = m(6*s);
  const iconR = m(5*s); // ball icon radius
  const padding = m(16*s);
  const bgW = totalW + padding * 2;
  const bgH = m(32*s);
  const bx = canvasWidth / 2 - bgW / 2;
  const by = canvasHeight - m(105*s);
  const barX = bx + padding;
  const barY = by + bgH / 2 - barH / 2;

  // Background pill
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, bx, by, bgW, bgH, m(6*s));
  ctx.fill();

  // Track
  ctx.fillStyle = '#1a1a1a';
  roundRect(ctx, barX, barY, totalW, barH, m(3*s));
  ctx.fill();

  // Green fill from ball toward pin
  const totalYards = holeData.distance;
  const ratio = Math.min(1, yardsRemaining / totalYards);
  const ballPos = barX + (1 - ratio) * totalW; // ball position on bar
  const fillW = totalW - (1 - ratio) * totalW;
  if (fillW > 1) {
    const grd = ctx.createLinearGradient(ballPos, 0, barX + totalW, 0);
    grd.addColorStop(0, '#22c55e');
    grd.addColorStop(1, '#065f46');
    ctx.fillStyle = grd;
    roundRect(ctx, ballPos, barY, fillW, barH, m(3*s));
    ctx.fill();
  }

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  roundRect(ctx, barX, barY, totalW, barH, m(3*s));
  ctx.stroke();

  // Ball icon (left side, at ball position)
  const ballCx = Math.max(barX + iconR, Math.min(ballPos, barX + totalW - iconR));
  const ballCy = by + bgH / 2;
  const ballGrad = ctx.createRadialGradient(ballCx - m(1*s), ballCy - m(1*s), 0, ballCx, ballCy, iconR);
  ballGrad.addColorStop(0, '#ffffff');
  ballGrad.addColorStop(0.5, playerColor);
  ballGrad.addColorStop(1, adjustColor(playerColor, -40));
  ctx.beginPath();
  ctx.arc(ballCx, ballCy, iconR, 0, Math.PI * 2);
  ctx.fillStyle = ballGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = m(1*s);
  ctx.stroke();

  // Pin flag icon (right end)
  const pinX = barX + totalW + m(2*s);
  const pinTop = by + m(4*s);
  const pinBot = by + bgH - m(4*s);
  // Pole
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = m(1.5*s);
  ctx.beginPath();
  ctx.moveTo(pinX, pinBot);
  ctx.lineTo(pinX, pinTop);
  ctx.stroke();
  // Flag
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(pinX, pinTop);
  ctx.lineTo(pinX - m(8*s), pinTop + m(4*s));
  ctx.lineTo(pinX, pinTop + m(8*s));
  ctx.closePath();
  ctx.fill();

  // Distance text centered
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${m(10*s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(`${yardsRemaining} yds`, canvasWidth / 2, by - m(3*s));
}

export function drawPowerMeter(
  ctx: CanvasRenderingContext2D,
  power: number,
  active: boolean,
  canvasWidth: number,
  canvasHeight: number,
  powerCap: number = 1.0
) {
  if (!active && power === 0) return;

  const s = uiScale(canvasHeight);
  const m = Math.round;
  const meterW = m(220*s);
  const meterH = m(22*s);
  const mx = canvasWidth / 2 - meterW / 2;
  const my = canvasHeight - m(78*s);

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(ctx, mx - m(8*s), my - m(4*s), meterW + m(16*s), meterH + m(24*s), m(6*s));
  ctx.fill();

  // Greyed-out zone beyond cap
  if (powerCap < 1.0) {
    ctx.fillStyle = '#1a1a1a';
    roundRect(ctx, mx, my, meterW, meterH, m(3*s));
    ctx.fill();
    ctx.fillStyle = '#2a2a2a';
    const capX = mx + powerCap * meterW;
    ctx.fillRect(capX, my, meterW * (1 - powerCap), meterH);
  } else {
    ctx.fillStyle = '#333';
    roundRect(ctx, mx, my, meterW, meterH, m(3*s));
    ctx.fill();
  }

  // Power fill
  const filledW = power * meterW;
  if (filledW > 0) {
    const pGrad = ctx.createLinearGradient(mx, 0, mx + powerCap * meterW, 0);
    pGrad.addColorStop(0, '#22c55e');
    pGrad.addColorStop(0.6, '#f59e0b');
    pGrad.addColorStop(1, '#ef4444');
    ctx.fillStyle = pGrad;
    roundRect(ctx, mx, my, filledW, meterH, m(3*s));
    ctx.fill();
  }

  // Cap marker
  if (powerCap < 1.0) {
    const capX = mx + powerCap * meterW;
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = m(2*s);
    ctx.beginPath();
    ctx.moveTo(capX, my - m(3*s));
    ctx.lineTo(capX, my + meterH + m(3*s));
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = m(2*s);
  roundRect(ctx, mx, my, meterW, meterH, m(3*s));
  ctx.stroke();

  // Label
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${m(11*s)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(active ? 'TAP to set power' : `Power: ${Math.round(power * 100)}%`, canvasWidth / 2, my + meterH + m(14*s));

  // Power % indicator
  if (power > 0) {
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${m(10*s)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(power * 100)}%`, mx + filledW / 2, my + meterH - m(5*s));
  }
}

export function drawHoleIntro(
  ctx: CanvasRenderingContext2D,
  holeData: HoleData,
  holeNumber: number,
  canvasWidth: number,
  canvasHeight: number,
  alpha: number,
  camera: Camera,
  progress: number // 0 = start (at pin), 1 = end (at tee)
) {
  ctx.save();

  // Subtle dark gradient at top for readability
  const topGrad = ctx.createLinearGradient(0, 0, 0, 100);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.6)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, canvasWidth, 100);

  // Hole info banner at top center
  ctx.globalAlpha = Math.min(1, alpha);

  const bannerW = 280;
  const bannerH = 60;
  const bx = canvasWidth / 2 - bannerW / 2;
  const by = 12;

  ctx.fillStyle = 'rgba(10,25,10,0.85)';
  roundRect(ctx, bx, by, bannerW, bannerH, 10);
  ctx.fill();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  roundRect(ctx, bx, by, bannerW, bannerH, 10);
  ctx.stroke();

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`HOLE ${holeNumber}`, canvasWidth / 2, by + 28);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px monospace';
  ctx.fillText(`Par ${holeData.par}  •  ${holeData.distance} yds`, canvasWidth / 2, by + 50);

  // === DISTANCE RULER along the bottom ===
  const rulerH = 32;
  const rulerY = canvasHeight - rulerH - 8;

  // Background bar
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, rulerY - 4, canvasWidth, rulerH + 12);
  ctx.globalAlpha = 1;

  const yardsPerPixel = holeData.distance / (holeData.holeX - holeData.teeX);

  // Draw tick marks and yard labels for visible area
  const startWorldX = Math.max(holeData.teeX, Math.floor(camera.x));
  const endWorldX = Math.min(holeData.holeX, Math.ceil(camera.x + canvasWidth));

  // Yard values visible on screen
  const startYards = Math.max(0, Math.floor((startWorldX - holeData.teeX) * yardsPerPixel));
  const endYards = Math.ceil((endWorldX - holeData.teeX) * yardsPerPixel);

  // Choose tick spacing based on total distance
  const tickSpacingYards = holeData.distance > 400 ? 50 : 25;

  ctx.textAlign = 'center';

  for (let yd = 0; yd <= holeData.distance; yd += tickSpacingYards) {
    const worldX = holeData.teeX + yd / yardsPerPixel;
    const screenX = worldX - camera.x;

    if (screenX < -20 || screenX > canvasWidth + 20) continue;

    const isMajor = yd % (tickSpacingYards * 2) === 0 || yd === 0;

    // Tick line
    ctx.strokeStyle = isMajor ? 'rgba(74,222,128,0.6)' : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(screenX, rulerY);
    ctx.lineTo(screenX, rulerY + (isMajor ? 16 : 10));
    ctx.stroke();

    // Yard label on major ticks
    if (isMajor) {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`${yd}`, screenX, rulerY + 28);
    }
  }

  // Pin marker
  const pinScreenX = holeData.holeX - camera.x;
  if (pinScreenX > -20 && pinScreenX < canvasWidth + 20) {
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('⛳', pinScreenX, rulerY + 28);

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pinScreenX, rulerY);
    ctx.lineTo(pinScreenX, rulerY + 16);
    ctx.stroke();
  }

  // Tee marker
  const teeScreenX = holeData.teeX - camera.x;
  if (teeScreenX > -20 && teeScreenX < canvasWidth + 20) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('TEE', teeScreenX, rulerY + 28);
  }

  // Baseline
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, rulerY);
  ctx.lineTo(canvasWidth, rulerY);
  ctx.stroke();

  ctx.restore();
}

export function drawScorecard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight: number
) {
  const s = uiScale(canvasHeight);
  const m = Math.round;

  // Dim background
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const numHoles = state.totalHoles;
  const numPlayers = state.players.length;
  const nameColW = m(90 * s);
  const totColW = m(44 * s);
  const colW = m(Math.min(36 * s, (canvasWidth - 60 - nameColW - totColW) / numHoles));
  const rowH = m(32 * s);
  const numRows = 3 + numPlayers; // header + yds + par + players
  const tableW = nameColW + numHoles * colW + totColW;
  const tableH = numRows * rowH;
  const cardPadX = m(20 * s);
  const cardPadTop = m(50 * s);
  const cardPadBot = m(40 * s);
  const cardW = tableW + cardPadX * 2;
  const cardH = tableH + cardPadTop + cardPadBot;
  const cx = canvasWidth / 2 - cardW / 2;
  const cy = canvasHeight / 2 - cardH / 2;
  const tableX = cx + cardPadX;
  const tableY = cy + cardPadTop;

  // Handwriting-style font (cursive fallback chain)
  const handFont = (size: number, bold = false) =>
    `${bold ? 'bold ' : ''}${m(size * s)}px 'Segoe Script', 'Comic Sans MS', 'Bradley Hand', cursive`;
  const printFont = (size: number, bold = false) =>
    `${bold ? 'bold ' : ''}${m(size * s)}px monospace`;

  // === Card background: off-white paper ===
  ctx.save();
  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#f5f0e8';
  roundRect(ctx, cx, cy, cardW, cardH, m(6 * s));
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.restore();

  // Subtle paper texture lines
  ctx.strokeStyle = 'rgba(180,170,150,0.15)';
  ctx.lineWidth = 0.5;
  for (let ly = cy + 8; ly < cy + cardH - 4; ly += 6) {
    ctx.beginPath();
    ctx.moveTo(cx + 4, ly);
    ctx.lineTo(cx + cardW - 4, ly);
    ctx.stroke();
  }

  // Title
  ctx.fillStyle = '#1a4d1a';
  ctx.font = handFont(18, true);
  ctx.textAlign = 'center';
  ctx.fillText('Scorecard', canvasWidth / 2, cy + m(28 * s));

  // Subtitle
  ctx.fillStyle = '#8a8070';
  ctx.font = printFont(9);
  ctx.fillText('Press F to close', canvasWidth / 2, cy + m(42 * s));

  // Helper: x position for hole column center
  const holeColX = (h: number) => tableX + nameColW + h * colW + colW / 2;
  const totX = tableX + nameColW + numHoles * colW + totColW / 2;

  // === Draw grid lines ===
  ctx.strokeStyle = '#b0a898';
  ctx.lineWidth = 1;

  // Outer border
  ctx.strokeRect(tableX, tableY, tableW, tableH);

  // Horizontal lines
  for (let r = 1; r < numRows; r++) {
    const ly = tableY + r * rowH;
    ctx.beginPath();
    ctx.moveTo(tableX, ly);
    ctx.lineTo(tableX + tableW, ly);
    ctx.stroke();
  }

  // Vertical: after name col
  ctx.beginPath();
  ctx.moveTo(tableX + nameColW, tableY);
  ctx.lineTo(tableX + nameColW, tableY + tableH);
  ctx.stroke();

  // Vertical: between each hole
  for (let h = 1; h <= numHoles; h++) {
    const lx = tableX + nameColW + h * colW;
    ctx.beginPath();
    ctx.moveTo(lx, tableY);
    ctx.lineTo(lx, tableY + tableH);
    ctx.stroke();
  }

  // Vertical: before TOT
  const totLineX = tableX + nameColW + numHoles * colW;
  ctx.strokeStyle = '#8a8070';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(totLineX, tableY);
  ctx.lineTo(totLineX, tableY + tableH);
  ctx.stroke();

  // Thicker line under header
  ctx.strokeStyle = '#6a6050';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tableX, tableY + rowH);
  ctx.lineTo(tableX + tableW, tableY + rowH);
  ctx.stroke();

  // === Header row ===
  ctx.fillStyle = 'rgba(30,80,30,0.08)';
  ctx.fillRect(tableX + 1, tableY + 1, tableW - 2, rowH - 1);

  ctx.fillStyle = '#3a5a3a';
  ctx.font = printFont(10, true);
  ctx.textAlign = 'left';
  ctx.fillText('HOLE', tableX + m(6 * s), tableY + rowH / 2 + m(4 * s));

  ctx.textAlign = 'center';
  for (let h = 0; h < numHoles; h++) {
    ctx.fillText(`${h + 1}`, holeColX(h), tableY + rowH / 2 + m(4 * s));
  }
  ctx.font = printFont(10, true);
  ctx.fillText('TOT', totX, tableY + rowH / 2 + m(4 * s));

  // === Yardage row ===
  const ydsY = tableY + rowH;
  ctx.fillStyle = 'rgba(60,130,200,0.06)';
  ctx.fillRect(tableX + 1, ydsY + 1, tableW - 2, rowH - 1);

  ctx.fillStyle = '#3a5a8a';
  ctx.font = printFont(10);
  ctx.textAlign = 'left';
  ctx.fillText('YDS', tableX + m(6 * s), ydsY + rowH / 2 + m(4 * s));

  ctx.textAlign = 'center';
  ctx.font = printFont(10);
  let totalYds = 0;
  for (let h = 0; h < numHoles; h++) {
    const yds = state.allHoleData[h]?.distance ?? 0;
    totalYds += yds;
    ctx.fillText(`${yds}`, holeColX(h), ydsY + rowH / 2 + m(4 * s));
  }
  ctx.font = printFont(10, true);
  ctx.fillText(`${totalYds}`, totX, ydsY + rowH / 2 + m(4 * s));

  // === Par row ===
  const parY = tableY + rowH * 2;
  ctx.fillStyle = 'rgba(74,222,128,0.06)';
  ctx.fillRect(tableX + 1, parY + 1, tableW - 2, rowH - 1);

  ctx.fillStyle = '#2a6a2a';
  ctx.font = printFont(10);
  ctx.textAlign = 'left';
  ctx.fillText('PAR', tableX + m(6 * s), parY + rowH / 2 + m(4 * s));

  ctx.textAlign = 'center';
  ctx.font = printFont(10);
  let totalPar = 0;
  for (let h = 0; h < numHoles; h++) {
    const par = state.allHoleData[h]?.par ?? 4;
    totalPar += par;
    ctx.fillText(`${par}`, holeColX(h), parY + rowH / 2 + m(4 * s));
  }
  ctx.font = printFont(10, true);
  ctx.fillText(`${totalPar}`, totX, parY + rowH / 2 + m(4 * s));

  // === Player rows ===
  state.players.forEach((player, pi) => {
    const ry = parY + (pi + 1) * rowH;

    // Alternating subtle tint
    if (pi % 2 === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.02)';
      ctx.fillRect(tableX + 1, ry + 1, tableW - 2, rowH - 1);
    }

    // Player name in their color (handwritten style)
    ctx.fillStyle = player.color;
    ctx.font = handFont(12, true);
    ctx.textAlign = 'left';
    // Slight y-jitter for handwritten feel
    const nameJitter = ((pi * 7 + 3) % 5) - 2;
    ctx.fillText(player.name, tableX + m(6 * s), ry + rowH / 2 + m(4 * s) + nameJitter * 0.5);

    // Scores in handwriting font
    let total = 0;
    for (let h = 0; h < numHoles; h++) {
      const strokes = player.scores[h] ?? 0;
      total += strokes;
      ctx.textAlign = 'center';

      if (strokes === 0) {
        ctx.fillStyle = '#c0b8a8';
        ctx.font = printFont(10);
        ctx.fillText('-', holeColX(h), ry + rowH / 2 + m(4 * s));
      } else {
        const par = state.allHoleData[h]?.par ?? 4;
        const diff = strokes - par;

        // Color-coded circle behind score for under/over par
        if (diff < 0) {
          // Birdie/eagle: circle the score (golf tradition)
          ctx.strokeStyle = 'rgba(220,170,30,0.6)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(holeColX(h), ry + rowH / 2, m(10 * s), 0, Math.PI * 2);
          ctx.stroke();
          if (diff <= -2) {
            // Double circle for eagle or better
            ctx.beginPath();
            ctx.arc(holeColX(h), ry + rowH / 2, m(13 * s), 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = '#8B6914';
        } else if (diff === 0) {
          ctx.fillStyle = '#2a5a2a';
        } else {
          // Bogey+: square around score (golf tradition)
          ctx.strokeStyle = 'rgba(200,60,60,0.4)';
          ctx.lineWidth = 1.5;
          const sqSz = m(10 * s);
          ctx.strokeRect(holeColX(h) - sqSz, ry + rowH / 2 - sqSz + m(1*s), sqSz * 2, sqSz * 2);
          if (diff >= 2) {
            // Double square for double bogey+
            const sqSz2 = m(13 * s);
            ctx.strokeRect(holeColX(h) - sqSz2, ry + rowH / 2 - sqSz2 + m(1*s), sqSz2 * 2, sqSz2 * 2);
          }
          ctx.fillStyle = '#a03030';
        }

        // The score number itself — handwritten
        ctx.font = handFont(14, true);
        // Slight random rotation/offset for handwritten feel
        const xJit = ((h * 13 + pi * 7) % 5) - 2;
        const yJit = ((h * 11 + pi * 3) % 3) - 1;
        ctx.fillText(`${strokes}`, holeColX(h) + xJit * 0.5, ry + rowH / 2 + m(5 * s) + yJit * 0.5);
      }
    }

    // Total column
    ctx.fillStyle = '#1a1a1a';
    ctx.font = handFont(14, true);
    ctx.textAlign = 'center';
    ctx.fillText(`${total}`, totX, ry + rowH / 2 + m(5 * s));
  });
}

export function drawHoleSunk(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight: number
) {
  const player = state.players[state.currentPlayerIdx];
  if (!player || !state.holeData) return;

  const strokes = state.currentStrokes;
  const par = state.holeData.par;
  const label = getScoreLabelLocal(strokes, par);
  const diff = strokes - par;

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  const cw = 300, ch = 150;
  const cx = canvasWidth / 2 - cw / 2;
  const cy = canvasHeight / 2 - ch / 2 - 50;
  roundRect(ctx, cx, cy, cw, ch, 12);
  ctx.fill();

  ctx.fillStyle = player.color;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(player.name, canvasWidth / 2, cy + 28);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px monospace';
  ctx.fillText(label, canvasWidth / 2, cy + 70);

  const scoreColor = diff < 0 ? '#fbbf24' : diff === 0 ? '#22c55e' : '#ef4444';
  ctx.fillStyle = scoreColor;
  ctx.font = 'bold 20px monospace';
  const scoreStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
  ctx.fillText(`${strokes} strokes (${scoreStr})`, canvasWidth / 2, cy + 100);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px monospace';
  ctx.fillText('Next hole loading...', canvasWidth / 2, cy + 130);
}

function getScoreLabelLocal(strokes: number, par: number): string {
  const diff = strokes - par;
  if (strokes === 1) return 'HOLE IN ONE!';
  if (diff <= -3) return 'ALBATROSS!';
  if (diff === -2) return 'EAGLE!';
  if (diff === -1) return 'BIRDIE!';
  if (diff === 0) return 'PAR';
  if (diff === 1) return 'BOGEY';
  if (diff === 2) return 'DOUBLE BOGEY';
  return `+${diff}`;
}

export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight: number
) {
  ctx.fillStyle = 'rgba(0,0,0,0.9)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 40px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', canvasWidth / 2, 80);

  // Sort players by total score
  const ranked = state.players
    .map((p) => ({ player: p, total: p.scores.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.total - b.total);

  const totalPar = state.allHoleData.reduce((sum, h) => sum + (h?.par ?? 4), 0);

  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = '#fbbf24';
  ctx.fillText('FINAL SCORES', canvasWidth / 2, 130);

  ranked.forEach((entry, i) => {
    const y = 170 + i * 50;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const diff = entry.total - totalPar;
    const scoreStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;

    ctx.fillStyle = entry.player.color;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${i + 1}. ${entry.player.name}: ${entry.total} (${scoreStr})`, canvasWidth / 2, y);
  });

  // "Play Again" button area (rendered as canvas text, click handled in GolfGame.tsx)
  const btnW = 220;
  const btnH = 44;
  const btnX = canvasWidth / 2 - btnW / 2;
  const btnY = canvasHeight - 80;
  ctx.fillStyle = 'rgba(22,101,52,0.9)';
  roundRect(ctx, btnX, btnY, btnW, btnH, 10);
  ctx.fill();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  roundRect(ctx, btnX, btnY, btnW, btnH, 10);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PLAY AGAIN', canvasWidth / 2, btnY + 28);

  ctx.fillStyle = '#64748b';
  ctx.font = '11px monospace';
  ctx.fillText('or press any key', canvasWidth / 2, btnY + btnH + 18);
}

export type InputMode = 'keyboard' | 'mouse' | 'gamepad' | 'touch';

/** Detect which input device was used most recently */
let _lastInputMode: InputMode = 'keyboard';
export function setLastInputMode(mode: InputMode) { _lastInputMode = mode; }
export function getLastInputMode(): InputMode { return _lastInputMode; }

export function drawControls(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight: number
) {
  const mode = _lastInputMode;
  let text = '';

  if (state.phase === 'aiming') {
    if (mode === 'gamepad') {
      text = '\uD83C\uDFAE Stick: Aim  |  LB/RB: Club  |  A: Swing';
    } else if (mode === 'mouse') {
      text = 'Hold LMB: Start swing  |  Drag: Aim  |  Release: Shoot';
    } else if (mode === 'touch') {
      text = 'Tap: Swing  |  Buttons: Aim & Club';
    } else {
      text = '\u2190 \u2192 Aim  |  \u2191 \u2193 Club  |  SPACE: Swing';
    }
  } else if (state.phase === 'powering') {
    if (mode === 'gamepad') {
      text = '\uD83C\uDFAE A: Launch!';
    } else if (mode === 'mouse') {
      text = 'Release to launch!  |  Drag \u2191\u2193 to aim';
    } else if (mode === 'touch') {
      text = 'Tap to launch!';
    } else {
      text = 'SPACE: Launch!';
    }
  }

  if (!text) return;

  const s = uiScale(canvasHeight);
  const m = Math.round;
  ctx.font = `${m(10*s)}px monospace`;
  const textW = ctx.measureText(text).width;
  const barW = Math.max(m(200*s), textW + m(20*s));

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(canvasWidth / 2 - barW / 2, canvasHeight - m(22*s), barW, m(20*s));

  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvasWidth / 2, canvasHeight - m(8*s));
}

export function drawTouchControls(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight: number
) {
  if (state.phase !== 'aiming') return;

  const s = uiScale(canvasHeight);
  const m = Math.round;
  const btnSize = m(44 * s);
  const btnMargin = m(8 * s);
  const cornerRadius = m(8 * s);

  const drawButton = (x: number, y: number, label: string, sublabel?: string) => {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, x, y, btnSize, btnSize, cornerRadius);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = m(1.5*s);
    roundRect(ctx, x, y, btnSize, btnSize, cornerRadius);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${m(18*s)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + btnSize / 2, y + btnSize / 2 + m(6*s));
    if (sublabel) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${m(7*s)}px monospace`;
      ctx.fillText(sublabel, x + btnSize / 2, y + btnSize - m(3*s));
    }
  };

  const clubX = m(12 * s);
  const clubUpY = canvasHeight - m(120*s) - btnSize - btnMargin;
  drawButton(clubX, clubUpY, '\u25B2', 'CLUB');

  const clubDnY = canvasHeight - m(120*s) + m(56*s) + btnMargin;
  drawButton(clubX, clubDnY, '\u25BC', 'CLUB');

  const aimBtnY = canvasHeight - btnSize - btnMargin;
  const aimLeftX = canvasWidth - btnSize * 2 - btnMargin * 2;
  const aimRightX = canvasWidth - btnSize - btnMargin;
  drawButton(aimLeftX, aimBtnY, '\u25C0', 'AIM');
  drawButton(aimRightX, aimBtnY, '\u25B6', 'AIM');
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

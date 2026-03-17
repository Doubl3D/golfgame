import { HoleData, getSegmentAt } from './terrain';
import { Ball } from './physics';
import { GameState, Particle } from './gameState';

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
  const treeBaseY = h * 0.80;
  const treeSpacing = 55;
  const treeCount = Math.ceil(w / treeSpacing) + 6;
  const treeOffset = ((-tx2) % treeSpacing + treeSpacing) % treeSpacing;
  for (let i = -3; i < treeCount; i++) {
    const tbx = treeOffset + i * treeSpacing + (((i * 17) % 7) - 3) * 6;
    const treeH = 60 + (((i * 13 + 7) % 5)) * 14;
    const treeW = treeH * 0.55;
    // Three stacked triangles for a pine silhouette
    for (let tier = 0; tier < 3; tier++) {
      const tierTop = treeBaseY - treeH + tier * treeH * 0.32;
      const tierW   = treeW * (1 - tier * 0.22);
      ctx.beginPath();
      ctx.moveTo(tbx, tierTop);
      ctx.lineTo(tbx + tierW / 2, treeBaseY - treeH * 0.28 + tier * treeH * 0.32);
      ctx.lineTo(tbx - tierW / 2, treeBaseY - treeH * 0.28 + tier * treeH * 0.32);
      ctx.closePath();
      ctx.fill();
    }
    // Trunk
    ctx.fillStyle = '#3d2b1a';
    ctx.fillRect(tbx - 3, treeBaseY - treeH * 0.20, 6, treeH * 0.20);
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
    const hcy = h * 0.80 - Math.sin(i * 1.1 + 0.7) * h * 0.12 - Math.sin(i * 2.3) * h * 0.05;
    ctx.quadraticCurveTo(hcx,            h * 0.86, hcx + hillW / 2, hcy);
    ctx.quadraticCurveTo(hcx + hillW,    h * 0.86, hcx + hillW * 1.5, hcy + h * 0.04);
  }
  ctx.lineTo(w + 200, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // === CLOUDS — three depth layers with distinct parallax speeds ===

  // Layer A: far, small, slow (parallax 0.12)
  const cloudsFar = [
    { ox: 60,  y: h * 0.12, r: 18 },
    { ox: 240, y: h * 0.09, r: 22 },
    { ox: 450, y: h * 0.14, r: 16 },
    { ox: 650, y: h * 0.11, r: 20 },
    { ox: 850, y: h * 0.08, r: 18 },
    { ox: 1100,y: h * 0.13, r: 24 },
    { ox: 1350,y: h * 0.10, r: 19 },
    { ox: 1600,y: h * 0.07, r: 21 },
  ];
  const shiftFar = cameraX * 0.12;
  for (const c of cloudsFar) {
    const sx = ((c.ox - shiftFar % (w + 400) + (w + 400) * 4) % (w + 400)) - 100;
    drawCloud(ctx, sx, c.y, c.r, 'rgba(255,255,255,0.55)');
  }

  // Layer B: mid, medium speed (parallax 0.22)
  const cloudsMid = [
    { ox: 120, y: h * 0.20, r: 30 },
    { ox: 330, y: h * 0.17, r: 38 },
    { ox: 570, y: h * 0.22, r: 28 },
    { ox: 790, y: h * 0.16, r: 42 },
    { ox: 980, y: h * 0.21, r: 34 },
    { ox: 1250,y: h * 0.18, r: 36 },
    { ox: 1500,y: h * 0.15, r: 32 },
  ];
  const shiftMid = cameraX * 0.22;
  for (const c of cloudsMid) {
    const sx = ((c.ox - shiftMid % (w + 400) + (w + 400) * 4) % (w + 400)) - 100;
    drawCloud(ctx, sx, c.y, c.r, 'rgba(255,255,255,0.80)');
  }

  // Layer C: near, big, faster (parallax 0.38)
  const cloudsNear = [
    { ox: 80,  y: h * 0.28, r: 48 },
    { ox: 400, y: h * 0.25, r: 55 },
    { ox: 720, y: h * 0.30, r: 44 },
    { ox: 1050,y: h * 0.27, r: 52 },
    { ox: 1380,y: h * 0.29, r: 46 },
  ];
  const shiftNear = cameraX * 0.38;
  for (const c of cloudsNear) {
    const sx = ((c.ox - shiftNear % (w + 400) + (w + 400) * 4) % (w + 400)) - 100;
    drawCloud(ctx, sx, c.y, c.r, 'rgba(255,255,255,0.92)');
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
  terrainSurface: number // approximate y of terrain near camera
) {
  // === PARALLAX FOREGROUND: dark grass tufts that scroll faster than world ===
  const fx = cameraX * 1.25;
  ctx.save();
  ctx.globalAlpha = 0.7;

  const tuftSpacing = 120;
  const tuftCount = Math.ceil(w / tuftSpacing) + 4;
  const tuftOffset = (-fx) % tuftSpacing;

  for (let i = -2; i < tuftCount; i++) {
    const tx = tuftOffset + i * tuftSpacing + (i % 3) * 18;
    const ty = terrainSurface - 4;

    ctx.strokeStyle = '#1a4d1a';
    ctx.lineWidth = 1.5;

    // 3-4 blades per tuft
    for (let b = -2; b <= 2; b++) {
      const bx = tx + b * 5;
      const blen = 10 + Math.abs(b) * 2;
      const curve = b * 3;
      ctx.beginPath();
      ctx.moveTo(bx, ty);
      ctx.quadraticCurveTo(bx + curve, ty - blen * 0.6, bx + curve * 0.5, ty - blen);
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
      // Dark murky water - clearly different from sky
      const waterGrad = ctx.createLinearGradient(0, 180, 0, canvasHeight);
      waterGrad.addColorStop(0, '#2d5a1a');   // dark swampy green surface
      waterGrad.addColorStop(0.15, '#1e3d10');
      waterGrad.addColorStop(0.5, '#0f2008');  // very dark below
      waterGrad.addColorStop(1, '#080f04');
      ctx.fillStyle = waterGrad;
      ctx.fill();

      // Muddy surface glint
      ctx.strokeStyle = 'rgba(80,140,30,0.5)';
      ctx.lineWidth = 2;
      const time = Date.now() * 0.0015;
      for (let wx = sx; wx < ex; wx += 18) {
        const wy = terrain[Math.min(wx, terrain.length - 1)] ?? 0;
        ctx.beginPath();
        ctx.moveTo(wx - camera.x, wy + Math.sin(time + wx * 0.04) * 1.5 + 2);
        ctx.lineTo(wx + 12 - camera.x, wy + Math.sin(time + (wx + 12) * 0.04) * 1.5 + 2);
        ctx.stroke();
      }

      // Bubbles / murk dots
      ctx.fillStyle = 'rgba(40,90,10,0.4)';
      const bubbleSeed = Math.floor(time * 0.3);
      for (let wx = sx + 15; wx < ex - 15; wx += 40) {
        const wy = terrain[Math.min(wx, terrain.length - 1)] ?? 0;
        const bx = wx + Math.sin(wx * 0.1 + bubbleSeed) * 8;
        const by = wy + 12 + Math.sin(wx * 0.2 + time) * 6;
        ctx.beginPath();
        ctx.arc(bx - camera.x, by, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // "HAZARD" label with warning style
      const midX = (sx + ex) / 2 - camera.x;
      const midTerrainY2 = terrain[Math.floor((sx + ex) / 2)] ?? 0;
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = 'rgba(255,80,80,0.85)';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ WATER', midX, midTerrainY2 + 22);
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

    // Terrain type label (skip water - handled above, skip fairway)
    if (seg.type !== 'water' && seg.type !== 'fairway' && ex - sx > 80) {
      const midX = (sx + ex) / 2 - camera.x;
      const midTerrainY = terrain[Math.floor((sx + ex) / 2)] ?? 0;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(seg.label.toUpperCase(), midX, midTerrainY + 18);
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
  camera: Camera
) {
  const sx = teeX - camera.x;
  ctx.beginPath();
  ctx.rect(sx - 15, teeY - 4, 30, 4);
  ctx.fillStyle = '#f9f9f9';
  ctx.fill();
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  ctx.stroke();
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
  canvasWidth: number
) {
  const player = state.players[state.currentPlayerIdx];
  if (!player || !state.holeData) return;

  // Background panel
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, 10, 10, 220, 90, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  roundRect(ctx, 10, 10, 220, 90, 8);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = player.color;
  ctx.font = 'bold 16px monospace';
  ctx.fillText(player.name, 20, 32);

  ctx.fillStyle = '#ffffff';
  ctx.font = '12px monospace';
  ctx.fillText(`Hole ${state.currentHole}/${state.totalHoles}  Par ${state.holeData.par}`, 20, 50);
  ctx.fillText(`Strokes: ${state.currentStrokes}`, 20, 66);
  ctx.fillText(`Dist: ${state.holeData.distance} yds`, 20, 82);

  // Wind indicator
  const windX = canvasWidth - 160;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, windX, 10, 150, 50, 8);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('WIND', windX + 75, 28);

  const arrowDir = state.wind.direction;
  const arrowLen = Math.min(50, state.wind.speed * 6);
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(windX + 75 - arrowLen / 2, 42);
  ctx.lineTo(windX + 75 + arrowLen / 2 * arrowDir, 42);
  ctx.stroke();

  // Arrowhead
  const ax = windX + 75 + arrowLen / 2 * arrowDir;
  ctx.beginPath();
  ctx.moveTo(ax, 42);
  ctx.lineTo(ax - 6 * arrowDir, 37);
  ctx.lineTo(ax - 6 * arrowDir, 47);
  ctx.closePath();
  ctx.fillStyle = '#fbbf24';
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(state.wind.label, windX + 75, 56);
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

  const meterW = 250;
  const meterH = 30;
  const mx = canvasWidth / 2 - meterW / 2;
  const my = canvasHeight - 60;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(ctx, mx - 10, my - 5, meterW + 20, meterH + 30, 8);
  ctx.fill();

  // Greyed-out zone beyond cap
  if (powerCap < 1.0) {
    ctx.fillStyle = '#1a1a1a';
    roundRect(ctx, mx, my, meterW, meterH, 4);
    ctx.fill();
    ctx.fillStyle = '#2a2a2a';
    const capX = mx + powerCap * meterW;
    ctx.fillRect(capX, my, meterW * (1 - powerCap), meterH);
  } else {
    ctx.fillStyle = '#333';
    roundRect(ctx, mx, my, meterW, meterH, 4);
    ctx.fill();
  }

  // Power fill with gradient (only up to cap range)
  const filledW = power * meterW;
  if (filledW > 0) {
    const pGrad = ctx.createLinearGradient(mx, 0, mx + powerCap * meterW, 0);
    pGrad.addColorStop(0, '#22c55e');
    pGrad.addColorStop(0.6, '#f59e0b');
    pGrad.addColorStop(1, '#ef4444');
    ctx.fillStyle = pGrad;
    roundRect(ctx, mx, my, filledW, meterH, 4);
    ctx.fill();
  }

  // Cap marker line
  if (powerCap < 1.0) {
    const capX = mx + powerCap * meterW;
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(capX, my - 4);
    ctx.lineTo(capX, my + meterH + 4);
    ctx.stroke();
    ctx.fillStyle = '#ff4444';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SAND', capX, my - 7);
  }

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  roundRect(ctx, mx, my, meterW, meterH, 4);
  ctx.stroke();

  // Label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(active ? 'PRESS SPACE to set power' : `Power: ${Math.round(power * 100)}%`, canvasWidth / 2, my + meterH + 18);

  // Power % indicator
  if (power > 0) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(power * 100)}%`, mx + filledW / 2, my + 20);
  }
}

export function drawHoleIntro(
  ctx: CanvasRenderingContext2D,
  holeData: HoleData,
  holeNumber: number,
  canvasWidth: number,
  canvasHeight: number,
  alpha: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;

  // Dark overlay
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Card
  const cw = 380, ch = 200;
  const cx = canvasWidth / 2 - cw / 2;
  const cy = canvasHeight / 2 - ch / 2;

  ctx.fillStyle = 'rgba(15,30,15,0.95)';
  roundRect(ctx, cx, cy, cw, ch, 12);
  ctx.fill();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  roundRect(ctx, cx, cy, cw, ch, 12);
  ctx.stroke();

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('HOLE', canvasWidth / 2, cy + 35);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px monospace';
  ctx.fillText(`${holeNumber}`, canvasWidth / 2, cy + 110);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px monospace';
  ctx.fillText(`Par ${holeData.par}  •  ${holeData.distance} yards`, canvasWidth / 2, cy + 145);

  ctx.fillStyle = '#4ade80';
  ctx.font = '13px monospace';
  ctx.fillText('Get ready...', canvasWidth / 2, cy + 175);

  ctx.restore();
}

export function drawScorecard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight: number
) {
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const cardW = Math.min(canvasWidth - 40, 700);
  const cardH = Math.min(canvasHeight - 60, 500);
  const cx = canvasWidth / 2 - cardW / 2;
  const cy = canvasHeight / 2 - cardH / 2;

  ctx.fillStyle = '#0f1a0f';
  roundRect(ctx, cx, cy, cardW, cardH, 12);
  ctx.fill();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  roundRect(ctx, cx, cy, cardW, cardH, 12);
  ctx.stroke();

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SCORECARD', canvasWidth / 2, cy + 32);

  ctx.fillStyle = '#64748b';
  ctx.font = '12px monospace';
  ctx.fillText('Press F to close', canvasWidth / 2, cy + 50);

  const cols = state.totalHoles + 2;
  const colW = Math.min((cardW - 40) / cols, 50);
  const rowH = 30;
  const tableX = cx + 20;
  const tableY = cy + 65;

  // Header row
  ctx.fillStyle = '#1e3320';
  ctx.fillRect(tableX, tableY, cardW - 40, rowH);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('Player', tableX + 5, tableY + 20);

  for (let h = 1; h <= state.totalHoles; h++) {
    ctx.textAlign = 'center';
    ctx.fillText(`${h}`, tableX + state.players.length > 0 ? 80 + (h - 1) * colW + colW / 2 : 80, tableY + 20);
  }
  ctx.textAlign = 'center';
  ctx.fillText('TOT', tableX + 80 + state.totalHoles * colW + colW / 2, tableY + 20);

  // Player rows
  state.players.forEach((player, pi) => {
    const ry = tableY + (pi + 1) * rowH;
    ctx.fillStyle = pi % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
    ctx.fillRect(tableX, ry, cardW - 40, rowH);

    ctx.fillStyle = player.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(player.name, tableX + 5, ry + 20);

    let total = 0;
    for (let h = 0; h < state.totalHoles; h++) {
      const strokes = player.scores[h] ?? 0;
      total += strokes;
      const hx = tableX + 80 + h * colW + colW / 2;
      ctx.textAlign = 'center';

      if (strokes === 0) {
        ctx.fillStyle = '#334155';
        ctx.fillText('-', hx, ry + 20);
      } else {
        // Color code
        const holePar = 4; // approximate
        const diff = strokes - holePar;
        if (diff < 0) ctx.fillStyle = '#fbbf24';
        else if (diff === 0) ctx.fillStyle = '#22c55e';
        else ctx.fillStyle = '#ef4444';
        ctx.fillText(`${strokes}`, hx, ry + 20);
      }
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${total}`, tableX + 80 + state.totalHoles * colW + colW / 2, ry + 20);
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

  const totalPar = state.totalHoles * 4;

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

  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px monospace';
  ctx.fillText('Refresh page to play again', canvasWidth / 2, canvasHeight - 40);
}

export function drawControls(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasWidth: number,
  canvasHeight: number
) {
  const lines: string[] = [];
  const playerIdx = state.currentPlayerIdx;

  if (state.phase === 'aiming') {
    if (playerIdx === 0) lines.push('← → Aim  |  SPACE: Power');
    else if (playerIdx === 1) lines.push('A D Aim  |  SPACE: Power');
    else lines.push('SPACE: Power');
    lines.push('F: Scorecard');
  } else if (state.phase === 'powering') {
    lines.push('SPACE: Launch!');
  }

  if (lines.length === 0) return;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(canvasWidth / 2 - 120, canvasHeight - 36, 240, 28);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(lines.join('  |  '), canvasWidth / 2, canvasHeight - 17);
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

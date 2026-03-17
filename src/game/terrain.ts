export interface TerrainSegment {
  type: 'fairway' | 'rough' | 'fringe' | 'green' | 'sand' | 'water';
  startX: number;
  endX: number;
  color: string;
  friction: number;
  label: string;
}

export interface HoleData {
  terrain: number[]; // Y values for terrain height at each X pixel
  segments: TerrainSegment[];
  teeX: number;
  teeY: number;
  holeX: number;
  holeY: number;
  par: number;
  distance: number; // in yards
  width: number;
}

function smoothNoise(x: number, seed: number): number {
  const a = Math.sin(x * 0.3 + seed) * 0.5;
  const b = Math.sin(x * 0.15 + seed * 1.7) * 0.3;
  const c = Math.sin(x * 0.05 + seed * 0.5) * 0.8;
  const d = Math.sin(x * 0.007 + seed * 2.3) * 1.2;
  return a + b + c + d;
}

export function generateHole(holeNumber: number): HoleData {
  const seed = holeNumber * 137.5;
  const totalWidth = 3000 + holeNumber * 200;
  const terrainResolution = 1; // 1 pixel per sample

  const points = totalWidth / terrainResolution;
  const terrain: number[] = [];

  const baseY = 500;
  const amplitude = 60 + (holeNumber % 5) * 12;

  for (let i = 0; i <= points; i++) {
    const x = i * terrainResolution;
    const noise = smoothNoise(x * 0.01, seed);
    terrain.push(baseY + noise * amplitude);
  }

  // Smooth the terrain
  const smoothed: number[] = [...terrain];
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 2; i < smoothed.length - 2; i++) {
      smoothed[i] = (terrain[i - 2] + terrain[i - 1] + terrain[i] + terrain[i + 1] + terrain[i + 2]) / 5;
    }
  }

  // Flatten tee area
  const teeX = 150;
  for (let i = Math.max(0, teeX - 60); i < Math.min(smoothed.length, teeX + 60); i++) {
    const t = Math.abs(i - teeX) / 60;
    smoothed[i] = smoothed[i] * t + smoothed[teeX] * (1 - t);
  }

  // Flatten green area
  const holeX = totalWidth - 250;
  for (let i = Math.max(0, holeX - 120); i < Math.min(smoothed.length, holeX + 120); i++) {
    const t = Math.abs(i - holeX) / 120;
    smoothed[i] = smoothed[i] * t + smoothed[holeX] * (1 - t);
  }

  const teeY = smoothed[teeX] ?? baseY;
  const holeY = smoothed[holeX] ?? baseY;

  // Create segments
  const segments: TerrainSegment[] = [];

  // Tee/rough start
  segments.push({
    type: 'rough',
    startX: 0,
    endX: 100,
    color: '#1a5c1a',
    friction: 0.85,
    label: 'Rough',
  });

  // Fairway — slightly stickier than before (0.87 vs 0.92)
  segments.push({
    type: 'fairway',
    startX: 100,
    endX: totalWidth - 600,
    color: '#2d8a2d',
    friction: 0.87,
    label: 'Fairway',
  });

  // Add sand bunker(s) — use integer boundaries to avoid sub-pixel cracks
  const bunkerX = Math.round(teeX + (holeX - teeX) * 0.45 + Math.sin(seed) * 200);
  const bunkerWidth = Math.round(120 + Math.abs(Math.sin(seed * 0.7)) * 80);
  const bunkerEnd = bunkerX + bunkerWidth;

  // Trim fairway right up to the bunker edge — no artificial gap
  segments[1].endX = bunkerX;

  segments.push({
    type: 'sand',
    startX: bunkerX,
    endX: bunkerEnd,
    color: '#e8d5a3',
    friction: 0.5,
    label: 'Sand',
  });

  // Optional water hazard
  const hasWater = holeNumber % 3 !== 1;
  let waterStart = 0, waterEnd = 0;
  if (hasWater) {
    waterStart = Math.round(bunkerEnd + 100 + Math.abs(Math.sin(seed * 1.3)) * 100);
    waterEnd = waterStart + 150;
    segments.push({
      type: 'fairway',
      startX: bunkerEnd,
      endX: waterStart,
      color: '#2d8a2d',
      friction: 0.87,
      label: 'Fairway',
    });
    segments.push({
      type: 'water',
      startX: waterStart,
      endX: waterEnd,
      color: '#1a6ba0',
      friction: 0,
      label: 'Water',
    });
    segments.push({
      type: 'fairway',
      startX: waterEnd,
      endX: totalWidth - 600,
      color: '#2d8a2d',
      friction: 0.87,
      label: 'Fairway',
    });
  } else {
    // Push (not replace) so the sand segment is preserved and there's no gap
    segments.push({
      type: 'fairway',
      startX: bunkerEnd,
      endX: totalWidth - 600,
      color: '#2d8a2d',
      friction: 0.87,
      label: 'Fairway',
    });
  }

  // Fringe — faster roll than fairway (0.94)
  segments.push({
    type: 'fringe',
    startX: totalWidth - 600,
    endX: totalWidth - 400,
    color: '#3da03d',
    friction: 0.94,
    label: 'Fringe',
  });

  // Green — very fast putt surface (0.98)
  segments.push({
    type: 'green',
    startX: totalWidth - 400,
    endX: totalWidth,
    color: '#50c050',
    friction: 0.98,
    label: 'Green',
  });

  // Flatten water if present
  if (hasWater) {
    const waterMidY = (smoothed[Math.floor(waterStart)] + smoothed[Math.min(Math.floor(waterEnd), smoothed.length - 1)]) / 2 + 10;
    for (let i = Math.floor(waterStart); i <= Math.min(Math.floor(waterEnd), smoothed.length - 1); i++) {
      smoothed[i] = waterMidY;
    }
  }

  const par = holeNumber <= 6 ? 4 : holeNumber <= 12 ? 3 : 5;
  const distance = Math.round((totalWidth / 3000) * (350 + holeNumber * 20));

  return {
    terrain: smoothed,
    segments,
    teeX,
    teeY,
    holeX,
    holeY,
    par,
    distance,
    width: totalWidth,
  };
}

export function getTerrainY(terrain: number[], x: number): number {
  const idx = Math.max(0, Math.min(Math.floor(x), terrain.length - 1));
  const next = Math.min(idx + 1, terrain.length - 1);
  const frac = x - Math.floor(x);
  return (terrain[idx] ?? 0) * (1 - frac) + (terrain[next] ?? 0) * frac;
}

export function getSegmentAt(segments: TerrainSegment[], x: number): TerrainSegment {
  for (const seg of segments) {
    if (x >= seg.startX && x <= seg.endX) return seg;
  }
  return segments[0];
}

export function getTerrainSlope(terrain: number[], x: number): number {
  const dx = 3;
  const y1 = getTerrainY(terrain, x - dx);
  const y2 = getTerrainY(terrain, x + dx);
  return (y2 - y1) / (dx * 2);
}

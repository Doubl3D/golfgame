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

export type Difficulty = 'easy' | 'normal' | 'expert';

function smoothNoise(x: number, seed: number): number {
  const a = Math.sin(x * 0.3 + seed) * 0.5;
  const b = Math.sin(x * 0.15 + seed * 1.7) * 0.3;
  const c = Math.sin(x * 0.05 + seed * 0.5) * 0.8;
  const d = Math.sin(x * 0.007 + seed * 2.3) * 1.2;
  return a + b + c + d;
}

/** Seeded pseudo-random 0-1 from seed value */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

export function generateHole(holeNumber: number, screenHeight?: number, difficulty: Difficulty = 'normal'): HoleData {
  const seed = holeNumber * 137.5;

  // Determine par and distance first, then size terrain to match
  const holeRng = seededRandom(seed + 99);
  let par: number;
  let distance: number;
  if (holeRng < 0.30) {
    par = 3;
    distance = Math.round(120 + seededRandom(seed + 200) * 180); // 120-300 yds
  } else if (holeRng < 0.75) {
    par = 4;
    distance = Math.round(250 + seededRandom(seed + 201) * 300); // 250-550 yds
  } else {
    par = 5;
    distance = Math.round(400 + seededRandom(seed + 202) * 373); // 400-773 yds
  }

  // Scale terrain pixel width to distance (roughly 6-8 pixels per yard)
  const pixelsPerYard = 6.5;
  const totalWidth = Math.round(distance * pixelsPerYard + 500); // +500 for tee + green padding
  const terrainResolution = 1;

  const points = totalWidth / terrainResolution;
  const terrain: number[] = [];

  const h = screenHeight || window.innerHeight;
  const baseY = Math.round(h * 0.70);
  const amplitude = Math.min(60 + (holeNumber % 5) * 12, h * 0.08);

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

  // === Difficulty-based hazard generation ===
  const fairwayStart = 100;
  const fairwayEnd = totalWidth - 600;
  const fairwayLen = fairwayEnd - fairwayStart;

  // Collect hazards as { type, startX, endX } then sort and build segments
  interface Hazard { type: 'rough' | 'sand' | 'water'; startX: number; endX: number; }
  const hazards: Hazard[] = [];

  // Helper to add a hazard if it doesn't overlap existing ones
  const addHazard = (type: Hazard['type'], start: number, width: number) => {
    const s = Math.round(Math.max(fairwayStart + 50, Math.min(start, fairwayEnd - width - 50)));
    const e = s + Math.round(width);
    // Check overlap with existing hazards (with 40px buffer)
    for (const h of hazards) {
      if (s < h.endX + 40 && e > h.startX - 40) return false;
    }
    hazards.push({ type, startX: s, endX: e });
    return true;
  };

  let rng = seed;
  const nextRng = () => { rng += 1.618; return seededRandom(rng); };

  if (difficulty === 'easy') {
    // Easy: 2-4 rough patches only, no sand or water
    const numRough = 2 + Math.floor(nextRng() * 3);
    for (let i = 0; i < numRough; i++) {
      const pos = fairwayStart + nextRng() * fairwayLen * 0.85;
      const w = 80 + nextRng() * 120;
      addHazard('rough', pos, w);
    }
  } else if (difficulty === 'normal') {
    // Hard: 2-3 rough patches, 1-2 sand bunkers, 0-1 water hazard
    const numRough = 2 + Math.floor(nextRng() * 2);
    for (let i = 0; i < numRough; i++) {
      const pos = fairwayStart + nextRng() * fairwayLen * 0.85;
      const w = 80 + nextRng() * 100;
      addHazard('rough', pos, w);
    }
    const numSand = 1 + Math.floor(nextRng() * 2);
    for (let i = 0; i < numSand; i++) {
      const pos = fairwayStart + nextRng() * fairwayLen * 0.8;
      const w = 100 + nextRng() * 80;
      addHazard('sand', pos, w);
    }
    // Water on some holes
    if (holeNumber % 3 !== 1) {
      const pos = fairwayStart + fairwayLen * 0.35 + nextRng() * fairwayLen * 0.35;
      addHazard('water', pos, 120 + nextRng() * 60);
    }
  } else {
    // Expert: 3-5 rough, 2-3 sand, 1-2 water
    const numRough = 3 + Math.floor(nextRng() * 3);
    for (let i = 0; i < numRough; i++) {
      const pos = fairwayStart + nextRng() * fairwayLen * 0.9;
      const w = 80 + nextRng() * 120;
      addHazard('rough', pos, w);
    }
    const numSand = 2 + Math.floor(nextRng() * 2);
    for (let i = 0; i < numSand; i++) {
      const pos = fairwayStart + nextRng() * fairwayLen * 0.85;
      const w = 100 + nextRng() * 100;
      addHazard('sand', pos, w);
    }
    const numWater = 1 + Math.floor(nextRng() * 2);
    for (let i = 0; i < numWater; i++) {
      const pos = fairwayStart + fairwayLen * 0.2 + nextRng() * fairwayLen * 0.5;
      addHazard('water', pos, 120 + nextRng() * 80);
    }
  }

  // Sort hazards by position
  hazards.sort((a, b) => a.startX - b.startX);

  // Build segments from hazards
  const segments: TerrainSegment[] = [];

  // Starting rough
  segments.push({
    type: 'rough', startX: 0, endX: fairwayStart,
    color: '#1a5c1a', friction: 0.85, label: 'Rough',
  });

  // Fill fairway between hazards
  let cursor = fairwayStart;
  for (const hz of hazards) {
    if (hz.startX > cursor) {
      segments.push({
        type: 'fairway', startX: cursor, endX: hz.startX,
        color: '#2d8a2d', friction: 0.87, label: 'Fairway',
      });
    }
    const segColor = hz.type === 'rough' ? '#1a5c1a' : hz.type === 'sand' ? '#e8d5a3' : '#1a6ba0';
    const segFriction = hz.type === 'rough' ? 0.85 : hz.type === 'sand' ? 0.5 : 0;
    segments.push({
      type: hz.type, startX: hz.startX, endX: hz.endX,
      color: segColor, friction: segFriction,
      label: hz.type === 'rough' ? 'Rough' : hz.type === 'sand' ? 'Sand' : 'Water',
    });
    cursor = hz.endX;
  }

  // Remaining fairway
  if (cursor < fairwayEnd) {
    segments.push({
      type: 'fairway', startX: cursor, endX: fairwayEnd,
      color: '#2d8a2d', friction: 0.87, label: 'Fairway',
    });
  }

  // Fringe
  segments.push({
    type: 'fringe', startX: fairwayEnd, endX: totalWidth - 400,
    color: '#3da03d', friction: 1.05, label: 'Fringe',
  });

  // Green
  segments.push({
    type: 'green', startX: totalWidth - 400, endX: totalWidth,
    color: '#50c050', friction: 1.1, label: 'Green',
  });

  // Flatten water hazards
  for (const hz of hazards) {
    if (hz.type === 'water') {
      const waterMidY = (smoothed[Math.floor(hz.startX)] + smoothed[Math.min(Math.floor(hz.endX), smoothed.length - 1)]) / 2 + 10;
      for (let i = Math.floor(hz.startX); i <= Math.min(Math.floor(hz.endX), smoothed.length - 1); i++) {
        smoothed[i] = waterMidY;
      }
    }
  }

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

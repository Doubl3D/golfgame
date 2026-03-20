export interface Club {
  name: string;
  shortName: string;   // for display in carousel
  maxRange: number;     // max distance in yards at full power
  launchAngle: number;  // typical launch angle in degrees
  maxPower: number;     // velocity multiplier (replaces the old constant 14)
  spinFactor: number;   // how much backspin the club imparts (1 = normal, 0 = none)
  icon: string;         // small emoji/text icon
}

export const CLUBS: Club[] = [
  // Woods — low spin, ball runs out after landing
  { name: 'Driver',     shortName: 'Dr',  maxRange: 250, launchAngle: 25,  maxPower: 30.1, spinFactor: 0.15, icon: '🏌' },
  { name: '3 Wood',     shortName: '3W',  maxRange: 215, launchAngle: 28,  maxPower: 25.6, spinFactor: 0.20, icon: '🏌' },
  { name: '5 Wood',     shortName: '5W',  maxRange: 195, launchAngle: 30,  maxPower: 23.3, spinFactor: 0.25, icon: '🏌' },

  // Long irons — moderate spin, some roll
  { name: '3 Iron',     shortName: '3i',  maxRange: 180, launchAngle: 32,  maxPower: 21.5, spinFactor: 0.35, icon: '⛳' },
  { name: '4 Iron',     shortName: '4i',  maxRange: 170, launchAngle: 34,  maxPower: 20.5, spinFactor: 0.40, icon: '⛳' },
  { name: '5 Iron',     shortName: '5i',  maxRange: 160, launchAngle: 36,  maxPower: 19.4, spinFactor: 0.45, icon: '⛳' },
  { name: '6 Iron',     shortName: '6i',  maxRange: 150, launchAngle: 38,  maxPower: 18.4, spinFactor: 0.50, icon: '⛳' },

  // Short irons — high spin, ball stops quickly
  { name: '7 Iron',     shortName: '7i',  maxRange: 140, launchAngle: 40,  maxPower: 17.4, spinFactor: 0.70, icon: '⛳' },
  { name: '8 Iron',     shortName: '8i',  maxRange: 125, launchAngle: 43,  maxPower: 16,   spinFactor: 0.80, icon: '⛳' },
  { name: '9 Iron',     shortName: '9i',  maxRange: 110, launchAngle: 46,  maxPower: 14.7, spinFactor: 0.90, icon: '⛳' },

  // Wedges — very high spin, ball checks and rolls backward
  { name: 'Pitching Wedge', shortName: 'PW', maxRange: 100, launchAngle: 50, maxPower: 13.9, spinFactor: 1.10, icon: '🔶' },
  { name: 'Sand Wedge',     shortName: 'SW', maxRange: 70,  launchAngle: 56, maxPower: 11.3, spinFactor: 1.40, icon: '🔶' },

  // Putter
  { name: 'Putter',     shortName: 'Pt',  maxRange: 50,  launchAngle: 3,   maxPower: 16,   spinFactor: 0.0, icon: '🏒' },
];

/** Power cap when hitting from sand — woods 25%, irons 50%, wedges 85% */
export function getSandPowerCap(clubIndex: number): number {
  if (clubIndex <= 2) return 0.25;  // Woods (Driver, 3W, 5W)
  if (clubIndex <= 9) return 0.50;  // Irons (3i–9i)
  return 0.85;                       // Wedges (PW, SW)
}

export function getClubIndex(name: string): number {
  return CLUBS.findIndex(c => c.name === name);
}

/** Suggest the best club given remaining yards */
export function suggestClub(yardsToPin: number): number {
  // Find the shortest-range club that can still reach
  for (let i = CLUBS.length - 1; i >= 0; i--) {
    if (CLUBS[i].maxRange >= yardsToPin) {
      return i;
    }
  }
  return 0; // Driver if nothing else reaches
}

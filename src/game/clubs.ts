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
  // Woods
  { name: 'Driver',     shortName: '1W',  maxRange: 250, launchAngle: 25,  maxPower: 30.1, spinFactor: 0.3, icon: '🏌' },
  { name: '3 Wood',     shortName: '3W',  maxRange: 215, launchAngle: 28,  maxPower: 25.6, spinFactor: 0.4, icon: '🏌' },
  { name: '5 Wood',     shortName: '5W',  maxRange: 195, launchAngle: 30,  maxPower: 23.3, spinFactor: 0.5, icon: '🏌' },

  // Irons
  { name: '3 Iron',     shortName: '3i',  maxRange: 180, launchAngle: 32,  maxPower: 21.5, spinFactor: 0.55, icon: '⛳' },
  { name: '4 Iron',     shortName: '4i',  maxRange: 170, launchAngle: 34,  maxPower: 20.5, spinFactor: 0.6,  icon: '⛳' },
  { name: '5 Iron',     shortName: '5i',  maxRange: 160, launchAngle: 36,  maxPower: 19.4, spinFactor: 0.65, icon: '⛳' },
  { name: '6 Iron',     shortName: '6i',  maxRange: 150, launchAngle: 38,  maxPower: 18.4, spinFactor: 0.7,  icon: '⛳' },
  { name: '7 Iron',     shortName: '7i',  maxRange: 140, launchAngle: 40,  maxPower: 17.4, spinFactor: 0.75, icon: '⛳' },
  { name: '8 Iron',     shortName: '8i',  maxRange: 125, launchAngle: 43,  maxPower: 16,   spinFactor: 0.8,  icon: '⛳' },
  { name: '9 Iron',     shortName: '9i',  maxRange: 110, launchAngle: 46,  maxPower: 14.7, spinFactor: 0.85, icon: '⛳' },

  // Wedges
  { name: 'Pitching Wedge', shortName: 'PW', maxRange: 100, launchAngle: 50, maxPower: 13.9, spinFactor: 0.9,  icon: '🔶' },
  { name: 'Sand Wedge',     shortName: 'SW', maxRange: 70,  launchAngle: 56, maxPower: 11.3, spinFactor: 1.0,  icon: '🔶' },

  // Putter
  { name: 'Putter',     shortName: 'PT',  maxRange: 30,  launchAngle: 3,   maxPower: 6,    spinFactor: 0.0, icon: '🏒' },
];

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

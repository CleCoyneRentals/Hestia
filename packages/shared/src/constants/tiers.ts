export const TIER_LIMITS = {
  free: {
    maxHomes: 1,
    maxItems: 50,
    maxTasks: 25,
    canShare: false,
    canAttach: false,
    maxFileMb: 5,
  },
  basic: {
    maxHomes: 3,
    maxItems: 500,
    maxTasks: 200,
    canShare: true,
    canAttach: true,
    maxFileMb: 25,
  },
  premium: {
    maxHomes: -1, // -1 means unlimited
    maxItems: -1,
    maxTasks: -1,
    canShare: true,
    canAttach: true,
    maxFileMb: 100,
  },
} as const;

export type TierName = keyof typeof TIER_LIMITS;

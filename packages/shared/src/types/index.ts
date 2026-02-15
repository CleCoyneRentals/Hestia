// Re-export all types from schemas for convenience.
// Consumers can import types from either '@homeapp/shared' or '@homeapp/shared/types'.

export type { User, CreateUserInput, UpdateUserInput } from '../schemas/user.js';
export type { Home, CreateHomeInput, UpdateHomeInput } from '../schemas/home.js';
export type { Room, CreateRoomInput, UpdateRoomInput } from '../schemas/room.js';
export type { Item, CreateItemInput, UpdateItemInput, ItemQuery } from '../schemas/item.js';
export type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  RecurrenceType,
  TaskStatus,
} from '../schemas/task.js';
export type {
  Subscription,
  SubscriptionTier,
  SubscriptionStatus,
} from '../schemas/subscription.js';
export type { ApiError, ErrorCode } from '../constants/errors.js';
export type { TierName } from '../constants/tiers.js';

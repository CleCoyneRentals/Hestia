import { z } from 'zod';

// ---------- Base schema: a room as returned from the API ----------

export const roomSchema = z.object({
  id: z.string().uuid(),
  homeId: z.string().uuid(),
  name: z.string().min(1).max(200),
  roomType: z.string().max(50).nullable(),
  floor: z.number().int().nullable(),
  notes: z.string().max(2000).nullable(),
  sortOrder: z.number().int().default(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ---------- Request schemas ----------

export const createRoomSchema = z.object({
  homeId: z.string().uuid(),
  name: z.string().min(1, 'Room name is required').max(200),
  roomType: z.string().max(50).optional(),
  floor: z.number().int().optional(),
  notes: z.string().max(2000).optional(),
  sortOrder: z.number().int().default(0),
});

export const updateRoomSchema = createRoomSchema.omit({ homeId: true }).partial();

// ---------- Type exports ----------

export type Room = z.infer<typeof roomSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

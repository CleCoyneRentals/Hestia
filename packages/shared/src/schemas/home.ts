import { z } from 'zod';

// ---------- Base schema: a home as returned from the API ----------

export const homeSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).nullable(),
  homeType: z.enum(['single_family', 'duplex', 'condo', 'townhouse', 'apartment', 'other']).nullable(),
  yearBuilt: z.number().int().min(1600).max(2100).nullable(),
  squareFeet: z.number().int().min(0).nullable(),
  photoUrl: z.string().url().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ---------- Request schemas ----------

export const createHomeSchema = z.object({
  name: z.string().min(1, 'Home name is required').max(200),
  address: z.string().max(500).optional(),
  homeType: z.enum(['single_family', 'duplex', 'condo', 'townhouse', 'apartment', 'other']).optional(),
  yearBuilt: z.number().int().min(1600).max(2100).optional(),
  squareFeet: z.number().int().min(0).optional(),
});

export const updateHomeSchema = createHomeSchema.partial();

// ---------- Type exports ----------

export type Home = z.infer<typeof homeSchema>;
export type CreateHomeInput = z.infer<typeof createHomeSchema>;
export type UpdateHomeInput = z.infer<typeof updateHomeSchema>;

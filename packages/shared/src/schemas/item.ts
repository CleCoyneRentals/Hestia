import { z } from 'zod';

// ---------- Enums ----------

export const itemConditionEnum = z.enum([
  'excellent',
  'good',
  'fair',
  'poor',
]);

// ---------- Base schema: an item as returned from the API ----------

export const itemSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  category: z.string().max(50).nullable(),
  manufacturer: z.string().max(200).nullable(),
  modelNumber: z.string().max(100).nullable(),
  serialNumber: z.string().max(100).nullable(),
  purchaseDate: z.coerce.date().nullable(),
  purchasePrice: z.number().min(0).max(9999999.99).nullable(),
  warrantyUntil: z.coerce.date().nullable(),
  condition: itemConditionEnum.nullable(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ---------- Request schemas ----------

export const createItemSchema = z.object({
  roomId: z.string().uuid(),
  name: z.string().min(1, 'Item name is required').max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  manufacturer: z.string().max(200).optional(),
  modelNumber: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
  purchaseDate: z.coerce.date().optional(),
  purchasePrice: z.number().min(0).max(9999999.99).optional(),
  warrantyUntil: z.coerce.date().optional(),
  condition: itemConditionEnum.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateItemSchema = createItemSchema.omit({ roomId: true }).partial();

// ---------- Query schema ----------

export const itemQuerySchema = z.object({
  roomId: z.string().uuid().optional(),
  category: z.string().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'createdAt', 'purchaseDate', 'category']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

// ---------- Type exports ----------

export type Item = z.infer<typeof itemSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ItemQuery = z.infer<typeof itemQuerySchema>;
export type ItemCondition = z.infer<typeof itemConditionEnum>;

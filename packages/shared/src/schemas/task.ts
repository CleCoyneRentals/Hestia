import { z } from 'zod';

// ---------- Enums ----------

export const recurrenceTypeEnum = z.enum([
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'custom_days',
]);

export const taskStatusEnum = z.enum([
  'pending',
  'in_progress',
  'completed',
  'skipped',
]);

// ---------- Base schema: a task as returned from the API ----------

export const taskSchema = z.object({
  id: z.string().uuid(),
  homeId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  assignedTo: z.string().uuid().nullable(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullable(),
  priority: z.number().int().min(0).max(3).default(0),
  recurrence: recurrenceTypeEnum.default('none'),
  recurrenceInterval: z.number().int().min(1).default(1),
  recurrenceDay: z.number().int().min(0).max(31).nullable(),
  recurrenceEndDate: z.coerce.date().nullable(),
  customDays: z.number().int().min(1).nullable(),
  nextDueDate: z.coerce.date().nullable(),
  notifyDaysBefore: z.number().int().min(0).max(30).default(1),
  notifyDayOf: z.boolean().default(true),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ---------- Request schemas ----------

export const createTaskSchema = z.object({
  homeId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  title: z.string().min(1, 'Task title is required').max(300),
  description: z.string().max(5000).optional(),
  priority: z.number().int().min(0).max(3).default(0),
  recurrence: recurrenceTypeEnum.default('none'),
  recurrenceInterval: z.number().int().min(1).default(1),
  recurrenceDay: z.number().int().min(0).max(31).optional(),
  recurrenceEndDate: z.coerce.date().optional(),
  customDays: z.number().int().min(1).optional(),
  nextDueDate: z.coerce.date().optional(),
  notifyDaysBefore: z.number().int().min(0).max(30).default(1),
  notifyDayOf: z.boolean().default(true),
});

export const updateTaskSchema = createTaskSchema.omit({
  homeId: true,
  itemId: true,
  assignedTo: true,
}).partial();

// ---------- Type exports ----------

export type Task = z.infer<typeof taskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type RecurrenceType = z.infer<typeof recurrenceTypeEnum>;
export type TaskStatus = z.infer<typeof taskStatusEnum>;

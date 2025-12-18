import { z } from 'zod';

export const createEventSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  payload: z.unknown().optional()
});

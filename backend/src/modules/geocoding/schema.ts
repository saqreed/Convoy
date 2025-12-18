import { z } from 'zod';

export const geocodeSearchQuerySchema = z.object({
  q: z.string().min(3),
  limit: z.coerce.number().int().min(1).max(10).optional()
});

export const geocodeReverseQuerySchema = z.object({
  lat: z.coerce.number(),
  lon: z.coerce.number()
});

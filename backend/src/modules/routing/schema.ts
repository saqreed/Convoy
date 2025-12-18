import { z } from 'zod';

export const routingPointSchema = z.object({
  lat: z.number(),
  lon: z.number()
});

export const buildRouteSchema = z.object({
  points: z.array(routingPointSchema).min(2),
  profile: z.enum(['driving', 'foot', 'bike']).optional()
});

import { z } from 'zod';

export const createConvoySchema = z.object({
  title: z.string().min(1),
  startTime: z.string().datetime().optional(),
  route: z.array(z.object({ lat: z.number(), lon: z.number(), name: z.string().optional() })),
  privacy: z.enum(['invite', 'open'])
});

export const joinConvoySchema = z.object({ code: z.string().min(3).optional() });

export const updateConvoySchema = z.object({
  title: z.string().min(1).optional(),
  startTime: z.string().datetime().nullable().optional(),
  route: z.array(z.object({ lat: z.number(), lon: z.number(), name: z.string().optional() })).optional(),
  privacy: z.enum(['invite', 'open']).optional(),
  status: z.string().optional()
});

export const nearbyOpenConvoysQuerySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusKm: z.number().min(1).max(500).default(25),
  limit: z.number().int().min(1).max(20).default(6)
});

export const transferLeaderSchema = z.object({ newLeaderId: z.string().uuid() });

export const addMemberByPhoneSchema = z.object({ phone: z.string().min(10) });

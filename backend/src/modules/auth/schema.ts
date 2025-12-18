import { z } from 'zod';

export const sendOtpSchema = z.object({ phone: z.string().min(10) });
export const verifyOtpSchema = z.object({ sessionId: z.string().uuid(), code: z.string().min(4).max(6) });

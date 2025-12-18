import { z } from 'zod';

export const createPollSchema = z.object({
  question: z.string().min(3),
  options: z.array(z.string().min(1)).min(2).max(10)
});

export const votePollSchema = z.object({
  optionId: z.string().uuid()
});

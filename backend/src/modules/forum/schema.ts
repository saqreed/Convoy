import { z } from 'zod';

export const createForumPostSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(5000)
});

export const updateForumPostSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  body: z.string().trim().min(1).max(5000).optional(),
  pinned: z.boolean().optional()
}).refine((value) => value.title !== undefined || value.body !== undefined || value.pinned !== undefined, {
  message: 'At least one field is required'
});

export const forumPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const createForumCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export const updateForumCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export const forumCommentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db/client';
import { broadcastConvoyEvent } from '../ws/broadcast';
import {
  createForumCommentSchema,
  createForumPostSchema,
  forumCommentsQuerySchema,
  forumPostsQuerySchema,
  updateForumCommentSchema,
  updateForumPostSchema
} from './schema';

function authGuard(req: FastifyRequest) {
  // @ts-ignore
  return (req as any).user?.userId as string | undefined;
}

async function getConvoyAccess(convoyId: string, userId: string) {
  const [convoy, member] = await Promise.all([
    prisma.convoy.findUnique({ where: { id: convoyId }, select: { id: true, leaderId: true } }),
    prisma.convoyMember.findUnique({ where: { convoyId_userId: { convoyId, userId } } })
  ]);

  if (!convoy) return { ok: false as const, code: 'not_found' as const };
  if (!member) return { ok: false as const, code: 'forbidden' as const };
  return { ok: true as const, convoy, member };
}

function serializeUser(user: any) {
  return user
    ? {
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt?.toISOString?.() ?? user.createdAt
      }
    : undefined;
}

function serializeForumComment(comment: any) {
  return {
    id: comment.id,
    postId: comment.postId,
    convoyId: comment.convoyId,
    authorId: comment.authorId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    author: serializeUser(comment.author)
  };
}

function serializeForumPost(post: any) {
  return {
    id: post.id,
    convoyId: post.convoyId,
    authorId: post.authorId,
    title: post.title,
    body: post.body,
    pinned: post.pinned,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    author: serializeUser(post.author),
    comments: Array.isArray(post.comments) ? post.comments.map(serializeForumComment) : [],
    commentCount: post._count?.comments ?? post.commentCount ?? (Array.isArray(post.comments) ? post.comments.length : 0)
  };
}

async function findForumPost(convoyId: string, postId: string) {
  const post = await (prisma as any).forumPost.findUnique({ where: { id: postId } });
  if (!post || post.convoyId !== convoyId) return null;
  return post;
}

function broadcastForum(convoyId: string, data: Record<string, unknown>) {
  broadcastConvoyEvent(convoyId, { success: true, data });
}

export async function registerForumRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
      // @ts-ignore
      (req as any).user = req.user;
    } catch {
      // ignore
    }
  });

  app.get('/convoys/:id/forum-posts', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;

    const access = await getConvoyAccess(convoyId, userId);
    if (!access.ok) {
      if (access.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }

    const query = forumPostsQuerySchema.parse(req.query);
    const posts = await (prisma as any).forumPost.findMany({
      where: { convoyId },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      take: query.limit,
      include: {
        author: true,
        comments: {
          orderBy: { createdAt: 'asc' },
          take: 100,
          include: { author: true }
        },
        _count: { select: { comments: true } }
      }
    });

    return { success: true, data: posts.map(serializeForumPost) };
  });

  app.post('/convoys/:id/forum-posts', {
    config: { rateLimit: { max: 40, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;

    const access = await getConvoyAccess(convoyId, userId);
    if (!access.ok) {
      if (access.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }

    const body = createForumPostSchema.parse(req.body);
    const post = await (prisma as any).forumPost.create({
      data: {
        convoyId,
        authorId: userId,
        title: body.title,
        body: body.body
      },
      include: {
        author: true,
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: true }
        },
        _count: { select: { comments: true } }
      }
    });

    const serialized = serializeForumPost(post);
    broadcastForum(convoyId, { type: 'forum:post_created', convoyId, post: serialized });
    return { success: true, data: serialized };
  });

  app.patch('/convoys/:id/forum-posts/:postId', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const postId = (req.params as any).postId as string;

    const access = await getConvoyAccess(convoyId, userId);
    if (!access.ok) {
      if (access.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }

    const existing = await findForumPost(convoyId, postId);
    if (!existing) return app.httpErrors.notFound();

    const isLeader = access.convoy.leaderId === userId;
    const isAuthor = existing.authorId === userId;
    if (!isLeader && !isAuthor) return app.httpErrors.forbidden();

    const body = updateForumPostSchema.parse(req.body);
    if (body.pinned !== undefined && !isLeader) return app.httpErrors.forbidden('Only convoy leader can pin forum posts');

    const post = await (prisma as any).forumPost.update({
      where: { id: postId },
      data: {
        title: body.title,
        body: body.body,
        pinned: body.pinned
      },
      include: {
        author: true,
        comments: {
          orderBy: { createdAt: 'asc' },
          take: 100,
          include: { author: true }
        },
        _count: { select: { comments: true } }
      }
    });

    const serialized = serializeForumPost(post);
    broadcastForum(convoyId, { type: 'forum:post_updated', convoyId, post: serialized });
    return { success: true, data: serialized };
  });

  app.delete('/convoys/:id/forum-posts/:postId', {
    config: { rateLimit: { max: 40, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const postId = (req.params as any).postId as string;

    const access = await getConvoyAccess(convoyId, userId);
    if (!access.ok) {
      if (access.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }

    const existing = await findForumPost(convoyId, postId);
    if (!existing) return app.httpErrors.notFound();

    const isLeader = access.convoy.leaderId === userId;
    const isAuthor = existing.authorId === userId;
    if (!isLeader && !isAuthor) return app.httpErrors.forbidden();

    await (prisma as any).forumPost.delete({ where: { id: postId } });
    broadcastForum(convoyId, { type: 'forum:post_deleted', convoyId, postId });
    return { success: true, data: { ok: true } };
  });

  app.get('/convoys/:id/forum-posts/:postId/comments', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const postId = (req.params as any).postId as string;

    const access = await getConvoyAccess(convoyId, userId);
    if (!access.ok) {
      if (access.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }
    const post = await findForumPost(convoyId, postId);
    if (!post) return app.httpErrors.notFound();

    const query = forumCommentsQuerySchema.parse(req.query);
    const comments = await (prisma as any).forumComment.findMany({
      where: { convoyId, postId },
      orderBy: { createdAt: 'asc' },
      take: query.limit,
      include: { author: true }
    });

    return { success: true, data: comments.map(serializeForumComment) };
  });

  app.post('/convoys/:id/forum-posts/:postId/comments', {
    config: { rateLimit: { max: 80, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const postId = (req.params as any).postId as string;

    const access = await getConvoyAccess(convoyId, userId);
    if (!access.ok) {
      if (access.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }
    const post = await findForumPost(convoyId, postId);
    if (!post) return app.httpErrors.notFound();

    const body = createForumCommentSchema.parse(req.body);
    const postUpdatedAt = new Date();
    const [comment] = await prisma.$transaction([
      (prisma as any).forumComment.create({
        data: {
          convoyId,
          postId,
          authorId: userId,
          body: body.body
        },
        include: { author: true }
      }),
      (prisma as any).forumPost.update({
        where: { id: postId },
        data: { updatedAt: postUpdatedAt }
      })
    ]);

    const serialized = serializeForumComment(comment);
    broadcastForum(convoyId, {
      type: 'forum:comment_created',
      convoyId,
      postId,
      postUpdatedAt: postUpdatedAt.toISOString(),
      comment: serialized
    });
    return { success: true, data: serialized };
  });

  app.patch('/convoys/:id/forum-posts/:postId/comments/:commentId', {
    config: { rateLimit: { max: 80, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const postId = (req.params as any).postId as string;
    const commentId = (req.params as any).commentId as string;

    const access = await getConvoyAccess(convoyId, userId);
    if (!access.ok) {
      if (access.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }
    const post = await findForumPost(convoyId, postId);
    if (!post) return app.httpErrors.notFound();

    const existing = await (prisma as any).forumComment.findUnique({ where: { id: commentId } });
    if (!existing || existing.convoyId !== convoyId || existing.postId !== postId) return app.httpErrors.notFound();

    const isLeader = access.convoy.leaderId === userId;
    const isAuthor = existing.authorId === userId;
    if (!isLeader && !isAuthor) return app.httpErrors.forbidden();

    const body = updateForumCommentSchema.parse(req.body);
    const postUpdatedAt = new Date();
    const [comment] = await prisma.$transaction([
      (prisma as any).forumComment.update({
        where: { id: commentId },
        data: { body: body.body },
        include: { author: true }
      }),
      (prisma as any).forumPost.update({
        where: { id: postId },
        data: { updatedAt: postUpdatedAt }
      })
    ]);

    const serialized = serializeForumComment(comment);
    broadcastForum(convoyId, {
      type: 'forum:comment_updated',
      convoyId,
      postId,
      postUpdatedAt: postUpdatedAt.toISOString(),
      comment: serialized
    });
    return { success: true, data: serialized };
  });

  app.delete('/convoys/:id/forum-posts/:postId/comments/:commentId', {
    config: { rateLimit: { max: 80, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const postId = (req.params as any).postId as string;
    const commentId = (req.params as any).commentId as string;

    const access = await getConvoyAccess(convoyId, userId);
    if (!access.ok) {
      if (access.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }
    const post = await findForumPost(convoyId, postId);
    if (!post) return app.httpErrors.notFound();

    const existing = await (prisma as any).forumComment.findUnique({ where: { id: commentId } });
    if (!existing || existing.convoyId !== convoyId || existing.postId !== postId) return app.httpErrors.notFound();

    const isLeader = access.convoy.leaderId === userId;
    const isAuthor = existing.authorId === userId;
    if (!isLeader && !isAuthor) return app.httpErrors.forbidden();

    const postUpdatedAt = new Date();
    await prisma.$transaction([
      (prisma as any).forumComment.delete({ where: { id: commentId } }),
      (prisma as any).forumPost.update({
        where: { id: postId },
        data: { updatedAt: postUpdatedAt }
      })
    ]);

    broadcastForum(convoyId, {
      type: 'forum:comment_deleted',
      convoyId,
      postId,
      commentId,
      postUpdatedAt: postUpdatedAt.toISOString()
    });
    return { success: true, data: { ok: true } };
  });
}

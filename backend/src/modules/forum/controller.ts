import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db/client';
import { createForumPostSchema, forumPostsQuerySchema, updateForumPostSchema } from './schema';

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
    author: post.author
      ? {
          id: post.author.id,
          name: post.author.name,
          phone: post.author.phone,
          avatarUrl: post.author.avatarUrl,
          createdAt: post.author.createdAt?.toISOString?.() ?? post.author.createdAt
        }
      : undefined
  };
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
      include: { author: true }
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
      include: { author: true }
    });

    return { success: true, data: serializeForumPost(post) };
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

    const existing = await (prisma as any).forumPost.findUnique({ where: { id: postId } });
    if (!existing || existing.convoyId !== convoyId) return app.httpErrors.notFound();

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
      include: { author: true }
    });

    return { success: true, data: serializeForumPost(post) };
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

    const existing = await (prisma as any).forumPost.findUnique({ where: { id: postId } });
    if (!existing || existing.convoyId !== convoyId) return app.httpErrors.notFound();

    const isLeader = access.convoy.leaderId === userId;
    const isAuthor = existing.authorId === userId;
    if (!isLeader && !isAuthor) return app.httpErrors.forbidden();

    await (prisma as any).forumPost.delete({ where: { id: postId } });
    return { success: true, data: { ok: true } };
  });
}

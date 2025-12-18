import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db/client';
import { createPollSchema, votePollSchema } from './schema';

function authGuard(req: FastifyRequest) {
  // @ts-ignore
  return (req as any).user?.userId as string | undefined;
}

async function requireMember(convoyId: string, userId: string) {
  const member = await prisma.convoyMember.findUnique({ where: { convoyId_userId: { convoyId, userId } } });
  return !!member;
}

async function requireLeader(convoyId: string, userId: string) {
  const convoy = await prisma.convoy.findUnique({ where: { id: convoyId } });
  if (!convoy) return { ok: false as const, code: 'not_found' as const };
  if (convoy.leaderId !== userId) return { ok: false as const, code: 'forbidden' as const };
  return { ok: true as const };
}

export async function registerPollRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
      // @ts-ignore
      (req as any).user = req.user;
    } catch {
      // ignore
    }
  });

  app.get('/convoys/:id/polls', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const isMember = await requireMember(convoyId, userId);
    if (!isMember) return app.httpErrors.forbidden();

    const polls = await (prisma as any).poll.findMany({
      where: { convoyId },
      orderBy: { createdAt: 'desc' },
      include: { options: true, votes: true }
    });

    const data = (polls as any[]).map((p: any) => {
      const counts: Record<string, number> = {};
      for (const v of p.votes as any[]) counts[v.optionId] = (counts[v.optionId] || 0) + 1;
      const myVote = (p.votes as any[]).find((v: any) => v.userId === userId);
      return {
        id: p.id,
        convoyId: p.convoyId,
        createdById: p.createdById,
        question: p.question,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        options: (p.options as any[]).map((o: any) => ({ id: o.id, text: o.text, votes: counts[o.id] || 0 })),
        myVoteOptionId: myVote?.optionId || null
      };
    });

    return { success: true, data };
  });

  app.post('/convoys/:id/polls', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;

    const leader = await requireLeader(convoyId, userId);
    if (!leader.ok) {
      if (leader.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }

    const body = createPollSchema.parse(req.body);

    const poll = await (prisma as any).poll.create({
      data: {
        convoyId,
        createdById: userId,
        question: body.question,
        options: { createMany: { data: body.options.map((t) => ({ text: t })) } }
      },
      include: { options: true, votes: true }
    });

    return {
      success: true,
      data: {
        id: poll.id,
        convoyId: poll.convoyId,
        createdById: poll.createdById,
        question: poll.question,
        status: poll.status,
        createdAt: poll.createdAt.toISOString(),
        options: (poll.options as any[]).map((o: any) => ({ id: o.id, text: o.text, votes: 0 })),
        myVoteOptionId: null
      }
    };
  });

  app.post('/convoys/:id/polls/:pollId/vote', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const pollId = (req.params as any).pollId as string;

    const isMember = await requireMember(convoyId, userId);
    if (!isMember) return app.httpErrors.forbidden();

    const poll = await (prisma as any).poll.findUnique({ where: { id: pollId }, include: { options: true } });
    if (!poll || poll.convoyId !== convoyId) return app.httpErrors.notFound();
    if (poll.status !== 'open') return app.httpErrors.badRequest('Poll is closed');

    const body = votePollSchema.parse(req.body);
    const option = (poll.options as any[]).find((o: any) => o.id === body.optionId);
    if (!option) return app.httpErrors.badRequest('Invalid option');

    await (prisma as any).pollVote.upsert({
      where: { pollId_userId: { pollId, userId } },
      update: { optionId: body.optionId },
      create: { pollId, userId, optionId: body.optionId }
    });

    return { success: true, data: { ok: true } };
  });

  app.post('/convoys/:id/polls/:pollId/close', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const pollId = (req.params as any).pollId as string;

    const leader = await requireLeader(convoyId, userId);
    if (!leader.ok) {
      if (leader.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }

    const poll = await (prisma as any).poll.findUnique({ where: { id: pollId } });
    if (!poll || poll.convoyId !== convoyId) return app.httpErrors.notFound();

    await (prisma as any).poll.update({ where: { id: pollId }, data: { status: 'closed' } });
    return { success: true, data: { ok: true } };
  });
}

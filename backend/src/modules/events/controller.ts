import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db/client';
import { createEventSchema } from './schema';

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

const RANDOM_TITLES = [
  { type: 'random', title: 'Road incident reported ahead' },
  { type: 'random', title: 'Heavy rain starts in 10 minutes' },
  { type: 'random', title: 'Police checkpoint spotted nearby' },
  { type: 'random', title: 'Fuel stop recommended soon' },
  { type: 'random', title: 'Traffic jam on the main road' }
];

export async function registerEventRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
      // @ts-ignore
      (req as any).user = req.user;
    } catch {
      // ignore
    }
  });

  app.get('/convoys/:id/events', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const isMember = await requireMember(convoyId, userId);
    if (!isMember) return app.httpErrors.forbidden();

    const events = await (prisma as any).convoyEvent.findMany({ where: { convoyId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const data = (events as any[]).map((e: any) => ({
      id: e.id,
      convoyId: e.convoyId,
      createdById: e.createdById,
      type: e.type,
      title: e.title,
      payload: e.payload,
      createdAt: e.createdAt.toISOString()
    }));
    return { success: true, data };
  });

  app.post('/convoys/:id/events', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;

    const leader = await requireLeader(convoyId, userId);
    if (!leader.ok) {
      if (leader.code === 'not_found') return app.httpErrors.notFound();
      return app.httpErrors.forbidden();
    }

    const body = createEventSchema.parse(req.body);
    const event = await (prisma as any).convoyEvent.create({
      data: {
        convoyId,
        createdById: userId,
        type: body.type,
        title: body.title,
        payload: body.payload
      }
    });

    return {
      success: true,
      data: {
        id: event.id,
        convoyId: event.convoyId,
        createdById: event.createdById,
        type: event.type,
        title: event.title,
        payload: event.payload,
        createdAt: event.createdAt.toISOString()
      }
    };
  });

  app.post('/convoys/:id/events/random', {
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

    const pick = RANDOM_TITLES[Math.floor(Math.random() * RANDOM_TITLES.length)];
    const event = await (prisma as any).convoyEvent.create({
      data: {
        convoyId,
        createdById: userId,
        type: pick.type,
        title: pick.title
      }
    });

    return {
      success: true,
      data: {
        id: event.id,
        convoyId: event.convoyId,
        createdById: event.createdById,
        type: event.type,
        title: event.title,
        payload: event.payload,
        createdAt: event.createdAt.toISOString()
      }
    };
  });
}

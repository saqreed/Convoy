import type { FastifyInstance, FastifyRequest } from 'fastify';
import { addMemberByPhoneSchema, createConvoySchema, joinConvoySchema, transferLeaderSchema, updateConvoySchema } from './schema';
import { ConvoyService } from './service';
import { prisma } from '../../db/client';

const service = new ConvoyService();

function authGuard(req: FastifyRequest) {
  // @ts-ignore
  return (req as any).user?.userId as string | undefined;
}

export async function registerConvoyRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
      // @ts-ignore
      (req as any).user = req.user;
    } catch {
      // ignore for public endpoints
    }
  });

  app.post('/convoys', {
    schema: {
      body: { $ref: 'ConvoyCreateBody#' },
      response: { 200: { $ref: 'SuccessEnvelopeConvoyWithInvite#' } }
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const body = createConvoySchema.parse(req.body);
    const res = await service.createConvoy(userId, body);
    return { success: true, data: res };
  });

  app.post('/convoys/:id/join', {
    schema: {
      params: { $ref: 'IdParams#' },
      body: { $ref: 'ConvoyJoinBody#' },
      response: { 200: { $ref: 'SuccessEnvelopeOk#' } }
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const body = joinConvoySchema.parse(req.body);
    const convoyId = (req.params as any).id as string;
    try {
      const res = await service.joinConvoyByCode(convoyId, userId, body.code);
      return { success: true, data: res };
    } catch (e: any) {
      return app.httpErrors.badRequest(e?.message || 'join failed');
    }
  });

  app.get('/convoys', {
    schema: { response: { 200: { $ref: 'SuccessEnvelopeConvoyList#' } } },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const list = await prisma.convoy.findMany({ where: { members: { some: { userId } } }, orderBy: { createdAt: 'desc' } });
    return { success: true, data: list };
  });

  app.get('/convoys/:id', {
    schema: { params: { $ref: 'IdParams#' }, response: { 200: { $ref: 'SuccessEnvelopeConvoyDetail#' } } },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const id = (req.params as any).id as string;
    const convoy = await prisma.convoy.findUnique({ where: { id }, include: { members: { include: { user: true } }, invites: true } });
    if (!convoy) return app.httpErrors.notFound();
    const isMember = await prisma.convoyMember.findUnique({ where: { convoyId_userId: { convoyId: id, userId } } });
    if (!isMember) return app.httpErrors.forbidden();
    return { success: true, data: convoy };
  });

  app.get('/convoys/:id/pings', {
    schema: {
      params: { $ref: 'IdParams#' },
      querystring: { $ref: 'PingsQuery#' },
      response: { 200: { $ref: 'SuccessEnvelopeLocationPingList#' } }
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;

    const isMember = await prisma.convoyMember.findUnique({ where: { convoyId_userId: { convoyId, userId } } });
    if (!isMember) return app.httpErrors.forbidden();

    const q = (req.query || {}) as { limit?: number; userId?: string; since?: string };
    const limit = Math.max(1, Math.min(Number(q.limit || 200), 500));
    const filterUserId = q.userId;
    const since = q.since ? new Date(q.since) : undefined;

    const pings = await prisma.locationPing.findMany({
      where: {
        convoyId,
        ...(filterUserId ? { userId: filterUserId } : {}),
        ...(since ? { ts: { gte: since } } : {})
      },
      orderBy: { ts: 'desc' },
      take: limit
    });

    return { success: true, data: pings };
  });

  app.get('/convoys/:id/tracks', {
    schema: {
      params: { $ref: 'IdParams#' },
      querystring: { $ref: 'TracksQuery#' },
      response: { 200: { $ref: 'SuccessEnvelopeTrackList#' } }
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;

    const isMember = await prisma.convoyMember.findUnique({ where: { convoyId_userId: { convoyId, userId } } });
    if (!isMember) return app.httpErrors.forbidden();

    const q = (req.query || {}) as { limit?: number; userId?: string; since?: string; until?: string };
    const limit = Math.max(1, Math.min(Number(q.limit || 2000), 5000));
    const filterUserId = q.userId;
    const since = q.since ? new Date(q.since) : undefined;
    const until = q.until ? new Date(q.until) : undefined;

    const points = await prisma.locationPing.findMany({
      where: {
        convoyId,
        ...(filterUserId ? { userId: filterUserId } : {}),
        ...((since || until)
          ? {
              ts: {
                ...(since ? { gte: since } : {}),
                ...(until ? { lte: until } : {})
              }
            }
          : {})
      },
      orderBy: { ts: 'asc' },
      take: limit
    });

    const byUser = new Map<string, typeof points>();
    for (const p of points) {
      const arr = byUser.get(p.userId);
      if (arr) arr.push(p);
      else byUser.set(p.userId, [p]);
    }

    const tracks = Array.from(byUser.entries()).map(([uid, pts]) => ({
      userId: uid,
      points: pts.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        speed: p.speed ?? null,
        heading: p.heading ?? null,
        accuracy: p.accuracy ?? null,
        battery: p.battery ?? null,
        ts: p.ts.toISOString()
      }))
    }));

    return { success: true, data: tracks };
  });

  app.patch('/convoys/:id', {
    schema: {
      params: { $ref: 'IdParams#' },
      body: { $ref: 'ConvoyUpdateBody#' },
      response: { 200: { $ref: 'SuccessEnvelopeConvoy#' } }
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const id = (req.params as any).id as string;
    const body = updateConvoySchema.parse(req.body);
    const convoy = await prisma.convoy.findUnique({ where: { id } });
    if (!convoy) return app.httpErrors.notFound();
    if (convoy.leaderId !== userId) return app.httpErrors.forbidden();
    const updated = await (prisma as any).convoy.update({
      where: { id },
      data: {
        title: body.title,
        startTime: body.startTime === undefined ? undefined : body.startTime ? new Date(body.startTime) : null,
        route: body.route,
        privacy: body.privacy,
        status: body.status
      }
    });
    return { success: true, data: updated };
  });

  app.post('/convoys/:id/members/add-by-phone', {
    schema: {
      params: { $ref: 'IdParams#' },
      response: { 200: { $ref: 'SuccessEnvelopeOk#' } }
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const body = addMemberByPhoneSchema.parse(req.body);

    const convoy = await prisma.convoy.findUnique({ where: { id: convoyId } });
    if (!convoy) return app.httpErrors.notFound();
    if (convoy.leaderId !== userId) return app.httpErrors.forbidden();

    const target = await prisma.user.findFirst({ where: { phone: body.phone } });
    if (!target) return app.httpErrors.badRequest('User not found');

    await prisma.convoyMember.upsert({
      where: { convoyId_userId: { convoyId, userId: target.id } },
      update: {},
      create: { convoyId, userId: target.id, role: 'member' }
    });

    return { success: true, data: { ok: true } };
  });

  app.delete('/convoys/:id/members/:userId', {
    schema: {
      params: {
        type: 'object',
        required: ['id', 'userId'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' }
        },
        additionalProperties: false
      },
      response: { 200: { $ref: 'SuccessEnvelopeOk#' } }
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const actorId = authGuard(req);
    if (!actorId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const targetUserId = (req.params as any).userId as string;

    const convoy = await prisma.convoy.findUnique({ where: { id: convoyId } });
    if (!convoy) return app.httpErrors.notFound();
    if (convoy.leaderId !== actorId) return app.httpErrors.forbidden();
    if (targetUserId === convoy.leaderId) return app.httpErrors.badRequest('Cannot remove leader');

    await prisma.convoyMember.deleteMany({ where: { convoyId, userId: targetUserId } });
    return { success: true, data: { ok: true } };
  });

  app.post('/convoys/:id/transfer-leader', {
    schema: {
      params: { $ref: 'IdParams#' },
      response: { 200: { $ref: 'SuccessEnvelopeOk#' } }
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const convoyId = (req.params as any).id as string;
    const body = transferLeaderSchema.parse(req.body);

    const convoy = await prisma.convoy.findUnique({ where: { id: convoyId } });
    if (!convoy) return app.httpErrors.notFound();
    if (convoy.leaderId !== userId) return app.httpErrors.forbidden();

    const newLeaderMember = await prisma.convoyMember.findUnique({
      where: { convoyId_userId: { convoyId, userId: body.newLeaderId } }
    });
    if (!newLeaderMember) return app.httpErrors.badRequest('Target user is not a convoy member');

    await prisma.$transaction([
      prisma.convoy.update({
        where: { id: convoyId },
        data: { leaderId: body.newLeaderId }
      }),
      prisma.convoyMember.update({
        where: { convoyId_userId: { convoyId, userId } },
        data: { role: 'member' }
      }),
      prisma.convoyMember.update({
        where: { convoyId_userId: { convoyId, userId: body.newLeaderId } },
        data: { role: 'leader' }
      })
    ]);

    return { success: true, data: { ok: true } };
  });

  app.delete('/convoys/:id', {
    schema: { params: { $ref: 'IdParams#' }, response: { 200: { $ref: 'SuccessEnvelopeOk#' } } },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const id = (req.params as any).id as string;
    const convoy = await prisma.convoy.findUnique({ where: { id } });
    if (!convoy) return app.httpErrors.notFound();
    if (convoy.leaderId !== userId) return app.httpErrors.forbidden();
    await prisma.invite.deleteMany({ where: { convoyId: id } });
    await prisma.convoyMember.deleteMany({ where: { convoyId: id } });
    await prisma.convoy.delete({ where: { id } });
    return { success: true, data: { ok: true } };
  });
}

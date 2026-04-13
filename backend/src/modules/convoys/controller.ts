import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addMemberByPhoneSchema,
  createConvoySchema,
  joinConvoySchema,
  nearbyOpenConvoysQuerySchema,
  transferLeaderSchema,
  updateConvoySchema
} from './schema';
import { ConvoyService } from './service';
import { prisma } from '../../db/client';
import {
  buildRouteMetadata,
  distanceKm,
  geoBoundingBoxes,
  readRoutePoints,
  routeLengthKm,
  type RoutePoint
} from './routeMetadata';

const service = new ConvoyService();

function authGuard(req: FastifyRequest) {
  // @ts-ignore
  return (req as any).user?.userId as string | undefined;
}

function readLastPingPoint(lastPing: unknown): RoutePoint | null {
  if (!lastPing || typeof lastPing !== 'object') return null;
  const point = lastPing as Record<string, unknown>;
  if (typeof point.lat !== 'number' || typeof point.lon !== 'number') return null;
  return { lat: point.lat, lon: point.lon };
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
      const res = await service.joinConvoy(convoyId, userId, body.code);
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

  app.get('/convoys/open/nearby', {
    schema: {
      querystring: { $ref: 'NearbyOpenConvoysQuery#' },
      response: { 200: { $ref: 'SuccessEnvelopeNearbyOpenConvoyList#' } }
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();

    const query = nearbyOpenConvoysQuerySchema.parse(req.query);
    const origin: RoutePoint = { lat: query.lat, lon: query.lon };
    const archivedStatuses = ['completed', 'cancelled', 'archived'];
    const geoBoxes = geoBoundingBoxes(origin, query.radiusKm);
    const geoPrefilter = geoBoxes.flatMap((box) => [
      {
        routeMinLat: { lte: box.maxLat },
        routeMaxLat: { gte: box.minLat },
        routeMinLon: { lte: box.maxLon },
        routeMaxLon: { gte: box.minLon }
      },
      {
        leaderLastPingLat: { gte: box.minLat, lte: box.maxLat },
        leaderLastPingLon: { gte: box.minLon, lte: box.maxLon }
      }
    ]);

    const convoys = await prisma.convoy.findMany({
      where: {
        privacy: 'open',
        status: query.status ? { equals: query.status, notIn: archivedStatuses } : { notIn: archivedStatuses },
        members: { none: { userId } },
        OR: geoPrefilter,
        ...(query.startAfter || query.startBefore
          ? {
              startTime: {
                ...(query.startAfter ? { gte: new Date(query.startAfter) } : {}),
                ...(query.startBefore ? { lte: new Date(query.startBefore) } : {})
              }
            }
          : {}),
        ...(typeof query.minRouteKm === 'number' || typeof query.maxRouteKm === 'number'
          ? {
              routeLengthKm: {
                ...(typeof query.minRouteKm === 'number' ? { gte: query.minRouteKm } : {}),
                ...(typeof query.maxRouteKm === 'number' ? { lte: query.maxRouteKm } : {})
              }
            }
          : {})
      },
      include: {
        members: {
          select: {
            userId: true,
            lastPing: true
          }
        }
      }
    });

    const nearby = convoys
      .map((convoy) => {
        const route = readRoutePoints(convoy.route);
        const totalRouteLengthKm = routeLengthKm(route);
        const leaderMember = convoy.members.find((member) => member.userId === convoy.leaderId);
        const leaderLastPing = readLastPingPoint(leaderMember?.lastPing);
        const anchors = leaderLastPing ? [leaderLastPing, ...route] : route;

        let closestPoint: RoutePoint | null = null;
        let closestDistanceKm = Number.POSITIVE_INFINITY;

        for (const point of anchors) {
          const candidateDistanceKm = distanceKm(origin, point);
          if (candidateDistanceKm < closestDistanceKm) {
            closestDistanceKm = candidateDistanceKm;
            closestPoint = point;
          }
        }

        if (!closestPoint || closestDistanceKm > query.radiusKm) return null;

        return {
          id: convoy.id,
          title: convoy.title,
          leaderId: convoy.leaderId,
          status: convoy.status,
          privacy: 'open' as const,
          startTime: convoy.startTime,
          createdAt: convoy.createdAt,
          memberCount: convoy.members.length,
          routePointCount: route.length,
          routeLengthKm: totalRouteLengthKm,
          startPoint: route[0] ?? null,
          endPoint: route.length > 0 ? route[route.length - 1] : null,
          closestPoint,
          proximitySource: leaderLastPing && closestPoint === leaderLastPing ? 'leader-last-ping' : 'route-point',
          distanceKm: Math.round(closestDistanceKm * 10) / 10
        };
      })
      .filter((convoy): convoy is NonNullable<typeof convoy> => convoy !== null)
      .sort((left, right) => left.distanceKm - right.distanceKm)
      .slice(0, query.limit);

    return { success: true, data: nearby };
  });

  app.get('/convoys/:id/preview', {
    schema: {
      params: { $ref: 'IdParams#' },
      response: { 200: { $ref: 'SuccessEnvelopeConvoyPublicPreview#' } }
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();

    const convoyId = (req.params as any).id as string;
    const convoy = await prisma.convoy.findUnique({
      where: { id: convoyId },
      include: {
        leader: true,
        members: {
          select: {
            userId: true
          }
        }
      }
    });
    if (!convoy) return app.httpErrors.notFound();

    const isMember = convoy.members.some((member) => member.userId === userId);
    if (convoy.privacy !== 'open' && !isMember) return app.httpErrors.forbidden();

    const route = readRoutePoints(convoy.route);
    const preview = {
      id: convoy.id,
      title: convoy.title,
      leaderId: convoy.leaderId,
      status: convoy.status,
      privacy: convoy.privacy,
      startTime: convoy.startTime,
      createdAt: convoy.createdAt,
      leader: convoy.leader,
      memberCount: convoy.members.length,
      routePointCount: route.length,
      routeLengthKm: routeLengthKm(route),
      route,
      startPoint: route[0] ?? null,
      endPoint: route.length > 0 ? route[route.length - 1] : null,
      inviteRequired: convoy.privacy !== 'open',
      alreadyJoined: isMember
    };

    return { success: true, data: preview };
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
        status: body.status,
        ...(body.route === undefined ? {} : buildRouteMetadata(body.route))
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

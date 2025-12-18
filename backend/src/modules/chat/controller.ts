import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db/client';

function authGuard(req: FastifyRequest) {
  // @ts-ignore
  return (req as any).user?.userId as string | undefined;
}

export async function registerChatRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
      // @ts-ignore
      (req as any).user = req.user;
    } catch {
      // ignore for public endpoints
    }
  });

  app.get('/convoys/:id/messages', {
    schema: {
      params: { $ref: 'IdParams#' },
      querystring: { $ref: 'ChatMessagesQuery#' },
      response: { 200: { $ref: 'SuccessEnvelopeChatMessageList#' } }
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();

    const convoyId = (req.params as any).id as string;
    const isMember = await prisma.convoyMember.findUnique({ where: { convoyId_userId: { convoyId, userId } } });
    if (!isMember) return app.httpErrors.forbidden();

    const q = (req.query || {}) as { since?: string; limit?: number };
    const since = q.since ? new Date(q.since) : undefined;
    const limit = typeof q.limit === 'number' ? q.limit : undefined;

    const take = Math.max(1, Math.min(Number(limit ?? 50), 200));
    const rows = await prisma.chatMessage.findMany({
      where: {
        convoyId,
        ...(since ? { createdAt: { gte: since } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take
    });
    rows.reverse();
    const list = rows.map((m) => ({
      id: m.id,
      convoyId: m.convoyId,
      userId: m.userId,
      text: m.text,
      createdAt: m.createdAt.toISOString()
    }));
    return { success: true, data: list };
  });
}

// placeholder for users controller
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db/client';

function authGuard(req: FastifyRequest) {
  // @ts-ignore
  return (req as any).user?.userId as string | undefined;
}

export async function registerUserRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
      // @ts-ignore
      (req as any).user = req.user;
    } catch {
      // ignore for public endpoints
    }
  });

  app.get('/me', {
    schema: {
      response: { 200: { $ref: 'SuccessEnvelopeUser#' } }
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return app.httpErrors.notFound();
    return { success: true, data: user };
  });

  app.patch('/me', {
    schema: {
      body: { $ref: 'UserUpdateBody#' },
      response: { 200: { $ref: 'SuccessEnvelopeUser#' } }
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();
    const body = (req.body || {}) as { name?: string; avatarUrl?: string | null };
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {})
      }
    });
    return { success: true, data: updated };
  });
}

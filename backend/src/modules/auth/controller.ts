import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendOtpSchema, verifyOtpSchema } from './schema';
import { AuthService } from './service';

const service = new AuthService();

export async function registerAuthRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.post('/auth/send-otp', {
    schema: {
      body: { $ref: 'AuthSendOtpBody#' },
      response: { 200: { $ref: 'SuccessEnvelopeSession#' } }
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const body = sendOtpSchema.parse(req.body);
    const res = await service.sendOtp(body.phone);
    return { success: true, data: res };
  });

  app.post('/auth/verify-otp', {
    schema: {
      body: { $ref: 'AuthVerifyOtpBody#' },
      response: { 200: { $ref: 'SuccessEnvelopeToken#' } }
    },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const body = verifyOtpSchema.parse(req.body);
    try {
      const { userId } = await service.verifyOtp(body.sessionId, body.code);
      const token = app.jwt.sign({ userId });
      return { success: true, data: { token } };
    } catch (e: any) {
      return app.httpErrors.badRequest(e?.message || 'Invalid code');
    }
  });
}

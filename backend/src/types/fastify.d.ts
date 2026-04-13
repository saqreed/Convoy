import type { JwtPayload } from 'jsonwebtoken';

declare module 'fastify' {
  interface FastifyInstance {
    jwt: {
      sign(payload: string | Buffer | object): string;
    };
  }

  interface FastifyRequest {
    jwtVerify(): Promise<string | JwtPayload>;
    user?: string | JwtPayload;
  }
}

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyJwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import pino from 'pino';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerChatRoutes } from './modules/chat/routes';
import { registerConvoyRoutes } from './modules/convoys/controller';
import { registerEventRoutes } from './modules/events/routes';
import { registerGeocodingRoutes } from './modules/geocoding/routes';
import { registerPollRoutes } from './modules/polls/routes';
import { registerRoutingRoutes } from './modules/routing/routes';
import { registerUserRoutes } from './modules/users/routes';
import { createWsGateway } from './modules/ws/gateway';
import { JWT_SECRET, PORT } from './config';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

async function buildServer() {
  const app = Fastify({ logger });

  await app.register(rateLimit, { max: 20, timeWindow: '1 minute' });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(sensible);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      // Allow localhost and 127.0.0.1 on any port for dev
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      cb(new Error('Not allowed'), false);
    },
    credentials: true
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Convoy API', version: '0.1.0' },
      servers: [{ url: 'http://localhost:' + PORT }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      },
      security: [{ bearerAuth: [] }]
    }
  });
  await app.register(swaggerUI, { routePrefix: '/docs' });

  // Ajv validator compiler with coercion for query strings
  const sharedAjv = new Ajv({ removeAdditional: false, useDefaults: true, coerceTypes: true, allErrors: true });
  addFormats(sharedAjv);
  app.setValidatorCompiler(({ schema }) => sharedAjv.compile(schema as any));

  const addSharedSchema = (schema: Parameters<typeof app.addSchema>[0]) => {
    app.addSchema(schema);
    sharedAjv.addSchema(schema as any);
  };

  // Common component schemas ($id/$ref)
  addSharedSchema({
    $id: 'LocationPoint',
    type: 'object',
    required: ['lat', 'lon'],
    properties: { lat: { type: 'number' }, lon: { type: 'number' }, name: { type: 'string' } },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'Convoy',
    type: 'object',
    required: ['id', 'title', 'leaderId', 'status', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      leaderId: { type: 'string', format: 'uuid' },
      startTime: { type: ['string', 'null'], format: 'date-time' },
      status: { type: 'string' },
      privacy: { type: 'string', enum: ['invite', 'open'] },
      route: { type: 'array', items: { $ref: 'LocationPoint#' } },
      createdAt: { type: 'string', format: 'date-time' }
    },
    additionalProperties: true
  });

  addSharedSchema({
    $id: 'User',
    type: 'object',
    required: ['id', 'name', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      phone: { type: ['string', 'null'] },
      email: { type: ['string', 'null'] },
      avatarUrl: { type: ['string', 'null'] },
      createdAt: { type: 'string', format: 'date-time' }
    },
    additionalProperties: true
  });

  addSharedSchema({
    $id: 'Invite',
    type: 'object',
    required: ['id', 'convoyId', 'code', 'expiresAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      convoyId: { type: 'string', format: 'uuid' },
      code: { type: 'string' },
      expiresAt: { type: 'string', format: 'date-time' }
    },
    additionalProperties: true
  });

  addSharedSchema({
    $id: 'ConvoyMember',
    type: 'object',
    required: ['convoyId', 'userId', 'role', 'joinedAt', 'user'],
    properties: {
      convoyId: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      role: { type: 'string' },
      lastPing: { type: ['object', 'null'] },
      joinedAt: { type: 'string', format: 'date-time' },
      user: { $ref: 'User#' }
    },
    additionalProperties: true
  });

  addSharedSchema({
    $id: 'ConvoyDetail',
    type: 'object',
    allOf: [
      { $ref: 'Convoy#' },
      {
        type: 'object',
        properties: {
          invites: { type: 'array', items: { $ref: 'Invite#' } },
          members: { type: 'array', items: { $ref: 'ConvoyMember#' } }
        }
      }
    ]
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeConvoy',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { $ref: 'Convoy#' } }
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeConvoyDetail',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { $ref: 'ConvoyDetail#' } }
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeConvoyList',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { type: 'array', items: { $ref: 'Convoy#' } } }
  });
  addSharedSchema({
    $id: 'ConvoyWithInvite',
    type: 'object',
    allOf: [ { $ref: 'Convoy#' }, { type: 'object', properties: { inviteCode: { type: 'string' } } } ]
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeConvoyWithInvite',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { $ref: 'ConvoyWithInvite#' } }
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeOk',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } }
  });

  // Auth schemas
  addSharedSchema({
    $id: 'AuthSendOtpBody',
    type: 'object',
    required: ['phone'],
    properties: { phone: { type: 'string', pattern: '^\\+?[0-9]{10,15}$' } },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeSession',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string', format: 'uuid' } } } }
  });
  addSharedSchema({
    $id: 'AuthVerifyOtpBody',
    type: 'object',
    required: ['sessionId', 'code'],
    properties: { sessionId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^[0-9]{4,6}$' } },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeToken',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } } }
  });

  // User profile
  addSharedSchema({
    $id: 'UserUpdateBody',
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      avatarUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeUser',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { $ref: 'User#' } }
  });

  // Chat (in-memory)
  addSharedSchema({
    $id: 'ChatMessage',
    type: 'object',
    required: ['id', 'convoyId', 'userId', 'text', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      convoyId: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      text: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'ChatMessagesQuery',
    type: 'object',
    properties: {
      since: { type: 'string', format: 'date-time' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeChatMessageList',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { type: 'array', items: { $ref: 'ChatMessage#' } } }
  });

  // Convoy request schemas
  addSharedSchema({
    $id: 'ConvoyCreateBody',
    type: 'object',
    required: ['title', 'route', 'privacy'],
    properties: {
      title: { type: 'string', minLength: 1 },
      startTime: { type: 'string', format: 'date-time' },
      route: { type: 'array', items: { $ref: 'LocationPoint#' }, minItems: 1 },
      privacy: { type: 'string', enum: ['invite', 'open'] }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'IdParams',
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'ConvoyJoinBody',
    type: 'object',
    properties: { code: { type: 'string', minLength: 3 } },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'ConvoyUpdateBody',
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1 },
      startTime: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
      route: { type: 'array', items: { $ref: 'LocationPoint#' } },
      privacy: { type: 'string', enum: ['invite', 'open'] },
      status: { type: 'string' }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'NearbyOpenConvoysQuery',
    type: 'object',
    required: ['lat', 'lon'],
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lon: { type: 'number', minimum: -180, maximum: 180 },
      radiusKm: { type: 'number', minimum: 1, maximum: 500, default: 25 },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 6 },
      status: { type: 'string', minLength: 1 },
      startAfter: { type: 'string', format: 'date-time' },
      startBefore: { type: 'string', format: 'date-time' },
      minRouteKm: { type: 'number', minimum: 0, maximum: 10000 },
      maxRouteKm: { type: 'number', minimum: 0, maximum: 10000 }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'NearbyOpenConvoy',
    type: 'object',
    required: [
      'id',
      'title',
      'leaderId',
      'status',
      'privacy',
      'createdAt',
      'memberCount',
      'routePointCount',
      'routeLengthKm',
      'distanceKm',
      'closestPoint',
      'proximitySource'
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      leaderId: { type: 'string', format: 'uuid' },
      status: { type: 'string' },
      privacy: { type: 'string', enum: ['open'] },
      startTime: { type: ['string', 'null'], format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      memberCount: { type: 'integer', minimum: 0 },
      routePointCount: { type: 'integer', minimum: 0 },
      routeLengthKm: { type: 'number', minimum: 0 },
      distanceKm: { type: 'number', minimum: 0 },
      startPoint: { anyOf: [{ $ref: 'LocationPoint#' }, { type: 'null' }] },
      endPoint: { anyOf: [{ $ref: 'LocationPoint#' }, { type: 'null' }] },
      closestPoint: { $ref: 'LocationPoint#' },
      proximitySource: { type: 'string', enum: ['leader-last-ping', 'route-point'] }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeNearbyOpenConvoyList',
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', const: true },
      data: { type: 'array', items: { $ref: 'NearbyOpenConvoy#' } }
    }
  });
  addSharedSchema({
    $id: 'ConvoyPublicPreview',
    type: 'object',
    required: [
      'id',
      'title',
      'leaderId',
      'status',
      'privacy',
      'createdAt',
      'leader',
      'memberCount',
      'routePointCount',
      'routeLengthKm',
      'route',
      'inviteRequired',
      'alreadyJoined'
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      leaderId: { type: 'string', format: 'uuid' },
      status: { type: 'string' },
      privacy: { type: 'string', enum: ['invite', 'open'] },
      startTime: { type: ['string', 'null'], format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      leader: { $ref: 'User#' },
      memberCount: { type: 'integer', minimum: 0 },
      routePointCount: { type: 'integer', minimum: 0 },
      routeLengthKm: { type: 'number', minimum: 0 },
      route: { type: 'array', items: { $ref: 'LocationPoint#' } },
      startPoint: { anyOf: [{ $ref: 'LocationPoint#' }, { type: 'null' }] },
      endPoint: { anyOf: [{ $ref: 'LocationPoint#' }, { type: 'null' }] },
      inviteRequired: { type: 'boolean' },
      alreadyJoined: { type: 'boolean' }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeConvoyPublicPreview',
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', const: true },
      data: { $ref: 'ConvoyPublicPreview#' }
    }
  });

  // Pings history
  addSharedSchema({
    $id: 'PingsQuery',
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
      userId: { type: 'string', format: 'uuid' },
      since: { type: 'string', format: 'date-time' }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'LocationPing',
    type: 'object',
    required: ['id', 'userId', 'convoyId', 'lat', 'lon', 'ts'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      convoyId: { type: 'string', format: 'uuid' },
      lat: { type: 'number' },
      lon: { type: 'number' },
      speed: { type: ['number', 'null'] },
      heading: { type: ['number', 'null'] },
      accuracy: { type: ['number', 'null'] },
      battery: { type: ['number', 'null'] },
      ts: { type: 'string', format: 'date-time' }
    },
    additionalProperties: true
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeLocationPingList',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { type: 'array', items: { $ref: 'LocationPing#' } } }
  });

  // Tracks history
  addSharedSchema({
    $id: 'TracksQuery',
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 5000, default: 2000 },
      userId: { type: 'string', format: 'uuid' },
      since: { type: 'string', format: 'date-time' },
      until: { type: 'string', format: 'date-time' }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'TrackPoint',
    type: 'object',
    required: ['lat', 'lon', 'ts'],
    properties: {
      lat: { type: 'number' },
      lon: { type: 'number' },
      speed: { type: ['number', 'null'] },
      heading: { type: ['number', 'null'] },
      accuracy: { type: ['number', 'null'] },
      battery: { type: ['number', 'null'] },
      ts: { type: 'string', format: 'date-time' }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'Track',
    type: 'object',
    required: ['userId', 'points'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      points: { type: 'array', items: { $ref: 'TrackPoint#' } }
    },
    additionalProperties: false
  });
  addSharedSchema({
    $id: 'SuccessEnvelopeTrackList',
    type: 'object',
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data: { type: 'array', items: { $ref: 'Track#' } } }
  });

  app.get('/health', async () => ({ success: true, data: { status: 'ok' } }));

  await registerAuthRoutes(app);
  await registerChatRoutes(app);
  await registerUserRoutes(app);
  await registerConvoyRoutes(app);
  await registerPollRoutes(app);
  await registerEventRoutes(app);
  await registerGeocodingRoutes(app);
  await registerRoutingRoutes(app);

  const server = app.server;
  createWsGateway(server);

  // Correlation ID: propagate x-correlation-id and log
  app.addHook('onRequest', (req, reply, done) => {
    const cid = (req.headers['x-correlation-id'] as string) || req.id;
    // @ts-ignore
    (req as any).cid = cid;
    reply.header('x-correlation-id', cid);
    done();
  });
  app.addHook('onResponse', (req, reply, done) => {
    // @ts-ignore
    const cid = (req as any).cid || req.id;
    const duration = reply.getResponseTime();
    (app.log || logger).info({ cid, method: req.method, url: req.url, statusCode: reply.statusCode, duration }, 'http_request');
    done();
  });

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as any).statusCode || 500;
    const code = (err as any).code || 'INTERNAL_ERROR';
    const message = err.message || 'Internal Server Error';
    reply.status(status).send({ success: false, error: { code, message } });
  });

  return app;
}

buildServer()
  .then((app) => app.listen({ port: PORT, host: '0.0.0.0' }))
  .catch((err) => {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  });

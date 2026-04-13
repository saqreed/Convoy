import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, WS_TTL_SECONDS, WS_MIN_PING_INTERVAL_MS } from '../../config';
import { createAuthHandler } from './handlers/authHandler';
import { createChatHandler } from './handlers/chatHandler';
import { createConvoyHandler } from './handlers/convoyHandler';
import { createPingHandler } from './handlers/pingHandler';
import { setConvoyBroadcast } from './broadcast';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

type WsWithMeta = import('ws').WebSocket & { userId?: string; convoys?: Set<string>; cid?: string };

export function createWsGateway(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

  const rooms = new Map<string, Set<WsWithMeta>>();

  function addToRoom(convoyId: string, ws: WsWithMeta) {
    if (!rooms.has(convoyId)) rooms.set(convoyId, new Set());
    rooms.get(convoyId)!.add(ws);
    ws.convoys = ws.convoys || new Set();
    ws.convoys.add(convoyId);
  }

  function removeFromAllRooms(ws: WsWithMeta) {
    if (!ws.convoys) return;
    for (const id of ws.convoys) {
      rooms.get(id)?.delete(ws);
      if (rooms.get(id)?.size === 0) rooms.delete(id);
    }
    ws.convoys.clear();
  }

  function broadcastToRoom(convoyId: string, payload: any) {
    const set = rooms.get(convoyId);
    if (!set) return;
    // Attach correlation id if available
    for (const client of set) {
      if (client.readyState === client.OPEN) {
        const withCid = client.cid ? { cid: client.cid, ...payload } : payload;
        client.send(JSON.stringify(withCid));
      }
    }
  }

  setConvoyBroadcast(broadcastToRoom);

  const lastPingAt = new Map<string, number>();

  wss.on('connection', (wsRaw, req) => {
    const ws = wsRaw as WsWithMeta;
    // Correlation ID and auth from query
    const url = new URL(req.url || '', 'http://localhost');
    ws.cid = url.searchParams.get('cid') || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const token = url.searchParams.get('token');
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        ws.userId = decoded.userId;
      } catch {
        // ignore; will require auth:init
      }
    }

    const auth = createAuthHandler(ws, JWT_SECRET);
    const convoy = createConvoyHandler(ws, { addToRoom });
    const ping = createPingHandler(ws, { broadcastToRoom, lastPingAt, ttlSeconds: WS_TTL_SECONDS, minIntervalMs: WS_MIN_PING_INTERVAL_MS });
    const chat = createChatHandler(ws, { broadcastToRoom });

    // Ajv validators for incoming WS messages (envelope required)
    const ajv = new Ajv({ removeAdditional: false, useDefaults: false, coerceTypes: false, allErrors: true });
    addFormats(ajv);

    const EnvelopeSchema = {
      type: 'object',
      required: ['data'],
      properties: {
        data: { type: 'object', required: ['type'], properties: { type: { type: 'string' } } }
      },
      additionalProperties: false
    } as const;

    const ChatPayloadSchema = {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 1000 }
      },
      additionalProperties: false
    } as const;

    const PingPayloadSchema = {
      type: 'object',
      required: ['lat', 'lon', 'timestamp'],
      properties: {
        lat: { type: 'number' },
        lon: { type: 'number' },
        speed: { type: 'number' },
        heading: { type: 'number' },
        accuracy: { type: 'number' },
        battery: { type: 'number' },
        timestamp: { type: 'number' }
      },
      additionalProperties: false
    } as const;

    const validators: Record<string, (v: any) => boolean> = {
      'auth:init': ajv.compile({ ...EnvelopeSchema, properties: { data: { type: 'object', required: ['type', 'payload'], properties: { type: { const: 'auth:init' }, payload: { type: 'object', required: ['token'], properties: { token: { type: 'string' } }, additionalProperties: false } }, additionalProperties: false } } }),
      'convoy:join': ajv.compile({ ...EnvelopeSchema, properties: { data: { type: 'object', required: ['type', 'convoyId'], properties: { type: { const: 'convoy:join' }, convoyId: { type: 'string' } }, additionalProperties: false } } }),
      ping: ajv.compile({ ...EnvelopeSchema, properties: { data: { type: 'object', required: ['type', 'convoyId', 'payload'], properties: { type: { const: 'ping' }, convoyId: { type: 'string' }, payload: PingPayloadSchema }, additionalProperties: false } } }),
      'member:status': ajv.compile({ ...EnvelopeSchema, properties: { data: { type: 'object', required: ['type', 'convoyId', 'payload'], properties: { type: { const: 'member:status' }, convoyId: { type: 'string' }, payload: { type: 'object', required: ['status'], properties: { status: { type: 'string' } }, additionalProperties: false } }, additionalProperties: false } } }),
      sos: ajv.compile({ ...EnvelopeSchema, properties: { data: { type: 'object', required: ['type', 'convoyId', 'payload'], properties: { type: { const: 'sos' }, convoyId: { type: 'string' }, payload: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number' }, lon: { type: 'number' }, message: { type: 'string' } }, additionalProperties: false } }, additionalProperties: false } } }),
      'chat:send': ajv.compile({ ...EnvelopeSchema, properties: { data: { type: 'object', required: ['type', 'convoyId', 'payload'], properties: { type: { const: 'chat:send' }, convoyId: { type: 'string' }, payload: ChatPayloadSchema }, additionalProperties: false } } })
    };

    ws.on('message', (data) => {
      try {
        const raw = JSON.parse(String(data));
        if (!raw || typeof raw !== 'object') {
          ws.send(JSON.stringify({ success: false, error: { code: 'BAD_MESSAGE', message: 'Object message required' } }));
          return;
        }

        // Support both formats:
        // 1) { data: { type, convoyId?, payload? } } (current)
        // 2) { type, convoyId?, payload? } (Task.md)
        const envelope = 'data' in (raw as any) ? (raw as any) : { data: raw };
        const msg = (envelope as any).data;
        const type = msg?.type as string;
        const validate = validators[type];
        if (!validate || !validate(envelope)) {
          ws.send(JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid message' } }));
          return;
        }
        switch (msg?.type) {
          case 'auth:init':
            auth(msg);
            break;
          case 'convoy:join':
            if (!ws.userId) return; // require auth
            convoy(msg);
            break;
          case 'chat:send':
            if (!ws.userId) return;
            chat(msg);
            break;
          case 'ping':
          case 'member:status':
          case 'sos':
            if (!ws.userId) return; // require auth
            ping(msg);
            break;
          default:
            break;
        }
      } catch {
        // ignore
      }
    });

    ws.on('close', () => {
      removeFromAllRooms(ws);
    });
  });
}

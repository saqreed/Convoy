import type { WebSocket } from 'ws';
import { prisma } from '../../../db/client';
import { z } from 'zod';

type WsWithMeta = WebSocket & { userId?: string; convoys?: Set<string> };

const PingSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  accuracy: z.number().optional(),
  battery: z.number().optional(),
  timestamp: z.number()
});

const StatusSchema = z.object({ status: z.enum(['ok', 'delayed', 'stopped']).or(z.string()) });

const SosSchema = z.object({ lat: z.number(), lon: z.number(), message: z.string().optional() });

export function createPingHandler(
  wsRaw: WebSocket,
  ctx: {
    broadcastToRoom: (convoyId: string, payload: any) => void;
    lastPingAt: Map<string, number>;
    ttlSeconds: number;
    minIntervalMs: number;
  }
) {
  const ws = wsRaw as WsWithMeta;
  return async function handle(msg: any) {
    const userId = ws.userId;
    const convoyId = msg?.convoyId as string | undefined;
    if (!userId || !convoyId) return;

    if (!ws.convoys?.has(convoyId)) {
      ws.send(JSON.stringify({ success: false, error: { code: 'NOT_JOINED', message: 'Join convoy first' } }));
      return;
    }

    if (msg?.type === 'ping') {
      const p = PingSchema.parse(msg?.payload || {});

      // Enforce timestamp TTL and throttle
      const now = Date.now();
      const ts = p.timestamp ?? now;
      if (Math.abs(now - ts) > ctx.ttlSeconds * 1000) {
        return; // drop outdated or too-future pings
      }
      const key = `${userId}:${convoyId}`;
      const last = ctx.lastPingAt.get(key) || 0;
      if (now - last < ctx.minIntervalMs) {
        return; // throttle
      }
      ctx.lastPingAt.set(key, now);

      await prisma.locationPing.create({
        data: {
          userId,
          convoyId,
          lat: p.lat,
          lon: p.lon,
          speed: p.speed,
          heading: p.heading,
          accuracy: p.accuracy,
          battery: p.battery
        }
      });

      await prisma.convoyMember.update({
        where: { convoyId_userId: { convoyId, userId } },
        data: { lastPing: { lat: p.lat, lon: p.lon, speed: p.speed, heading: p.heading, timestamp: p.timestamp } as any }
      }).catch(() => Promise.resolve());

      ctx.broadcastToRoom(convoyId, {
        success: true,
        data: {
          type: 'member:update',
          userId,
          convoyId,
          timestamp: Date.now(),
          payload: { lat: p.lat, lon: p.lon, speed: p.speed, heading: p.heading, timestamp: p.timestamp }
        }
      });
      return;
    }

    if (msg?.type === 'member:status') {
      const s = StatusSchema.parse(msg?.payload || {});
      ctx.broadcastToRoom(convoyId, {
        success: true,
        data: {
          type: 'member:status',
          userId,
          convoyId,
          timestamp: Date.now(),
          payload: s
        }
      });
      return;
    }

    if (msg?.type === 'sos') {
      const so = SosSchema.parse(msg?.payload || {});
      ctx.broadcastToRoom(convoyId, {
        success: true,
        data: {
          type: 'sos',
          userId,
          convoyId,
          timestamp: Date.now(),
          payload: so
        }
      });
      return;
    }
  };
}

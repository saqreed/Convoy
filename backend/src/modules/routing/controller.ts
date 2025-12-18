import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildRouteSchema } from './schema';

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';

type RoutePoint = { lat: number; lon: number };

type CacheEntry = {
  expiresAt: number;
  value: {
    geometry: RoutePoint[];
    distanceMeters: number;
    durationSeconds: number;
  };
};

const cache = new Map<string, CacheEntry>();

function authGuard(req: FastifyRequest) {
  // @ts-ignore
  return (req as any).user?.userId as string | undefined;
}

function roundCoord(n: number) {
  return Math.round(n * 1e5) / 1e5;
}

function cacheKey(profile: string, points: RoutePoint[]) {
  const parts = points.map((p) => `${roundCoord(p.lat)},${roundCoord(p.lon)}`);
  return `${profile}|${parts.join(';')}`;
}

async function osrmRoute(profile: string, points: RoutePoint[]) {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM_BASE_URL}/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false`;

  const fetchFn = (globalThis as any).fetch as undefined | ((input: any, init?: any) => Promise<any>);
  if (!fetchFn) throw new Error('fetch is not available in this Node runtime');

  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res?.ok) {
    throw new Error(`Routing provider error (${res?.status || 'unknown'})`);
  }

  const json = (await res.json()) as any;
  const route = json?.routes?.[0];
  const coordsArr = route?.geometry?.coordinates;
  if (!route || !Array.isArray(coordsArr)) {
    throw new Error('Invalid routing response');
  }

  const geometry: RoutePoint[] = coordsArr
    .filter((c: any) => Array.isArray(c) && c.length >= 2)
    .map((c: any) => ({ lon: Number(c[0]), lat: Number(c[1]) }))
    .filter((p: any) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (geometry.length < 2) {
    throw new Error('Routing returned empty geometry');
  }

  return {
    geometry,
    distanceMeters: Number(route.distance) || 0,
    durationSeconds: Number(route.duration) || 0
  };
}

export async function registerRoutingRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
      // @ts-ignore
      (req as any).user = req.user;
    } catch {
      // ignore
    }
  });

  app.post('/routing/route', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();

    const body = buildRouteSchema.parse(req.body);
    const profile = body.profile === 'bike' ? 'cycling' : body.profile === 'foot' ? 'walking' : 'driving';

    const key = cacheKey(profile, body.points);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      return { success: true, data: cached.value };
    }

    const value = await osrmRoute(profile, body.points);
    cache.set(key, { expiresAt: now + 5 * 60 * 1000, value });
    return { success: true, data: value };
  });
}

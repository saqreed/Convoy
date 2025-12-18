import type { FastifyInstance, FastifyRequest } from 'fastify';
import { geocodeReverseQuerySchema, geocodeSearchQuerySchema } from './schema';

const NOMINATIM_BASE_URL = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const cache = new Map<string, CacheEntry>();

function authGuard(req: FastifyRequest) {
  // @ts-ignore
  return (req as any).user?.userId as string | undefined;
}

function cacheKey(q: string, limit: number) {
  return `${q.toLowerCase().trim()}|${limit}`;
}

function reverseCacheKey(lat: number, lon: number) {
  const rLat = Math.round(lat * 1e5) / 1e5;
  const rLon = Math.round(lon * 1e5) / 1e5;
  return `${rLat},${rLon}`;
}

export async function registerGeocodingRoutes(app: FastifyInstance<any, any, any, any, any>) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
      // @ts-ignore
      (req as any).user = req.user;
    } catch {
      // ignore
    }
  });

  app.get('/geocoding/search', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();

    const q = (req.query || {}) as Record<string, unknown>;
    const parsed = geocodeSearchQuerySchema.parse({ q: q['q'], limit: q['limit'] });
    const limit = parsed.limit ?? 5;

    const key = cacheKey(parsed.q, limit);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      return { success: true, data: cached.value };
    }

    const fetchFn = (globalThis as any).fetch as undefined | ((input: any, init?: any) => Promise<any>);
    if (!fetchFn) throw new Error('fetch is not available in this Node runtime');

    const url = new URL('/search', NOMINATIM_BASE_URL);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', parsed.q);
    url.searchParams.set('limit', String(limit));

    const res = await fetchFn(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ConvoyApp/0.1 (dev)'
      }
    });

    if (!res?.ok) {
      throw new Error(`Geocoding provider error (${res?.status || 'unknown'})`);
    }

    const json = (await res.json()) as any[];
    const data = (Array.isArray(json) ? json : []).map((item) => ({
      displayName: String(item?.display_name || ''),
      lat: Number(item?.lat),
      lon: Number(item?.lon)
    })).filter((x) => x.displayName && Number.isFinite(x.lat) && Number.isFinite(x.lon));

    cache.set(key, { expiresAt: now + 10 * 60 * 1000, value: data });
    return { success: true, data };
  });

  app.get('/geocoding/reverse', {
    config: { rateLimit: { max: 240, timeWindow: '1 minute' } }
  }, async (req: FastifyRequest) => {
    const userId = authGuard(req);
    if (!userId) return app.httpErrors.unauthorized();

    const q = (req.query || {}) as Record<string, unknown>;
    const parsed = geocodeReverseQuerySchema.parse({ lat: q['lat'], lon: q['lon'] });

    const key = reverseCacheKey(parsed.lat, parsed.lon);
    const now = Date.now();
    const cached = cache.get(`rev:${key}`);
    if (cached && cached.expiresAt > now) {
      return { success: true, data: cached.value };
    }

    const fetchFn = (globalThis as any).fetch as undefined | ((input: any, init?: any) => Promise<any>);
    if (!fetchFn) throw new Error('fetch is not available in this Node runtime');

    const url = new URL('/reverse', NOMINATIM_BASE_URL);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(parsed.lat));
    url.searchParams.set('lon', String(parsed.lon));

    const res = await fetchFn(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ConvoyApp/0.1 (dev)'
      }
    });

    if (!res?.ok) {
      throw new Error(`Geocoding provider error (${res?.status || 'unknown'})`);
    }

    const json = (await res.json()) as any;
    const displayName = String(json?.display_name || '');
    const data = {
      displayName,
      lat: parsed.lat,
      lon: parsed.lon
    };

    cache.set(`rev:${key}`, { expiresAt: now + 10 * 60 * 1000, value: data });
    return { success: true, data };
  });
}

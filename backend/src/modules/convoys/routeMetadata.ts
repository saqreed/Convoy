export type RoutePoint = {
  lat: number;
  lon: number;
  name?: string;
};

type GeoBox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = 111.32;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRoutePoint(value: unknown): value is RoutePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.lat) && isFiniteNumber(point.lon);
}

export function readRoutePoints(route: unknown): RoutePoint[] {
  if (!Array.isArray(route)) return [];
  return route.filter(isRoutePoint);
}

export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceKm(a: RoutePoint, b: RoutePoint) {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function routeLengthKm(route: RoutePoint[]) {
  let totalKm = 0;
  for (let index = 1; index < route.length; index += 1) {
    totalKm += distanceKm(route[index - 1], route[index]);
  }
  return Math.round(totalKm * 10) / 10;
}

export function buildRouteMetadata(route: unknown) {
  const points = readRoutePoints(route);
  const first = points[0] ?? null;
  const last = points.length > 0 ? points[points.length - 1] : null;
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);

  return {
    routeStartLat: first?.lat ?? null,
    routeStartLon: first?.lon ?? null,
    routeEndLat: last?.lat ?? null,
    routeEndLon: last?.lon ?? null,
    routeMinLat: lats.length > 0 ? Math.min(...lats) : null,
    routeMaxLat: lats.length > 0 ? Math.max(...lats) : null,
    routeMinLon: lons.length > 0 ? Math.min(...lons) : null,
    routeMaxLon: lons.length > 0 ? Math.max(...lons) : null,
    routeLengthKm: routeLengthKm(points),
    routePointCount: points.length
  };
}

export function geoBoundingBoxes(origin: RoutePoint, radiusKm: number): GeoBox[] {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const minLat = Math.max(-90, origin.lat - latDelta);
  const maxLat = Math.min(90, origin.lat + latDelta);
  const cosLat = Math.cos(toRadians(origin.lat));

  if (minLat <= -90 || maxLat >= 90 || Math.abs(cosLat) < 0.000001) {
    return [{ minLat, maxLat, minLon: -180, maxLon: 180 }];
  }

  const lonDelta = radiusKm / (KM_PER_DEGREE_LAT * cosLat);
  if (lonDelta >= 180) {
    return [{ minLat, maxLat, minLon: -180, maxLon: 180 }];
  }

  const minLon = origin.lon - lonDelta;
  const maxLon = origin.lon + lonDelta;

  if (minLon < -180) {
    return [
      { minLat, maxLat, minLon: minLon + 360, maxLon: 180 },
      { minLat, maxLat, minLon: -180, maxLon }
    ];
  }

  if (maxLon > 180) {
    return [
      { minLat, maxLat, minLon, maxLon: 180 },
      { minLat, maxLat, minLon: -180, maxLon: maxLon - 360 }
    ];
  }

  return [{ minLat, maxLat, minLon, maxLon }];
}

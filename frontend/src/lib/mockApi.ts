import type {
  ChatMessage,
  Convoy,
  ConvoyDetail,
  ConvoyEvent,
  ConvoyWithInvite,
  GeocodeSearchResult,
  LocationPoint,
  NearbyOpenConvoy,
  Poll,
  RoutedRoute,
  Track,
  User
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_STORAGE_KEY = 'token';

type SuccessEnvelope<T> = { success: true; data: T };
type ErrorEnvelope = { success: false; error: { code?: string; message?: string } };
type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (!token) throw new Error('Not authenticated');
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Network error');
  }

  let payload: Envelope<T>;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new Error('Invalid server response');
  }

  if (!response.ok || !payload.success) {
    const message = payload && !payload.success ? payload.error?.message : undefined;
    throw new Error(message || `Request failed (${response.status})`);
  }

  return payload.data;
}

export async function sendOtp(phone: string) {
  return request<{ sessionId: string }>('/auth/send-otp', {
    method: 'POST',
    body: { phone },
    auth: false
  });
}

export async function verifyOtp(sessionId: string, code: string) {
  return request<{ token: string }>('/auth/verify-otp', {
    method: 'POST',
    body: { sessionId, code },
    auth: false
  });
}

export async function listConvoys(): Promise<Convoy[]> {
  return request<Convoy[]>('/convoys');
}

export async function createConvoy(input: { title: string; startTime?: string; route: LocationPoint[]; privacy: 'invite' | 'open' }) {
  return request<ConvoyWithInvite>('/convoys', {
    method: 'POST',
    body: input
  });
}

export async function joinConvoy(convoyId: string, code?: string) {
  return request<{ ok: boolean }>(`/convoys/${convoyId}/join`, {
    method: 'POST',
    body: code?.trim() ? { code: code.trim() } : {}
  });
}

export async function getConvoy(convoyId: string) {
  return request<ConvoyDetail>(`/convoys/${convoyId}`);
}

export async function listNearbyOpenConvoys(query: {
  lat: number;
  lon: number;
  radiusKm?: number;
  limit?: number;
}) {
  const qs = new URLSearchParams({
    lat: String(query.lat),
    lon: String(query.lon)
  });
  if (typeof query.radiusKm === 'number') qs.set('radiusKm', String(query.radiusKm));
  if (typeof query.limit === 'number') qs.set('limit', String(query.limit));
  return request<NearbyOpenConvoy[]>(`/convoys/open/nearby?${qs.toString()}`);
}

export async function updateConvoy(
  convoyId: string,
  input: { title?: string; startTime?: string | null; route?: LocationPoint[]; status?: string; privacy?: 'invite' | 'open' }
) {
  return request<Convoy>(`/convoys/${convoyId}`, {
    method: 'PATCH',
    body: input
  });
}

export async function getMe(): Promise<User> {
  return request<User>('/me');
}

export async function updateMe(input: { name?: string; avatarUrl?: string | null }): Promise<User> {
  return request<User>('/me', {
    method: 'PATCH',
    body: input
  });
}

export async function getConvoyMessages(
  convoyId: string,
  query?: { since?: string; limit?: number }
): Promise<ChatMessage[]> {
  const qs = new URLSearchParams();
  if (query?.since) qs.set('since', query.since);
  if (typeof query?.limit === 'number') qs.set('limit', String(query.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<ChatMessage[]>(`/convoys/${convoyId}/messages${suffix}`);
}

export async function getTracks(
  convoyId: string,
  query?: { userId?: string; since?: string; until?: string; limit?: number }
) {
  const qs = new URLSearchParams();
  if (query?.userId) qs.set('userId', query.userId);
  if (query?.since) qs.set('since', query.since);
  if (query?.until) qs.set('until', query.until);
  if (typeof query?.limit === 'number') qs.set('limit', String(query.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<Track[]>(`/convoys/${convoyId}/tracks${suffix}`);
}

export async function buildRoute(points: Array<Pick<LocationPoint, 'lat' | 'lon'>>, profile?: 'driving' | 'foot' | 'bike') {
  return request<RoutedRoute>('/routing/route', {
    method: 'POST',
    body: { points, ...(profile ? { profile } : {}) }
  });
}

export async function geocodeSearch(q: string, limit?: number) {
  const qs = new URLSearchParams();
  qs.set('q', q);
  if (typeof limit === 'number') qs.set('limit', String(limit));
  return request<GeocodeSearchResult[]>(`/geocoding/search?${qs.toString()}`);
}

export async function reverseGeocode(lat: number, lon: number) {
  const qs = new URLSearchParams();
  qs.set('lat', String(lat));
  qs.set('lon', String(lon));
  return request<GeocodeSearchResult>(`/geocoding/reverse?${qs.toString()}`);
}

export async function transferConvoyLeader(convoyId: string, newLeaderId: string) {
  return request<{ ok: boolean }>(`/convoys/${convoyId}/transfer-leader`, {
    method: 'POST',
    body: { newLeaderId }
  });
}

export async function addConvoyMemberByPhone(convoyId: string, phone: string) {
  return request<{ ok: boolean }>(`/convoys/${convoyId}/members/add-by-phone`, {
    method: 'POST',
    body: { phone }
  });
}

export async function kickConvoyMember(convoyId: string, userId: string) {
  return request<{ ok: boolean }>(`/convoys/${convoyId}/members/${userId}`, {
    method: 'DELETE'
  });
}

export async function listPolls(convoyId: string) {
  return request<Poll[]>(`/convoys/${convoyId}/polls`);
}

export async function createPoll(convoyId: string, input: { question: string; options: string[] }) {
  return request<Poll>(`/convoys/${convoyId}/polls`, {
    method: 'POST',
    body: input
  });
}

export async function votePoll(convoyId: string, pollId: string, optionId: string) {
  return request<{ ok: boolean }>(`/convoys/${convoyId}/polls/${pollId}/vote`, {
    method: 'POST',
    body: { optionId }
  });
}

export async function closePoll(convoyId: string, pollId: string) {
  return request<{ ok: boolean }>(`/convoys/${convoyId}/polls/${pollId}/close`, {
    method: 'POST'
  });
}

export async function listConvoyEvents(convoyId: string) {
  return request<ConvoyEvent[]>(`/convoys/${convoyId}/events`);
}

export async function createRandomConvoyEvent(convoyId: string) {
  return request<ConvoyEvent>(`/convoys/${convoyId}/events/random`, {
    method: 'POST'
  });
}

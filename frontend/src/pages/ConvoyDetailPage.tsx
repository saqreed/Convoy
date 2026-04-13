import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useConvoyStore } from '../store/convoys';
import { useAuthStore } from '../store/auth';
import type { ChatMessage, ConvoyEvent, ForumPost, LocationPoint, Poll, RoutedRoute, Track, UUID } from '../types';
import { ConvoyWsClient, type WsEvent } from '../lib/wsClient';
import {
  addConvoyMemberByPhone,
  buildRoute,
  closePoll,
  createForumPost,
  createPoll,
  createRandomConvoyEvent,
  deleteForumPost,
  getConvoyMessages,
  getTracks,
  kickConvoyMember,
  listConvoyEvents,
  listForumPosts,
  listPolls,
  reverseGeocode,
  transferConvoyLeader,
  updateConvoy,
  updateForumPost,
  votePoll
} from '../lib/mockApi';

type LeafletMap = typeof import('leaflet');
type LeafletInstance = ReturnType<LeafletMap['map']> | null;

declare global {
  interface Window {
    L?: LeafletMap;
  }
}

function isLoopedRoute(route: LocationPoint[]) {
  if (!Array.isArray(route) || route.length < 3) return false;
  const a = route[0];
  const b = route[route.length - 1];
  const latA = Math.round(a.lat * 1e5) / 1e5;
  const lonA = Math.round(a.lon * 1e5) / 1e5;
  const latB = Math.round(b.lat * 1e5) / 1e5;
  const lonB = Math.round(b.lon * 1e5) / 1e5;
  return latA === latB && lonA === lonB;
}

type RouteEditPoint = { id: string; lat: number; lon: number; name: string };

function makeId() {
  const fn = globalThis.crypto?.randomUUID;
  return fn ? fn.call(globalThis.crypto) : Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function decodeJwtUserId(token: string | null) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    const json = JSON.parse(atob(padded)) as unknown;
    if (!json || typeof json !== 'object') return null;
    const obj = json as Record<string, unknown>;
    return typeof obj.userId === 'string' ? obj.userId : null;
  } catch {
    return null;
  }
}

type MemberLive = {
  userId: UUID;
  lat?: number;
  lon?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  status?: string;
  lastSos?: { lat: number; lon: number; message?: string; timestamp: number };
};

type WsDataConvoyJoined = { type: 'convoy:joined'; convoyId: string; timestamp?: number };
type WsDataMemberUpdate = { type: 'member:update'; userId: string; payload: { lat: number; lon: number; speed?: number; heading?: number; timestamp: number } };
type WsDataMemberStatus = { type: 'member:status'; userId: string; payload: { status: string } };
type WsDataSos = { type: 'sos'; userId: string; payload: { lat: number; lon: number; message?: string } };
type WsDataChatNew = { type: 'chat:new'; userId: string; message: ChatMessage };
type KnownWsData = WsDataConvoyJoined | WsDataMemberUpdate | WsDataMemberStatus | WsDataSos | WsDataChatNew;

function colorForUserId(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 80% 45%)`;
}

function getGlobalLastTs(tracks: Track[]) {
  let max = 0;
  for (const t of tracks) {
    const pts = t?.points;
    if (!Array.isArray(pts) || pts.length === 0) continue;
    const last = pts[pts.length - 1];
    const ms = typeof last?.ts === 'string' ? Date.parse(last.ts) : NaN;
    if (!Number.isFinite(ms)) continue;
    if (ms > max) max = ms;
  }
  return max ? new Date(max).toISOString() : null;
}

function pointKey(p: { ts: string; lat: number; lon: number }) {
  const lat = Math.round(p.lat * 1e5) / 1e5;
  const lon = Math.round(p.lon * 1e5) / 1e5;
  return `${p.ts}|${lat}|${lon}`;
}

function mergeTracks(prev: Track[], incoming: Track[]) {
  const byUser = new Map<string, Track>();
  for (const t of prev) {
    if (!t?.userId) continue;
    byUser.set(t.userId, { userId: t.userId, points: Array.isArray(t.points) ? [...t.points] : [] });
  }

  for (const t of incoming) {
    if (!t?.userId || !Array.isArray(t.points) || t.points.length === 0) continue;
    const existing = byUser.get(t.userId) || { userId: t.userId, points: [] as Track['points'] };

    const existingKeys = new Set<string>();
    for (const p of existing.points) {
      if (!p || typeof p.ts !== 'string' || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      existingKeys.add(pointKey(p));
    }

    for (const p of t.points) {
      if (!p || typeof p.ts !== 'string' || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const k = pointKey(p);
      if (existingKeys.has(k)) continue;
      existingKeys.add(k);
      existing.points.push(p);
    }

    const MAX_POINTS_PER_USER = 3000;
    if (existing.points.length > MAX_POINTS_PER_USER) {
      existing.points = existing.points.slice(existing.points.length - MAX_POINTS_PER_USER);
    }

    byUser.set(t.userId, existing);
  }

  return Array.from(byUser.values());
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isKnownWsData(data: unknown): data is KnownWsData {
  if (!isObject(data)) return false;
  const t = data.type;
  if (t === 'convoy:joined') return typeof data.convoyId === 'string';
  if (t === 'member:update') return typeof data.userId === 'string' && isObject(data.payload);
  if (t === 'member:status') return typeof data.userId === 'string' && isObject(data.payload);
  if (t === 'sos') return typeof data.userId === 'string' && isObject(data.payload);
  if (t === 'chat:new') return typeof data.userId === 'string' && isObject(data.message);
  return false;
}

export default function ConvoyDetailPage() {
  const { id } = useParams();
  const current = useConvoyStore((s) => s.current);
  const loading = useConvoyStore((s) => s.loading);
  const error = useConvoyStore((s) => s.error);
  const loadOne = useConvoyStore((s) => s.loadOne);
  const token = useAuthStore((s) => s.token);

  const myUserId = useMemo(() => decodeJwtUserId(token), [token]);
  const isLeader = !!(myUserId && current?.leaderId && myUserId === current.leaderId);
  const leaderLabel = useMemo(() => {
    const leaderId = current?.leaderId;
    if (!leaderId) return '—';
    const m = current?.members?.find((x) => x.userId === leaderId);
    return m?.user?.name || m?.user?.phone || leaderId.slice(0, 8);
  }, [current?.leaderId, current?.members]);

  const [newLeaderId, setNewLeaderId] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const [settingsPrivacy, setSettingsPrivacy] = useState<'invite' | 'open'>('invite');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [addPhone, setAddPhone] = useState('');
  const [addMemberLoading, setAddMemberLoading] = useState(false);

  const [editingRoute, setEditingRoute] = useState(false);
  const [routeEdit, setRouteEdit] = useState<RouteEditPoint[] | null>(null);
  const [routeEditCloseLoop, setRouteEditCloseLoop] = useState(false);
  const [routeEditDragIndex, setRouteEditDragIndex] = useState<number | null>(null);
  const [routeEditSaving, setRouteEditSaving] = useState(false);
  const [routeEditError, setRouteEditError] = useState<string | null>(null);

  const [wsError, setWsError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);

  const wsRef = useRef<ConvoyWsClient | null>(null);
  const joinedRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletInstance>(null);
  const LRef = useRef<LeafletMap | null>(null);
  const memberMarkersRef = useRef<Map<string, import('leaflet').Marker>>(new Map());
  const trackPolylinesRef = useRef<Map<string, import('leaflet').Polyline>>(new Map());
  const routePolylineRef = useRef<import('leaflet').Polyline | null>(null);
  const routePointMarkersRef = useRef<Map<string, import('leaflet').Marker>>(new Map());

  const [membersLive, setMembersLive] = useState<Record<string, MemberLive>>({});

  const [tracks, setTracks] = useState<Track[]>([]);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [tracksLoading, setTracksLoading] = useState(false);
  const tracksRef = useRef<Track[]>([]);
  const tracksInFlightRef = useRef(false);

  const [routedRoute, setRoutedRoute] = useState<RoutedRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mapReadyEpoch, setMapReadyEpoch] = useState(0);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatText, setChatText] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [polls, setPolls] = useState<Poll[]>([]);
  const [pollsLoading, setPollsLoading] = useState(false);
  const [pollsError, setPollsError] = useState<string | null>(null);
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newPollOptionsText, setNewPollOptionsText] = useState('');
  const [pollCreateLoading, setPollCreateLoading] = useState(false);

  const [events, setEvents] = useState<ConvoyEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [randomEventLoading, setRandomEventLoading] = useState(false);

  const [forumPosts, setForumPosts] = useState<ForumPost[]>([]);
  const [forumLoading, setForumLoading] = useState(false);
  const [forumError, setForumError] = useState<string | null>(null);
  const [forumTitle, setForumTitle] = useState('');
  const [forumBody, setForumBody] = useState('');
  const [forumSaving, setForumSaving] = useState(false);
  const [editingForumPostId, setEditingForumPostId] = useState<string | null>(null);

  useEffect(() => {
    setNewLeaderId('');
    setTransferError(null);
    setTransferLoading(false);
  }, [current?.id, current?.leaderId]);

  useEffect(() => {
    setEditingRoute(false);
    setRouteEdit(null);
    setRouteEditError(null);
    setRouteEditSaving(false);
    setRouteEditDragIndex(null);
    setRouteEditCloseLoop(false);
  }, [current?.id]);

  useEffect(() => {
    setSettingsPrivacy(current?.privacy === 'open' ? 'open' : 'invite');
    setSettingsError(null);
    setSettingsSaving(false);
    setAddPhone('');
    setAddMemberLoading(false);
  }, [current?.id, current?.privacy]);

  useEffect(() => {
    setForumTitle('');
    setForumBody('');
    setForumError(null);
    setForumSaving(false);
    setEditingForumPostId(null);
  }, [current?.id]);

  const refreshPolls = useCallback(() => {
    if (!id || !token) return;
    setPollsLoading(true);
    setPollsError(null);
    listPolls(id)
      .then((p) => setPolls(p))
      .catch((e) => setPollsError(e instanceof Error ? e.message : 'Failed to load polls'))
      .finally(() => setPollsLoading(false));
  }, [id, token]);

  const refreshEvents = useCallback(() => {
    if (!id || !token) return;
    setEventsLoading(true);
    setEventsError(null);
    listConvoyEvents(id)
      .then((list) => setEvents(list))
      .catch((e) => setEventsError(e instanceof Error ? e.message : 'Failed to load events'))
      .finally(() => setEventsLoading(false));
  }, [id, token]);

  const refreshForumPosts = useCallback(() => {
    if (!id || !token) return;
    setForumLoading(true);
    setForumError(null);
    listForumPosts(id, { limit: 50 })
      .then((posts) => setForumPosts(posts))
      .catch((e) => setForumError(e instanceof Error ? e.message : 'Failed to load forum'))
      .finally(() => setForumLoading(false));
  }, [id, token]);

  useEffect(() => {
    refreshPolls();
    refreshEvents();
    refreshForumPosts();
  }, [refreshPolls, refreshEvents, refreshForumPosts]);

  const submitForumPost = useCallback(async () => {
    if (!id) return;
    const title = forumTitle.trim();
    const body = forumBody.trim();
    if (title.length < 3 || !body) {
      setForumError('Forum post needs a title of at least 3 characters and a body');
      return;
    }

    setForumSaving(true);
    setForumError(null);
    try {
      if (editingForumPostId) {
        await updateForumPost(id, editingForumPostId, { title, body });
      } else {
        await createForumPost(id, { title, body });
      }
      setForumTitle('');
      setForumBody('');
      setEditingForumPostId(null);
      refreshForumPosts();
    } catch (e) {
      setForumError(e instanceof Error ? e.message : 'Failed to save forum post');
    } finally {
      setForumSaving(false);
    }
  }, [editingForumPostId, forumBody, forumTitle, id, refreshForumPosts]);

  const startForumEdit = useCallback((post: ForumPost) => {
    setEditingForumPostId(post.id);
    setForumTitle(post.title);
    setForumBody(post.body);
    setForumError(null);
  }, []);

  const cancelForumEdit = useCallback(() => {
    setEditingForumPostId(null);
    setForumTitle('');
    setForumBody('');
    setForumError(null);
  }, []);

  const membersMerged = useMemo(() => {
    const byId: Record<string, { name?: string; phone?: string } & MemberLive> = {};
    for (const [uid, live] of Object.entries(membersLive)) {
      byId[uid] = { ...live };
    }
    for (const m of current?.members || []) {
      const uid = m.userId;
      byId[uid] = {
        ...(byId[uid] || { userId: uid }),
        userId: uid,
        name: m.user?.name,
        phone: m.user?.phone
      };
    }
    return Object.values(byId);
  }, [current?.members, membersLive]);

  // Seed live locations from backend (ConvoyMember.lastPing) so markers appear immediately
  useEffect(() => {
    if (!current?.members?.length) return;
    const seeded: Record<string, MemberLive> = {};
    for (const m of current.members) {
      const lp = m.lastPing as unknown;
      if (!lp || typeof lp !== 'object') continue;
      const obj = lp as Record<string, unknown>;
      const lat = obj['lat'];
      const lon = obj['lon'];
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      seeded[m.userId] = {
        userId: m.userId,
        lat,
        lon,
        speed: typeof obj['speed'] === 'number' ? (obj['speed'] as number) : undefined,
        heading: typeof obj['heading'] === 'number' ? (obj['heading'] as number) : undefined,
        timestamp: typeof obj['timestamp'] === 'number' ? (obj['timestamp'] as number) : undefined
      };
    }
    if (Object.keys(seeded).length === 0) return;
    setMembersLive((prev) => ({ ...seeded, ...prev }));
  }, [current?.members]);

  const handleWsMessage = useCallback((event: WsEvent) => {
    const data = event.data as unknown;
    if (!isKnownWsData(data)) return;
    switch (data.type) {
      case 'convoy:joined':
        joinedRef.current = true;
        setJoined(true);
        return;
      case 'chat:new': {
        const msg = data.message as unknown;
        if (!isObject(msg)) return;
        const m = msg as Record<string, unknown>;
        const id = m['id'];
        const convoyId = m['convoyId'];
        const userId = m['userId'];
        const text = m['text'];
        const createdAt = m['createdAt'];
        if (typeof id !== 'string' || typeof convoyId !== 'string' || typeof userId !== 'string' || typeof text !== 'string' || typeof createdAt !== 'string') {
          return;
        }
        const normalized: ChatMessage = { id, convoyId: convoyId as UUID, userId: userId as UUID, text, createdAt };
        setChatMessages((prev) => {
          if (prev.some((x) => x.id === normalized.id)) return prev;
          return [...prev, normalized].slice(-200);
        });
        return;
      }
      case 'member:update': {
        const userId = data.userId;
        const payload = data.payload;
        setMembersLive((prev) => ({
          ...prev,
          [userId]: {
            userId,
            lat: typeof payload.lat === 'number' ? payload.lat : prev[userId]?.lat,
            lon: typeof payload.lon === 'number' ? payload.lon : prev[userId]?.lon,
            speed: typeof payload.speed === 'number' ? payload.speed : prev[userId]?.speed,
            heading: typeof payload.heading === 'number' ? payload.heading : prev[userId]?.heading,
            timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : prev[userId]?.timestamp,
            status: prev[userId]?.status,
            lastSos: prev[userId]?.lastSos
          }
        }));
        return;
      }
      case 'member:status': {
        const userId = data.userId;
        const payload = data.payload;
        setMembersLive((prev) => ({
          ...prev,
          [userId]: {
            ...(prev[userId] || { userId }),
            status: typeof payload.status === 'string' ? payload.status : prev[userId]?.status
          }
        }));
        return;
      }
      case 'sos': {
        const userId = data.userId;
        const payload = data.payload;
        if (typeof payload.lat !== 'number' || typeof payload.lon !== 'number') return;
        setMembersLive((prev) => ({
          ...prev,
          [userId]: {
            ...(prev[userId] || { userId }),
            lastSos: {
              lat: payload.lat,
              lon: payload.lon,
              message: typeof payload.message === 'string' ? payload.message : undefined,
              timestamp: Date.now()
            }
          }
        }));
        return;
      }
      default:
        return;
    }
  }, []);

  // Load chat history
  useEffect(() => {
    if (!id || !token) return;
    let cancelled = false;
    setChatLoading(true);
    setChatError(null);
    getConvoyMessages(id, { limit: 100 })
      .then((list) => {
        if (cancelled) return;
        setChatMessages(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setChatError(e instanceof Error ? e.message : 'Failed to load chat');
      })
      .finally(() => {
        if (cancelled) return;
        setChatLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages.length]);

  const nameByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of current?.members || []) {
      const label = m.user?.name || m.user?.phone || m.userId.slice(0, 8);
      map.set(m.userId, label);
    }
    return map;
  }, [current?.members]);

  const sendChat = useCallback(() => {
    if (!id) return;
    const text = chatText.trim();
    if (!text) return;
    if (!wsRef.current || !joinedRef.current) {
      setChatError('Join convoy first');
      return;
    }
    setChatError(null);
    try {
      wsRef.current.send({ type: 'chat:send', convoyId: id, payload: { text } });
      setChatText('');
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Failed to send message');
    }
  }, [chatText, id]);

  useEffect(() => {
    if (id) loadOne(id);
  }, [id, loadOne]);

  const routeCacheKey = useMemo(() => {
    if (!id || !current?.route?.length) return null;
    const parts = current.route.map((p) => {
      const lat = Math.round(p.lat * 1e5) / 1e5;
      const lon = Math.round(p.lon * 1e5) / 1e5;
      return `${lat},${lon}`;
    });
    return `v1|${parts.join(';')}`;
  }, [id, current?.route]);

  useEffect(() => {
    if (!id || !token || !current?.route?.length || !routeCacheKey) {
      setRoutedRoute(null);
      setRouteError(null);
      setRouteLoading(false);
      return;
    }

    let cancelled = false;
    setRouteError(null);
    setRouteLoading(true);

    const storageKey = `convoyRoutedRoute:${id}`;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { v?: number; key?: string; data?: unknown };
        if (parsed?.v === 1 && parsed.key === routeCacheKey && parsed.data && typeof parsed.data === 'object') {
          setRoutedRoute(parsed.data as RoutedRoute);
          setRouteLoading(false);
          return () => {
            cancelled = true;
          };
        }
      }
    } catch {
      // ignore
    }

    buildRoute(current.route, 'driving')
      .then((r) => {
        if (cancelled) return;
        setRoutedRoute(r);
        try {
          sessionStorage.setItem(storageKey, JSON.stringify({ v: 1, key: routeCacheKey, data: r }));
        } catch {
          // ignore
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setRoutedRoute(null);
        setRouteError(e instanceof Error ? e.message : 'Failed to build route');
      })
      .finally(() => {
        if (cancelled) return;
        setRouteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, token, current?.route, routeCacheKey]);

  // Tracks: keep ref + cache
  useEffect(() => {
    tracksRef.current = tracks;
    if (!id) return;
    try {
      sessionStorage.setItem(`convoyTracks:${id}`, JSON.stringify({ v: 1, ts: Date.now(), tracks }));
    } catch {
      // ignore storage quota/unavailable
    }
  }, [tracks, id]);

  // Load tracks history (cache + incremental polling)
  useEffect(() => {
    if (!id || !token) return;
    let cancelled = false;
    queueMicrotask(() => setTracksError(null));
    queueMicrotask(() => setTracksLoading(false));

    // 1) read cache immediately
    let cached: Track[] | null = null;
    try {
      const raw = sessionStorage.getItem(`convoyTracks:${id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { v?: number; tracks?: unknown };
        if (parsed?.v === 1 && Array.isArray(parsed.tracks)) {
          cached = parsed.tracks as Track[];
          queueMicrotask(() => {
            if (!cancelled && cached) setTracks(cached);
          });
        }
      }
    } catch {
      cached = null;
    }

    // 2) initial fetch: incremental if cache exists, otherwise full
    const initialSince = cached ? getGlobalLastTs(cached) : null;
    tracksInFlightRef.current = true;
    queueMicrotask(() => setTracksLoading(true));
    getTracks(id, { limit: 2000, ...(initialSince ? { since: initialSince } : {}) })
      .then((t) => {
        if (cancelled) return;
        if (cached) {
          setTracks((prev) => mergeTracks(prev, t));
        } else {
          setTracks(t);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setTracksError(e instanceof Error ? e.message : 'Failed to load tracks');
      })
      .finally(() => {
        tracksInFlightRef.current = false;
        queueMicrotask(() => setTracksLoading(false));
      });

    // 3) polling incremental updates
    const POLL_MS = 7000;
    let inFlight = false;
    const intervalId = window.setInterval(() => {
      if (cancelled || inFlight) return;
      if (document.visibilityState !== 'visible') return;
      const since = getGlobalLastTs(tracksRef.current);
      if (!since) return;
      inFlight = true;
      getTracks(id, { since, limit: 2000 })
        .then((t) => {
          if (cancelled) return;
          if (t.length) setTracks((prev) => mergeTracks(prev, t));
        })
        .catch((e) => {
          if (cancelled) return;
          setTracksError(e instanceof Error ? e.message : 'Failed to load tracks');
        })
        .finally(() => {
          inFlight = false;
        });
    }, POLL_MS);

    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      const since = getGlobalLastTs(tracksRef.current);
      if (!since || tracksInFlightRef.current) return;
      tracksInFlightRef.current = true;
      queueMicrotask(() => setTracksLoading(true));
      getTracks(id, { since, limit: 2000 })
        .then((t) => {
          if (cancelled) return;
          if (t.length) setTracks((prev) => mergeTracks(prev, t));
        })
        .catch((e) => {
          if (cancelled) return;
          setTracksError(e instanceof Error ? e.message : 'Failed to load tracks');
        })
        .finally(() => {
          tracksInFlightRef.current = false;
          queueMicrotask(() => setTracksLoading(false));
        });
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [id, token]);

  const refreshTracks = useCallback(() => {
    if (!id || !token) return;
    if (tracksInFlightRef.current) return;
    const since = getGlobalLastTs(tracksRef.current);
    if (!since) return;

    tracksInFlightRef.current = true;
    setTracksLoading(true);
    setTracksError(null);

    getTracks(id, { since, limit: 2000 })
      .then((t) => {
        if (t.length) setTracks((prev) => mergeTracks(prev, t));
      })
      .catch((e) => {
        setTracksError(e instanceof Error ? e.message : 'Failed to load tracks');
      })
      .finally(() => {
        tracksInFlightRef.current = false;
        setTracksLoading(false);
      });
  }, [id, token]);

  // Init map (Leaflet via window.L)
  // Important: map container appears only after convoy loads, so we retry until it's available.
  useEffect(() => {
    const markers = memberMarkersRef.current;
    const polylines = trackPolylinesRef.current;

    let disposed = false;
    let tries = 0;
    const maxTries = 60; // ~3s

    const intervalId = window.setInterval(() => {
      if (disposed) return;
      if (mapInstanceRef.current) return;
      const L = window.L;
      const el = mapContainerRef.current;
      if (!L || !el) {
        tries++;
        if (tries >= maxTries) {
          window.clearInterval(intervalId);
        }
        return;
      }

      LRef.current = L;
      const map = L.map(el).setView([51.1605, 46.0091], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);
      mapInstanceRef.current = map;
      setMapReadyEpoch((x) => x + 1);
      window.clearInterval(intervalId);
    }, 50);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      setMapReadyEpoch((x) => x + 1);
      markers.forEach((m) => m.remove());
      markers.clear();
      polylines.forEach((p) => p.remove());
      polylines.clear();
    };
  }, [id, current?.id]);

  // Draw route polyline when convoy loaded
  useEffect(() => {
    const L = LRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map) return;
    const points = editingRoute && routeEdit?.length
      ? routeEdit.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name }))
      : (routedRoute?.geometry?.length ? routedRoute.geometry : current?.route);
    if (!points?.length) return;
    const latlngs = points.map((p) => [p.lat, p.lon] as [number, number]);

    routePolylineRef.current?.remove();
    const polyline = L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.9 }).addTo(map);
    routePolylineRef.current = polyline;
    if (!editingRoute) {
      map.fitBounds(polyline.getBounds().pad(0.2));
    }
    return () => {
      polyline.remove();
      if (routePolylineRef.current === polyline) routePolylineRef.current = null;
    };
  }, [current?.route, routedRoute?.geometry, mapReadyEpoch, editingRoute, routeEdit]);

  // Route edit markers (leader only)
  useEffect(() => {
    const L = LRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    const markers = routePointMarkersRef.current;
    if (!editingRoute || !routeEdit?.length) {
      markers.forEach((m) => m.remove());
      markers.clear();
      return;
    }

    const alive = new Set<string>();
    for (const p of routeEdit) {
      alive.add(p.id);
      const existing = markers.get(p.id);
      if (!existing) {
        const marker = L.marker([p.lat, p.lon], { draggable: true }).addTo(map);
        marker.bindPopup(p.name);
        marker.on('dragend', (e: import('leaflet').LeafletEvent) => {
          const ll = (e.target as import('leaflet').Marker).getLatLng();
          setRouteEdit((prev) => {
            if (!prev) return prev;
            return prev.map((x) => (x.id === p.id ? { ...x, lat: ll.lat, lon: ll.lng } : x));
          });
          reverseGeocode(ll.lat, ll.lng)
            .then((r) => {
              const name = (r?.displayName || '').trim();
              if (!name) return;
              marker.setPopupContent(name);
              setRouteEdit((prev) => {
                if (!prev) return prev;
                return prev.map((x) => (x.id === p.id ? { ...x, name } : x));
              });
            })
            .catch(() => {
              // ignore
            });
        });
        markers.set(p.id, marker);
      } else {
        existing.setLatLng([p.lat, p.lon]);
        existing.setPopupContent(p.name);
      }
    }

    for (const [id, m] of markers.entries()) {
      if (!alive.has(id)) {
        m.remove();
        markers.delete(id);
      }
    }
  }, [editingRoute, routeEdit, mapReadyEpoch]);

  // Connect WS + join convoy
  useEffect(() => {
    if (!id) return;
    queueMicrotask(() => {
      setWsError(null);
      setJoined(false);
      setMembersLive({});
    });
    joinedRef.current = false;

    if (!token) {
      wsRef.current?.close();
      wsRef.current = null;
      queueMicrotask(() => setWsError('Not authenticated'));
      return;
    }

    const client = new ConvoyWsClient(token, handleWsMessage);
    wsRef.current = client;

    let cancelled = false;
    client.connect()
      .then(() => {
        if (cancelled) return;
        client.send({ type: 'convoy:join', convoyId: id });
      })
      .catch((e) => {
        if (cancelled) return;
        setWsError(e instanceof Error ? e.message : 'WS connection error');
      });

    return () => {
      cancelled = true;
      client.close();
      wsRef.current = null;
      joinedRef.current = false;
      setJoined(false);
    };
  }, [id, token, handleWsMessage]);

  // Update member markers on map
  useEffect(() => {
    const L = LRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    for (const m of membersMerged) {
      if (typeof m.lat !== 'number' || typeof m.lon !== 'number') continue;
      const key = m.userId;
      const existing = memberMarkersRef.current.get(key);
      const popupText = `${m.name || m.userId}${m.status ? `\nstatus: ${m.status}` : ''}`;

      if (!existing) {
        const marker = L.marker([m.lat, m.lon]).addTo(map);
        marker.bindPopup(popupText);
        memberMarkersRef.current.set(key, marker);
      } else {
        existing.setLatLng([m.lat, m.lon]);
        existing.setPopupContent(popupText);
      }
    }
  }, [membersMerged]);

  // Draw tracks polylines
  useEffect(() => {
    const L = LRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    const polylines = trackPolylinesRef.current;
    const alive = new Set<string>();

    for (const track of tracks) {
      if (!track?.userId || !Array.isArray(track.points) || track.points.length < 2) continue;
      const latlngs = track.points
        .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
        .map((p) => [p.lat, p.lon] as [number, number]);
      if (latlngs.length < 2) continue;

      alive.add(track.userId);
      const existing = polylines.get(track.userId);
      const color = colorForUserId(track.userId);
      if (!existing) {
        const poly = L.polyline(latlngs, { color, weight: 3, opacity: 0.75 }).addTo(map);
        polylines.set(track.userId, poly);
      } else {
        existing.setLatLngs(latlngs);
      }
    }

    for (const [uid, poly] of polylines.entries()) {
      if (!alive.has(uid)) {
        poly.remove();
        polylines.delete(uid);
      }
    }
  }, [tracks]);

  const toggleShareLocation = useCallback(() => {
    if (!id) return;
    if (sharingLocation) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setSharingLocation(false);
      return;
    }

    if (!navigator.geolocation) {
      alert('Geolocation is not supported');
      return;
    }
    if (!wsRef.current) {
      alert('WebSocket is not connected');
      return;
    }
    if (!joinedRef.current) {
      alert('Join convoy first (WS)');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const payload = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          speed: pos.coords.speed ?? undefined,
          heading: pos.coords.heading ?? undefined,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now()
        };
        try {
          wsRef.current?.send({ type: 'ping', convoyId: id, payload });
        } catch (e) {
          console.error(e);
        }
      },
      (err) => {
        setWsError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
    watchIdRef.current = watchId;
    setSharingLocation(true);
  }, [sharingLocation, id]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  if (!id) return <p className="text-slate-500">Invalid convoy ID</p>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{current?.title || 'Loading...'}</h1>
          {current && (
            <div className="flex items-center gap-3 mt-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                current.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'
              }`}>
                {current.status}
              </span>
              <span className={`inline-flex items-center gap-1 text-xs ${joined ? 'text-emerald-600' : 'text-slate-400'}`}>
                <span className={`w-2 h-2 rounded-full ${joined ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                {joined ? 'Live' : 'Connecting...'}
              </span>
            </div>
          )}

          {current?.members?.length && isLeader && (
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-4">Leadership</h3>
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <div className="sm:col-span-2">
                  <label className="label">Transfer leadership to</label>
                  <select
                    value={newLeaderId}
                    onChange={(e) => setNewLeaderId(e.target.value)}
                    className="input"
                  >
                    <option value="">Select member</option>
                    {(current.members || [])
                      .filter((m) => m.userId !== current.leaderId)
                      .map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.user?.name || m.user?.phone || m.userId.slice(0, 8)}
                        </option>
                      ))}
                  </select>
                </div>
                <button
                  className="btn-secondary"
                  disabled={!id || !newLeaderId || transferLoading}
                  onClick={async () => {
                    if (!id || !newLeaderId) return;
                    setTransferLoading(true);
                    setTransferError(null);
                    try {
                      await transferConvoyLeader(id, newLeaderId);
                      await loadOne(id);
                      setNewLeaderId('');
                    } catch (e) {
                      setTransferError(e instanceof Error ? e.message : 'Failed to transfer leadership');
                    } finally {
                      setTransferLoading(false);
                    }
                  }}
                >
                  {transferLoading ? 'Transferring...' : 'Transfer'}
                </button>
              </div>
              {transferError && <div className="text-sm text-red-600 mt-3">{transferError}</div>}
            </div>
          )}
        </div>
        <button onClick={() => loadOne(id)} disabled={loading} className="btn-secondary">
          {loading ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Reload
        </button>
      </div>

      {/* Errors */}
      {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
      {wsError && <div className="bg-amber-50 text-amber-700 px-4 py-3 rounded-lg text-sm">WebSocket: {wsError}</div>}
      {tracksError && <div className="bg-amber-50 text-amber-700 px-4 py-3 rounded-lg text-sm">Tracks: {tracksError}</div>}
      {routeError && <div className="bg-amber-50 text-amber-700 px-4 py-3 rounded-lg text-sm">Route: {routeError}</div>}
      {pollsError && <div className="bg-amber-50 text-amber-700 px-4 py-3 rounded-lg text-sm">Polls: {pollsError}</div>}
      {eventsError && <div className="bg-amber-50 text-amber-700 px-4 py-3 rounded-lg text-sm">Events: {eventsError}</div>}
      {forumError && <div className="bg-amber-50 text-amber-700 px-4 py-3 rounded-lg text-sm">Forum: {forumError}</div>}
      {settingsError && <div className="bg-amber-50 text-amber-700 px-4 py-3 rounded-lg text-sm">Settings: {settingsError}</div>}

      {!current ? (
        <div className="card text-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto" />
          <p className="text-slate-500 mt-4">Loading convoy data...</p>
        </div>
      ) : (
        <>
          {/* Info Cards */}
          <div className="grid sm:grid-cols-4 gap-4">
            <div className="card">
              <div className="text-sm text-slate-500 mb-1">Invite Code</div>
              <div className="font-mono text-lg font-semibold text-indigo-600">
                {current.invites?.[0]?.code || current.inviteCode || 'N/A'}
              </div>
            </div>
            <div className="card">
              <div className="text-sm text-slate-500 mb-1">Start Time</div>
              <div className="font-medium text-slate-900">
                {current.startTime ? new Date(current.startTime).toLocaleString() : 'Not set'}
              </div>
            </div>
            <div className="card">
              <div className="text-sm text-slate-500 mb-1">Members</div>
              <div className="font-medium text-slate-900">{membersMerged.length} online</div>
            </div>

            <div className="card">
              <div className="text-sm text-slate-500 mb-1">Leader</div>
              <div className="font-medium text-slate-900 truncate">{leaderLabel}</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={toggleShareLocation}
              disabled={!token || !joined}
              className={sharingLocation ? 'btn-danger' : 'btn-success'}
            >
              {sharingLocation ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                  Stop Sharing
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Share Location
                </>
              )}
            </button>
            <button onClick={refreshTracks} disabled={!token || tracksLoading} className="btn-secondary">
              {tracksLoading ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              )}
              Refresh Tracks
            </button>

            {isLeader && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  if (!current?.route?.length) return;
                  const looped = isLoopedRoute(current.route);
                  const base = looped ? current.route.slice(0, -1) : current.route;
                  const normalized: RouteEditPoint[] = base.map((p, idx) => ({
                    id: makeId(),
                    lat: p.lat,
                    lon: p.lon,
                    name: p.name || `Point ${idx + 1}`
                  }));
                  setRouteEdit(normalized);
                  setRouteEditCloseLoop(looped);
                  setRouteEditError(null);
                  setEditingRoute(true);
                }}
                disabled={!current?.route?.length}
              >
                Edit Route
              </button>
            )}

            {isLeader && (
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  if (!id) return;
                  setRandomEventLoading(true);
                  setEventsError(null);
                  try {
                    await createRandomConvoyEvent(id);
                    refreshEvents();
                  } catch (e) {
                    setEventsError(e instanceof Error ? e.message : 'Failed to create event');
                  } finally {
                    setRandomEventLoading(false);
                  }
                }}
                disabled={!id || randomEventLoading}
              >
                {randomEventLoading ? 'Creating event...' : 'Random Event'}
              </button>
            )}

            <button type="button" className="btn-secondary" onClick={refreshPolls} disabled={pollsLoading}>
              {pollsLoading ? 'Loading polls...' : 'Refresh Polls'}
            </button>

            <button type="button" className="btn-secondary" onClick={refreshEvents} disabled={eventsLoading}>
              {eventsLoading ? 'Loading events...' : 'Refresh Events'}
            </button>

            <button type="button" className="btn-secondary" onClick={refreshForumPosts} disabled={forumLoading}>
              {forumLoading ? 'Loading forum...' : 'Refresh Forum'}
            </button>
          </div>

          {isLeader && current && (
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-4">Convoy Settings</h3>
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="label">Privacy</label>
                  <select value={settingsPrivacy} onChange={(e) => setSettingsPrivacy(e.target.value as 'invite' | 'open')} className="input">
                    <option value="invite">Invite</option>
                    <option value="open">Open</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={settingsSaving || !id}
                  onClick={async () => {
                    if (!id) return;
                    setSettingsSaving(true);
                    setSettingsError(null);
                    try {
                      await updateConvoy(id, { privacy: settingsPrivacy });
                      await loadOne(id);
                    } catch (e) {
                      setSettingsError(e instanceof Error ? e.message : 'Failed to save settings');
                    } finally {
                      setSettingsSaving(false);
                    }
                  }}
                >
                  {settingsSaving ? 'Saving...' : 'Save'}
                </button>

                <div className="sm:col-span-3" />

                <div className="sm:col-span-2">
                  <label className="label">Add member by phone</label>
                  <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} className="input" placeholder="+1234567890" />
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!id || addMemberLoading || !addPhone.trim()}
                  onClick={async () => {
                    if (!id) return;
                    const phone = addPhone.trim();
                    if (!phone) return;
                    setAddMemberLoading(true);
                    setSettingsError(null);
                    try {
                      await addConvoyMemberByPhone(id, phone);
                      await loadOne(id);
                      setAddPhone('');
                    } catch (e) {
                      setSettingsError(e instanceof Error ? e.message : 'Failed to add member');
                    } finally {
                      setAddMemberLoading(false);
                    }
                  }}
                >
                  {addMemberLoading ? 'Adding...' : 'Add'}
                </button>
              </div>

              <div className="mt-4">
                <div className="text-sm text-slate-500 mb-2">Members</div>
                <div className="space-y-2">
                  {(current.members || []).map((m) => (
                    <div key={m.userId} className="flex items-center justify-between gap-3 p-2 bg-slate-50 rounded-lg">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">{m.user?.name || m.user?.phone || m.userId.slice(0, 8)}</div>
                        <div className="text-xs text-slate-500">{m.role}</div>
                      </div>
                      {m.userId !== current.leaderId && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={async () => {
                            if (!id) return;
                            setSettingsError(null);
                            try {
                              await kickConvoyMember(id, m.userId);
                              await loadOne(id);
                            } catch (e) {
                              setSettingsError(e instanceof Error ? e.message : 'Failed to remove member');
                            }
                          }}
                        >
                          Kick
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Forum</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Persistent convoy discussions for route notes, rules, stops, and decisions that should not disappear in chat.
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {forumPosts.length} posts
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <div>
                <label className="label">{editingForumPostId ? 'Edit discussion title' : 'Discussion title'}</label>
                <input
                  value={forumTitle}
                  onChange={(event) => setForumTitle(event.target.value)}
                  className="input"
                  placeholder="Fuel stop plan, route warning, meeting point..."
                />
              </div>
              <div>
                <label className="label">Body</label>
                <textarea
                  value={forumBody}
                  onChange={(event) => setForumBody(event.target.value)}
                  className="input"
                  rows={4}
                  placeholder="Write a longer note for the convoy..."
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={forumSaving || !forumTitle.trim() || !forumBody.trim()}
                  onClick={submitForumPost}
                >
                  {forumSaving
                    ? 'Saving...'
                    : editingForumPostId
                      ? 'Save Changes'
                      : 'Publish Discussion'}
                </button>
                {editingForumPostId && (
                  <button type="button" className="btn-secondary" onClick={cancelForumEdit} disabled={forumSaving}>
                    Cancel Edit
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {forumPosts.length === 0 && !forumLoading ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                  No forum discussions yet. Start with route rules, stop planning, or known road issues.
                </div>
              ) : (
                forumPosts.slice(0, 50).map((post) => {
                  const authorLabel = post.author?.name || post.author?.phone || nameByUserId.get(post.authorId) || post.authorId.slice(0, 8);
                  const canManagePost = isLeader || post.authorId === myUserId;
                  return (
                    <div key={post.id} className={`rounded-xl border p-4 ${
                      post.pinned ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                    }`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {post.pinned && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                Pinned
                              </span>
                            )}
                            <h4 className="font-semibold text-slate-900">{post.title}</h4>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {authorLabel} • updated {new Date(post.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isLeader && (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={async () => {
                                if (!id) return;
                                setForumError(null);
                                try {
                                  await updateForumPost(id, post.id, { pinned: !post.pinned });
                                  refreshForumPosts();
                                } catch (e) {
                                  setForumError(e instanceof Error ? e.message : 'Failed to update pin');
                                }
                              }}
                            >
                              {post.pinned ? 'Unpin' : 'Pin'}
                            </button>
                          )}
                          {canManagePost && (
                            <button type="button" className="btn-secondary" onClick={() => startForumEdit(post)}>
                              Edit
                            </button>
                          )}
                          {canManagePost && (
                            <button
                              type="button"
                              className="btn-danger"
                              onClick={async () => {
                                if (!id) return;
                                if (!window.confirm('Delete this forum post?')) return;
                                setForumError(null);
                                try {
                                  await deleteForumPost(id, post.id);
                                  if (editingForumPostId === post.id) cancelForumEdit();
                                  refreshForumPosts();
                                } catch (e) {
                                  setForumError(e instanceof Error ? e.message : 'Failed to delete forum post');
                                }
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">
                        {post.body}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-4">Events</h3>
              {events.length === 0 && !eventsLoading ? (
                <div className="text-sm text-slate-500">No events yet</div>
              ) : (
                <div className="space-y-2">
                  {events.slice(0, 20).map((e) => (
                    <div key={e.id} className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-sm font-medium text-slate-900">{e.title}</div>
                      <div className="text-xs text-slate-500 mt-1">{new Date(e.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-4">Polls</h3>

              {isLeader && (
                <div className="mb-4 p-3 bg-slate-50 rounded-lg">
                  <div className="grid gap-3">
                    <div>
                      <label className="label">Question</label>
                      <input value={newPollQuestion} onChange={(e) => setNewPollQuestion(e.target.value)} className="input" placeholder="Where do we stop?" />
                    </div>
                    <div>
                      <label className="label">Options (one per line)</label>
                      <textarea value={newPollOptionsText} onChange={(e) => setNewPollOptionsText(e.target.value)} className="input" rows={3} placeholder="Option 1\nOption 2" />
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={pollCreateLoading || !id}
                      onClick={async () => {
                        if (!id) return;
                        const question = newPollQuestion.trim();
                        const options = newPollOptionsText
                          .split('\n')
                          .map((x) => x.trim())
                          .filter(Boolean);
                        if (!question || options.length < 2) {
                          setPollsError('Provide a question and at least 2 options');
                          return;
                        }
                        setPollCreateLoading(true);
                        setPollsError(null);
                        try {
                          await createPoll(id, { question, options });
                          setNewPollQuestion('');
                          setNewPollOptionsText('');
                          refreshPolls();
                        } catch (e) {
                          setPollsError(e instanceof Error ? e.message : 'Failed to create poll');
                        } finally {
                          setPollCreateLoading(false);
                        }
                      }}
                    >
                      {pollCreateLoading ? 'Creating...' : 'Create Poll'}
                    </button>
                  </div>
                </div>
              )}

              {polls.length === 0 && !pollsLoading ? (
                <div className="text-sm text-slate-500">No polls yet</div>
              ) : (
                <div className="space-y-3">
                  {polls.slice(0, 10).map((p) => (
                    <div key={p.id} className="p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium text-slate-900">{p.question}</div>
                        {isLeader && p.status === 'open' && (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={async () => {
                              if (!id) return;
                              try {
                                await closePoll(id, p.id);
                                refreshPolls();
                              } catch (e) {
                                setPollsError(e instanceof Error ? e.message : 'Failed to close poll');
                              }
                            }}
                          >
                            Close
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">{p.status} • {new Date(p.createdAt).toLocaleString()}</div>
                      <div className="mt-3 space-y-2">
                        {p.options.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            className={`w-full text-left px-3 py-2 rounded-lg border ${
                              p.myVoteOptionId === o.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'
                            }`}
                            disabled={p.status !== 'open'}
                            onClick={async () => {
                              if (!id) return;
                              try {
                                await votePoll(id, p.id, o.id);
                                refreshPolls();
                              } catch (e) {
                                setPollsError(e instanceof Error ? e.message : 'Failed to vote');
                              }
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm text-slate-900">{o.text}</div>
                              <div className="text-xs text-slate-500">{o.votes}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {editingRoute && isLeader && routeEdit && (
            <div className="card">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="font-semibold text-slate-900">Edit Route</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setEditingRoute(false);
                      setRouteEdit(null);
                      setRouteEditError(null);
                      setRouteEditSaving(false);
                      setRouteEditDragIndex(null);
                      setRouteEditCloseLoop(false);
                    }}
                    disabled={routeEditSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={routeEditSaving || routeEdit.length < 2 || !id}
                    onClick={async () => {
                      if (!id) return;
                      setRouteEditSaving(true);
                      setRouteEditError(null);
                      try {
                        const base: LocationPoint[] = routeEdit.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name }));
                        const route: LocationPoint[] = routeEditCloseLoop && base.length > 2 ? [...base, base[0]] : base;
                        await updateConvoy(id, { route });
                        await loadOne(id);
                        setEditingRoute(false);
                        setRouteEdit(null);
                      } catch (e) {
                        setRouteEditError(e instanceof Error ? e.message : 'Failed to save route');
                      } finally {
                        setRouteEditSaving(false);
                      }
                    }}
                  >
                    {routeEditSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={routeEditCloseLoop} onChange={(e) => setRouteEditCloseLoop(e.target.checked)} />
                <span>Замкнуть маршрут</span>
              </label>

              <div className="mt-4 space-y-2">
                {routeEdit.map((p, idx) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={() => setRouteEditDragIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (routeEditDragIndex === null || routeEditDragIndex === idx) return;
                      setRouteEdit((prev) => {
                        if (!prev) return prev;
                        const next = [...prev];
                        const [moved] = next.splice(routeEditDragIndex, 1);
                        next.splice(idx, 0, moved);
                        return next;
                      });
                      setRouteEditDragIndex(null);
                    }}
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg cursor-move"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${
                      idx === 0 ? 'bg-emerald-500' : idx === routeEdit.length - 1 ? 'bg-red-500' : 'bg-indigo-500'
                    }`}>
                      {idx + 1}
                    </div>
                    <input
                      value={p.name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRouteEdit((prev) => prev ? prev.map((x) => (x.id === p.id ? { ...x, name: v } : x)) : prev);
                      }}
                      className="input flex-1"
                    />
                    <span className="text-xs text-slate-500 font-mono">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</span>
                  </div>
                ))}
              </div>

              {routeEditError && <div className="text-sm text-red-600 mt-3">{routeEditError}</div>}
              <div className="text-xs text-slate-500 mt-2">
                Tip: you can drag markers on the map to change coordinates.
              </div>
            </div>
          )}

          {/* Map */}
          <div className="card p-0 overflow-hidden">
            <div ref={mapContainerRef} className="w-full h-96" />
          </div>

          {/* Route & Members Grid */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Route Points */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-4">Route Points</h3>
              {(routeLoading || routedRoute) && (
                <div className="text-xs text-slate-500 mb-3">
                  {routeLoading
                    ? 'Building road route...'
                    : routedRoute
                      ? `Road route: ${(routedRoute.distanceMeters / 1000).toFixed(1)} km • ${(routedRoute.durationSeconds / 60).toFixed(0)} min`
                      : ''}
                </div>
              )}
              <div className="space-y-2">
                {current.route.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium ${
                      idx === 0 ? 'bg-emerald-500' : idx === current.route.length - 1 ? 'bg-red-500' : 'bg-indigo-500'
                    }`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-slate-900 text-sm">{p.name || `Point ${idx + 1}`}</div>
                      <div className="text-xs text-slate-500 font-mono">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Members */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-4">Live Members</h3>
              {membersMerged.length === 0 ? (
                <p className="text-slate-500 text-sm">No live location data yet</p>
              ) : (
                <div className="space-y-3">
                  {membersMerged.map((m) => (
                    <div key={m.userId} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                        <span className="text-indigo-600 font-semibold text-sm">
                          {(m.name || m.userId).slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 truncate">{m.name || m.userId.slice(0, 8)}</div>
                        <div className="text-xs text-slate-500">
                          {typeof m.lat === 'number' && typeof m.lon === 'number' 
                            ? `${m.lat.toFixed(4)}, ${m.lon.toFixed(4)}`
                            : 'No location'}
                          {typeof m.speed === 'number' && ` • ${m.speed.toFixed(0)} km/h`}
                        </div>
                      </div>
                      {m.status && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          m.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {m.status}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Chat */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Chat</h3>
              <div className="text-xs text-slate-500">Realtime</div>
            </div>

            {chatError && (
              <div className="bg-amber-50 text-amber-700 px-3 py-2 rounded-lg text-sm mb-3">{chatError}</div>
            )}

            <div className="h-72 overflow-auto rounded-lg border border-slate-200 bg-white">
              <div className="p-3 space-y-3">
                {chatLoading ? (
                  <div className="text-sm text-slate-500">Loading chat...</div>
                ) : chatMessages.length === 0 ? (
                  <div className="text-sm text-slate-500">No messages yet</div>
                ) : (
                  chatMessages.map((m) => (
                    <div key={m.id} className="flex gap-3">
                      <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-none">
                        <span className="text-indigo-700 text-xs font-semibold">
                          {(nameByUserId.get(m.userId) || m.userId.slice(0, 2)).slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {nameByUserId.get(m.userId) || m.userId.slice(0, 8)}
                          </div>
                          <div className="text-xs text-slate-400 flex-none">
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{m.text}</div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                className="input flex-1"
                placeholder={joined ? 'Type a message...' : 'Connect to convoy to chat...'}
                disabled={!token}
              />
              <button className="btn-primary" onClick={sendChat} disabled={!token || !joined || !chatText.trim()}>
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

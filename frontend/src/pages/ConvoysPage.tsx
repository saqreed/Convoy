import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import NearbyConvoysMap from '../components/NearbyConvoysMap';
import { getConvoyPublicPreview, listNearbyOpenConvoys } from '../lib/mockApi';
import { useAuthStore } from '../store/auth';
import { useConvoyStore } from '../store/convoys';
import type { ConvoyPublicPreview, NearbyOpenConvoy } from '../types';

function requestCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    });
  });
}

function formatDistance(distanceKm: number) {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
}

function formatLocationError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: number }).code;
    if (code === 1) return 'Location permission was denied.';
    if (code === 2) return 'Unable to determine your current location.';
    if (code === 3) return 'Location request timed out.';
  }
  if (error instanceof Error) return error.message;
  return 'Failed to get your location.';
}

function formatStartLabel(value: string | null) {
  if (!value) return 'Flexible start';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function buildStartWindow(filter: 'any' | '24h' | '7d' | 'future') {
  if (filter === 'any') return {};

  const now = new Date();
  if (filter === 'future') {
    return { startAfter: now.toISOString() };
  }

  const end = new Date(now);
  end.setHours(end.getHours() + (filter === '24h' ? 24 : 24 * 7));
  return {
    startAfter: now.toISOString(),
    startBefore: end.toISOString()
  };
}

function buildRouteWindow(filter: 'any' | 'short' | 'medium' | 'long') {
  if (filter === 'short') return { minRouteKm: 0, maxRouteKm: 25 };
  if (filter === 'medium') return { minRouteKm: 25, maxRouteKm: 120 };
  if (filter === 'long') return { minRouteKm: 120 };
  return {};
}

function renderPreviewMeta(preview: ConvoyPublicPreview) {
  return [
    `${preview.memberCount} members`,
    `${preview.routePointCount} route points`,
    `${preview.routeLengthKm.toFixed(1)} km route`
  ].join(' • ');
}

export default function ConvoysPage() {
  const navigate = useNavigate();
  const items = useConvoyStore((state) => state.items);
  const loading = useConvoyStore((state) => state.loading);
  const error = useConvoyStore((state) => state.error);
  const loadAll = useConvoyStore((state) => state.loadAll);
  const joinOne = useConvoyStore((state) => state.joinOne);
  const token = useAuthStore((state) => state.token);

  const [nearbyConvoys, setNearbyConvoys] = useState<NearbyOpenConvoy[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(25);
  const [statusFilter, setStatusFilter] = useState<'any' | 'planned' | 'active'>('any');
  const [startFilter, setStartFilter] = useState<'any' | '24h' | '7d' | 'future'>('any');
  const [routeFilter, setRouteFilter] = useState<'any' | 'short' | 'medium' | 'long'>('any');
  const [selectedNearbyId, setSelectedNearbyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ConvoyPublicPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [joiningConvoyId, setJoiningConvoyId] = useState<string | null>(null);

  const deferredRadiusKm = useDeferredValue(radiusKm);
  const deferredStatusFilter = useDeferredValue(statusFilter);
  const deferredStartFilter = useDeferredValue(startFilter);
  const deferredRouteFilter = useDeferredValue(routeFilter);
  const deferredNearbyConvoys = useDeferredValue(nearbyConvoys);

  useEffect(() => {
    if (token) loadAll();
  }, [loadAll, token]);

  useEffect(() => {
    if (!token || !position) return;

    let cancelled = false;
    setNearbyLoading(true);
    setNearbyError(null);

    const startWindow = buildStartWindow(deferredStartFilter);
    const routeWindow = buildRouteWindow(deferredRouteFilter);

    listNearbyOpenConvoys({
      lat: position.lat,
      lon: position.lon,
      radiusKm: deferredRadiusKm,
      limit: 12,
      status: deferredStatusFilter === 'any' ? undefined : deferredStatusFilter,
      ...startWindow,
      ...routeWindow
    })
      .then((result) => {
        if (cancelled) return;
        startTransition(() => {
          setNearbyConvoys(result);
        });
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setNearbyError(fetchError instanceof Error ? fetchError.message : 'Failed to load nearby convoys');
      })
      .finally(() => {
        if (cancelled) return;
        setNearbyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [deferredRadiusKm, deferredRouteFilter, deferredStartFilter, deferredStatusFilter, position, token]);

  useEffect(() => {
    if (nearbyConvoys.length === 0) {
      setSelectedNearbyId(null);
      setPreview(null);
      setPreviewError(null);
      return;
    }

    if (selectedNearbyId && nearbyConvoys.some((convoy) => convoy.id === selectedNearbyId)) return;
    setSelectedNearbyId(nearbyConvoys[0].id);
  }, [nearbyConvoys, selectedNearbyId]);

  useEffect(() => {
    if (!token || !selectedNearbyId) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    getConvoyPublicPreview(selectedNearbyId)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(fetchError instanceof Error ? fetchError.message : 'Failed to load convoy preview');
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNearbyId, token]);

  const stats = useMemo(() => {
    const activeCount = items.filter((item) => item.status === 'active').length;
    const openCount = items.filter((item) => item.privacy === 'open').length;
    const now = Date.now();
    const nextStart = items
      .filter((item) => item.startTime)
      .map((item) => item.startTime as string)
      .filter((value) => Date.parse(value) >= now)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;

    return {
      total: items.length,
      activeCount,
      openCount,
      nextStart
    };
  }, [items]);

  async function detectNearbyConvoys() {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.');
      return;
    }

    setLocationError(null);
    try {
      const currentPosition = await requestCurrentPosition();
      setPosition({
        lat: currentPosition.coords.latitude,
        lon: currentPosition.coords.longitude
      });
    } catch (geoError) {
      setLocationError(formatLocationError(geoError));
    }
  }

  async function joinOpenConvoy(convoyId: string) {
    setJoiningConvoyId(convoyId);
    setPreviewError(null);
    setNearbyError(null);
    try {
      await joinOne(convoyId);
      navigate(`/convoys/${convoyId}`);
    } catch (joinError) {
      const message = joinError instanceof Error ? joinError.message : 'Failed to join convoy';
      setPreviewError(message);
      setNearbyError(message);
    } finally {
      setJoiningConvoyId(null);
    }
  }

  if (!token) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
          <svg className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-semibold text-slate-900">Sign in required</h2>
        <p className="mb-6 text-slate-500">Please sign in to view your convoys</p>
        <Link to="/auth" className="btn-primary">Sign In</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Convoys</h1>
          <p className="mt-1 text-slate-500">Manage your convoy trips and discover open convoys nearby.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={loadAll} disabled={loading} className="btn-secondary">
            {loading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
          <Link to="/convoys/create" className="btn-primary">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Convoy
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <div className="text-sm text-slate-500">Total convoys</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{stats.total}</div>
          <div className="mt-2 text-xs text-slate-500">Everything you currently lead or joined.</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">Active now</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{stats.activeCount}</div>
          <div className="mt-2 text-xs text-slate-500">Useful when you need a fast jump back into live tracking.</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">Next planned start</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">{stats.nextStart ? formatStartLabel(stats.nextStart) : 'Nothing scheduled'}</div>
          <div className="mt-2 text-xs text-slate-500">{stats.openCount} of your convoys are open to public discovery.</div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.15),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,0.03),_rgba(15,23,42,0))] px-6 py-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Open Convoys Nearby</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Nearby discovery now follows the product direction from the tech spec: map-first orientation,
                direct joining for open convoys, and preview-before-join.
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={detectNearbyConvoys}>
              {position ? 'Refresh Nearby' : 'Use My Location'}
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} className="input">
              <option value={10}>10 km radius</option>
              <option value={25}>25 km radius</option>
              <option value={50}>50 km radius</option>
              <option value={100}>100 km radius</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="input">
              <option value="any">Any status</option>
              <option value="planned">Planned only</option>
              <option value="active">Active only</option>
            </select>
            <select value={startFilter} onChange={(event) => setStartFilter(event.target.value as typeof startFilter)} className="input">
              <option value="any">Any start time</option>
              <option value="future">Any future start</option>
              <option value="24h">Starting in 24h</option>
              <option value="7d">Starting in 7 days</option>
            </select>
            <select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value as typeof routeFilter)} className="input">
              <option value="any">Any route length</option>
              <option value="short">Short route (0-25 km)</option>
              <option value="medium">Medium route (25-120 km)</option>
              <option value="long">Long route (120+ km)</option>
            </select>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>Only open convoys you have not joined yet are shown here.</span>
            {position && <span>Lookup point: {position.lat.toFixed(3)}, {position.lon.toFixed(3)}</span>}
          </div>
        </div>

        <div className="space-y-4 px-6 py-6">
          {locationError && (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">{locationError}</div>
          )}

          {nearbyError && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{nearbyError}</div>
          )}

          {!position ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              Nearby discovery is idle until you share your current location.
            </div>
          ) : nearbyLoading ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
              <div className="h-[24rem] animate-pulse rounded-[1.5rem] border border-slate-200 bg-slate-100" />
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
                <div className="mt-4 h-3 w-full animate-pulse rounded bg-slate-200" />
                <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-slate-200" />
                <div className="mt-8 h-12 w-full animate-pulse rounded-xl bg-slate-200" />
              </div>
            </div>
          ) : deferredNearbyConvoys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              No open convoys were found with the current filters. Try a larger radius or broaden the route and time filters.
            </div>
          ) : (
            <>
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
                <NearbyConvoysMap
                  convoys={deferredNearbyConvoys}
                  origin={position}
                  selectedConvoyId={selectedNearbyId}
                  onSelect={(convoyId) => {
                    startTransition(() => {
                      setSelectedNearbyId(convoyId);
                    });
                  }}
                />

                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                  {previewLoading ? (
                    <div>
                      <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
                      <div className="mt-4 h-3 w-full animate-pulse rounded bg-slate-200" />
                      <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-slate-200" />
                      <div className="mt-8 h-12 w-full animate-pulse rounded-xl bg-slate-200" />
                    </div>
                  ) : previewError ? (
                    <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{previewError}</div>
                  ) : !preview ? (
                    <div className="text-sm text-slate-500">Select a convoy on the map or in the list to preview it.</div>
                  ) : (
                    <div className="space-y-5">
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                              Pre-Join Preview
                            </div>
                            <h3 className="mt-2 text-xl font-semibold text-slate-900">{preview.title}</h3>
                          </div>
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                            preview.status === 'active'
                              ? 'bg-emerald-100 text-emerald-700'
                              : preview.status === 'planned'
                                ? 'bg-indigo-100 text-indigo-700'
                                : 'bg-slate-100 text-slate-600'
                          }`}>
                            {preview.status}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-slate-500">{renderPreviewMeta(preview)}</div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Leader</div>
                        <div className="mt-3 flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                            {(preview.leader.name || preview.leader.phone || 'CV').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-slate-900">{preview.leader.name || 'Unnamed leader'}</div>
                            <div className="text-sm text-slate-500">{preview.leader.phone || 'Phone hidden'}</div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Start</div>
                          <div className="mt-2 text-sm font-medium text-slate-900">{preview.startPoint?.name || 'Route start not named'}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatStartLabel(preview.startTime)}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Finish</div>
                          <div className="mt-2 text-sm font-medium text-slate-900">{preview.endPoint?.name || 'Route finish not named'}</div>
                          <div className="mt-1 text-xs text-slate-500">{preview.inviteRequired ? 'Invite required' : 'Open join available'}</div>
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Route Preview</div>
                        <div className="max-h-56 space-y-2 overflow-auto pr-1">
                          {preview.route.slice(0, 8).map((point, index) => (
                            <div key={`${point.lat}-${point.lon}-${index}`} className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2">
                              <div className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ${
                                index === 0 ? 'bg-emerald-500' : index === preview.route.length - 1 ? 'bg-red-500' : 'bg-slate-700'
                              }`}>
                                {index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-slate-900">{point.name || `Route point ${index + 1}`}</div>
                                <div className="text-xs text-slate-500">{point.lat.toFixed(4)}, {point.lon.toFixed(4)}</div>
                              </div>
                            </div>
                          ))}
                          {preview.route.length > 8 && (
                            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
                              {preview.route.length - 8} more points hidden in preview.
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn-primary w-full"
                        disabled={joiningConvoyId === preview.id || preview.alreadyJoined}
                        onClick={() => joinOpenConvoy(preview.id)}
                      >
                        {preview.alreadyJoined
                          ? 'Already Joined'
                          : joiningConvoyId === preview.id
                            ? 'Joining...'
                            : 'Join This Open Convoy'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {deferredNearbyConvoys.map((convoy) => (
                  <button
                    key={convoy.id}
                    type="button"
                    onClick={() => setSelectedNearbyId(convoy.id)}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      convoy.id === selectedNearbyId
                        ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{convoy.title}</div>
                        <div className="mt-1 text-sm text-slate-500">{formatDistance(convoy.distanceKm)} away</div>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {convoy.routeLengthKm.toFixed(1)} km
                      </span>
                    </div>
                    <div className="mt-3 text-sm text-slate-600">
                      {convoy.memberCount} members • {formatStartLabel(convoy.startTime)}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {convoy.startPoint?.name || 'Unnamed start'} → {convoy.endPoint?.name || 'Unnamed finish'}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {items.length === 0 && !loading ? (
        <div className="card py-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <svg className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-medium text-slate-900">No convoys yet</h3>
          <p className="mb-6 text-slate-500">Create your first convoy or join an existing one</p>
          <div className="flex justify-center gap-3">
            <Link to="/convoys/create" className="btn-primary">Create Convoy</Link>
            <Link to="/convoys/join" className="btn-secondary">Join Convoy</Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((convoy) => (
            <Link key={convoy.id} to={`/convoys/${convoy.id}`} className="card group hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    convoy.status === 'active' ? 'bg-emerald-100' : convoy.status === 'planned' ? 'bg-indigo-100' : 'bg-slate-100'
                  }`}>
                    <svg className={`h-5 w-5 ${
                      convoy.status === 'active' ? 'text-emerald-600' : convoy.status === 'planned' ? 'text-indigo-600' : 'text-slate-500'
                    }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 transition-colors group-hover:text-indigo-600">{convoy.title}</h3>
                    <div className="mt-0.5 flex items-center gap-3 text-sm text-slate-500">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        convoy.status === 'active' ? 'bg-emerald-100 text-emerald-700' : convoy.status === 'planned' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {convoy.status}
                      </span>
                      <span>{new Date(convoy.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <svg className="h-5 w-5 text-slate-400 transition-colors group-hover:text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

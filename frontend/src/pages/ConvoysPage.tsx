import { startTransition, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useConvoyStore } from '../store/convoys';
import { useAuthStore } from '../store/auth';
import { listNearbyOpenConvoys } from '../lib/mockApi';
import type { NearbyOpenConvoy } from '../types';

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

export default function ConvoysPage() {
  const navigate = useNavigate();
  const items = useConvoyStore((s) => s.items);
  const loading = useConvoyStore((s) => s.loading);
  const error = useConvoyStore((s) => s.error);
  const loadAll = useConvoyStore((s) => s.loadAll);
  const joinOne = useConvoyStore((s) => s.joinOne);
  const token = useAuthStore((s) => s.token);
  const [nearbyConvoys, setNearbyConvoys] = useState<NearbyOpenConvoy[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(25);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [joiningConvoyId, setJoiningConvoyId] = useState<string | null>(null);

  useEffect(() => {
    if (token) loadAll();
  }, [loadAll, token]);

  useEffect(() => {
    if (!token || !position) return;

    let cancelled = false;
    setNearbyLoading(true);
    setNearbyError(null);

    listNearbyOpenConvoys({
      lat: position.lat,
      lon: position.lon,
      radiusKm,
      limit: 6
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
  }, [position, radiusKm, token]);

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
    setNearbyError(null);
    try {
      await joinOne(convoyId);
      navigate(`/convoys/${convoyId}`);
    } catch (joinError) {
      setNearbyError(joinError instanceof Error ? joinError.message : 'Failed to join convoy');
    } finally {
      setJoiningConvoyId(null);
    }
  }

  if (!token) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Sign in required</h2>
        <p className="text-slate-500 mb-6">Please sign in to view your convoys</p>
        <Link to="/auth" className="btn-primary">Sign In</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Convoys</h1>
          <p className="text-slate-500 mt-1">Manage your convoy trips and discover open convoys nearby.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={loadAll} disabled={loading} className="btn-secondary">
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
            Refresh
          </button>
          <Link to="/convoys/create" className="btn-primary">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      <div className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Open Convoys Nearby</h2>
            <p className="mt-1 text-sm text-slate-500">
              Use your current location to discover nearby open convoys that you can join immediately.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              className="input w-auto min-w-[120px]"
            >
              <option value={10}>10 km radius</option>
              <option value={25}>25 km radius</option>
              <option value={50}>50 km radius</option>
              <option value={100}>100 km radius</option>
            </select>
            <button type="button" className="btn-secondary" onClick={detectNearbyConvoys}>
              {position ? 'Refresh Nearby' : 'Use My Location'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>Only open convoys you have not joined yet are shown here.</span>
          {position && <span>Lookup point: {position.lat.toFixed(3)}, {position.lon.toFixed(3)}</span>}
        </div>

        {locationError && (
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">{locationError}</div>
        )}

        {nearbyError && (
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{nearbyError}</div>
        )}

        {nearbyLoading ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
                <div className="mt-3 h-3 w-48 animate-pulse rounded bg-slate-200" />
                <div className="mt-6 h-10 w-full animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>
        ) : !position ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            Nearby discovery is idle until you share your current location.
          </div>
        ) : nearbyConvoys.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            No open convoys were found within {radiusKm} km. Try a larger radius or refresh your location.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {/* TODO: move this discovery surface to a map-first layout once the
                API returns preview geometry and clustering metadata. */}
            {nearbyConvoys.map((convoy) => (
              <div key={convoy.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{convoy.title}</h3>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {formatDistance(convoy.distanceKm)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {convoy.memberCount} members • {formatStartLabel(convoy.startTime)}
                    </div>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    convoy.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700'
                      : convoy.status === 'planned'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}>
                    {convoy.status}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <div>
                    <span className="font-medium text-slate-900">Start:</span>{' '}
                    {convoy.startPoint?.name || `${convoy.closestPoint.lat.toFixed(4)}, ${convoy.closestPoint.lon.toFixed(4)}`}
                  </div>
                  <div>
                    <span className="font-medium text-slate-900">Finish:</span>{' '}
                    {convoy.endPoint?.name || 'Route endpoint not named yet'}
                  </div>
                  <div className="text-xs text-slate-500">
                    Nearby by {convoy.proximitySource === 'leader-last-ping' ? 'leader live position' : 'route anchor'}.
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">{convoy.routePointCount} route points published</div>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={joiningConvoyId === convoy.id}
                    onClick={() => joinOpenConvoy(convoy.id)}
                  >
                    {joiningConvoyId === convoy.id ? 'Joining...' : 'Join Open Convoy'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 && !loading ? (
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-slate-900 mb-2">No convoys yet</h3>
          <p className="text-slate-500 mb-6">Create your first convoy or join an existing one</p>
          <div className="flex gap-3 justify-center">
            <Link to="/convoys/create" className="btn-primary">Create Convoy</Link>
            <Link to="/convoys/join" className="btn-secondary">Join Convoy</Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((c) => (
            <Link key={c.id} to={`/convoys/${c.id}`} className="card hover:shadow-md transition-shadow group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    c.status === 'active' ? 'bg-emerald-100' : c.status === 'planned' ? 'bg-indigo-100' : 'bg-slate-100'
                  }`}>
                    <svg className={`w-5 h-5 ${
                      c.status === 'active' ? 'text-emerald-600' : c.status === 'planned' ? 'text-indigo-600' : 'text-slate-500'
                    }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{c.title}</h3>
                    <div className="flex items-center gap-3 text-sm text-slate-500 mt-0.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : c.status === 'planned' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {c.status}
                      </span>
                      <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <svg className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

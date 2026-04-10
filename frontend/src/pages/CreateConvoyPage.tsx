import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeocodeSearchResult, LocationPoint } from '../types';
import { useConvoyStore } from '../store/convoys';
import { useNavigate } from 'react-router-dom';
import { geocodeSearch, reverseGeocode } from '../lib/mockApi';

type NamedPoint = LocationPoint & { id: string; label: string };

type LeafletMap = typeof import('leaflet');
type LeafletInstance = ReturnType<LeafletMap['map']> | null;

declare global {
  interface Window {
    L?: LeafletMap;
  }
}

export default function CreateConvoyPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [privacy, setPrivacy] = useState<'invite' | 'open'>('invite');
  const [startDate, setStartDate] = useState<string>('');
  const [startHour, setStartHour] = useState<string>('09');
  const [startMinute, setStartMinute] = useState<string>('00');
  const [startPoint, setStartPoint] = useState<NamedPoint | null>(null);
  const [endPoint, setEndPoint] = useState<NamedPoint | null>(null);
  const [checkpoints, setCheckpoints] = useState<NamedPoint[]>([]);
  const [closeLoop, setCloseLoop] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [addressQuery, setAddressQuery] = useState('');
  const [addressResults, setAddressResults] = useState<GeocodeSearchResult[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletInstance>(null);
  const markersRef = useRef<{ start?: import('leaflet').Marker; end?: import('leaflet').Marker; checkpoints: { marker: import('leaflet').Marker; point: NamedPoint }[] }>({ checkpoints: [] });

  const loading = useConvoyStore((s) => s.loading);
  const error = useConvoyStore((s) => s.error);
  const createOne = useConvoyStore((s) => s.createOne);

  const LRef = useRef<LeafletMap | null>(null);

  const makeId = useCallback(() => {
    const fn = globalThis.crypto?.randomUUID;
    return fn ? fn.call(globalThis.crypto) : Math.random().toString(16).slice(2) + Date.now().toString(16);
  }, []);

  const resolveAddressLabel = useCallback(async (lat: number, lon: number) => {
    try {
      const res = await reverseGeocode(lat, lon);
      const name = (res?.displayName || '').trim();
      return name || null;
    } catch {
      return null;
    }
  }, []);

  const addOrUpdateMarker = useCallback((type: 'start' | 'end', point: NamedPoint) => {
    const L = LRef.current;
    if (!mapInstanceRef.current || !L) return;
    const marker = L.marker([point.lat, point.lon], { draggable: true }).addTo(mapInstanceRef.current);
    marker.bindPopup(point.label).openPopup();
    marker.on('dragend', (e: import('leaflet').LeafletEvent) => {
      const { lat, lng } = e.target.getLatLng();
      const updateCoords = { lat, lon: lng };
      if (type === 'start') {
        setStartPoint((prev) => (prev ? { ...prev, ...updateCoords } : prev));
      } else {
        setEndPoint((prev) => (prev ? { ...prev, ...updateCoords } : prev));
      }
      resolveAddressLabel(lat, lng).then((label) => {
        if (!label) return;
        marker.setPopupContent(label);
        if (type === 'start') {
          setStartPoint((prev) => (prev ? { ...prev, label } : prev));
        } else {
          setEndPoint((prev) => (prev ? { ...prev, label } : prev));
        }
      });
    });
    if (markersRef.current[type]) {
      markersRef.current[type]?.remove();
    }
    markersRef.current[type] = marker;
  }, [resolveAddressLabel]);

  const addCheckpointMarker = useCallback((point: NamedPoint) => {
    const L = LRef.current;
    if (!mapInstanceRef.current || !L) return;
    const marker = L.marker([point.lat, point.lon], { draggable: true, icon: L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41]
    }) }).addTo(mapInstanceRef.current);
    marker.bindPopup(point.label);
    marker.on('dragend', (e: import('leaflet').LeafletEvent) => {
      const { lat, lng } = e.target.getLatLng();
      setCheckpoints((prev) => prev.map((cp) => (cp.id === point.id ? { ...cp, lat, lon: lng } : cp)));
      resolveAddressLabel(lat, lng).then((label) => {
        if (!label) return;
        marker.setPopupContent(label);
        setCheckpoints((prev) => prev.map((cp) => (cp.id === point.id ? { ...cp, label } : cp)));
      });
    });
    markersRef.current.checkpoints.push({ marker, point });
  }, [resolveAddressLabel]);

  const rebuildMarkers = useCallback((ordered: NamedPoint[]) => {
    markersRef.current.start?.remove();
    markersRef.current.end?.remove();
    markersRef.current.checkpoints.forEach(({ marker }) => marker.remove());
    markersRef.current = { checkpoints: [] };

    if (ordered[0]) addOrUpdateMarker('start', ordered[0]);
    if (ordered.length > 1) addOrUpdateMarker('end', ordered[ordered.length - 1]);
    for (const p of ordered.slice(1, -1)) addCheckpointMarker(p);
  }, [addCheckpointMarker, addOrUpdateMarker]);

  const addPointFromMap = useCallback((lat: number, lon: number, label?: string) => {
    if (!startPoint) {
      const point: NamedPoint = { id: makeId(), lat, lon, label: label || 'Старт' };
      setStartPoint(point);
      addOrUpdateMarker('start', point);
      if (!label) {
        resolveAddressLabel(lat, lon).then((addr) => {
          if (!addr) return;
          setStartPoint((prev) => (prev ? { ...prev, label: addr } : prev));
          markersRef.current.start?.setPopupContent(addr);
        });
      }
      return;
    }
    if (!endPoint) {
      const point: NamedPoint = { id: makeId(), lat, lon, label: label || 'Финиш' };
      setEndPoint(point);
      addOrUpdateMarker('end', point);
      if (!label) {
        resolveAddressLabel(lat, lon).then((addr) => {
          if (!addr) return;
          setEndPoint((prev) => (prev ? { ...prev, label: addr } : prev));
          markersRef.current.end?.setPopupContent(addr);
        });
      }
      return;
    }
    const newCheckpoint: NamedPoint = { id: makeId(), lat, lon, label: label || `Чекпоинт ${checkpoints.length + 1}` };
    setCheckpoints((prev) => [...prev, newCheckpoint]);
    addCheckpointMarker(newCheckpoint);
    if (!label) {
      resolveAddressLabel(lat, lon).then((addr) => {
        if (!addr) return;
        setCheckpoints((prev) => prev.map((cp) => (cp.id === newCheckpoint.id ? { ...cp, label: addr } : cp)));
        const idx = markersRef.current.checkpoints.findIndex((x) => x.point.id === newCheckpoint.id);
        if (idx >= 0) markersRef.current.checkpoints[idx].marker.setPopupContent(addr);
      });
    }
  }, [startPoint, endPoint, checkpoints.length, addOrUpdateMarker, addCheckpointMarker, makeId, resolveAddressLabel]);

  const addPointFromMapRef = useRef(addPointFromMap);
  useEffect(() => {
    addPointFromMapRef.current = addPointFromMap;
  }, [addPointFromMap]);

  async function onSearchAddress() {
    const q = addressQuery.trim();
    if (q.length < 3) {
      setAddressResults([]);
      setAddressError('Enter at least 3 characters');
      return;
    }
    setAddressLoading(true);
    setAddressError(null);
    try {
      const res = await geocodeSearch(q, 6);
      setAddressResults(res);
    } catch (e) {
      setAddressResults([]);
      setAddressError(e instanceof Error ? e.message : 'Failed to search address');
    } finally {
      setAddressLoading(false);
    }
  }

  useEffect(() => {
    const L = window.L;
    if (!mapContainerRef.current || !L) return;
    if (mapInstanceRef.current) return;
    LRef.current = L;
    const map = L.map(mapContainerRef.current).setView([51.1605, 46.0091], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);
    const onClick = (e: import('leaflet').LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      addPointFromMapRef.current(lat, lng);
    };
    map.on('click', onClick);
    mapInstanceRef.current = map;
    return () => {
      map.off('click', onClick);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  function resetRoute() {
    markersRef.current.start?.remove();
    markersRef.current.end?.remove();
    markersRef.current.checkpoints.forEach(({ marker }) => marker.remove());
    markersRef.current = { checkpoints: [] };
    setStartPoint(null);
    setEndPoint(null);
    setCheckpoints([]);
  }

  function updateCheckpointLabel(idx: number, label: string) {
    setCheckpoints((prev) => prev.map((cp, i) => (i === idx ? { ...cp, label } : cp)));
  }

  const routePreview = useMemo(() => {
    const arr: NamedPoint[] = [];
    if (startPoint) arr.push(startPoint);
    arr.push(...checkpoints);
    if (endPoint) arr.push(endPoint);
    return arr;
  }, [startPoint, checkpoints, endPoint]);

  async function onCreate() {
    if (!startPoint || !endPoint) {
      alert('Укажите точку старта и финиша на карте');
      return;
    }
    const baseRoute: LocationPoint[] = routePreview.map(({ lat, lon, label }) => ({ lat, lon, name: label }));
    const route: LocationPoint[] = closeLoop && baseRoute.length > 2 ? [...baseRoute, baseRoute[0]] : baseRoute;
    let startTimeIso: string | undefined;
    if (startDate) {
      const dt = new Date(`${startDate}T${startHour}:${startMinute}:00`);
      startTimeIso = dt.toISOString();
    }
    const res = await createOne({ title: title || 'Convoy', startTime: startTimeIso, route, privacy });
    navigate(`/convoys/${res.id}`);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Create Convoy</h1>
        <p className="text-slate-500 mt-1">Set up a new convoy trip with route points</p>
      </div>

      <div className="space-y-6">
        <div className="card">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder="Trip name"
              />
            </div>
            <div>
              <label className="label">Start Date (optional)</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Privacy</label>
              <select value={privacy} onChange={(e) => setPrivacy(e.target.value as 'invite' | 'open')} className="input">
                <option value="invite">Invite</option>
                <option value="open">Open</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Open convoys can appear in nearby discovery and allow joining without an invite code.
              </p>
            </div>
            <div>
              <label className="label">Start Time</label>
              <div className="flex gap-2">
                <select
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                  className="input flex-1"
                >
                  {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <span className="flex items-center text-slate-400 font-bold">:</span>
                <select
                  value={startMinute}
                  onChange={(e) => setStartMinute(e.target.value)}
                  className="input flex-1"
                >
                  {['00', '15', '30', '45'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <label className="label">Route Map</label>
          <div className="flex items-center justify-between mb-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={closeLoop}
                onChange={(e) => setCloseLoop(e.target.checked)}
              />
              <span>Замкнуть маршрут</span>
            </label>
          </div>
          <div className="mb-3">
            <label className="label">Search address</label>
            <div className="flex gap-2">
              <input
                value={addressQuery}
                onChange={(e) => setAddressQuery(e.target.value)}
                className="input flex-1"
                placeholder="Type address (e.g. Moscow, Tverskaya 1)"
                onKeyDown={(e) => e.key === 'Enter' && onSearchAddress()}
              />
              <button type="button" className="btn-secondary" onClick={onSearchAddress} disabled={addressLoading}>
                {addressLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
            {addressError && <div className="text-xs text-red-600 mt-1">{addressError}</div>}
            {addressResults.length > 0 && (
              <div className="mt-2 border border-slate-200 rounded-lg bg-white max-h-48 overflow-auto">
                {addressResults.map((r, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b last:border-b-0"
                    onClick={() => {
                      addPointFromMap(r.lat, r.lon, r.displayName);
                      setAddressResults([]);
                    }}
                  >
                    <div className="text-slate-900">{r.displayName}</div>
                    <div className="text-xs text-slate-500 font-mono">{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div
            ref={mapContainerRef}
            className="w-full h-80 rounded-lg overflow-hidden border border-slate-200"
          />
          <p className="text-sm text-slate-500 mt-2">
            Click to add points: 1st = Start, 2nd = Finish, then checkpoints. Drag markers to adjust.
          </p>
        </div>

        {routePreview.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Route Points</h3>
              <button type="button" onClick={resetRoute} className="text-sm text-red-600 hover:text-red-700">
                Reset All
              </button>
            </div>
            <div className="space-y-3">
              {routePreview.map((point, idx) => (
                <div
                  key={point.id}
                  draggable
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex === null || dragIndex === idx) return;
                    const next = [...routePreview];
                    const [moved] = next.splice(dragIndex, 1);
                    next.splice(idx, 0, moved);
                    setDragIndex(null);

                    setStartPoint(next[0] || null);
                    setEndPoint(next.length > 1 ? next[next.length - 1] : null);
                    setCheckpoints(next.slice(1, -1));
                    rebuildMarkers(next);
                  }}
                  className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg cursor-move"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${
                    idx === 0 ? 'bg-emerald-500' : idx === routePreview.length - 1 ? 'bg-red-500' : 'bg-indigo-500'
                  }`}>
                    {idx + 1}
                  </div>
                  <input
                    value={point.label}
                    onChange={(e) => {
                      if (!startPoint || !endPoint) return;
                      if (idx === 0) setStartPoint({ ...point, label: e.target.value });
                      else if (idx === routePreview.length - 1) setEndPoint({ ...point, label: e.target.value });
                      else updateCheckpointLabel(idx - 1, e.target.value);
                    }}
                    className="input flex-1"
                  />
                  <span className="text-xs text-slate-500 font-mono">
                    {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
                  </span>
                  {idx > 0 && idx < routePreview.length - 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCheckpoints((prev) => prev.filter((_, cIdx) => cIdx !== idx - 1));
                        const markerInfo = markersRef.current.checkpoints[idx - 1];
                        markerInfo?.marker?.remove();
                        markersRef.current.checkpoints.splice(idx - 1, 1);
                      }}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          onClick={onCreate}
          disabled={loading || !startPoint || !endPoint}
          className="btn-primary w-full"
        >
          {loading ? 'Creating...' : 'Create Convoy'}
        </button>
      </div>
    </div>
  );
}

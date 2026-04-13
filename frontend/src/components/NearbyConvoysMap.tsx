import { useEffect, useRef, useState } from 'react';
import type { NearbyOpenConvoy } from '../types';

type LeafletMap = typeof import('leaflet');
type LeafletInstance = ReturnType<LeafletMap['map']> | null;

declare global {
  interface Window {
    L?: LeafletMap;
  }
}

type NearbyConvoysMapProps = {
  convoys: NearbyOpenConvoy[];
  origin: { lat: number; lon: number } | null;
  selectedConvoyId: string | null;
  onSelect: (convoyId: string) => void;
};

type Cluster = {
  center: { lat: number; lon: number };
  items: NearbyOpenConvoy[];
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function clusterRadiusKmForZoom(zoom: number) {
  if (zoom <= 7) return 40;
  if (zoom <= 9) return 20;
  if (zoom <= 11) return 8;
  if (zoom <= 13) return 3;
  if (zoom <= 15) return 1;
  return 0.35;
}

function clusterConvoys(convoys: NearbyOpenConvoy[], clusterRadiusKm: number) {
  const clusters: Cluster[] = [];

  for (const convoy of convoys) {
    const point = convoy.closestPoint;
    const cluster = clusters.find((item) => distanceKm(item.center, point) <= clusterRadiusKm);

    if (!cluster) {
      clusters.push({
        center: { lat: point.lat, lon: point.lon },
        items: [convoy]
      });
      continue;
    }

    const nextItems = [...cluster.items, convoy];
    const lat = nextItems.reduce((sum, item) => sum + item.closestPoint.lat, 0) / nextItems.length;
    const lon = nextItems.reduce((sum, item) => sum + item.closestPoint.lon, 0) / nextItems.length;
    cluster.center = { lat, lon };
    cluster.items = nextItems;
  }

  return clusters;
}

function createClusterHtml(count: number, highlighted: boolean) {
  return `
    <div class="convoy-map-cluster${highlighted ? ' is-selected' : ''}">
      <span>${count}</span>
    </div>
  `;
}

function createConvoyHtml(convoy: NearbyOpenConvoy, highlighted: boolean) {
  return `
    <div class="convoy-map-pin${highlighted ? ' is-selected' : ''}">
      <span>${Math.max(convoy.memberCount, 1)}</span>
    </div>
  `;
}

function createOriginHtml() {
  return `
    <div class="convoy-map-origin">
      <span></span>
    </div>
  `;
}

export default function NearbyConvoysMap({
  convoys,
  origin,
  selectedConvoyId,
  onSelect
}: NearbyConvoysMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletInstance>(null);
  const layerGroupRef = useRef<import('leaflet').LayerGroup | null>(null);
  const fittedKeyRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  const [viewEpoch, setViewEpoch] = useState(0);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const L = window.L;
    if (!mapContainerRef.current || !L || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true
    }).setView([51.5336, 46.0343], 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    map.on('zoomend moveend', () => {
      setViewEpoch((value) => value + 1);
    });

    mapRef.current = map;
    layerGroupRef.current = layerGroup;

    return () => {
      layerGroup.clearLayers();
      map.off();
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      fittedKeyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!L || !map || !layerGroup) return;

    layerGroup.clearLayers();

    if (origin) {
      const originMarker = L.marker([origin.lat, origin.lon], {
        icon: L.divIcon({
          className: 'convoy-map-origin-wrapper',
          html: createOriginHtml(),
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        })
      });
      originMarker.bindTooltip('Your current location', {
        direction: 'top',
        offset: [0, -12]
      });
      originMarker.addTo(layerGroup);
    }

    if (convoys.length === 0) return;

    const zoom = map.getZoom();
    const clusters = clusterConvoys(convoys, clusterRadiusKmForZoom(zoom));

    for (const cluster of clusters) {
      const hasSelectedConvoy = cluster.items.some((item) => item.id === selectedConvoyId);
      if (cluster.items.length === 1) {
        const convoy = cluster.items[0];
        const marker = L.marker([convoy.closestPoint.lat, convoy.closestPoint.lon], {
          icon: L.divIcon({
            className: 'convoy-map-pin-wrapper',
            html: createConvoyHtml(convoy, convoy.id === selectedConvoyId),
            iconSize: [38, 38],
            iconAnchor: [19, 19]
          })
        });
        marker.bindTooltip(
          `${convoy.title} • ${convoy.distanceKm.toFixed(1)} km • ${convoy.memberCount} members`,
          {
            direction: 'top',
            offset: [0, -18]
          }
        );
        marker.on('click', () => onSelectRef.current(convoy.id));
        marker.addTo(layerGroup);
        continue;
      }

      const clusterMarker = L.marker([cluster.center.lat, cluster.center.lon], {
        icon: L.divIcon({
          className: 'convoy-map-cluster-wrapper',
          html: createClusterHtml(cluster.items.length, hasSelectedConvoy),
          iconSize: [54, 54],
          iconAnchor: [27, 27]
        })
      });
      clusterMarker.bindTooltip(`${cluster.items.length} convoys in this area`, {
        direction: 'top',
        offset: [0, -20]
      });
      clusterMarker.on('click', () => {
        const bounds = L.latLngBounds(
          cluster.items.map((item) => [item.closestPoint.lat, item.closestPoint.lon] as [number, number])
        );
        if (bounds.isValid()) {
          map.fitBounds(bounds.pad(0.45), { maxZoom: Math.max(map.getZoom() + 2, 13) });
        }
      });
      clusterMarker.addTo(layerGroup);
    }
  }, [convoys, origin, selectedConvoyId, viewEpoch]);

  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    const fitKey = `${origin ? `${origin.lat.toFixed(4)}:${origin.lon.toFixed(4)}` : 'no-origin'}|${convoys
      .map((convoy) => convoy.id)
      .join('|')}`;
    if (fittedKeyRef.current === fitKey) return;
    fittedKeyRef.current = fitKey;

    const points = convoys.map((convoy) => [convoy.closestPoint.lat, convoy.closestPoint.lon] as [number, number]);
    if (origin) {
      points.push([origin.lat, origin.lon]);
    }

    if (points.length === 0) {
      map.setView([51.5336, 46.0343], 10);
      return;
    }

    if (points.length === 1) {
      map.setView(points[0], 12);
      return;
    }

    const bounds = L.latLngBounds(points);
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.22), { maxZoom: 13 });
    }
  }, [convoys, origin]);

  useEffect(() => {
    const map = mapRef.current;
    const selected = convoys.find((convoy) => convoy.id === selectedConvoyId);
    if (!map || !selected) return;

    const latLng = [selected.closestPoint.lat, selected.closestPoint.lon] as [number, number];
    if (!map.getBounds().pad(-0.15).contains(latLng)) {
      map.panTo(latLng, { animate: true });
    }
  }, [convoys, selectedConvoyId]);

  return <div ref={mapContainerRef} className="h-[24rem] w-full overflow-hidden rounded-[1.5rem] border border-slate-200" />;
}

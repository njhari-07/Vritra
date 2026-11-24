import React, { useEffect, useRef, useState } from 'react';
import { Map, Marker, NavigationControl, LngLatBounds, addProtocol, setWorkerUrl } from 'maplibre-gl';
import { Crosshair, MapPin, Scan } from 'lucide-react';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { Protocol } from 'pmtiles';
import { Button } from '@/components/ui/button';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import land from '../assets/reference-land.geojson?url';

const base = '/api/map-assets';
const archives = [
  { id: 'india', minzoom: 0 },
  { id: 'south-karnataka', minzoom: 10 },
];
const empty = { type: 'FeatureCollection', features: [] };
const darkBasemap = namedFlavor('dark');
const darkFlavor = {
  ...darkBasemap,
  earth: '#202d3b', water: '#1b425e', buildings: '#394c5f',
  park_a: '#203c34', park_b: '#25473b', aerodrome: '#1c2734', runway: '#526679',
  other: '#405267', minor_service: '#455970', minor_a: '#60748a', minor_b: '#506479',
  link: '#687786', major: '#9e917b', highway: '#c6a46c',
  roads_label_minor: '#c6d2e2', roads_label_major: '#f4e6cf', subplace_label: '#c6d2e2',
  city_label: '#e5edf5', state_label: '#afc1d4', country_label: '#d2dfec',
  pois: { ...darkBasemap.pois, lapis: '#8eb8ff' },
  landcover: { ...darkBasemap.landcover, urban_area: '#263442' },
};

// PMTiles reads only the visible tile ranges from the local backend.
setWorkerUrl(workerUrl);
addProtocol('pmtiles', new Protocol().tile);

function mapStyle(assets, darkMode) {
  const theme = darkMode ? 'dark' : 'light';
  const flavor = darkMode ? darkFlavor : namedFlavor(theme);
  const sourceUrl = window.location.origin + base;
  const sources = {
    world: { type: 'geojson', data: land },
    areas: { type: 'geojson', data: empty },
  };
  const basemapLayers = [
    { id: 'world-water', type: 'background', paint: { 'background-color': flavor.water } },
    { id: 'world-land', type: 'fill', source: 'world', paint: { 'fill-color': flavor.earth } },
  ];
  for (const { id, minzoom } of assets) {
    sources[id] = { type: 'vector', url: `pmtiles://${sourceUrl}/${id}.pmtiles`, minzoom };
    basemapLayers.push(...layers(id, flavor, { lang: 'en' })
      .filter(layer => layer.type !== 'background')
      .map(layer => ({
        ...layer, id: `${id}-${layer.id}`, minzoom: Math.max(minzoom, layer.minzoom || 0),
        ...(layer.layout?.['text-font'] ? { layout: { ...layer.layout, 'text-font': ['noto-sans'] } } : {}),
      })));
  }
  return {
    version: 8, sources,
    ...(assets.length ? { glyphs: `${sourceUrl}/{fontstack}-{range}.pbf`, sprite: `${sourceUrl}/${theme}` } : {}),
    layers: [
      ...basemapLayers.filter(layer => layer.maxzoom == null || (layer.minzoom ?? 0) < layer.maxzoom),
      { id: 'areas', type: 'fill', source: 'areas', paint: { 'fill-color': '#f1b343', 'fill-opacity': 0.14 } },
      { id: 'area-borders', type: 'line', source: 'areas',
        paint: { 'line-color': '#c18725', 'line-width': 1.5, 'line-dasharray': [3, 2] } },
    ],
  };
}

function boundFeatures(entries) {
  return { type: 'FeatureCollection', features: entries.flatMap(({ review }) => {
    const bounds = review.match.bounds;
    if (!bounds) return [];
    const [south, north, west, east] = bounds;
    return [{ type: 'Feature', properties: {}, geometry: {
      type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    } }];
  }) };
}

function fitPlaces(map, entries) {
  const points = new LngLatBounds();
  for (const { review: { match } } of entries) {
    points.extend([match.lon, match.lat]);
    if (match.bounds) {
      const [south, north, west, east] = match.bounds;
      points.extend([west, south]).extend([east, north]);
    }
  }
  const closeUp = entries.length === 1 && entries[0].review.match.geometry === 'point';
  if (!points.isEmpty()) map.fitBounds(points, { padding: 52, maxZoom: closeUp ? 14 : 11, duration: 0 });
}

export default function PlaceMap({ entries, onSource, darkMode }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const [assets, setAssets] = useState(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const selected = entries.find(entry => entry.id === selectedId);

  useEffect(() => {
    const abort = new AbortController();
    Promise.all(archives.map(async archive => {
      try {
        const response = await fetch(`${base}/${archive.id}.pmtiles`, { method: 'HEAD', signal: abort.signal });
        return response.ok ? archive : null;
      } catch {
        return null;
      }
    })).then(available => {
      if (abort.signal.aborted) return;
      const found = available.filter(Boolean);
      const hasOverview = found.some(asset => asset.id === 'india');
      setAssets(hasOverview ? found : found.map(asset => ({ ...asset, minzoom: 0 })));
    });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!assets || !container.current) return;
    let map;
    try {
      setReady(false);
      map = new Map({
        container: container.current, center: [78.6, 21.3], zoom: 3.5, maxZoom: 17, renderWorldCopies: false,
        cooperativeGestures: true, attributionControl: false, style: mapStyle(assets, darkMode),
      });
      map.addControl(new NavigationControl({ showCompass: false }));
      map.once('load', () => setReady(true));
      map.on('error', event => {
        if (assets.some(asset => asset.id === event.sourceId)) setTileError(true);
        if (event.error?.message.startsWith('Worker failed to load')) setFailed(true);
      });
      mapRef.current = map;
      setFailed(false);
      setTileError(false);
    } catch {
      map?.remove();
      setFailed(true);
    }
    return () => { mapRef.current = null; map?.remove(); };
  }, [assets, darkMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = entries.map(entry => {
      const { lon, lat, name, geometry } = entry.review.match;
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'place-map-marker';
      element.dataset.geometry = geometry;
      element.title = name;
      element.setAttribute('aria-label', `${geometry === 'area' ? 'Area' : 'Site'} on map · ${name}`);
      element.addEventListener('click', () => setSelectedId(entry.id));
      return new Marker({ element, anchor: geometry === 'area' ? 'center' : 'bottom' })
        .setLngLat([lon, lat]).addTo(map);
    });
    function showAreas() {
      map.getSource('areas')?.setData(boundFeatures(entries));
    }
    if (map.isStyleLoaded()) showAreas();
    else map.once('load', showAreas);
    fitPlaces(map, entries);
    return () => { map.off('load', showAreas); markers.forEach(marker => marker.remove()); };
  }, [entries, assets, darkMode]);

  const streetDetail = assets?.some(asset => asset.id === 'south-karnataka');
  const countryOverview = assets?.some(asset => asset.id === 'india');

  return <div className="place-map-wrap">
    <div className="place-map-toolbar">
      <div className="place-map-legend">
        <span><i className="site-swatch" />Site pin</span>
        <span><i className="area-swatch" />Area reference</span>
      </div>
      <Button size="sm" variant="outline" disabled={!assets || failed} onClick={() => fitPlaces(mapRef.current, entries)}>
        <Scan aria-hidden="true" />Fit all places
      </Button>
    </div>
    <div className="place-map-frame">
      <div className="place-map" ref={container} aria-label="Map of reviewed document places" />
      {!failed && <div className="place-map-credit">
        {assets?.length > 0 && <>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
          {' · '}<a href="https://protomaps.com/" target="_blank" rel="noreferrer">Protomaps</a>{' · '}
        </>}
        <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>
      </div>}
    </div>
    <p className="place-map-status" role="status">{failed ? 'Map rendering is unavailable. Review the places below.'
      : tileError ? 'Some local map tiles are unavailable.'
      : !ready ? 'Loading local map…'
      : streetDetail ? `${countryOverview ? 'India overview · ' : ''}Street detail around Bengaluru and Mysuru`
      : countryOverview ? 'India overview · Street detail is unavailable'
      : 'Overview map · Local street tiles are unavailable'}</p>
    {selected && <div className="place-map-selection">
      <MapPin aria-hidden="true" size={20} />
      <div>
        <strong>{selected.review.match.name}</strong>
        <div>{selected.review.match.geometry === 'area' ? 'Area reference' : 'Site pin'} · {selected.place.text}</div>
      </div>
      <div className="place-actions">
        <Button size="sm" variant="outline" disabled={failed} onClick={() => fitPlaces(mapRef.current, [selected])}>
          <Crosshair aria-hidden="true" />Zoom to place
        </Button>
        <Button size="sm" onClick={() => onSource(selected.id, selected.place.text)}>View evidence</Button>
      </div>
    </div>}
  </div>;
}

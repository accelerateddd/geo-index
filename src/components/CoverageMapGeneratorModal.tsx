import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  MapPin,
  Maximize2,
  RefreshCw,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CoverageAnnotation,
  CoverageTagNode,
  PoiTagDefinition,
  SideLineTagDefinition,
} from '../types/coverageNotes';
import { getDescendantIdsInclusive } from '../utils/coverageFilterEngine';
import {
  extractSubPolylineByFraction,
  resolveSideLineFractions,
} from './CoverageSubComponents';

interface GeoJsonPolygonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

interface CountryOption {
  iso3: string;
  iso2: string;
  name: string;
  feature: GeoJsonPolygonFeature;
}

interface SubdivisionOption {
  id: string;
  name: string;
  typeEn: string;
  feature: GeoJsonPolygonFeature;
}

interface CityEntry {
  name: string;
  lat: number;
  lng: number;
  population: number;
  isCapital?: boolean;
}

interface HighwayRefLabel {
  ref: string;
  lat: number;
  lng: number;
}

export interface MapViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface CoverageMapGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  annotations: CoverageAnnotation[];
  tagTree: CoverageTagNode[];
  sideLineTags: SideLineTagDefinition[];
  poiTags: PoiTagDefinition[];
  currentViewportBounds: MapViewportBounds | null;
}

export interface ScopeRegionItem {
  countryIso3: string;
  subdivisionIds: string[];
}

export type MapFramingMode = 'fit-scope' | 'custom';
type ExteriorMaskMode = 'blackout' | 'darken';
type BaseMapStyle = 'clean-light' | 'clean-dark' | 'google-roadmap' | 'google-satellite';
type MultiTagRenderMode = 'side-by-side' | 'alternating-dash';
type SideLinePlacementMode = 'offset-side' | 'on-road';
type PlaceNameDensity = 'none' | 'medium' | 'dense';
type PoiPlotMode = 'none' | 'all' | 'by-tag';
type LegendCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'hidden';

// Web Mercator projection helpers
function lngToMercatorX(lng: number): number {
  return (lng + 180) / 360;
}

function latToMercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return (
    (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2
  );
}

function getPolygonRings(
  geometry: GeoJsonPolygonFeature['geometry']
): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates as number[][][];
    for (const ring of coords) {
      rings.push(ring.map((pt) => [pt[1], pt[0]]));
    }
  } else if (geometry.type === 'MultiPolygon') {
    const polys = geometry.coordinates as number[][][][];
    for (const poly of polys) {
      for (const ring of poly) {
        rings.push(ring.map((pt) => [pt[1], pt[0]]));
      }
    }
  }
  return rings;
}

function getOuterRingsOnly(
  geometry: GeoJsonPolygonFeature['geometry']
): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates as number[][][];
    if (coords[0]) {
      rings.push(coords[0].map((pt) => [pt[1], pt[0]]));
    }
  } else if (geometry.type === 'MultiPolygon') {
    const polys = geometry.coordinates as number[][][][];
    for (const poly of polys) {
      if (poly[0]) {
        rings.push(poly[0].map((pt) => [pt[1], pt[0]]));
      }
    }
  }
  return rings;
}

function computeGeometryBounds(
  geometry: GeoJsonPolygonFeature['geometry']
): MapViewportBounds {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  const rings = getOuterRingsOnly(geometry);
  for (const ring of rings) {
    for (const [lat, lng] of ring) {
      if (lat > north) north = lat;
      if (lat < south) south = lat;
      if (lng > east) east = lng;
      if (lng < west) west = lng;
    }
  }
  return { north, south, east, west };
}

function isPointInRing(lat: number, lng: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0];
    const xi = ring[i][1];
    const yj = ring[j][0];
    const xj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInGeometry(
  lat: number,
  lng: number,
  geometry: GeoJsonPolygonFeature['geometry']
): boolean {
  const outerRings = getOuterRingsOnly(geometry);
  for (const ring of outerRings) {
    if (isPointInRing(lat, lng, ring)) return true;
  }
  return false;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return [56, 189, 248];
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [
    Number.isFinite(r) ? r : 56,
    Number.isFinite(g) ? g : 189,
    Number.isFinite(b) ? b : 248,
  ];
}

function loadTileImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 6500);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function offsetPixelPolyline(
  pts: Array<[number, number]>,
  offsetPx: number
): Array<[number, number]> {
  if (pts.length < 2 || Math.abs(offsetPx) < 1e-3) return pts;
  return pts.map((pt, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return pt;
    // Right-hand perpendicular in screen coords (x right, y down): (-dy, dx)
    const nx = (-dy / len) * offsetPx;
    const ny = (dx / len) * offsetPx;
    return [pt[0] + nx, pt[1] + ny];
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fillColor: string,
  outlineColor: string,
  outlineWidth: number
) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = outlineWidth;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export const CoverageMapGeneratorModal: React.FC<CoverageMapGeneratorModalProps> = ({
  isOpen,
  onClose,
  annotations,
  tagTree,
  sideLineTags,
  poiTags,
  currentViewportBounds,
}) => {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Loaded GeoJSON & City Datasets
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [citiesByIso3, setCitiesByIso3] = useState<Record<string, CityEntry[]>>({});
  const [subdivisionsByCountry, setSubdivisionsByCountry] = useState<
    Record<string, SubdivisionOption[]>
  >({});
  const [loadingGeoData, setLoadingGeoData] = useState<boolean>(false);

  // Masking Scope (What Gets Preserved / Non-Blacked Out)
  const [scopeRegions, setScopeRegions] = useState<ScopeRegionItem[]>(() => [
    { countryIso3: 'BWA', subdivisionIds: [] },
  ]);

  // Map Framing / Viewport (Region the Map Shows)
  const [framingMode, setFramingMode] = useState<MapFramingMode>('fit-scope');
  const [customBounds, setCustomBounds] = useState<MapViewportBounds>(() =>
    currentViewportBounds || {
      north: -17.5,
      south: -27.0,
      east: 29.5,
      west: 19.8,
    }
  );

  // Exterior & Base Map Settings
  const [exteriorMask, setExteriorMask] = useState<ExteriorMaskMode>('blackout');
  const [baseMapStyle, setBaseMapStyle] = useState<BaseMapStyle>('clean-light');
  const [showSubdivisionBordersInCountry, setShowSubdivisionBordersInCountry] =
    useState<boolean>(false);

  // Official Coverage Layer Settings
  const [showOfficialCoverage, setShowOfficialCoverage] = useState<boolean>(false);
  const [officialCoverageColor, setOfficialCoverageColor] =
    useState<string>('#94a3b8');
  const [officialCoverageOpacity, setOfficialCoverageOpacity] =
    useState<number>(0.45);
  const [includeOfficialInLegend, setIncludeOfficialInLegend] =
    useState<boolean>(false);
  const [officialLegendLabel, setOfficialLegendLabel] =
    useState<string>('Official Coverage');

  // Plotted Road Tags & Custom Color/Label Overrides
  const [selectedRoadTagIds, setSelectedRoadTagIds] = useState<string[]>([]);
  const [roadTagColorOverrides, setRoadTagColorOverrides] = useState<
    Record<string, string>
  >({});
  const [roadTagLabelOverrides, setRoadTagLabelOverrides] = useState<
    Record<string, string>
  >({});
  const [multiTagMode, setMultiTagMode] =
    useState<MultiTagRenderMode>('side-by-side');
  const [roadStrokeThickness, setRoadStrokeThickness] = useState<number>(4.5);
  const [plotUntaggedRoads, setPlotUntaggedRoads] = useState<boolean>(false);
  const [untaggedRoadColor, setUntaggedRoadColor] = useState<string>('#64748b');

  // Plotted Side Line Tags & Placement Mode
  const [selectedSideLineTagIds, setSelectedSideLineTagIds] = useState<string[]>(
    []
  );
  const [sideLineColorOverrides, setSideLineColorOverrides] = useState<
    Record<string, string>
  >({});
  const [sideLineLabelOverrides, setSideLineLabelOverrides] = useState<
    Record<string, string>
  >({});
  const [sideLinePlacement, setSideLinePlacement] =
    useState<SideLinePlacementMode>('offset-side');

  // Place Names, POIs & Highway Names (Population centres off by default)
  const [placeNameDensity, setPlaceNameDensity] =
    useState<PlaceNameDensity>('none');
  const [poiPlotMode, setPoiPlotMode] = useState<PoiPlotMode>('none');
  const [selectedPoiTagIds, setSelectedPoiTagIds] = useState<string[]>([]);
  const [showHighwayNames, setShowHighwayNames] = useState<boolean>(false);

  // Overpass-fetched extra places & highways for subdivisions / dense mode
  const [overpassPlaces, setOverpassPlaces] = useState<CityEntry[]>([]);
  const [overpassHighways, setOverpassHighways] = useState<HighwayRefLabel[]>([]);

  // Legend, Title & Watermark
  const [legendCorner, setLegendCorner] = useState<LegendCorner>('bottom-right');
  const [mapTitle, setMapTitle] = useState<string>('');
  const [watermarkText, setWatermarkText] = useState<string>('');
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Sync default selected tags on initial open
  useEffect(() => {
    if (tagTree.length > 0 && selectedRoadTagIds.length === 0) {
      setSelectedRoadTagIds(tagTree.map((t) => t.id));
    }
  }, [tagTree]);

  // Update custom bounds when currentViewportBounds changes
  useEffect(() => {
    if (currentViewportBounds) {
      setCustomBounds(currentViewportBounds);
    }
  }, [currentViewportBounds]);

  // Load world-countries.geojson & world-country-top-cities.json once
  useEffect(() => {
    if (!isOpen || countries.length > 0) return;
    let cancelled = false;
    setLoadingGeoData(true);

    Promise.all([
      fetch('/data/world-countries.geojson').then((r) => r.json()),
      fetch('/data/special/world-country-top-cities.json').then((r) => r.json()),
    ])
      .then(([worldGeo, citiesData]) => {
        if (cancelled) return;
        const isoMap: Record<string, string> = {};
        const cityMap: Record<string, CityEntry[]> = {};
        const iso3ToIso2: Record<string, string> = {};

        for (const entry of Object.values(citiesData) as Array<{
          iso3: string;
          iso2: string;
          cities?: CityEntry[];
          citiesProper?: CityEntry[];
        }>) {
          if (!entry || !entry.iso3) continue;
          const iso3 = entry.iso3.toUpperCase();
          const iso2 = (entry.iso2 || '').toUpperCase();
          if (iso2) {
            isoMap[iso2] = iso3;
            iso3ToIso2[iso3] = iso2;
          }
          // Merge cities and citiesProper (deduplicating by name)
          const merged: CityEntry[] = [];
          const seen = new Set<string>();
          for (const c of [...(entry.cities || []), ...(entry.citiesProper || [])]) {
            const key = c.name.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(c);
            }
          }
          cityMap[iso3] = merged;
        }

        const list: CountryOption[] = [];
        for (const feat of (worldGeo.features || []) as GeoJsonPolygonFeature[]) {
          const iso3 = String(
            feat.properties?.ADM0_A3 || feat.properties?.ISO_A3 || ''
          ).toUpperCase();
          const name = String(feat.properties?.NAME || iso3);
          if (!iso3) continue;
          list.push({
            iso3,
            iso2: iso3ToIso2[iso3] || iso3.slice(0, 2),
            name,
            feature: feat,
          });
        }
        list.sort((a, b) => a.name.localeCompare(b.name));

        setCountries(list);
        setCitiesByIso3(cityMap);

        // Auto-detect dominant country from annotations if available
        const counts: Record<string, number> = {};
        for (const ann of annotations) {
          const cc = ann.countryCode?.toUpperCase();
          if (cc) counts[cc] = (counts[cc] || 0) + 1;
          for (const sp of ann.autoMetaSpans || []) {
            if (sp.countryCode) {
              const scc = sp.countryCode.toUpperCase();
              counts[scc] = (counts[scc] || 0) + 1;
            }
          }
        }
        const topIso2 = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (topIso2 && isoMap[topIso2]) {
          setScopeRegions([{ countryIso3: isoMap[topIso2], subdivisionIds: [] }]);
        }
      })
      .catch((err) => {
        console.error('Failed to load world GeoJSON / cities:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingGeoData(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, countries.length, annotations]);

  // Load subdivisions for any country included in scopeRegions
  useEffect(() => {
    if (!isOpen) return;
    for (const sr of scopeRegions) {
      if (!subdivisionsByCountry[sr.countryIso3]) {
        fetch(`/data/adm1/${sr.countryIso3.toLowerCase()}.geojson`)
          .then((r) => (r.ok ? r.json() : null))
          .then((geo) => {
            if (!geo || !Array.isArray(geo.features)) return;
            const subs: SubdivisionOption[] = (
              geo.features as GeoJsonPolygonFeature[]
            )
              .map((feat, idx) => {
                const rawName = String(
                  feat.properties?.name ||
                    feat.properties?.NAME_1 ||
                    feat.properties?.region ||
                    `Region ${idx + 1}`
                );
                const typeEn = String(feat.properties?.type_en || '');
                return {
                  id: `${sr.countryIso3}-${idx}-${rawName}`,
                  name: rawName,
                  typeEn,
                  feature: feat,
                };
              })
              .sort((a, b) => a.name.localeCompare(b.name));
            setSubdivisionsByCountry((prev) => ({
              ...prev,
              [sr.countryIso3]: subs,
            }));
          })
          .catch(() => {});
      }
    }
  }, [isOpen, scopeRegions, subdivisionsByCountry]);

  // Active region features forming the unmasked/preserved area
  const activeRegionFeatures = useMemo((): GeoJsonPolygonFeature[] => {
    const feats: GeoJsonPolygonFeature[] = [];
    for (const sr of scopeRegions) {
      const country = countries.find((c) => c.iso3 === sr.countryIso3);
      if (!country) continue;
      if (sr.subdivisionIds.length === 0) {
        feats.push(country.feature);
      } else {
        const subs = subdivisionsByCountry[sr.countryIso3] || [];
        for (const sId of sr.subdivisionIds) {
          const found = subs.find((s) => s.id === sId);
          if (found) {
            feats.push(found.feature);
          }
        }
      }
    }
    return feats;
  }, [scopeRegions, countries, subdivisionsByCountry]);

  // Compute map bounds: automatic fit to preserved scope or custom bounds
  const activeBounds = useMemo((): MapViewportBounds => {
    if (framingMode === 'fit-scope' && activeRegionFeatures.length > 0) {
      let north = -90;
      let south = 90;
      let east = -180;
      let west = 180;

      for (const feat of activeRegionFeatures) {
        const b = computeGeometryBounds(feat.geometry);
        if (b.north > north) north = b.north;
        if (b.south < south) south = b.south;
        if (b.east > east) east = b.east;
        if (b.west < west) west = b.west;
      }

      const latSpan = Math.max(0.05, north - south);
      const lngSpan = Math.max(0.05, east - west);
      const padFrac = exteriorMask === 'darken' ? 0.14 : 0.09;
      return {
        north: Math.min(84, north + latSpan * padFrac),
        south: Math.max(-84, south - latSpan * padFrac),
        east: Math.min(179.9, east + lngSpan * padFrac),
        west: Math.max(-179.9, west - lngSpan * padFrac),
      };
    }
    return customBounds;
  }, [framingMode, activeRegionFeatures, exteriorMask, customBounds]);

  // Fetch extra places & highway refs from Overpass when needed (for custom scopes or dense cities / highway names)
  useEffect(() => {
    if (!isOpen) return;
    const needOverpassPlaces =
      placeNameDensity === 'dense' ||
      (placeNameDensity === 'medium' &&
        scopeRegions.some((sr) => sr.subdivisionIds.length > 0));
    const needHighways = showHighwayNames;

    if (!needOverpassPlaces && !needHighways) {
      setOverpassPlaces([]);
      setOverpassHighways([]);
      return;
    }

    let cancelled = false;
    const { south, west, north, east } = activeBounds;
    const bboxStr = `${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(
      3
    )},${east.toFixed(3)}`;

    const timer = window.setTimeout(async () => {
      try {
        const parts: string[] = [];
        if (needOverpassPlaces) {
          parts.push(
            `node["place"~"^(city|town|village)$"](${bboxStr});`
          );
        }
        if (needHighways) {
          parts.push(
            `way["highway"~"^(motorway|trunk|primary)$"]["ref"](${bboxStr});`
          );
        }
        const query = `[out:json][timeout:10];(${parts.join('')});out center 250;`;
        const res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.elements)) return;

        const places: CityEntry[] = [];
        const hways: HighwayRefLabel[] = [];

        for (const el of data.elements) {
          if (el.type === 'node' && el.tags?.place && el.tags?.name) {
            const name = String(el.tags['name:en'] || el.tags.name);
            const pop = Number(el.tags.population) ||
              (el.tags.place === 'city'
                ? 100000
                : el.tags.place === 'town'
                ? 15000
                : 2000);
            places.push({
              name,
              lat: el.lat,
              lng: el.lon,
              population: pop,
              isCapital: el.tags.capital === 'yes',
            });
          } else if (
            el.type === 'way' &&
            el.tags?.ref &&
            el.center?.lat !== undefined &&
            el.center?.lon !== undefined
          ) {
            const refStr = String(el.tags.ref).split(';')[0].trim();
            if (refStr.length >= 1 && refStr.length <= 7) {
              hways.push({
                ref: refStr,
                lat: el.center.lat,
                lng: el.center.lon,
              });
            }
          }
        }
        places.sort((a, b) => b.population - a.population);
        setOverpassPlaces(places);
        setOverpassHighways(hways);
      } catch {
        // Ignore network errors cleanly
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, activeBounds, placeNameDensity, scopeRegions, showHighwayNames]);

  // Core High-Resolution Canvas Map Renderer
  const renderMetaMapToCanvas = useCallback(async () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    setIsRendering(true);

    try {
      const { north, south, east, west } = activeBounds;
      const mercMinX = lngToMercatorX(west);
      const mercMaxX = lngToMercatorX(east);
      const mercMinY = latToMercatorY(north); // North has smaller Mercator Y
      const mercMaxY = latToMercatorY(south);

      const spanX = Math.max(1e-5, mercMaxX - mercMinX);
      const spanY = Math.max(1e-5, mercMaxY - mercMinY);
      const aspect = spanX / spanY;

      // High-res output dimensions (clamped so aspect ratios stay crisp and well-proportioned)
      const baseSize = 1350;
      let width = baseSize;
      let height = baseSize;
      if (aspect >= 1) {
        width = Math.round(Math.min(1750, Math.max(1100, baseSize * Math.sqrt(aspect))));
        height = Math.round(width / aspect);
      } else {
        height = Math.round(Math.min(1750, Math.max(1100, baseSize / Math.sqrt(aspect))));
        width = Math.round(height * aspect);
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const projectLatLngToPx = (lat: number, lng: number): [number, number] => {
        const mx = lngToMercatorX(lng);
        const my = latToMercatorY(lat);
        const px = ((mx - mercMinX) / spanX) * width;
        const py = ((my - mercMinY) / spanY) * height;
        return [px, py];
      };

      const traceGeometryPath = (
        targetCtx: CanvasRenderingContext2D,
        geometry: GeoJsonPolygonFeature['geometry']
      ) => {
        const rings = getPolygonRings(geometry);
        targetCtx.beginPath();
        for (const ring of rings) {
          ring.forEach(([lat, lng], idx) => {
            const [px, py] = projectLatLngToPx(lat, lng);
            if (idx === 0) targetCtx.moveTo(px, py);
            else targetCtx.lineTo(px, py);
          });
          targetCtx.closePath();
        }
      };

      // Choose optimal tile zoom Z so tiles match canvas pixel resolution
      const rawTileZ = Math.log2(width / (256 * spanX));
      const tileZ = Math.max(3, Math.min(15, Math.round(rawTileZ)));
      const numTiles = Math.pow(2, tileZ);
      const minTileX = Math.max(0, Math.floor(mercMinX * numTiles));
      const maxTileX = Math.min(numTiles - 1, Math.floor(mercMaxX * numTiles));
      const minTileY = Math.max(0, Math.floor(mercMinY * numTiles));
      const maxTileY = Math.min(numTiles - 1, Math.floor(mercMaxY * numTiles));

      const drawTileLayerToCtx = async (
        targetCtx: CanvasRenderingContext2D,
        urlBuilder: (x: number, y: number, z: number) => string
      ) => {
        const jobs: Array<
          Promise<{
            img: HTMLImageElement | null;
            dx: number;
            dy: number;
            dw: number;
            dh: number;
          }>
        > = [];

        // Cap tile count for safety
        if ((maxTileX - minTileX + 1) * (maxTileY - minTileY + 1) > 120) {
          return;
        }

        for (let ty = minTileY; ty <= maxTileY; ty++) {
          for (let tx = minTileX; tx <= maxTileX; tx++) {
            const tileMercX0 = tx / numTiles;
            const tileMercX1 = (tx + 1) / numTiles;
            const tileMercY0 = ty / numTiles;
            const tileMercY1 = (ty + 1) / numTiles;

            const dx = ((tileMercX0 - mercMinX) / spanX) * width;
            const dy = ((tileMercY0 - mercMinY) / spanY) * height;
            const dw = ((tileMercX1 - tileMercX0) / spanX) * width;
            const dh = ((tileMercY1 - tileMercY0) / spanY) * height;

            jobs.push(
              loadTileImage(urlBuilder(tx, ty, tileZ)).then((img) => ({
                img,
                dx,
                dy,
                dw,
                dh,
              }))
            );
          }
        }

        const loaded = await Promise.all(jobs);
        for (const item of loaded) {
          if (item.img) {
            targetCtx.drawImage(
              item.img,
              item.dx,
              item.dy,
              item.dw + 0.6,
              item.dh + 0.6
            );
          }
        }
      };

      // 1. Render Base Background & Interior Map
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);

      if (
        baseMapStyle === 'google-roadmap' ||
        baseMapStyle === 'google-satellite'
      ) {
        const lyrs = baseMapStyle === 'google-satellite' ? 'y' : 'm';
        await drawTileLayerToCtx(
          ctx,
          (x, y, z) =>
            `https://mt1.google.com/vt/lyrs=${lyrs}&hl=en&x=${x}&y=${y}&z=${z}`
        );
      } else {
        const interiorColor =
          baseMapStyle === 'clean-light' ? '#f4f5f6' : '#161b22';
        if (activeRegionFeatures.length > 0) {
          if (exteriorMask === 'darken') {
            // Fill whole canvas with dimmed version of interior, then bright interior
            ctx.fillStyle =
              baseMapStyle === 'clean-light' ? '#2c3237' : '#0b0e12';
            ctx.fillRect(0, 0, width, height);
          }
          ctx.save();
          for (const feat of activeRegionFeatures) {
            traceGeometryPath(ctx, feat.geometry);
          }
          ctx.fillStyle = interiorColor;
          ctx.fill('evenodd');
          ctx.restore();
        } else {
          ctx.fillStyle = interiorColor;
          ctx.fillRect(0, 0, width, height);
        }
      }

      // Optional Subdivision Borders when enabled
      if (showSubdivisionBordersInCountry) {
        ctx.save();
        if (activeRegionFeatures.length > 0) {
          for (const feat of activeRegionFeatures) {
            traceGeometryPath(ctx, feat.geometry);
          }
          ctx.clip('evenodd');
        }
        ctx.strokeStyle =
          baseMapStyle === 'clean-light'
            ? 'rgba(100, 116, 139, 0.42)'
            : 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1.6;
        for (const sr of scopeRegions) {
          const subs = subdivisionsByCountry[sr.countryIso3] || [];
          for (const sub of subs) {
            traceGeometryPath(ctx, sub.feature.geometry);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // 2. Render Official Google Street View Coverage Network (if enabled)
      if (showOfficialCoverage) {
        const svCanvas = document.createElement('canvas');
        svCanvas.width = width;
        svCanvas.height = height;
        const svCtx = svCanvas.getContext('2d');
        if (svCtx) {
          await drawTileLayerToCtx(
            svCtx,
            (x, y, z) =>
              `https://mts1.google.com/vt?pb=!1m4!1m3!1i${z}!2i${x}!3i${y}!2m8!1e2!2ssvv!4m2!1scc!2s*211m3*211e2*212b1*213e2*212b1*214b1!4m2!1ssvl!2s*212b1!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0`
          );
          try {
            // Re-tint coverage pixels to officialCoverageColor
            const imgData = svCtx.getImageData(0, 0, width, height);
            const data = imgData.data;
            const [rCol, gCol, bCol] = hexToRgbTuple(officialCoverageColor);
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] > 12) {
                data[i] = rCol;
                data[i + 1] = gCol;
                data[i + 2] = bCol;
                data[i + 3] = Math.min(
                  255,
                  Math.round(data[i + 3] * officialCoverageOpacity * 1.45)
                );
              }
            }
            svCtx.putImageData(imgData, 0, 0);
          } catch {
            // ignore
          }
          ctx.drawImage(svCanvas, 0, 0);
        }
      }

      // 3. Render Tagged Road Stretches & Side Lines
      const roadStretches = annotations.filter(
        (a) => a.type === 'road-stretch' && a.points && a.points.length >= 2
      );

      // Build lookup for active plotted Road Tags
      // To prevent a child tag AND its auto-selected parent tag from both plotting on the same road
      // when both are checked, we check which plotted tags match each road stretch.
      const plottedRoadTags = tagTree.filter((t) =>
        selectedRoadTagIds.includes(t.id)
      );
      const plottedSideTags = sideLineTags.filter((t) =>
        selectedSideLineTagIds.includes(t.id)
      );

      const drawSingleRoadPolyline = (
        pxPts: Array<[number, number]>,
        colors: string[],
        strokeWidth: number
      ) => {
        if (pxPts.length < 2 || colors.length === 0) return;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (colors.length === 1) {
          ctx.strokeStyle = colors[0];
          ctx.lineWidth = strokeWidth;
          ctx.beginPath();
          pxPts.forEach(([x, y], idx) => {
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        } else if (multiTagMode === 'alternating-dash') {
          const dashLen = Math.max(10, strokeWidth * 3.2);
          const gapLen = dashLen * (colors.length - 1);
          colors.forEach((col, cIdx) => {
            ctx.save();
            ctx.strokeStyle = col;
            ctx.lineWidth = strokeWidth;
            ctx.setLineDash([dashLen, gapLen]);
            ctx.lineDashOffset = -cIdx * dashLen;
            ctx.beginPath();
            pxPts.forEach(([x, y], idx) => {
              if (idx === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.restore();
          });
        } else {
          // 'side-by-side' parallel stripes (default)
          const subWidth = Math.max(2, strokeWidth * 0.72);
          const totalSpan = (colors.length - 1) * subWidth;
          colors.forEach((col, cIdx) => {
            const offsetPx = -totalSpan * 0.5 + cIdx * subWidth;
            const shifted = offsetPixelPolyline(pxPts, offsetPx);
            ctx.strokeStyle = col;
            ctx.lineWidth = subWidth;
            ctx.beginPath();
            shifted.forEach(([x, y], idx) => {
              if (idx === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.stroke();
          });
        }
        ctx.restore();
      };

      for (const rs of roadStretches) {
        const annTagSet = new Set(rs.tagIds || []);
        const autoTagSet = new Set(rs.autoSelectedTagIds || []);

        // Find all plotted road tags that match this road stretch
        let matchedRoadTags = plottedRoadTags.filter((pt) => {
          const desc = getDescendantIdsInclusive(pt.id, tagTree);
          for (const dId of desc) {
            if (annTagSet.has(dId)) return true;
          }
          return false;
        });

        // If both a parent category AND its child subtag matched this road,
        // drop the parent if it was only auto-selected on this road!
        if (matchedRoadTags.length > 1) {
          const matchedIds = new Set(matchedRoadTags.map((t) => t.id));
          matchedRoadTags = matchedRoadTags.filter((t) => {
            const properDesc = Array.from(
              getDescendantIdsInclusive(t.id, tagTree)
            ).filter((id) => id !== t.id);
            const hasMatchedChild = properDesc.some((dId) =>
              matchedIds.has(dId)
            );
            if (hasMatchedChild && autoTagSet.has(t.id)) {
              return false;
            }
            return true;
          });
        }

        const roadColors = matchedRoadTags.map(
          (t) => roadTagColorOverrides[t.id] || t.color
        );

        if (roadColors.length === 0 && plotUntaggedRoads) {
          roadColors.push(untaggedRoadColor);
        }

        const pxPts = rs.points!.map(([lat, lng]) => projectLatLngToPx(lat, lng));

        if (roadColors.length > 0) {
          drawSingleRoadPolyline(pxPts, roadColors, roadStrokeThickness);
        }

        // Render attached Side Lines if selected
        if (plottedSideTags.length > 0 && rs.sideLines && rs.sideLines.length > 0) {
          rs.sideLines.forEach((sl, slIdx) => {
            const matchedSlTag = plottedSideTags.find((st) =>
              getDescendantIdsInclusive(st.id, sideLineTags).has(
                sl.sideLineTagId
              )
            );
            if (!matchedSlTag) return;

            const slColor =
              sl.customColor ||
              sideLineColorOverrides[matchedSlTag.id] ||
              matchedSlTag.color;
            const [f0, f1] = resolveSideLineFractions(sl, rs.roadPois);
            const subGeoPts = extractSubPolylineByFraction(rs.points!, f0, f1);
            if (subGeoPts.length < 2) return;

            const subPxPts = subGeoPts.map(([lat, lng]) =>
              projectLatLngToPx(lat, lng)
            );

            if (sideLinePlacement === 'on-road') {
              drawSingleRoadPolyline(subPxPts, [slColor], roadStrokeThickness);
            } else {
              // Offset to the respective side ('left' or 'right') in screen pixels
              const sign = sl.side === 'left' ? -1 : 1;
              const offsetDist =
                (roadStrokeThickness * 0.9 + 4.5 + (slIdx % 3) * 3.5) * sign;
              const shiftedPx = offsetPixelPolyline(subPxPts, offsetDist);
              drawSingleRoadPolyline(
                shiftedPx,
                [slColor],
                Math.max(2.5, roadStrokeThickness * 0.78)
              );
            }
          });
        }
      }

      // 4. Apply Exterior Region Masking ('blackout' vs 'darken') & Crisp Region Border
      if (activeRegionFeatures.length > 0) {
        // Create an offscreen mask where exterior is filled using evenodd winding rule
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = width;
        maskCanvas.height = height;
        const mCtx = maskCanvas.getContext('2d');
        if (mCtx) {
          mCtx.beginPath();
          // Outer canvas rectangle
          mCtx.rect(0, 0, width, height);
          // Inner polygon rings for all active features
          for (const feat of activeRegionFeatures) {
            const rings = getPolygonRings(feat.geometry);
            for (const ring of rings) {
              ring.forEach(([lat, lng], idx) => {
                const [px, py] = projectLatLngToPx(lat, lng);
                if (idx === 0) mCtx.moveTo(px, py);
                else mCtx.lineTo(px, py);
              });
              mCtx.closePath();
            }
          }
          mCtx.fillStyle =
            exteriorMask === 'blackout'
              ? '#050505'
              : 'rgba(14, 18, 20, 0.78)';
          mCtx.fill('evenodd');
          ctx.drawImage(maskCanvas, 0, 0);
        }

        // Draw Region Outer Border for all active features
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const feat of activeRegionFeatures) {
          traceGeometryPath(ctx, feat.geometry);
          if (exteriorMask === 'darken') {
            ctx.strokeStyle = '#050505';
            ctx.lineWidth = 6.5;
            ctx.stroke();
          } else {
            ctx.strokeStyle =
              baseMapStyle === 'clean-light' ? '#1e293b' : '#475569';
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // Track occupied label bounding boxes so labels never overlap
      const placedBoxes: Array<{
        x0: number;
        y0: number;
        x1: number;
        y1: number;
      }> = [];

      const canPlaceBox = (
        x0: number,
        y0: number,
        x1: number,
        y1: number
      ): boolean => {
        if (x0 < 12 || y0 < 12 || x1 > width - 12 || y1 > height - 12) {
          return false;
        }
        for (const b of placedBoxes) {
          if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) {
            return false;
          }
        }
        return true;
      };

      // 5. Render Highway / Major Road Names (if enabled)
      if (showHighwayNames) {
        const highwayCandidates: HighwayRefLabel[] = [];
        // Collect road names from marked road stretches first
        for (const rs of roadStretches) {
          if (!rs.points || rs.points.length < 2) continue;
          for (const sp of rs.autoMetaSpans || []) {
            if (sp.roadName) {
              // Extract short highway ref if present (e.g. "A1", "A15", "M1") or short road name
              const matchRef = sp.roadName.match(/\b([A-Z]{1,2}\s?-?\d{1,3})\b/);
              const label = matchRef ? matchRef[1].replace(/\s+/g, '') : sp.roadName;
              if (label.length <= 14) {
                const midFrac = (sp.startFrac + sp.endFrac) * 0.5;
                const midIdx = Math.min(
                  rs.points.length - 1,
                  Math.floor(midFrac * rs.points.length)
                );
                const [lat, lng] = rs.points[midIdx];
                highwayCandidates.push({ ref: label, lat, lng });
              }
            }
          }
        }
        // Append Overpass highway refs
        highwayCandidates.push(...overpassHighways);

        ctx.save();
        ctx.font = '800 15px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const recentRefPositions: Array<{ ref: string; px: number; py: number }> =
          [];

        for (const hw of highwayCandidates) {
          if (
            activeRegionFeatures.length > 0 &&
            !activeRegionFeatures.some((f) =>
              isPointInGeometry(hw.lat, hw.lng, f.geometry)
            )
          ) {
            continue;
          }
          const [px, py] = projectLatLngToPx(hw.lat, hw.lng);
          if (
            recentRefPositions.some(
              (r) => r.ref === hw.ref && Math.hypot(r.px - px, r.py - py) < 160
            )
          ) {
            continue;
          }

          const tw = ctx.measureText(hw.ref).width;
          const bw = tw + 14;
          const bh = 22;
          const x0 = px - bw / 2;
          const y0 = py - bh / 2;

          if (!canPlaceBox(x0 - 4, y0 - 4, x0 + bw + 4, y0 + bh + 4)) {
            continue;
          }
          placedBoxes.push({
            x0: x0 - 4,
            y0: y0 - 4,
            x1: x0 + bw + 4,
            y1: y0 + bh + 4,
          });
          recentRefPositions.push({ ref: hw.ref, px, py });

          // Highway shield pill
          drawRoundedRect(ctx, x0, y0, bw, bh, 5);
          ctx.fillStyle = '#15803d';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.fillText(hw.ref, px, py + 0.5);
        }
        ctx.restore();
      }

      // 6. Render Custom Notebook POIs (if enabled)
      if (poiPlotMode !== 'none') {
        const allowedPoiTagSet = new Set<string>();
        if (poiPlotMode === 'by-tag') {
          for (const tid of selectedPoiTagIds) {
            for (const dId of getDescendantIdsInclusive(tid, poiTags)) {
              allowedPoiTagSet.add(dId);
            }
          }
        }

        const poisToDraw: Array<{
          label: string;
          lat: number;
          lng: number;
          color: string;
        }> = [];

        for (const ann of annotations) {
          for (const p of ann.roadPois || []) {
            if (poiPlotMode === 'by-tag') {
              const hasTag = (p.tagIds || []).some((id) =>
                allowedPoiTagSet.has(id)
              );
              if (!hasTag) continue;
            }
            poisToDraw.push({
              label: p.label,
              lat: p.position[0],
              lng: p.position[1],
              color: p.color || '#1e293b',
            });
          }
          if (ann.type === 'pin' && ann.position) {
            if (poiPlotMode === 'by-tag') {
              const hasTag = (ann.poiTagIds || []).some((id) =>
                allowedPoiTagSet.has(id)
              );
              if (!hasTag) continue;
            }
            poisToDraw.push({
              label: ann.label || '',
              lat: ann.position[0],
              lng: ann.position[1],
              color: ann.color || '#1e293b',
            });
          }
        }

        ctx.save();
        ctx.font = '700 22px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        for (const poi of poisToDraw) {
          const [px, py] = projectLatLngToPx(poi.lat, poi.lng);
          if (px < 0 || px > width || py < 0 || py > height) continue;

          // Draw city/POI marker dot
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#111827';
          ctx.fill();
          ctx.lineWidth = 2.2;
          ctx.strokeStyle = poi.color || '#d97746';
          ctx.stroke();

          if (poi.label) {
            const tw = ctx.measureText(poi.label).width;
            // Try placing right, top-left, top, bottom
            const placements: Array<{
              tx: number;
              ty: number;
              align: CanvasTextAlign;
              bx0: number;
              by0: number;
            }> = [
              {
                tx: px + 11,
                ty: py,
                align: 'left',
                bx0: px + 9,
                by0: py - 13,
              },
              {
                tx: px - 11,
                ty: py - 14,
                align: 'right',
                bx0: px - 11 - tw,
                by0: py - 27,
              },
              {
                tx: px,
                ty: py - 16,
                align: 'center',
                bx0: px - tw / 2,
                by0: py - 29,
              },
            ];
            const chosen =
              placements.find((pl) =>
                canPlaceBox(pl.bx0, pl.by0, pl.bx0 + tw + 4, pl.by0 + 26)
              ) || placements[0];

            placedBoxes.push({
              x0: chosen.bx0,
              y0: chosen.by0,
              x1: chosen.bx0 + tw + 4,
              y1: chosen.by0 + 26,
            });
            ctx.textAlign = chosen.align;
            drawOutlinedText(
              ctx,
              poi.label,
              chosen.tx,
              chosen.ty,
              '#ffffff',
              '#18181b',
              5.5
            );
          }
        }
        ctx.restore();
      }

      // 7. Render Automatic Population Centres (Place Names)
      if (placeNameDensity !== 'none') {
        const nativeCities: CityEntry[] = [];
        if (scopeRegions.length > 0) {
          for (const sr of scopeRegions) {
            const list = citiesByIso3[sr.countryIso3] || [];
            nativeCities.push(...list);
          }
        } else {
          for (const list of Object.values(citiesByIso3)) {
            nativeCities.push(...list);
          }
        }
        const combinedCities: CityEntry[] = [];
        const seenNames = new Set<string>();

        for (const c of [...nativeCities, ...overpassPlaces]) {
          const key = c.name.toLowerCase();
          if (seenNames.has(key)) continue;
          if (
            activeRegionFeatures.length > 0 &&
            !activeRegionFeatures.some((f) =>
              isPointInGeometry(c.lat, c.lng, f.geometry)
            )
          ) {
            continue;
          }
          seenNames.add(key);
          combinedCities.push(c);
        }

        const maxCities = placeNameDensity === 'medium' ? 8 : 24;
        const minPixelSpacing = placeNameDensity === 'medium' ? 145 : 75;
        const placedCityCoords: Array<[number, number]> = [];

        ctx.save();
        ctx.font = '700 23px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        let count = 0;
        for (const city of combinedCities) {
          if (count >= maxCities) break;
          const [px, py] = projectLatLngToPx(city.lat, city.lng);
          if (px < 20 || px > width - 20 || py < 20 || py > height - 20) {
            continue;
          }
          if (
            placedCityCoords.some(
              ([cx, cy]) => Math.hypot(cx - px, cy - py) < minPixelSpacing
            )
          ) {
            continue;
          }

          const tw = ctx.measureText(city.name).width;
          const candidates: Array<{
            tx: number;
            ty: number;
            align: CanvasTextAlign;
            bx0: number;
            by0: number;
          }> = [
            {
              tx: px + 11,
              ty: py - 2,
              align: 'left',
              bx0: px + 9,
              by0: py - 15,
            },
            {
              tx: px - 10,
              ty: py - 14,
              align: 'right',
              bx0: px - 10 - tw,
              by0: py - 27,
            },
            {
              tx: px + 10,
              ty: py + 14,
              align: 'left',
              bx0: px + 8,
              by0: py + 1,
            },
          ];

          const chosen = candidates.find((pl) =>
            canPlaceBox(pl.bx0, pl.by0, pl.bx0 + tw + 6, pl.by0 + 26)
          );
          if (!chosen) continue;

          placedBoxes.push({
            x0: chosen.bx0,
            y0: chosen.by0,
            x1: chosen.bx0 + tw + 6,
            y1: chosen.by0 + 26,
          });
          placedCityCoords.push([px, py]);
          count++;

          // Plonkit-style city dot: dark circle with subtle warm/light rim
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#111827';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#a16207';
          ctx.stroke();

          ctx.textAlign = chosen.align;
          drawOutlinedText(
            ctx,
            city.name,
            chosen.tx,
            chosen.ty,
            '#ffffff',
            '#18181b',
            5.5
          );
        }
        ctx.restore();
      }

      // 8. Render Clean Plonkit-Style Legend Key
      const legendItems: Array<{ color: string; label: string }> = [];
      for (const t of plottedRoadTags) {
        legendItems.push({
          color: roadTagColorOverrides[t.id] || t.color,
          label: roadTagLabelOverrides[t.id] ?? t.name,
        });
      }
      for (const st of plottedSideTags) {
        legendItems.push({
          color: sideLineColorOverrides[st.id] || st.color,
          label: sideLineLabelOverrides[st.id] ?? st.name,
        });
      }
      if (showOfficialCoverage && includeOfficialInLegend) {
        legendItems.push({
          color: officialCoverageColor,
          label: officialLegendLabel || 'Official Coverage',
        });
      }

      if (legendCorner !== 'hidden' && legendItems.length > 0) {
        ctx.save();
        ctx.font = '700 28px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        const swatchW = 108;
        const swatchH = 50;
        const rowGap = 14;
        const textGap = 18;
        let maxTextW = 0;
        for (const item of legendItems) {
          const w = ctx.measureText(item.label).width;
          if (w > maxTextW) maxTextW = w;
        }

        const totalLegendW = swatchW + textGap + maxTextW;
        const totalLegendH =
          legendItems.length * swatchH + (legendItems.length - 1) * rowGap;
        const margin = 44;

        let startX = width - margin - totalLegendW;
        let startY = height - margin - totalLegendH;
        if (legendCorner === 'bottom-left') {
          startX = margin;
          startY = height - margin - totalLegendH;
        } else if (legendCorner === 'top-right') {
          startX = width - margin - totalLegendW;
          startY = margin;
        } else if (legendCorner === 'top-left') {
          startX = margin;
          startY = margin;
        }

        // Shift up if mapTitle or watermark is in bottom-right
        if (
          legendCorner === 'bottom-right' &&
          (mapTitle.trim() || watermarkText.trim())
        ) {
          startY -= 68;
        }

        legendItems.forEach((item, idx) => {
          const y = startY + idx * (swatchH + rowGap);
          drawRoundedRect(ctx, startX, y, swatchW, swatchH, 16);
          ctx.fillStyle = item.color;
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
          ctx.stroke();

          drawOutlinedText(
            ctx,
            item.label,
            startX + swatchW + textGap,
            y + swatchH / 2 + 1,
            '#ffffff',
            '#18181b',
            6.5
          );
        });
        ctx.restore();
      }

      // 9. Render Optional Title & Watermark
      if (mapTitle.trim() || watermarkText.trim()) {
        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        let curY = height - 30;
        if (watermarkText.trim()) {
          ctx.font = 'italic 700 22px Inter, system-ui, sans-serif';
          drawOutlinedText(
            ctx,
            watermarkText.trim(),
            width - 36,
            curY,
            '#f8fafc',
            '#09090b',
            5.5
          );
          curY -= 32;
        }
        if (mapTitle.trim()) {
          ctx.font = '800 38px Inter, system-ui, sans-serif';
          drawOutlinedText(
            ctx,
            mapTitle.trim(),
            width - 36,
            curY,
            '#ffffff',
            '#09090b',
            7.5
          );
        }
        ctx.restore();
      }
    } finally {
      setIsRendering(false);
    }
  }, [
    activeBounds,
    activeRegionFeatures,
    annotations,
    baseMapStyle,
    citiesByIso3,
    exteriorMask,
    includeOfficialInLegend,
    legendCorner,
    mapTitle,
    multiTagMode,
    officialCoverageColor,
    officialCoverageOpacity,
    officialLegendLabel,
    overpassHighways,
    overpassPlaces,
    placeNameDensity,
    plotUntaggedRoads,
    poiPlotMode,
    poiTags,
    roadStrokeThickness,
    roadTagColorOverrides,
    roadTagLabelOverrides,
    scopeRegions,
    selectedPoiTagIds,
    selectedRoadTagIds,
    selectedSideLineTagIds,
    showHighwayNames,
    showOfficialCoverage,
    showSubdivisionBordersInCountry,
    sideLineColorOverrides,
    sideLineLabelOverrides,
    sideLinePlacement,
    sideLineTags,
    subdivisionsByCountry,
    tagTree,
    untaggedRoadColor,
    watermarkText,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => {
      renderMetaMapToCanvas();
    }, 120);
    return () => window.clearTimeout(t);
  }, [isOpen, renderMetaMapToCanvas]);

  const handleCopyImageToClipboard = async () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) return;
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2200);
    } catch {
      window.alert(
        'Clipboard copy failed in this browser. Use "Download PNG" instead.'
      );
    }
  };

  const handleDownloadPng = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    const slug = (
      mapTitle ||
      (scopeRegions.length > 0
        ? scopeRegions.map((r) => r.countryIso3).join('-')
        : 'custom-region')
    )
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    a.download = `${slug}-meta-map.png`;
    a.click();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 select-none">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-[1380px] h-[90dvh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">
              META MAP & INFOGRAPHIC IMAGE GENERATOR
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold">
              High-Res Export
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={renderMetaMapToCanvas}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRendering ? 'animate-spin' : ''}`}
              />
              <span>Re-render</span>
            </button>
            <button
              type="button"
              onClick={handleCopyImageToClipboard}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shadow"
            >
              {copySuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Image</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownloadPng}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer shadow"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download PNG</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Body: Left Controls + Right Live Image Preview */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* Left Configuration Sidebar */}
          <div className="w-full lg:w-[440px] border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900 overflow-y-auto p-3.5 space-y-4 text-xs">
            {/* 1. Masking Scope (What Gets Preserved / Non-Blacked Out) */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  1. MASKING SCOPE (Preserved Regions)
                </span>
                {loadingGeoData && (
                  <span className="text-[10px] text-amber-300">
                    Loading countries...
                  </span>
                )}
              </div>

              <div className="text-[11px] text-slate-400 leading-relaxed">
                Select one or multiple countries and optional subdivisions to keep visible. Outside areas are blacked out or darkened.
              </div>

              {/* Selected Scope Countries */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {scopeRegions.length === 0 ? (
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                    No regions selected. The map will render unmasked without exterior blackout.
                  </div>
                ) : (
                  scopeRegions.map((sr) => {
                    const country = countries.find((c) => c.iso3 === sr.countryIso3);
                    const countrySubs = subdivisionsByCountry[sr.countryIso3] || [];
                    const isAllSubs = sr.subdivisionIds.length === 0;

                    return (
                      <div
                        key={sr.countryIso3}
                        className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-bold text-slate-100 text-xs truncate">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                            <span className="truncate">{country ? country.name : sr.countryIso3}</span>
                            <span className="text-[10px] text-slate-400 shrink-0">[{sr.countryIso3}]</span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setScopeRegions((prev) =>
                                prev.filter((item) => item.countryIso3 !== sr.countryIso3)
                              )
                            }
                            className="p-1 rounded text-slate-400 hover:text-rose-400 cursor-pointer"
                            title="Remove country from scope"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Whole Country vs Specific Subdivisions */}
                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          <button
                            type="button"
                            onClick={() =>
                              setScopeRegions((prev) =>
                                prev.map((item) =>
                                  item.countryIso3 === sr.countryIso3
                                    ? { ...item, subdivisionIds: [] }
                                    : item
                                )
                              )
                            }
                            className={`py-1 rounded font-bold cursor-pointer ${
                              isAllSubs
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-950 text-slate-400 hover:text-white'
                            }`}
                          >
                            Whole Country
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (countrySubs.length > 0 && isAllSubs) {
                                setScopeRegions((prev) =>
                                  prev.map((item) =>
                                    item.countryIso3 === sr.countryIso3
                                      ? { ...item, subdivisionIds: [countrySubs[0].id] }
                                      : item
                                  )
                                );
                              }
                            }}
                            className={`py-1 rounded font-bold cursor-pointer ${
                              !isAllSubs
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-950 text-slate-400 hover:text-white'
                            }`}
                          >
                            Subdivisions ({countrySubs.length})
                          </button>
                        </div>

                        {/* Subdivisions Checkbox Selector */}
                        {!isAllSubs && (
                          <div className="bg-slate-950 p-2 rounded border border-slate-800 space-y-1.5">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400 font-bold">
                                Included Subdivisions:
                              </span>
                              <div className="flex items-center gap-1.5 text-indigo-400">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScopeRegions((prev) =>
                                      prev.map((item) =>
                                        item.countryIso3 === sr.countryIso3
                                          ? {
                                              ...item,
                                              subdivisionIds: countrySubs.map((s) => s.id),
                                            }
                                          : item
                                      )
                                    )
                                  }
                                  className="hover:underline cursor-pointer"
                                >
                                  All
                                </button>
                                <span>|</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScopeRegions((prev) =>
                                      prev.map((item) =>
                                        item.countryIso3 === sr.countryIso3
                                          ? { ...item, subdivisionIds: [] }
                                          : item
                                      )
                                    )
                                  }
                                  className="hover:underline cursor-pointer"
                                >
                                  Reset
                                </button>
                              </div>
                            </div>
                            <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                              {countrySubs.map((sub) => {
                                const isChecked = sr.subdivisionIds.includes(sub.id);
                                return (
                                  <label
                                    key={sub.id}
                                    className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {
                                        setScopeRegions((prev) =>
                                          prev.map((item) => {
                                            if (item.countryIso3 !== sr.countryIso3)
                                              return item;
                                            const nextIds = isChecked
                                              ? item.subdivisionIds.filter(
                                                  (id) => id !== sub.id
                                                )
                                              : [...item.subdivisionIds, sub.id];
                                            return {
                                              ...item,
                                              subdivisionIds: nextIds,
                                            };
                                          })
                                        );
                                      }}
                                      className="accent-indigo-500"
                                    />
                                    <span className="truncate">{sub.name}</span>
                                    {sub.typeEn && (
                                      <span className="text-[10px] text-slate-500 truncate">
                                        ({sub.typeEn})
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add Country Dropdown */}
              <div className="flex items-center gap-1.5 pt-1">
                <select
                  value=""
                  onChange={(e) => {
                    const nextIso3 = e.target.value;
                    if (!nextIso3) return;
                    if (!scopeRegions.some((r) => r.countryIso3 === nextIso3)) {
                      setScopeRegions((prev) => [
                        ...prev,
                        { countryIso3: nextIso3, subdivisionIds: [] },
                      ]);
                    }
                  }}
                  className="flex-1 px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs font-bold"
                >
                  <option value="">+ Add Country to Scope...</option>
                  {countries
                    .filter((c) => !scopeRegions.some((r) => r.countryIso3 === c.iso3))
                    .map((c) => (
                      <option key={c.iso3} value={c.iso3}>
                        {c.name} ({c.iso3})
                      </option>
                    ))}
                </select>
                {scopeRegions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setScopeRegions([])}
                    className="px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-[10px] font-bold cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            {/* 2. Map Framing / Viewport (Region the Map Shows) */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2.5">
              <div className="font-bold text-slate-200 flex items-center gap-1.5">
                <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
                2. MAP FRAMING (Region the Map Shows)
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setFramingMode('fit-scope')}
                  className={`py-1.5 px-2 rounded border text-[11px] font-bold cursor-pointer ${
                    framingMode === 'fit-scope'
                      ? 'bg-indigo-600 border-indigo-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Fit Preserved Scope
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFramingMode('custom');
                    if (currentViewportBounds) {
                      setCustomBounds(currentViewportBounds);
                    }
                  }}
                  className={`py-1.5 px-2 rounded border text-[11px] font-bold cursor-pointer ${
                    framingMode === 'custom'
                      ? 'bg-indigo-600 border-indigo-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Custom View / Crop
                </button>
              </div>

              {framingMode === 'fit-scope' ? (
                <div className="text-[11px] text-slate-400 bg-slate-900 p-2 rounded border border-slate-800 leading-relaxed">
                  The map viewport automatically frames all non-blacked out countries and subdivisions selected in Scope.
                </div>
              ) : (
                <div className="space-y-2 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold">
                      Custom Viewport Bounds
                    </span>
                    {currentViewportBounds && (
                      <button
                        type="button"
                        onClick={() => setCustomBounds(currentViewportBounds)}
                        className="px-2 py-0.5 rounded bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-[10px] font-bold cursor-pointer hover:bg-indigo-600/50"
                      >
                        Reset to Current Map View
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div>
                      <span className="text-[10px] text-slate-500">North</span>
                      <input
                        type="number"
                        step="0.05"
                        value={customBounds.north}
                        onChange={(e) =>
                          setCustomBounds((b) => ({
                            ...b,
                            north: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">South</span>
                      <input
                        type="number"
                        step="0.05"
                        value={customBounds.south}
                        onChange={(e) =>
                          setCustomBounds((b) => ({
                            ...b,
                            south: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">West</span>
                      <input
                        type="number"
                        step="0.05"
                        value={customBounds.west}
                        onChange={(e) =>
                          setCustomBounds((b) => ({
                            ...b,
                            west: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">East</span>
                      <input
                        type="number"
                        step="0.05"
                        value={customBounds.east}
                        onChange={(e) =>
                          setCustomBounds((b) => ({
                            ...b,
                            east: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Base Map Style & Outside Region Masking */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2.5">
              <div className="font-bold text-slate-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                2. BASE MAP & EXTERIOR MASKING
              </div>

              {scopeRegions.length > 0 && (
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    Area Outside Region Boundary
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setExteriorMask('blackout')}
                      className={`py-1.5 px-2 rounded border text-[11px] font-bold cursor-pointer ${
                        exteriorMask === 'blackout'
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Black Out Outside
                    </button>
                    <button
                      type="button"
                      onClick={() => setExteriorMask('darken')}
                      className={`py-1.5 px-2 rounded border text-[11px] font-bold cursor-pointer ${
                        exteriorMask === 'darken'
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Darken Outside (Context)
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Interior Map Surface
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'clean-light', label: 'Clean Solid Light' },
                      { id: 'clean-dark', label: 'Clean Solid Dark' },
                      { id: 'google-roadmap', label: 'Google Map' },
                      { id: 'google-satellite', label: 'Google Satellite' },
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setBaseMapStyle(st.id)}
                      className={`py-1.5 px-2 rounded border text-[11px] font-bold cursor-pointer ${
                        baseMapStyle === st.id
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {scopeRegions.length > 0 && (
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={showSubdivisionBordersInCountry}
                    onChange={(e) =>
                      setShowSubdivisionBordersInCountry(e.target.checked)
                    }
                    className="accent-indigo-500"
                  />
                  <span>Show internal subdivision outlines</span>
                </label>
              )}

              {/* Faint Official Coverage Network Option */}
              <div className="border-t border-slate-800 pt-2 space-y-2">
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="flex items-center gap-2 text-[11px] font-bold text-slate-200">
                    <input
                      type="checkbox"
                      checked={showOfficialCoverage}
                      onChange={(e) =>
                        setShowOfficialCoverage(e.target.checked)
                      }
                      className="accent-indigo-500"
                    />
                    <span>Show All Official Coverage Roads</span>
                  </span>
                  <input
                    type="color"
                    value={officialCoverageColor}
                    onChange={(e) => setOfficialCoverageColor(e.target.value)}
                    className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                  />
                </label>

                {showOfficialCoverage && (
                  <div className="space-y-1.5 pl-4">
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span>Opacity: {Math.round(officialCoverageOpacity * 100)}%</span>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={officialCoverageOpacity}
                        onChange={(e) =>
                          setOfficialCoverageOpacity(Number(e.target.value))
                        }
                        className="flex-1 accent-indigo-500"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeOfficialInLegend}
                        onChange={(e) =>
                          setIncludeOfficialInLegend(e.target.checked)
                        }
                        className="accent-indigo-500"
                      />
                      <span>Include Official Coverage in Legend Key</span>
                    </label>
                    {includeOfficialInLegend && (
                      <input
                        type="text"
                        value={officialLegendLabel}
                        onChange={(e) => setOfficialLegendLabel(e.target.value)}
                        placeholder="Legend label..."
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-[11px]"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Road Tags, Multi-Tag Overlap Mode & Side Line Tags */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  3. TAGS & SIDE LINES TO PLOT
                </span>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedRoadTagIds(tagTree.map((t) => t.id))
                    }
                    className="text-indigo-400 hover:underline cursor-pointer"
                  >
                    All
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => setSelectedRoadTagIds([])}
                    className="text-slate-400 hover:underline cursor-pointer"
                  >
                    None
                  </button>
                </div>
              </div>

              {/* Multi-Tag Overlap Rendering Mode */}
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Overlapping / Non-Mutually-Exclusive Tags Style
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMultiTagMode('side-by-side')}
                    className={`py-1.5 px-2 rounded border text-[11px] font-bold cursor-pointer ${
                      multiTagMode === 'side-by-side'
                        ? 'bg-indigo-600 border-indigo-400 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Side-by-Side Stripes
                  </button>
                  <button
                    type="button"
                    onClick={() => setMultiTagMode('alternating-dash')}
                    className={`py-1.5 px-2 rounded border text-[11px] font-bold cursor-pointer ${
                      multiTagMode === 'alternating-dash'
                        ? 'bg-indigo-600 border-indigo-400 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Alternating Dashes
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                <span>Road Thickness: {roadStrokeThickness}px</span>
                <input
                  type="range"
                  min={2}
                  max={10}
                  step={0.5}
                  value={roadStrokeThickness}
                  onChange={(e) =>
                    setRoadStrokeThickness(Number(e.target.value))
                  }
                  className="flex-1 accent-indigo-500"
                />
              </div>

              {/* Road Tag Checkboxes + Color & Label Overrides */}
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {tagTree.length === 0 ? (
                  <div className="text-[11px] text-slate-500 py-1">
                    No road tags created yet.
                  </div>
                ) : (
                  tagTree.map((t) => {
                    const checked = selectedRoadTagIds.includes(t.id);
                    const effColor = roadTagColorOverrides[t.id] || t.color;
                    const effLabel = roadTagLabelOverrides[t.id] ?? t.name;
                    return (
                      <div
                        key={t.id}
                        className="flex items-center gap-1.5 bg-slate-900 px-2 py-1 rounded border border-slate-800"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedRoadTagIds((prev) =>
                              prev.includes(t.id)
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id]
                            )
                          }
                          className="accent-indigo-500 cursor-pointer"
                        />
                        <input
                          type="color"
                          value={effColor}
                          onChange={(e) =>
                            setRoadTagColorOverrides((prev) => ({
                              ...prev,
                              [t.id]: e.target.value,
                            }))
                          }
                          className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer shrink-0"
                        />
                        <input
                          type="text"
                          value={effLabel}
                          onChange={(e) =>
                            setRoadTagLabelOverrides((prev) => ({
                              ...prev,
                              [t.id]: e.target.value,
                            }))
                          }
                          className="flex-1 bg-transparent text-[11px] text-slate-100 outline-none border-b border-transparent focus:border-slate-600"
                        />
                      </div>
                    );
                  })
                )}
              </div>

              <label className="flex items-center justify-between gap-2 text-[11px] text-slate-300 pt-1 cursor-pointer">
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={plotUntaggedRoads}
                    onChange={(e) => setPlotUntaggedRoads(e.target.checked)}
                    className="accent-indigo-500"
                  />
                  <span>Also plot untagged marked roads</span>
                </span>
                {plotUntaggedRoads && (
                  <input
                    type="color"
                    value={untaggedRoadColor}
                    onChange={(e) => setUntaggedRoadColor(e.target.value)}
                    className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer"
                  />
                )}
              </label>

              {/* Side Line Tags to Plot */}
              {sideLineTags.length > 0 && (
                <div className="border-t border-slate-800 pt-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">
                      SIDE LINE TAGS TO PLOT
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSideLinePlacement('offset-side')}
                      className={`py-1 px-2 rounded border text-[10px] font-bold cursor-pointer ${
                        sideLinePlacement === 'offset-side'
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      On Respective Side
                    </button>
                    <button
                      type="button"
                      onClick={() => setSideLinePlacement('on-road')}
                      className={`py-1 px-2 rounded border text-[10px] font-bold cursor-pointer ${
                        sideLinePlacement === 'on-road'
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      On Road (As Road Tag)
                    </button>
                  </div>

                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                    {sideLineTags.map((st) => {
                      const checked = selectedSideLineTagIds.includes(st.id);
                      const effColor =
                        sideLineColorOverrides[st.id] || st.color;
                      const effLabel =
                        sideLineLabelOverrides[st.id] ?? st.name;
                      return (
                        <div
                          key={st.id}
                          className="flex items-center gap-1.5 bg-slate-900 px-2 py-1 rounded border border-slate-800"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedSideLineTagIds((prev) =>
                                prev.includes(st.id)
                                  ? prev.filter((id) => id !== st.id)
                                  : [...prev, st.id]
                              )
                            }
                            className="accent-indigo-500 cursor-pointer"
                          />
                          <input
                            type="color"
                            value={effColor}
                            onChange={(e) =>
                              setSideLineColorOverrides((prev) => ({
                                ...prev,
                                [st.id]: e.target.value,
                              }))
                            }
                            className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer shrink-0"
                          />
                          <input
                            type="text"
                            value={effLabel}
                            onChange={(e) =>
                              setSideLineLabelOverrides((prev) => ({
                                ...prev,
                                [st.id]: e.target.value,
                              }))
                            }
                            className="flex-1 bg-transparent text-[11px] text-slate-100 outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 4. Place Names, POIs & Highway Names */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2.5">
              <div className="font-bold text-slate-200 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-rose-400" />
                4. PLACE NAMES, POIS & ROAD NAMES
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Automatic Population Centres
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 'none', label: 'None' },
                      { id: 'medium', label: 'Medium' },
                      { id: 'dense', label: 'Many Places' },
                    ] as const
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setPlaceNameDensity(d.id)}
                      className={`py-1.5 rounded border text-[11px] font-bold cursor-pointer ${
                        placeNameDensity === d.id
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Notebook Points of Interest (POIs)
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 'none', label: 'Hidden' },
                      { id: 'all', label: 'All POIs' },
                      { id: 'by-tag', label: 'By POI Tag' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPoiPlotMode(m.id)}
                      className={`py-1.5 rounded border text-[11px] font-bold cursor-pointer ${
                        poiPlotMode === m.id
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {poiPlotMode === 'by-tag' && (
                  <div className="mt-1.5 space-y-1 max-h-28 overflow-y-auto bg-slate-900 p-2 rounded border border-slate-800">
                    {poiTags.length === 0 ? (
                      <div className="text-[10px] text-slate-500">
                        No POI tags created yet. Create POI tags in "Tags & Filters".
                      </div>
                    ) : (
                      poiTags.map((pt) => (
                        <label
                          key={pt.id}
                          className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPoiTagIds.includes(pt.id)}
                            onChange={() =>
                              setSelectedPoiTagIds((prev) =>
                                prev.includes(pt.id)
                                  ? prev.filter((id) => id !== pt.id)
                                  : [...prev, pt.id]
                              )
                            }
                            className="accent-indigo-500"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: pt.color }}
                          />
                          <span>{pt.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-[11px] text-slate-200 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={showHighwayNames}
                  onChange={(e) => setShowHighwayNames(e.target.checked)}
                  className="accent-indigo-500"
                />
                <span>Show Highway & Major Road Names</span>
              </label>
            </div>

            {/* 5. Legend Key, Title & Watermark */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
              <div className="font-bold text-slate-200">
                5. KEY POSITION & LABELS
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Key / Legend Corner
                </label>
                <select
                  value={legendCorner}
                  onChange={(e) =>
                    setLegendCorner(e.target.value as LegendCorner)
                  }
                  className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-white"
                >
                  <option value="bottom-right">Bottom Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="top-right">Top Right</option>
                  <option value="top-left">Top Left</option>
                  <option value="hidden">Hidden</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">
                  Optional Map Title
                </label>
                <input
                  type="text"
                  value={mapTitle}
                  onChange={(e) => setMapTitle(e.target.value)}
                  placeholder="Optional title..."
                  className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">
                  Optional Footer / Watermark
                </label>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="Optional watermark..."
                  className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                />
              </div>
            </div>
          </div>

          {/* Right Live Preview Area */}
          <div className="flex-1 bg-black/90 flex items-center justify-center p-4 overflow-auto relative">
            <canvas
              ref={previewCanvasRef}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-slate-800"
            />
            {isRendering && (
              <div className="absolute top-6 right-6 px-3 py-1.5 rounded-full bg-slate-900/90 border border-indigo-500/50 text-xs font-bold text-indigo-300 shadow-lg">
                Rendering map...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

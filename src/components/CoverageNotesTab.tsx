import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import {
  ArrowUpRight,
  Bookmark,
  Compass,
  Crosshair,
  Download,
  Eraser,
  Eye,
  EyeOff,
  ExternalLink,
  Filter,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  Layers,
  MapPin,
  MousePointer,
  Navigation,
  Pencil,
  Redo2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type {
  CardinalDirectionFilter,
  CoverageAnnotation,
  CoverageNotebook,
  CoverageTagNode,
  CoverageToolId,
  DrivingDirectionMode,
  OfficialStreetViewMetadata,
  RoadPointOfInterest,
  RoadSideLineAttachment,
  RoadSnapSubMode,
  SideLineTagDefinition,
} from '../types/coverageNotes';
import {
  exportNotebookJson,
  fetchOfficialStreetViewAtLatLng,
  fetchSingleClickRoadSection,
  loadCoverageNotebooks,
  loadCoverageTagTree,
  loadNotebookAnnotations,
  loadSideLineTags,
  loadSvCoverageStylePrefs,
  saveCoverageNotebooks,
  saveCoverageTagTree,
  saveNotebookAnnotations,
  saveSideLineTags,
  saveSvCoverageStylePrefs,
  snapPathToOfficialCoveredRoad,
  type CoverageExportBundle,
} from '../utils/coverageStorage';

// Official Google Maps Non-Terrain Roadmap tiles
const GOOGLE_ROADMAP_TILES =
  'https://mt1.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}';
// Official Google Satellite Hybrid tiles
const GOOGLE_HYBRID_TILES =
  'https://mt1.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}';
// Official Google Street View Coverage overlay tiles
const GOOGLE_OFFICIAL_SV_COVERAGE_TILES =
  'https://mts1.google.com/vt?pb=!1m4!1m3!1i{z}!2i{x}!3i{y}!2m8!1e2!2ssvv!4m2!1scc!2s*211m3*211e2*212b1*213e2*212b1*214b1!4m2!1ssvl!2s*212b1!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0';

const ANNOTATION_COLORS = [
  { id: '#2563eb', label: 'Blue' },
  { id: '#ec4899', label: 'Pink' },
  { id: '#f97316', label: 'Orange' },
  { id: '#16a34a', label: 'Green' },
  { id: '#dc2626', label: 'Red' },
  { id: '#9333ea', label: 'Purple' },
  { id: '#eab308', label: 'Yellow' },
  { id: '#06b6d4', label: 'Cyan' },
  { id: '#1e293b', label: 'Black' },
];

const CARDINAL_DIRECTION_TARGET_DEG: Record<
  Exclude<CardinalDirectionFilter, 'all'>,
  { deg: number; tolerance: number; label: string }
> = {
  N: { deg: 0, tolerance: 50, label: 'North of Road (N)' },
  NE: { deg: 45, tolerance: 35, label: 'NE of Road' },
  E: { deg: 90, tolerance: 50, label: 'East of Road (E)' },
  SE: { deg: 135, tolerance: 35, label: 'SE of Road' },
  S: { deg: 180, tolerance: 50, label: 'South of Road (S)' },
  SW: { deg: 225, tolerance: 35, label: 'SW of Road' },
  W: { deg: 270, tolerance: 50, label: 'West of Road (W)' },
  NW: { deg: 315, tolerance: 35, label: 'NW of Road' },
};

function formatCompassDirection(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((deg % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return `${Math.round(normalized)}° ${dirs[idx]}`;
}

function hexToRgbNormalized(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return [0.22, 0.74, 0.97];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 0.22,
    Number.isFinite(g) ? g : 0.74,
    Number.isFinite(b) ? b : 0.97,
  ];
}

function computeCompassBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const cosLat = Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  const dy = lat2 - lat1;
  const dx = (lng2 - lng1) * cosLat;
  const angleRad = Math.atan2(dx, dy);
  return ((angleRad * 180) / Math.PI + 360) % 360;
}

function computeSideOutwardCompassBearing(
  pt1: [number, number],
  pt2: [number, number],
  side: 'left' | 'right'
): number {
  const roadBearing = computeCompassBearing(pt1[0], pt1[1], pt2[0], pt2[1]);
  return side === 'left'
    ? (roadBearing - 90 + 360) % 360
    : (roadBearing + 90) % 360;
}

function isAngleWithinCardinalFilter(
  bearingDeg: number,
  filter: CardinalDirectionFilter
): boolean {
  if (filter === 'all') return true;
  const spec = CARDINAL_DIRECTION_TARGET_DEG[filter];
  const diff = Math.abs((((bearingDeg - spec.deg) % 360) + 540) % 360 - 180);
  return diff <= spec.tolerance;
}

/**
 * Interpolates a single [lat, lng] coordinate at normalized arc-length fraction `frac` [0..1] along `points`.
 */
function interpolatePointOnPolylineByFraction(
  points: Array<[number, number]>,
  frac: number
): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const clamped = Math.max(0, Math.min(1, frac));

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cosLat = Math.cos(
      ((points[i][0] + points[i + 1][0]) * 0.5 * Math.PI) / 180
    );
    const len = Math.hypot(
      points[i + 1][0] - points[i][0],
      (points[i + 1][1] - points[i][1]) * cosLat
    );
    segLengths.push(len);
    totalLen += len;
  }
  if (totalLen <= 1e-9) return points[0];

  const targetDist = clamped * totalLen;
  let accum = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (accum + segLen >= targetDist && segLen > 1e-10) {
      const t = (targetDist - accum) / segLen;
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ];
    }
    accum += segLen;
  }
  return points[points.length - 1];
}

/**
 * Resolves the effective [startFrac, endFrac] of a Side Line attachment,
 * taking into account any linked startPoiId or endPoiId on the parent road stretch.
 */
function resolveSideLineFractions(
  sl: RoadSideLineAttachment,
  roadPois?: RoadPointOfInterest[]
): [number, number] {
  let start = sl.startFrac;
  let end = sl.endFrac;
  if (roadPois && roadPois.length > 0) {
    if (sl.startPoiId) {
      const p = roadPois.find((poi) => poi.id === sl.startPoiId);
      if (p) start = p.frac;
    }
    if (sl.endPoiId) {
      const p = roadPois.find((poi) => poi.id === sl.endPoiId);
      if (p) end = p.frac;
    }
  }
  return [Math.min(start, end), Math.max(start, end)];
}

/**
 * Extracts a sub-polyline from `points` between normalized arc-length fractions [startFrac, endFrac].
 */
function extractSubPolylineByFraction(
  points: Array<[number, number]>,
  startFrac: number,
  endFrac: number
): Array<[number, number]> {
  if (points.length < 2) return points;
  const f0 = Math.max(0, Math.min(1, Math.min(startFrac, endFrac)));
  const f1 = Math.max(0, Math.min(1, Math.max(startFrac, endFrac)));
  if (f1 - f0 < 0.001) return [];

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cosLat = Math.cos(
      ((points[i][0] + points[i + 1][0]) * 0.5 * Math.PI) / 180
    );
    const dLat = points[i + 1][0] - points[i][0];
    const dLng = (points[i + 1][1] - points[i][1]) * cosLat;
    const len = Math.hypot(dLat, dLng);
    segLengths.push(len);
    totalLen += len;
  }

  if (totalLen <= 1e-9) return points;

  const targetStart = f0 * totalLen;
  const targetEnd = f1 * totalLen;
  const out: Array<[number, number]> = [];

  let accum = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    const nextAccum = accum + segLen;
    const pA = points[i];
    const pB = points[i + 1];

    if (nextAccum >= targetStart && accum <= targetEnd && segLen > 1e-10) {
      const tStart = Math.max(0, (targetStart - accum) / segLen);
      const tEnd = Math.min(1, (targetEnd - accum) / segLen);

      const startPt: [number, number] = [
        pA[0] + (pB[0] - pA[0]) * tStart,
        pA[1] + (pB[1] - pA[1]) * tStart,
      ];
      const endPt: [number, number] = [
        pA[0] + (pB[0] - pA[0]) * tEnd,
        pA[1] + (pB[1] - pA[1]) * tEnd,
      ];

      if (out.length === 0) {
        out.push(startPt);
      }
      out.push(endPt);
    }
    accum = nextAccum;
  }

  return out;
}

/**
 * Offsets a polyline perpendicular to its path by `offsetPixels` at the given map zoom level.
 */
function offsetPolylinePerpendicular(
  points: Array<[number, number]>,
  side: 'left' | 'right',
  offsetPixels: number,
  zoom: number
): Array<[number, number]> {
  if (points.length < 2) return points;
  const degPerPixelLng = 360 / (256 * Math.pow(2, zoom));
  const sign = side === 'left' ? -1 : 1;

  return points.map((pt, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const cosLat = Math.max(0.15, Math.cos((pt[0] * Math.PI) / 180));
    const dy = (next[0] - prev[0]) / cosLat;
    const dx = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-10) return pt;

    const nxEast = (dy / len) * sign;
    const nyNorth = (-dx / len) * sign;

    const dLat = nyNorth * offsetPixels * degPerPixelLng * cosLat;
    const dLng = nxEast * offsetPixels * degPerPixelLng;
    return [pt[0] + dLat, pt[1] + dLng];
  });
}

/**
 * Builds geographic chevron polylines (`[leftWing, tip, rightWing]`) along a polyline.
 */
function buildChevronPolylines(
  points: Array<[number, number]>,
  direction: DrivingDirectionMode,
  zoom: number
): Array<Array<[number, number]>> {
  if (points.length < 2 || direction === 'none') return [];
  const degPerPixel = 360 / (256 * Math.pow(2, zoom));
  const spacingDeg = degPerPixel * 85;
  const wingLenDeg = degPerPixel * 7.5;

  const chevrons: Array<Array<[number, number]>> = [];
  let distSinceLast = spacingDeg * 0.45;

  const addChevronAt = (
    lat: number,
    lng: number,
    dLat: number,
    dLng: number,
    reverse: boolean
  ) => {
    const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
    const ux = (reverse ? -dLng : dLng) * cosLat;
    const uy = reverse ? -dLat : dLat;
    const len = Math.hypot(ux, uy);
    if (len < 1e-10) return;

    const fx = ux / len;
    const fy = uy / len;
    const px = -fy;
    const py = fx;

    const backX = -fx * wingLenDeg;
    const backY = -fy * wingLenDeg;
    const sideX = px * wingLenDeg * 0.68;
    const sideY = py * wingLenDeg * 0.68;

    const tip: [number, number] = [
      lat + fy * wingLenDeg * 0.35 * cosLat,
      lng + (fx * wingLenDeg * 0.35) / cosLat,
    ];
    const leftWing: [number, number] = [
      tip[0] + (backY + sideY) * cosLat,
      tip[1] + (backX + sideX) / cosLat,
    ];
    const rightWing: [number, number] = [
      tip[0] + (backY - sideY) * cosLat,
      tip[1] + (backX - sideX) / cosLat,
    ];
    chevrons.push([leftWing, tip, rightWing]);
  };

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const cosLat = Math.max(
      0.15,
      Math.cos(((p1[0] + p2[0]) * 0.5 * Math.PI) / 180)
    );
    const dLat = p2[0] - p1[0];
    const dLng = p2[1] - p1[1];
    const segLen = Math.hypot(dLat / cosLat, dLng);
    if (segLen < 1e-9) continue;

    let pos = spacingDeg - distSinceLast;
    while (pos <= segLen) {
      const t = pos / segLen;
      const lat = p1[0] + dLat * t;
      const lng = p1[1] + dLng * t;

      if (direction === 'forward' || direction === 'both') {
        addChevronAt(lat, lng, dLat / cosLat, dLng, false);
      }
      if (direction === 'reverse' || direction === 'both') {
        addChevronAt(lat, lng, dLat / cosLat, dLng, true);
      }
      pos += spacingDeg;
    }
    distSinceLast = segLen - (pos - spacingDeg);
  }

  if (chevrons.length === 0 && points.length >= 2) {
    const midIdx = Math.floor((points.length - 1) / 2);
    const p1 = points[midIdx];
    const p2 = points[midIdx + 1];
    const cosLat = Math.max(
      0.15,
      Math.cos(((p1[0] + p2[0]) * 0.5 * Math.PI) / 180)
    );
    const midLat = (p1[0] + p2[0]) * 0.5;
    const midLng = (p1[1] + p2[1]) * 0.5;
    if (direction === 'forward' || direction === 'both') {
      addChevronAt(midLat, midLng, (p2[0] - p1[0]) / cosLat, p2[1] - p1[1], false);
    }
    if (direction === 'reverse' || direction === 'both') {
      addChevronAt(midLat, midLng, (p2[0] - p1[0]) / cosLat, p2[1] - p1[1], true);
    }
  }

  return chevrons;
}

/**
 * Projects a clicked point `[lat, lng]` onto a polyline `points`, returning:
 * - `frac`: normalized arc-length [0..1] along the polyline
 * - `snappedPos`: exact [lat, lng] on the polyline
 * - `side`: 'left' | 'right' relative to the forward polyline tangent
 * - `distanceDeg`: approximate distance in degrees
 */
function projectPointOntoRoadStretch(
  lat: number,
  lng: number,
  points: Array<[number, number]>
): {
  frac: number;
  snappedPos: [number, number];
  side: 'left' | 'right';
  distanceDeg: number;
} {
  if (points.length < 2) {
    return {
      frac: 0,
      snappedPos: points[0] || [lat, lng],
      side: 'left',
      distanceDeg: Infinity,
    };
  }

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cosLat = Math.cos(
      ((points[i][0] + points[i + 1][0]) * 0.5 * Math.PI) / 180
    );
    const len = Math.hypot(
      points[i + 1][0] - points[i][0],
      (points[i + 1][1] - points[i][1]) * cosLat
    );
    segLengths.push(len);
    totalLen += len;
  }
  if (totalLen <= 1e-9) {
    return {
      frac: 0,
      snappedPos: points[0],
      side: 'left',
      distanceDeg: Infinity,
    };
  }

  let bestDist = Infinity;
  let bestFrac = 0;
  let bestSnapped: [number, number] = points[0];
  let bestSide: 'left' | 'right' = 'left';
  let accum = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];
    const cosLat = Math.cos(((A[0] + B[0]) * 0.5 * Math.PI) / 180);
    const vx = (B[1] - A[1]) * cosLat;
    const vy = B[0] - A[0];
    const wx = (lng - A[1]) * cosLat;
    const wy = lat - A[0];

    const segLenSq = vx * vx + vy * vy;
    const t =
      segLenSq > 1e-12
        ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / segLenSq))
        : 0;

    const projX = vx * t;
    const projY = vy * t;
    const dist = Math.hypot(wx - projX, wy - projY);

    if (dist < bestDist) {
      bestDist = dist;
      bestFrac = (accum + segLengths[i] * t) / totalLen;
      bestSnapped = [
        A[0] + (B[0] - A[0]) * t,
        A[1] + (B[1] - A[1]) * t,
      ];
      const cross = vx * wy - vy * wx;
      bestSide = cross >= 0 ? 'left' : 'right';
    }
    accum += segLengths[i];
  }

  return {
    frac: bestFrac,
    snappedPos: bestSnapped,
    side: bestSide,
    distanceDeg: bestDist,
  };
}

function getTagAndDescendantIds(
  rootTagId: string,
  tree: CoverageTagNode[]
): Set<string> {
  const result = new Set<string>([rootTagId]);
  let added = true;
  while (added) {
    added = false;
    for (const node of tree) {
      if (node.parentId && result.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id);
        added = true;
      }
    }
  }
  return result;
}

/**
 * Interactive 360° Spherical Panorama Viewer using Google's Official Panorama Tiles.
 * Synchronizes `viewHeadingDeg` and `viewPitchDeg` in real time so the map's headlight cone
 * points in the exact direction the user is currently looking.
 */
const StreetViewSphericalViewer: React.FC<{
  panoId: string;
  carHeadingDeg: number;
  panoNorthDeg: number;
  viewHeadingDeg: number;
  viewPitchDeg: number;
  neighborLinks: OfficialStreetViewMetadata['neighborLinks'];
  onChangeViewAngle: (headingDeg: number, pitchDeg: number) => void;
  onNavigateNeighbor: (neighbor: {
    panoId: string;
    headingDeg: number;
    lat?: number;
    lng?: number;
  }) => void;
}> = ({
  panoId,
  panoNorthDeg,
  viewHeadingDeg,
  viewPitchDeg,
  neighborLinks,
  onChangeViewAngle,
  onNavigateNeighbor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fovDeg, setFovDeg] = useState<number>(75);
  const [tilesLoaded, setTilesLoaded] = useState<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    heading: number;
    pitch: number;
  }>({ x: 0, y: 0, heading: 0, pitch: 0 });
  const panoCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTilesLoaded(0);

    const offscreen = document.createElement('canvas');
    offscreen.width = 1664;
    offscreen.height = 832;
    const ctx = offscreen.getContext('2d');
    panoCanvasRef.current = offscreen;

    if (!ctx) return;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    let loadedCount = 0;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (cancelled) return;
          ctx.drawImage(img, x * 512, y * 512);
          loadedCount++;
          setTilesLoaded(loadedCount);
        };
        img.src = `https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=maps_sv.tactile&panoid=${encodeURIComponent(
          panoId
        )}&x=${x}&y=${y}&zoom=2&nbt=1&fover=2`;
      }
    }

    return () => {
      cancelled = true;
    };
  }, [panoId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const srcCanvas = panoCanvasRef.current;
    if (!canvas || !srcCanvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(240, Math.min(640, Math.floor(rect.width * 0.85)));
    const height = Math.max(180, Math.min(480, Math.floor(rect.height * 0.85)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    const srcCtx = srcCanvas.getContext('2d');
    if (!ctx || !srcCtx) return;

    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;
    let srcData: ImageData;
    try {
      srcData = srcCtx.getImageData(0, 0, srcW, srcH);
    } catch {
      return;
    }

    const dstData = ctx.createImageData(width, height);
    const srcPixels = new Uint32Array(srcData.data.buffer);
    const dstPixels = new Uint32Array(dstData.data.buffer);

    const fovRad = (fovDeg * Math.PI) / 180;
    const focal = (width * 0.5) / Math.tan(fovRad * 0.5);

    const yawDeg = viewHeadingDeg - panoNorthDeg;
    const yawRad = (yawDeg * Math.PI) / 180;
    const pitchRad = (viewPitchDeg * Math.PI) / 180;

    const cosYaw = Math.cos(yawRad);
    const sinYaw = Math.sin(yawRad);
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);

    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const invTwoPi = 1 / (2 * Math.PI);
    const invPi = 1 / Math.PI;

    let dstIdx = 0;
    for (let py = 0; py < height; py++) {
      const cy = halfH - py;
      for (let px = 0; px < width; px++) {
        const cx = px - halfW;
        const cz = focal;

        const invLen = 1 / Math.hypot(cx, cy, cz);
        const rx = cx * invLen;
        const ry = cy * invLen;
        const rz = cz * invLen;

        const y1 = ry * cosPitch + rz * sinPitch;
        const z1 = -ry * sinPitch + rz * cosPitch;
        const x1 = rx;

        const wx = x1 * cosYaw + z1 * sinYaw;
        const wz = -x1 * sinYaw + z1 * cosYaw;
        const wy = y1;

        const lon = Math.atan2(wx, wz);
        const lat = Math.asin(Math.max(-1, Math.min(1, wy)));

        let u = 0.5 + lon * invTwoPi;
        u = u - Math.floor(u);
        const v = Math.max(0, Math.min(0.999, 0.5 - lat * invPi));

        const sx = (u * (srcW - 1)) | 0;
        const sy = (v * (srcH - 1)) | 0;
        dstPixels[dstIdx++] = srcPixels[sy * srcW + sx];
      }
    }

    ctx.putImageData(dstData, 0, 0);
  }, [panoId, panoNorthDeg, viewHeadingDeg, viewPitchDeg, fovDeg, tilesLoaded]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      heading: viewHeadingDeg,
      pitch: viewPitchDeg,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const sensitivity = fovDeg / 320;
    const nextHeading =
      (((dragStartRef.current.heading - dx * sensitivity) % 360) + 360) % 360;
    const nextPitch = Math.max(
      -85,
      Math.min(85, dragStartRef.current.pitch + dy * sensitivity)
    );
    onChangeViewAngle(nextHeading, nextPitch);
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setFovDeg((prev) =>
      Math.max(22, Math.min(105, prev + (e.deltaY > 0 ? 7 : -7)))
    );
  };

  return (
    <div className="relative w-full h-full bg-slate-950 select-none overflow-hidden">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />

      {/* Live Compass Heading at Top of Panorama */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-950/85 border border-slate-700 text-[11px] font-bold text-amber-300 shadow pointer-events-none flex items-center gap-2">
        <Compass className="w-3.5 h-3.5 text-amber-400" />
        <span>Looking: {formatCompassDirection(viewHeadingDeg)}</span>
      </div>

      {/* Step Forward / Backward Road Arrows at Bottom of Panorama */}
      {neighborLinks.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-slate-950/85 px-2.5 py-1.5 rounded-full border border-slate-700 shadow-lg">
          {neighborLinks.map((n, idx) => {
            const relAngle =
              (((n.headingDeg - viewHeadingDeg) % 360) + 360) % 360;
            return (
              <button
                key={`${n.panoId}-${idx}`}
                type="button"
                onClick={() => onNavigateNeighbor(n)}
                title={`Step along road (${formatCompassDirection(n.headingDeg)})`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 hover:bg-indigo-600 text-[10px] font-bold text-slate-200 hover:text-white border border-slate-700 cursor-pointer transition"
              >
                <span
                  className="inline-block"
                  style={{ transform: `rotate(${relAngle}deg)` }}
                >
                  ↑
                </span>
                <span>{formatCompassDirection(n.headingDeg)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Interactive Mini Sketch Canvas for Pin Annotations
 */
const PinSketchCanvas: React.FC<{
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
}> = ({ value, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [brushColor, setBrushColor] = useState('#f8fafc');
  const [brushSize, setBrushSize] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = value;
    }
  }, [value]);

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL('image/png'));
  };

  const clearSketch = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(undefined);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span className="font-bold text-slate-300">SKETCH CANVAS</span>
        <div className="flex items-center gap-1">
          {['#f8fafc', '#ef4444', '#eab308', '#38bdf8', '#22c55e'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setBrushColor(c)}
              className={`w-3.5 h-3.5 rounded-full border cursor-pointer ${
                brushColor === c ? 'border-white scale-110' : 'border-slate-700'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <select
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="ml-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-300"
          >
            <option value={2}>Thin</option>
            <option value={3}>Med</option>
            <option value={5}>Thick</option>
          </select>
          <button
            type="button"
            onClick={clearSketch}
            className="ml-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={220}
        height={130}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="w-full h-[130px] rounded-lg bg-slate-950 border border-slate-800 cursor-crosshair touch-none"
      />
    </div>
  );
};

/**
 * Map interaction & zoom tracker component.
 */
const MapInteractionController: React.FC<{
  activeTool: CoverageToolId;
  roadSnapSubMode: RoadSnapSubMode;
  onZoomChange: (zoom: number) => void;
  onMapSingleClick: (lat: number, lng: number, altOrRight: boolean) => void;
  onMapDoubleClick: () => void;
  onFinishDragStroke: (pts: Array<[number, number]>) => void;
  onUpdateLiveDrag: (pts: Array<[number, number]>) => void;
}> = ({
  activeTool,
  roadSnapSubMode,
  onZoomChange,
  onMapSingleClick,
  onMapDoubleClick,
  onFinishDragStroke,
  onUpdateLiveDrag,
}) => {
  const map = useMap();
  const isDraggingStrokeRef = useRef(false);
  const strokePtsRef = useRef<Array<[number, number]>>([]);

  const isDragDrawingMode =
    activeTool === 'freehand' ||
    activeTool === 'side-line' ||
    (activeTool === 'road-stretch' && roadSnapSubMode === 'freedraw-snap');

  useEffect(() => {
    if (isDragDrawingMode) {
      map.dragging.disable();
      map.doubleClickZoom.disable();
    } else if (activeTool === 'road-stretch') {
      map.dragging.enable();
      map.doubleClickZoom.disable();
    } else {
      map.dragging.enable();
      map.doubleClickZoom.enable();
    }
  }, [map, activeTool, isDragDrawingMode]);

  useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    },
    click: (e) => {
      const orig = e.originalEvent as MouseEvent;
      if (isDragDrawingMode) return;
      onMapSingleClick(
        e.latlng.lat,
        e.latlng.lng,
        orig.altKey || orig.button === 2
      );
    },
    contextmenu: (e) => {
      e.originalEvent.preventDefault();
      onMapSingleClick(e.latlng.lat, e.latlng.lng, true);
    },
    dblclick: () => {
      if (activeTool === 'road-stretch' && roadSnapSubMode === 'point-to-point') {
        onMapDoubleClick();
      }
    },
    mousedown: (e) => {
      const orig = e.originalEvent as MouseEvent;
      if (orig.button !== 0 || orig.altKey || !isDragDrawingMode) return;
      isDraggingStrokeRef.current = true;
      const startPt: [number, number] = [e.latlng.lat, e.latlng.lng];
      strokePtsRef.current = [startPt];
      onUpdateLiveDrag([startPt]);
    },
    mousemove: (e) => {
      if (!isDraggingStrokeRef.current) return;
      const nextPt: [number, number] = [e.latlng.lat, e.latlng.lng];
      const prev = strokePtsRef.current[strokePtsRef.current.length - 1];
      if (
        !prev ||
        Math.hypot(nextPt[0] - prev[0], nextPt[1] - prev[1]) > 0.00004
      ) {
        strokePtsRef.current.push(nextPt);
        onUpdateLiveDrag([...strokePtsRef.current]);
      }
    },
    mouseup: () => {
      if (!isDraggingStrokeRef.current) return;
      isDraggingStrokeRef.current = false;
      const pts = [...strokePtsRef.current];
      strokePtsRef.current = [];
      onUpdateLiveDrag([]);
      if (pts.length >= 1) {
        onFinishDragStroke(pts);
      }
    },
  });

  return null;
};

const MapFlyController: React.FC<{
  target: { center: [number, number]; zoom: number; seq: number } | null;
}> = ({ target }) => {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.setView(target.center, target.zoom, { animate: true });
  }, [map, target]);
  return null;
};

export const CoverageNotesTab: React.FC = () => {
  const [notebooks, setNotebooks] = useState<CoverageNotebook[]>(() =>
    loadCoverageNotebooks()
  );
  const [activeNotebookId, setActiveNotebookId] = useState<string>(
    () => loadCoverageNotebooks()[0]?.id || 'nb-default'
  );
  const activeNotebook = useMemo(
    () => notebooks.find((n) => n.id === activeNotebookId) || notebooks[0],
    [notebooks, activeNotebookId]
  );

  const [annotations, setAnnotations] = useState<CoverageAnnotation[]>(() =>
    loadNotebookAnnotations(activeNotebookId)
  );
  const [undoStack, setUndoStack] = useState<CoverageAnnotation[][]>([]);
  const [redoStack, setRedoStack] = useState<CoverageAnnotation[][]>([]);

  // User-created Tag Tree & Side Line Tags
  const [tagTree, setTagTree] = useState<CoverageTagNode[]>(() =>
    loadCoverageTagTree()
  );
  const [sideLineTags, setSideLineTags] = useState<SideLineTagDefinition[]>(() =>
    loadSideLineTags()
  );
  const [activeSideLineTagId, setActiveSideLineTagId] = useState<string>('');

  useEffect(() => {
    if (
      sideLineTags.length > 0 &&
      !sideLineTags.some((t) => t.id === activeSideLineTagId)
    ) {
      setActiveSideLineTagId(sideLineTags[0].id);
    }
  }, [sideLineTags, activeSideLineTagId]);

  // Customizable Official SV Coverage Style
  const initialSvPrefs = useMemo(() => loadSvCoverageStylePrefs(), []);
  const [baseLayer, setBaseLayer] = useState<'roadmap' | 'hybrid' | 'osm'>(
    'roadmap'
  );
  const [showOfficialCoverage, setShowOfficialCoverage] = useState<boolean>(
    initialSvPrefs.visible
  );
  const [coverageOpacity, setCoverageOpacity] = useState<number>(
    initialSvPrefs.opacity
  );
  const [svLineColor, setSvLineColor] = useState<string>(initialSvPrefs.color);
  const [hideAllAnnotations, setHideAllAnnotations] = useState<boolean>(false);

  useEffect(() => {
    saveSvCoverageStylePrefs({
      color: svLineColor,
      opacity: coverageOpacity,
      visible: showOfficialCoverage,
    });
  }, [svLineColor, coverageOpacity, showOfficialCoverage]);

  // Active Tool & Road Stretch Snapping States
  const [activeTool, setActiveTool] = useState<CoverageToolId>('inspect');
  const [roadSnapSubMode, setRoadSnapSubMode] =
    useState<RoadSnapSubMode>('freedraw-snap');
  const [activeColor, setActiveColor] = useState<string>('#2563eb');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(4);
  const [activeDirection, setActiveDirection] =
    useState<DrivingDirectionMode>('forward');
  const [autoDetectCarDir, setAutoDetectCarDir] = useState<boolean>(false);
  const [freehandArrowEnd, setFreehandArrowEnd] = useState<boolean>(false);

  // Map Zoom & Live Drawing States
  const [mapZoom, setMapZoom] = useState<number>(activeNotebook.defaultZoom);
  const [draftPoints, setDraftPoints] = useState<Array<[number, number]>>([]);
  const [liveDragPoints, setLiveDragPoints] = useState<Array<[number, number]>>(
    []
  );
  const [snapStatusMsg, setSnapStatusMsg] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(null);

  // Split-Screen Street View Panorama States
  const [svMeta, setSvMeta] = useState<OfficialStreetViewMetadata | null>(null);
  const [svViewHeading, setSvViewHeading] = useState<number>(0);
  const [svViewPitch, setSvViewPitch] = useState<number>(0);
  const [svLoading, setSvLoading] = useState<boolean>(false);
  const [svStatusMessage, setSvStatusMessage] = useState<string | null>(null);
  const [showStreetViewPanel, setShowStreetViewPanel] =
    useState<boolean>(false);
  const [useIframeFallback, setUseIframeFallback] = useState<boolean>(false);

  // Dedicated Right-Sidebar Tags & Filters Panel State
  const [showTagManagerPanel, setShowTagManagerPanel] =
    useState<boolean>(false);
  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState<string[]>(
    []
  );
  const [selectedFilterSideLineTagId, setSelectedFilterSideLineTagId] =
    useState<string>('all');
  const [cardinalDirectionFilter, setCardinalDirectionFilter] =
    useState<CardinalDirectionFilter>('all');

  // Tag Creation Inputs
  const [newTagName, setNewTagName] = useState<string>('');
  const [newTagParentId, setNewTagParentId] = useState<string>('');
  const [newTagColor, setNewTagColor] = useState<string>('#38bdf8');

  // Side Line Tag Creation Inputs
  const [newSideLineTagName, setNewSideLineTagName] = useState<string>('');
  const [newSideLineTagColor, setNewSideLineTagColor] =
    useState<string>('#ef4444');

  // Place Search & Fly Controller
  const [placeQuery, setPlaceQuery] = useState<string>('');
  const [flyTarget, setFlyTarget] = useState<{
    center: [number, number];
    zoom: number;
    seq: number;
  } | null>(null);

  useEffect(() => {
    const loaded = loadNotebookAnnotations(activeNotebookId);
    setAnnotations(loaded);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedAnnotationId(null);
    setDraftPoints([]);
  }, [activeNotebookId]);

  const commitAnnotations = useCallback(
    (next: CoverageAnnotation[]) => {
      setUndoStack((prev) => [...prev.slice(-35), annotations]);
      setRedoStack([]);
      setAnnotations(next);
      saveNotebookAnnotations(activeNotebookId, next);
    },
    [annotations, activeNotebookId]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, annotations]);
    setUndoStack((u) => u.slice(0, -1));
    setAnnotations(prev);
    saveNotebookAnnotations(activeNotebookId, prev);
  }, [undoStack, annotations, activeNotebookId]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, annotations]);
    setRedoStack((r) => r.slice(0, -1));
    setAnnotations(next);
    saveNotebookAnnotations(activeNotebookId, next);
  }, [redoStack, annotations, activeNotebookId]);

  const selectedAnnotation = useMemo(
    () => annotations.find((a) => a.id === selectedAnnotationId) || null,
    [annotations, selectedAnnotationId]
  );

  const updateSelectedAnnotation = (patch: Partial<CoverageAnnotation>) => {
    if (!selectedAnnotationId) return;
    const next = annotations.map((a) =>
      a.id === selectedAnnotationId
        ? { ...a, ...patch, updatedAt: Date.now() }
        : a
    );
    commitAnnotations(next);
  };

  const deleteAnnotationById = (id: string) => {
    const next = annotations.filter((a) => a.id !== id);
    commitAnnotations(next);
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  };

  const closeTemporaryStreetView = useCallback(() => {
    setShowStreetViewPanel(false);
    setSvMeta(null);
    setSvStatusMessage(null);
  }, []);

  const markedSphereForActivePano = useMemo(() => {
    if (!svMeta) return null;
    return (
      annotations.find(
        (a) => a.type === 'sphere' && a.panoId === svMeta.panoId
      ) || null
    );
  }, [annotations, svMeta]);

  const handleMarkOrUnmarkActiveSphere = () => {
    if (!svMeta) return;
    if (markedSphereForActivePano) {
      deleteAnnotationById(markedSphereForActivePano.id);
      return;
    }
    const newSphere: CoverageAnnotation = {
      id: `sph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      notebookId: activeNotebookId,
      type: 'sphere',
      position: [svMeta.lat, svMeta.lng],
      color: '#f59e0b',
      panoId: svMeta.panoId,
      carHeadingDeg: svMeta.carHeadingDeg,
      viewHeadingDeg: svViewHeading,
      viewPitchDeg: svViewPitch,
      captureDate: svMeta.captureDate,
      label: '',
      notes: '',
      tagIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    commitAnnotations([...annotations, newSphere]);
    setSelectedAnnotationId(newSphere.id);
  };

  const openStreetViewAt = async (lat: number, lng: number) => {
    setSvLoading(true);
    setSvStatusMessage('Locating official Google Street View coverage...');
    setShowStreetViewPanel(true);

    let found = await fetchOfficialStreetViewAtLatLng(lat, lng, 350);
    if (!found) {
      found = await fetchOfficialStreetViewAtLatLng(lat, lng, 1800);
    }

    setSvLoading(false);
    if (!found) {
      setSvStatusMessage(
        'No official Google Street View coverage found near this point.'
      );
      setSvMeta(null);
      return;
    }

    setSvStatusMessage(null);
    setSvMeta(found);
    setSvViewHeading(found.carHeadingDeg);
    setSvViewPitch(0);
  };

  /**
   * Snaps a Road Stretch strictly to roads with official Google Street View coverage.
   */
  const createSnappedRoadStretch = async (
    rawPoints: Array<[number, number]>
  ) => {
    if (rawPoints.length < 2) return;
    setSnapStatusMsg('Verifying official Street View coverage & snapping road...');
    const result = await snapPathToOfficialCoveredRoad(rawPoints, mapZoom);

    if (!result || result.points.length < 2) {
      setSnapStatusMsg(
        'Rejected: No official Street View coverage on that road section.'
      );
      window.setTimeout(() => setSnapStatusMsg(null), 3200);
      setDraftPoints([]);
      return;
    }

    const snappedPoints = result.points;
    let directionToUse: DrivingDirectionMode = activeDirection;

    if (
      autoDetectCarDir &&
      result.carHeadingDeg !== undefined &&
      snappedPoints.length >= 2
    ) {
      const startPt = snappedPoints[0];
      const endPt = snappedPoints[snappedPoints.length - 1];
      const drawnBearing = computeCompassBearing(
        startPt[0],
        startPt[1],
        endPt[0],
        endPt[1]
      );
      const angleDiff = Math.abs(
        (((result.carHeadingDeg - drawnBearing) % 360) + 540) % 360 - 180
      );
      directionToUse = angleDiff <= 90 ? 'forward' : 'reverse';
    }

    setSnapStatusMsg(null);

    const newStretch: CoverageAnnotation = {
      id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      notebookId: activeNotebookId,
      type: 'road-stretch',
      points: snappedPoints,
      color: activeColor,
      strokeWidth: activeStrokeWidth,
      direction: directionToUse,
      label: '',
      notes: '',
      tagIds: [],
      roadPois: [],
      sideLines: [],
      carHeadingDeg: result.carHeadingDeg,
      captureDate: result.captureDate,
      panoId: result.panoId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    commitAnnotations([...annotations, newStretch]);
    setSelectedAnnotationId(newStretch.id);
    setDraftPoints([]);
  };

  /**
   * Places a Point of Interest (POI) on the nearest Marked Road Stretch.
   */
  const addPointOfInterestOnRoadStretch = (lat: number, lng: number) => {
    const roadStretches = annotations.filter(
      (a) => a.type === 'road-stretch' && a.points && a.points.length >= 2
    );
    if (roadStretches.length === 0) {
      setSnapStatusMsg('Mark a road stretch first before adding a Road POI.');
      window.setTimeout(() => setSnapStatusMsg(null), 2600);
      return;
    }

    let bestStretch: CoverageAnnotation | null = null;
    let bestProj: ReturnType<typeof projectPointOntoRoadStretch> | null = null;

    for (const rs of roadStretches) {
      const proj = projectPointOntoRoadStretch(lat, lng, rs.points!);
      if (!bestProj || proj.distanceDeg < bestProj.distanceDeg) {
        bestProj = proj;
        bestStretch = rs;
      }
    }

    if (!bestStretch || !bestProj) return;

    const existingPois = bestStretch.roadPois || [];
    const newPoi: RoadPointOfInterest = {
      id: `poi-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: `P${existingPois.length + 1}`,
      frac: Math.round(bestProj.frac * 1000) / 1000,
      position: bestProj.snappedPos,
      color: activeColor,
    };

    const nextAnnotations = annotations.map((a) =>
      a.id === bestStretch!.id
        ? {
            ...a,
            roadPois: [...existingPois, newPoi].sort((x, y) => x.frac - y.frac),
            updatedAt: Date.now(),
          }
        : a
    );
    commitAnnotations(nextAnnotations);
    setSelectedAnnotationId(bestStretch.id);
  };

  /**
   * Attaches a Side Line along the nearest Marked Road Stretch, automatically snapping
   * to nearby Road POIs (or bounding between two Road POIs on single-click) when applicable.
   */
  const attachSideLineFromStroke = (strokePts: Array<[number, number]>) => {
    let tagId = activeSideLineTagId;
    if (!tagId) {
      const defaultTag: SideLineTagDefinition = {
        id: `slt-${Date.now()}`,
        name: newSideLineTagName.trim() || 'Side Line 1',
        color: newSideLineTagColor,
      };
      const nextTags = [...sideLineTags, defaultTag];
      setSideLineTags(nextTags);
      saveSideLineTags(nextTags);
      tagId = defaultTag.id;
      setActiveSideLineTagId(tagId);
    }

    const roadStretches = annotations.filter(
      (a) => a.type === 'road-stretch' && a.points && a.points.length >= 2
    );
    if (roadStretches.length === 0) return;

    const firstPt = strokePts[0];
    const lastPt = strokePts[strokePts.length - 1];

    let bestStretch: CoverageAnnotation | null = null;
    let bestDist = Infinity;
    for (const rs of roadStretches) {
      const proj = projectPointOntoRoadStretch(
        firstPt[0],
        firstPt[1],
        rs.points!
      );
      if (proj.distanceDeg < bestDist) {
        bestDist = proj.distanceDeg;
        bestStretch = rs;
      }
    }

    if (!bestStretch || !bestStretch.points) return;

    const projStart = projectPointOntoRoadStretch(
      firstPt[0],
      firstPt[1],
      bestStretch.points
    );
    const projEnd = projectPointOntoRoadStretch(
      lastPt[0],
      lastPt[1],
      bestStretch.points
    );

    const sortedPois = [...(bestStretch.roadPois || [])].sort(
      (a, b) => a.frac - b.frac
    );

    const isSingleClick =
      strokePts.length === 1 ||
      Math.abs(projEnd.frac - projStart.frac) < 0.025;

    let startFrac = 0;
    let endFrac = 1;
    let startPoiId: string | undefined;
    let endPoiId: string | undefined;

    if (isSingleClick) {
      // If single-clicked on a road stretch that has POIs, bound between the surrounding POIs (or start/end of road)
      if (sortedPois.length > 0) {
        const clickF = projStart.frac;
        const prevPoi = [...sortedPois].reverse().find((p) => p.frac <= clickF);
        const nextPoi = sortedPois.find((p) => p.frac > clickF);
        if (prevPoi) {
          startFrac = prevPoi.frac;
          startPoiId = prevPoi.id;
        } else {
          startFrac = 0;
        }
        if (nextPoi) {
          endFrac = nextPoi.frac;
          endPoiId = nextPoi.id;
        } else {
          endFrac = 1;
        }
      } else {
        startFrac = 0;
        endFrac = 1;
      }
    } else {
      const rawStart = Math.max(0, Math.min(projStart.frac, projEnd.frac));
      const rawEnd = Math.min(1, Math.max(projStart.frac, projEnd.frac));
      startFrac = rawStart;
      endFrac = rawEnd;

      // Snap start/end to nearby Road POIs if within 4% arc-length
      const nearStartPoi = sortedPois.find(
        (p) => Math.abs(p.frac - rawStart) <= 0.04
      );
      if (nearStartPoi) {
        startFrac = nearStartPoi.frac;
        startPoiId = nearStartPoi.id;
      }
      const nearEndPoi = sortedPois.find(
        (p) =>
          p.id !== nearStartPoi?.id && Math.abs(p.frac - rawEnd) <= 0.04
      );
      if (nearEndPoi) {
        endFrac = nearEndPoi.frac;
        endPoiId = nearEndPoi.id;
      }
    }

    const newAttachment: RoadSideLineAttachment = {
      id: `sl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sideLineTagId: tagId,
      side: projStart.side,
      startFrac: Math.round(startFrac * 1000) / 1000,
      endFrac: Math.round(endFrac * 1000) / 1000,
      startPoiId,
      endPoiId,
    };

    const nextAnnotations = annotations.map((a) =>
      a.id === bestStretch!.id
        ? {
            ...a,
            sideLines: [...(a.sideLines || []), newAttachment],
            updatedAt: Date.now(),
          }
        : a
    );
    commitAnnotations(nextAnnotations);
    setSelectedAnnotationId(bestStretch.id);
  };

  const handleFinishDragStroke = async (pts: Array<[number, number]>) => {
    if (activeTool === 'road-stretch' && roadSnapSubMode === 'freedraw-snap') {
      if (pts.length >= 2) {
        await createSnappedRoadStretch(pts);
      }
      return;
    }

    if (activeTool === 'side-line') {
      attachSideLineFromStroke(pts);
      return;
    }

    if (activeTool === 'freehand' && pts.length >= 2) {
      const newFreehand: CoverageAnnotation = {
        id: `fh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        type: 'freehand',
        points: pts,
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        direction: freehandArrowEnd ? 'forward' : 'none',
        label: '',
        notes: '',
        tagIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      commitAnnotations([...annotations, newFreehand]);
      setSelectedAnnotationId(newFreehand.id);
    }
  };

  const handleMapSingleClick = async (
    lat: number,
    lng: number,
    altOrRight: boolean
  ) => {
    if (altOrRight || activeTool === 'inspect') {
      await openStreetViewAt(lat, lng);
      return;
    }

    if (svMeta && !markedSphereForActivePano) {
      closeTemporaryStreetView();
    }

    if (activeTool === 'select') {
      setSelectedAnnotationId(null);
      return;
    }

    if (activeTool === 'road-poi') {
      addPointOfInterestOnRoadStretch(lat, lng);
      return;
    }

    if (activeTool === 'road-stretch') {
      if (roadSnapSubMode === 'single-section') {
        setSnapStatusMsg(
          'Verifying official Street View coverage & snapping section...'
        );
        const section = await fetchSingleClickRoadSection(lat, lng, mapZoom);
        if (!section || section.points.length < 2) {
          setSnapStatusMsg(
            'Rejected: No official Street View coverage at that location.'
          );
          window.setTimeout(() => setSnapStatusMsg(null), 3200);
          return;
        }
        setSnapStatusMsg(null);
        const newStretch: CoverageAnnotation = {
          id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          notebookId: activeNotebookId,
          type: 'road-stretch',
          points: section.points,
          color: activeColor,
          strokeWidth: activeStrokeWidth,
          direction: activeDirection,
          carHeadingDeg: section.carHeadingDeg,
          captureDate: section.captureDate,
          panoId: section.panoId,
          label: '',
          notes: '',
          tagIds: [],
          roadPois: [],
          sideLines: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        commitAnnotations([...annotations, newStretch]);
        setSelectedAnnotationId(newStretch.id);
        return;
      }

      if (roadSnapSubMode === 'point-to-point') {
        setDraftPoints((prev) => [...prev, [lat, lng]]);
        return;
      }
    }

    if (activeTool === 'text') {
      const newText: CoverageAnnotation = {
        id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        type: 'text',
        position: [lat, lng],
        color: activeColor,
        label: 'Label',
        notes: '',
        tagIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      commitAnnotations([...annotations, newText]);
      setSelectedAnnotationId(newText.id);
      return;
    }

    if (activeTool === 'pin') {
      const newPin: CoverageAnnotation = {
        id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        type: 'pin',
        position: [lat, lng],
        color: activeColor,
        label: '',
        notes: '',
        tagIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      commitAnnotations([...annotations, newPin]);
      setSelectedAnnotationId(newPin.id);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (
        e.key === 'Enter' &&
        activeTool === 'road-stretch' &&
        draftPoints.length >= 2
      ) {
        e.preventDefault();
        createSnappedRoadStretch(draftPoints);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedAnnotationId
      ) {
        e.preventDefault();
        deleteAnnotationById(selectedAnnotationId);
      } else if (e.key === 'Escape') {
        setDraftPoints([]);
        setSelectedAnnotationId(null);
        closeTemporaryStreetView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    activeTool,
    draftPoints,
    selectedAnnotationId,
    closeTemporaryStreetView,
  ]);

  const expandedFilterTagIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of selectedFilterTagIds) {
      for (const desc of getTagAndDescendantIds(id, tagTree)) {
        set.add(desc);
      }
    }
    return set;
  }, [selectedFilterTagIds, tagTree]);

  const sideLineTagById = useMemo(() => {
    const map = new Map<string, SideLineTagDefinition>();
    for (const t of sideLineTags) map.set(t.id, t);
    return map;
  }, [sideLineTags]);

  const filteredAnnotationsWithMatchingSideSegments = useMemo(() => {
    const hasTagFilter = expandedFilterTagIds.size > 0;
    const hasSideLineFilter =
      selectedFilterSideLineTagId !== 'all' || cardinalDirectionFilter !== 'all';

    return annotations
      .map((ann) => {
        if (hasTagFilter) {
          const annTags = ann.tagIds || [];
          const matchesTag = annTags.some((tid) => expandedFilterTagIds.has(tid));
          if (!matchesTag) return null;
        }

        if (!hasSideLineFilter) {
          return { ann, matchingSideSegments: null };
        }

        if (
          ann.type !== 'road-stretch' ||
          !ann.points ||
          ann.points.length < 2 ||
          !ann.sideLines ||
          ann.sideLines.length === 0
        ) {
          return null;
        }

        const matchingSideSegments: Array<{
          attachmentId: string;
          color: string;
          points: Array<[number, number]>;
        }> = [];

        ann.sideLines.forEach((sl, idx) => {
          if (
            selectedFilterSideLineTagId !== 'all' &&
            sl.sideLineTagId !== selectedFilterSideLineTagId
          ) {
            return;
          }
          const slDef = sideLineTagById.get(sl.sideLineTagId);
          const color = slDef?.color || '#f43f5e';

          const [resolvedStart, resolvedEnd] = resolveSideLineFractions(
            sl,
            ann.roadPois
          );

          const subPts = extractSubPolylineByFraction(
            ann.points!,
            resolvedStart,
            resolvedEnd
          );
          if (subPts.length < 2) return;

          const offsetPts = offsetPolylinePerpendicular(
            subPts,
            sl.side,
            7 + (idx % 4) * 4.5,
            mapZoom
          );

          if (cardinalDirectionFilter === 'all') {
            matchingSideSegments.push({
              attachmentId: sl.id,
              color,
              points: offsetPts,
            });
            return;
          }

          let currentRun: Array<[number, number]> = [];
          for (let i = 0; i < subPts.length - 1; i++) {
            const outwardBearing = computeSideOutwardCompassBearing(
              subPts[i],
              subPts[i + 1],
              sl.side
            );
            const matchesCardinal = isAngleWithinCardinalFilter(
              outwardBearing,
              cardinalDirectionFilter
            );
            if (matchesCardinal) {
              if (currentRun.length === 0) {
                currentRun.push(offsetPts[i]);
              }
              currentRun.push(offsetPts[i + 1]);
            } else if (currentRun.length >= 2) {
              matchingSideSegments.push({
                attachmentId: `${sl.id}-${i}`,
                color,
                points: currentRun,
              });
              currentRun = [];
            } else {
              currentRun = [];
            }
          }
          if (currentRun.length >= 2) {
            matchingSideSegments.push({
              attachmentId: `${sl.id}-end`,
              color,
              points: currentRun,
            });
          }
        });

        if (matchingSideSegments.length === 0) return null;
        return { ann, matchingSideSegments };
      })
      .filter(
        (
          item
        ): item is {
          ann: CoverageAnnotation;
          matchingSideSegments: Array<{
            attachmentId: string;
            color: string;
            points: Array<[number, number]>;
          }> | null;
        } => item !== null
      );
  }, [
    annotations,
    expandedFilterTagIds,
    selectedFilterSideLineTagId,
    cardinalDirectionFilter,
    sideLineTagById,
    mapZoom,
  ]);

  const handleAddTagNode = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    const node: CoverageTagNode = {
      id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: trimmed,
      parentId: newTagParentId || null,
      color: newTagColor,
    };
    const next = [...tagTree, node];
    setTagTree(next);
    saveCoverageTagTree(next);
    setNewTagName('');
  };

  const handleDeleteTagNode = (tagId: string) => {
    const toRemove = getTagAndDescendantIds(tagId, tagTree);
    const next = tagTree.filter((t) => !toRemove.has(t.id));
    setTagTree(next);
    saveCoverageTagTree(next);
    setSelectedFilterTagIds((prev) => prev.filter((id) => !toRemove.has(id)));
  };

  const handleAddSideLineTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSideLineTagName.trim();
    if (!trimmed) return;
    const def: SideLineTagDefinition = {
      id: `slt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: trimmed,
      color: newSideLineTagColor,
    };
    const next = [...sideLineTags, def];
    setSideLineTags(next);
    saveSideLineTags(next);
    setActiveSideLineTagId(def.id);
    setNewSideLineTagName('');
  };

  const handleDeleteSideLineTag = (id: string) => {
    const next = sideLineTags.filter((t) => t.id !== id);
    setSideLineTags(next);
    saveSideLineTags(next);
    if (selectedFilterSideLineTagId === id) {
      setSelectedFilterSideLineTagId('all');
    }
  };

  const handlePlaceSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = placeQuery.trim();
    if (!q) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
          q
        )}`
      );
      if (!res.ok) return;
      const items = await res.json();
      if (Array.isArray(items) && items.length > 0) {
        const lat = Number(items[0].lat);
        const lon = Number(items[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setFlyTarget({ center: [lat, lon], zoom: 11, seq: Date.now() });
        }
      }
    } catch {
      // ignore
    }
  };

  const handleCreateNotebook = () => {
    const name = window.prompt('Notebook Name:');
    if (!name || !name.trim()) return;
    const nb: CoverageNotebook = {
      id: `nb-${Date.now()}`,
      name: name.trim(),
      countryOrRegion: name.trim(),
      defaultCenter: [20, 0],
      defaultZoom: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [...notebooks, nb];
    setNotebooks(next);
    saveCoverageNotebooks(next);
    setActiveNotebookId(nb.id);
  };

  const handleExportJson = () => {
    const json = exportNotebookJson(
      activeNotebook,
      annotations,
      tagTree,
      sideLineTags
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeNotebook.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}-coverage.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as CoverageExportBundle;
        if (Array.isArray(parsed.annotations)) {
          commitAnnotations(parsed.annotations);
        }
        if (Array.isArray(parsed.tagTree)) {
          setTagTree(parsed.tagTree);
          saveCoverageTagTree(parsed.tagTree);
        }
        if (Array.isArray(parsed.sideLineTags)) {
          setSideLineTags(parsed.sideLineTags);
          saveSideLineTags(parsed.sideLineTags);
        }
      } catch {
        window.alert('Invalid Coverage Notes JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [svR, svG, svB] = useMemo(
    () => hexToRgbNormalized(svLineColor),
    [svLineColor]
  );

  const renderTagTreeNodes = (
    parentId: string | null,
    depth: number,
    mode: 'filter' | 'assign'
  ): React.ReactNode => {
    const children = tagTree.filter((t) => (t.parentId || null) === parentId);
    if (children.length === 0) return null;

    return children.map((node) => {
      const isChecked =
        mode === 'filter'
          ? selectedFilterTagIds.includes(node.id)
          : (selectedAnnotation?.tagIds || []).includes(node.id);

      return (
        <div key={node.id} style={{ paddingLeft: depth * 12 }} className="space-y-0.5">
          <div className="flex items-center justify-between gap-1.5 py-0.5 px-1.5 rounded hover:bg-slate-800/70">
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-200 flex-1 min-w-0">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => {
                  if (mode === 'filter') {
                    setSelectedFilterTagIds((prev) =>
                      prev.includes(node.id)
                        ? prev.filter((id) => id !== node.id)
                        : [...prev, node.id]
                    );
                  } else if (selectedAnnotation) {
                    const curr = selectedAnnotation.tagIds || [];
                    const next = curr.includes(node.id)
                      ? curr.filter((id) => id !== node.id)
                      : [...curr, node.id];
                    updateSelectedAnnotation({ tagIds: next });
                  }
                }}
                className="accent-indigo-500 cursor-pointer"
              />
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: node.color }}
              />
              <span className="truncate">{node.name}</span>
            </label>
            {mode === 'filter' && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title={`Add subtag under "${node.name}"`}
                  onClick={() => setNewTagParentId(node.id)}
                  className="px-1 text-[10px] rounded bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white cursor-pointer"
                >
                  +Sub
                </button>
                <button
                  type="button"
                  title="Delete tag"
                  onClick={() => handleDeleteTagNode(node.id)}
                  className="text-slate-500 hover:text-rose-400 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          {renderTagTreeNodes(node.id, depth + 1, mode)}
        </div>
      );
    });
  };

  const showRightSidebar =
    showTagManagerPanel || showStreetViewPanel || Boolean(selectedAnnotation);

  return (
    <div className="h-[calc(100dvh-3.5rem)] flex flex-col bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Hidden SVG Filter that recolors the official Google Street View coverage tiles */}
      <svg className="w-0 h-0 absolute pointer-events-none" aria-hidden="true">
        <defs>
          <filter id="sv-custom-line-color" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values={`0 0 0 0 ${svR}  0 0 0 0 ${svG}  0 0 0 0 ${svB}  0 0 0 1 0`}
            />
          </filter>
        </defs>
      </svg>
      <style>{`
        .sv-coverage-custom-tiles img.leaflet-tile {
          filter: url(#sv-custom-line-color);
        }
        .coverage-clean-text-icon {
          background: transparent !important;
          border: none !important;
        }
      `}</style>

      {/* Top Control & Tool Bar */}
      <div className="border-b border-slate-800 bg-slate-900/95 px-3 py-2 flex flex-wrap items-center justify-between gap-2 z-30">
        {/* Left: Notebook Selector & Search */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
            <Compass className="w-3.5 h-3.5 text-indigo-400" />
            <select
              value={activeNotebookId}
              onChange={(e) => {
                const nextId = e.target.value;
                setActiveNotebookId(nextId);
                const nb = notebooks.find((n) => n.id === nextId);
                if (nb) {
                  setFlyTarget({
                    center: nb.defaultCenter,
                    zoom: nb.defaultZoom,
                    seq: Date.now(),
                  });
                }
              }}
              className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
            >
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id} className="bg-slate-900">
                  {nb.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateNotebook}
              title="New Notebook"
              className="ml-1 p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>

          <form onSubmit={handlePlaceSearch} className="relative">
            <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              placeholder="Search place..."
              className="w-36 sm:w-44 pl-6 pr-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-white outline-none focus:border-indigo-500"
            />
          </form>
        </div>

        {/* Center/Right: Map Layer, Customizable SV Coverage Color & Opacity, Tag Tree Filter Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
            {(
              [
                { id: 'roadmap', label: 'Google Map' },
                { id: 'hybrid', label: 'Satellite' },
                { id: 'osm', label: 'OSM' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setBaseLayer(m.id)}
                className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                  baseLayer === m.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Customizable SV Coverage Line Color & Opacity */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800">
            <button
              type="button"
              onClick={() => setShowOfficialCoverage((v) => !v)}
              className={`inline-flex items-center gap-1 font-bold text-[11px] cursor-pointer ${
                showOfficialCoverage ? 'text-white' : 'text-slate-500'
              }`}
              title="Toggle Official Google Street View Coverage Overlay"
            >
              <Layers
                className="w-3.5 h-3.5"
                style={{ color: showOfficialCoverage ? svLineColor : undefined }}
              />
              <span>SV Lines</span>
            </button>
            {showOfficialCoverage && (
              <>
                <input
                  type="color"
                  value={svLineColor}
                  onChange={(e) => setSvLineColor(e.target.value)}
                  title="Customize Street View Coverage Line Color"
                  className="w-4 h-4 rounded border-0 bg-transparent cursor-pointer"
                />
                <input
                  type="range"
                  min={0.08}
                  max={1}
                  step={0.04}
                  value={coverageOpacity}
                  onChange={(e) => setCoverageOpacity(Number(e.target.value))}
                  title={`Coverage Line Opacity: ${Math.round(coverageOpacity * 100)}%`}
                  className="w-14 accent-indigo-500 cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 w-7 text-right">
                  {Math.round(coverageOpacity * 100)}%
                </span>
              </>
            )}
          </div>

          {/* Tags & Filters Sidebar Toggle */}
          <button
            type="button"
            onClick={() => setShowTagManagerPanel((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-bold cursor-pointer ${
              showTagManagerPanel ||
              selectedFilterTagIds.length > 0 ||
              selectedFilterSideLineTagId !== 'all' ||
              cardinalDirectionFilter !== 'all'
                ? 'bg-indigo-600 border-indigo-400 text-white'
                : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Tags & Filters</span>
            {(selectedFilterTagIds.length > 0 ||
              selectedFilterSideLineTagId !== 'all' ||
              cardinalDirectionFilter !== 'all') && (
              <span className="px-1 rounded bg-amber-400 text-slate-950 text-[10px]">
                Active
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setHideAllAnnotations((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
              hideAllAnnotations
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            {hideAllAnnotations ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span>Notes Hidden</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Hide Notes</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            title="Export Notebook, Tag Tree & Side Line Tags JSON"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Export</span>
          </button>
          <label
            title="Import Notebook JSON"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Import</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImportJson}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Second Row: Annotation Tools & Active Tool Options */}
      <div className="border-b border-slate-800 bg-slate-900/75 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-1 flex-wrap">
          {(
            [
              {
                id: 'inspect',
                label: 'Street View',
                icon: Navigation,
                tip: 'Click any covered road to open 360° Street View (Alt+Click works in any tool)',
              },
              {
                id: 'road-stretch',
                label: 'Road Stretch',
                icon: GitCommitHorizontal,
                tip: 'Snap road stretches strictly to roads with official Street View coverage',
              },
              {
                id: 'road-poi',
                label: 'Road POI',
                icon: Crosshair,
                tip: 'Click along any marked road stretch to add a Point of Interest (usable as a Side Line boundary)',
              },
              {
                id: 'side-line',
                label: 'Road Side Line',
                icon: GitBranch,
                tip: 'Click or drag along either side of a marked road stretch to attach a side line',
              },
              {
                id: 'freehand',
                label: 'Freehand Pen',
                icon: Pencil,
                tip: 'Draw freehand lines on the map',
              },
              {
                id: 'text',
                label: 'Text Label',
                icon: Type,
                tip: 'Place clean text on the map',
              },
              {
                id: 'pin',
                label: 'Pin',
                icon: MapPin,
                tip: 'Drop a pin with optional sketch canvas',
              },
              {
                id: 'select',
                label: 'Select / Edit',
                icon: MousePointer,
                tip: 'Select and edit any road stretch, POI, side line, sphere, text, or pin',
              },
              {
                id: 'eraser',
                label: 'Eraser',
                icon: Eraser,
                tip: 'Click any road stretch, POI, side line, marked sphere, text, or pin to delete it',
              },
            ] as const
          ).map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                title={tool.tip}
                onClick={() => {
                  setActiveTool(tool.id);
                  setDraftPoints([]);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Sub-options for the active tool */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeTool === 'road-stretch' && (
            <>
              <div className="inline-flex items-center rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
                {(
                  [
                    { id: 'freedraw-snap', label: 'Freedraw Snap' },
                    { id: 'single-section', label: '1-Click Section' },
                    { id: 'point-to-point', label: 'Click Points' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setRoadSnapSubMode(m.id);
                      setDraftPoints([]);
                    }}
                    className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                      roadSnapSubMode === m.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
                {(
                  [
                    { id: 'forward', label: 'A → B' },
                    { id: 'reverse', label: 'B ← A' },
                    { id: 'both', label: 'A ↔ B' },
                    { id: 'none', label: 'No Arrow' },
                  ] as const
                ).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActiveDirection(d.id)}
                    className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                      activeDirection === d.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setAutoDetectCarDir((v) => !v)}
                title="Automatically orient the driving arrow to match the official Google car direction"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
                  autoDetectCarDir
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto Car Dir: {autoDetectCarDir ? 'On' : 'Off'}</span>
              </button>

              {roadSnapSubMode === 'point-to-point' && draftPoints.length >= 2 && (
                <button
                  type="button"
                  onClick={() => createSnappedRoadStretch(draftPoints)}
                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                >
                  Snap Road ({draftPoints.length} pts)
                </button>
              )}
            </>
          )}

          {activeTool === 'side-line' && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800 text-[11px]">
              <span className="text-slate-400 font-bold">Side Line Tag:</span>
              {sideLineTags.length > 0 ? (
                <select
                  value={activeSideLineTagId}
                  onChange={(e) => setActiveSideLineTagId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-white font-bold cursor-pointer"
                >
                  {sideLineTags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                type="text"
                value={newSideLineTagName}
                onChange={(e) => setNewSideLineTagName(e.target.value)}
                placeholder="New side line tag..."
                className="w-28 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-white text-[11px] outline-none"
              />
              <input
                type="color"
                value={newSideLineTagColor}
                onChange={(e) => setNewSideLineTagColor(e.target.value)}
                className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer"
              />
              <button
                type="button"
                onClick={handleAddSideLineTag}
                className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] cursor-pointer"
              >
                +Add
              </button>
            </div>
          )}

          {activeTool === 'freehand' && (
            <button
              type="button"
              onClick={() => setFreehandArrowEnd((v) => !v)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
                freehandArrowEnd
                  ? 'bg-indigo-500/20 border-indigo-400 text-indigo-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Arrowhead: {freehandArrowEnd ? 'On' : 'Off'}</span>
            </button>
          )}

          {/* Color Swatches & Stroke Width */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onClick={() => {
                  setActiveColor(c.id);
                  if (selectedAnnotation) {
                    updateSelectedAnnotation({ color: c.id });
                  }
                }}
                className={`w-4 h-4 rounded-full border transition cursor-pointer ${
                  activeColor === c.id
                    ? 'border-white scale-125 shadow'
                    : 'border-slate-700 opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: c.id }}
              />
            ))}
            <select
              value={activeStrokeWidth}
              onChange={(e) => {
                const w = Number(e.target.value);
                setActiveStrokeWidth(w);
                if (selectedAnnotation) {
                  updateSelectedAnnotation({ strokeWidth: w });
                }
              }}
              className="ml-1 bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-300 cursor-pointer"
            >
              <option value={2.5}>Thin</option>
              <option value={4}>Med</option>
              <option value={6}>Thick</option>
            </select>
          </div>

          {/* Undo / Redo / Clear */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Undo (Ctrl+Z)"
              className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title="Redo (Ctrl+Y)"
              className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `Clear all annotations in "${activeNotebook.name}"?`
                  )
                ) {
                  commitAnnotations([]);
                  setSelectedAnnotationId(null);
                }
              }}
              title="Clear All Annotations"
              className="p-1 rounded bg-slate-950 border border-slate-800 text-rose-400 hover:bg-rose-500/15 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 relative overflow-hidden">
        {/* Left / Main Map Canvas */}
        <div className="flex-1 relative min-h-[320px]">
          <MapContainer
            center={activeNotebook.defaultCenter}
            zoom={activeNotebook.defaultZoom}
            minZoom={2}
            maxZoom={20}
            zoomControl={true}
            className="w-full h-full bg-slate-900"
          >
            <MapFlyController target={flyTarget} />
            <MapInteractionController
              activeTool={activeTool}
              roadSnapSubMode={roadSnapSubMode}
              onZoomChange={setMapZoom}
              onMapSingleClick={handleMapSingleClick}
              onMapDoubleClick={() => createSnappedRoadStretch(draftPoints)}
              onFinishDragStroke={handleFinishDragStroke}
              onUpdateLiveDrag={setLiveDragPoints}
            />

            {/* Base Map Layer */}
            {baseLayer === 'roadmap' && (
              <TileLayer
                key="google-roadmap"
                url={GOOGLE_ROADMAP_TILES}
                maxZoom={20}
                attribution="&copy; Google Maps"
              />
            )}
            {baseLayer === 'hybrid' && (
              <TileLayer
                key="google-hybrid"
                url={GOOGLE_HYBRID_TILES}
                maxZoom={20}
                attribution="&copy; Google Maps"
              />
            )}
            {baseLayer === 'osm' && (
              <TileLayer
                key="osm-standard"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
                attribution="&copy; OpenStreetMap"
              />
            )}

            {/* Official Google Street View Coverage Layer */}
            {showOfficialCoverage && (
              <TileLayer
                key="official-sv-coverage"
                className="sv-coverage-custom-tiles"
                url={GOOGLE_OFFICIAL_SV_COVERAGE_TILES}
                opacity={coverageOpacity}
                maxZoom={20}
                zIndex={250}
              />
            )}

            {/* Native Leaflet Vector Layers (Zero Zoom Stagger) */}
            {!hideAllAnnotations &&
              filteredAnnotationsWithMatchingSideSegments.map(
                ({ ann, matchingSideSegments }) => {
                  const isSelected = ann.id === selectedAnnotationId;

                  if (
                    (ann.type === 'road-stretch' || ann.type === 'freehand') &&
                    ann.points &&
                    ann.points.length >= 2
                  ) {
                    const chevrons = buildChevronPolylines(
                      ann.points,
                      ann.direction || 'none',
                      mapZoom
                    );
                    const midPt = ann.points[Math.floor(ann.points.length / 2)];

                    const sidePolylines: Array<{
                      id: string;
                      color: string;
                      points: Array<[number, number]>;
                    }> =
                      matchingSideSegments !== null
                        ? matchingSideSegments.map((s) => ({
                            id: s.attachmentId,
                            color: s.color,
                            points: s.points,
                          }))
                        : (ann.sideLines || [])
                            .map((sl, idx) => {
                              const def = sideLineTagById.get(sl.sideLineTagId);
                              const [resolvedStart, resolvedEnd] =
                                resolveSideLineFractions(sl, ann.roadPois);
                              const subPts = extractSubPolylineByFraction(
                                ann.points!,
                                resolvedStart,
                                resolvedEnd
                              );
                              if (subPts.length < 2) return null;
                              return {
                                id: sl.id,
                                color: def?.color || '#f43f5e',
                                points: offsetPolylinePerpendicular(
                                  subPts,
                                  sl.side,
                                  7 + (idx % 4) * 4.5,
                                  mapZoom
                                ),
                              };
                            })
                            .filter(
                              (
                                x
                              ): x is {
                                id: string;
                                color: string;
                                points: Array<[number, number]>;
                              } => x !== null
                            );

                    return (
                      <React.Fragment key={ann.id}>
                        {isSelected && (
                          <Polyline
                            positions={ann.points}
                            pathOptions={{
                              color: '#38bdf8',
                              weight: (ann.strokeWidth || 4) + 6,
                              opacity: 0.45,
                            }}
                          />
                        )}

                        <Polyline
                          positions={ann.points}
                          pathOptions={{
                            color: ann.color,
                            weight: ann.strokeWidth || 4,
                            opacity:
                              cardinalDirectionFilter !== 'all' ? 0.45 : 0.95,
                          }}
                          eventHandlers={{
                            click: (e) => {
                              L.DomEvent.stopPropagation(e);
                              if (activeTool === 'eraser') {
                                deleteAnnotationById(ann.id);
                              } else if (activeTool === 'road-poi') {
                                addPointOfInterestOnRoadStretch(
                                  e.latlng.lat,
                                  e.latlng.lng
                                );
                              } else {
                                setSelectedAnnotationId(ann.id);
                              }
                            },
                          }}
                        />

                        {chevrons.length > 0 && (
                          <Polyline
                            positions={chevrons}
                            pathOptions={{
                              color: ann.color,
                              weight: Math.max(
                                2.5,
                                (ann.strokeWidth || 4) * 0.85
                              ),
                              opacity:
                                cardinalDirectionFilter !== 'all' ? 0.45 : 0.95,
                            }}
                            interactive={false}
                          />
                        )}

                        {/* Attached Road Side Lines */}
                        {sidePolylines.map((sl) => (
                          <React.Fragment key={sl.id}>
                            {cardinalDirectionFilter !== 'all' && (
                              <Polyline
                                positions={sl.points}
                                pathOptions={{
                                  color: sl.color,
                                  weight: 10,
                                  opacity: 0.35,
                                }}
                                interactive={false}
                              />
                            )}
                            <Polyline
                              positions={sl.points}
                              pathOptions={{
                                color: sl.color,
                                weight:
                                  cardinalDirectionFilter !== 'all' ? 4.5 : 3,
                                opacity: 1,
                              }}
                              eventHandlers={{
                                click: (e) => {
                                  L.DomEvent.stopPropagation(e);
                                  if (activeTool === 'eraser') {
                                    const nextSideLines = (
                                      ann.sideLines || []
                                    ).filter(
                                      (item) => !sl.id.startsWith(item.id)
                                    );
                                    const nextAnns = annotations.map((a) =>
                                      a.id === ann.id
                                        ? { ...a, sideLines: nextSideLines }
                                        : a
                                    );
                                    commitAnnotations(nextAnns);
                                  } else {
                                    setSelectedAnnotationId(ann.id);
                                  }
                                },
                              }}
                            />
                          </React.Fragment>
                        ))}

                        {/* Points of Interest (POIs) along this Road Stretch */}
                        {(ann.roadPois || []).map((poi) => (
                          <React.Fragment key={poi.id}>
                            <CircleMarker
                              center={poi.position}
                              radius={6}
                              pathOptions={{
                                fillColor: poi.color || '#ffffff',
                                fillOpacity: 1,
                                color: '#0f172a',
                                weight: 2,
                              }}
                              eventHandlers={{
                                click: (e) => {
                                  L.DomEvent.stopPropagation(e);
                                  if (activeTool === 'eraser') {
                                    const nextPois = (
                                      ann.roadPois || []
                                    ).filter((p) => p.id !== poi.id);
                                    const nextAnns = annotations.map((a) =>
                                      a.id === ann.id
                                        ? { ...a, roadPois: nextPois }
                                        : a
                                    );
                                    commitAnnotations(nextAnns);
                                  } else {
                                    setSelectedAnnotationId(ann.id);
                                  }
                                },
                              }}
                            />
                            {poi.label && (
                              <Marker
                                position={poi.position}
                                icon={L.divIcon({
                                  className: 'coverage-clean-text-icon',
                                  html: `<div style="transform:translate(-50%,-135%);white-space:nowrap;font-weight:800;font-size:11px;color:#0f172a;background:rgba(255,255,255,0.88);padding:0px 4px;border-radius:3px;border:1px solid ${
                                    poi.color || '#0f172a'
                                  };">${poi.label}</div>`,
                                })}
                                interactive={false}
                              />
                            )}
                          </React.Fragment>
                        ))}

                        {ann.label && (
                          <Marker
                            position={midPt}
                            icon={L.divIcon({
                              className: 'coverage-clean-text-icon',
                              html: `<div style="transform:translate(-50%,-120%);white-space:nowrap;font-weight:800;font-size:12px;color:${ann.color};text-shadow:0 0 4px #ffffff,0 0 4px #ffffff,0 0 3px #ffffff;">${ann.label}</div>`,
                            })}
                            eventHandlers={{
                              click: (e) => {
                                L.DomEvent.stopPropagation(e);
                                if (activeTool === 'eraser') {
                                  deleteAnnotationById(ann.id);
                                } else {
                                  setSelectedAnnotationId(ann.id);
                                }
                              },
                            }}
                          />
                        )}
                      </React.Fragment>
                    );
                  }

                  if (ann.type === 'text' && ann.position) {
                    return (
                      <Marker
                        key={ann.id}
                        position={ann.position}
                        icon={L.divIcon({
                          className: 'coverage-clean-text-icon',
                          html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font-weight:800;font-size:13px;color:${
                            ann.color
                          };text-shadow:0 0 4px #ffffff,0 0 4px #ffffff,0 0 3px #ffffff;${
                            isSelected
                              ? 'outline:2px dashed #38bdf8;padding:1px 4px;border-radius:4px;'
                              : ''
                          }">${ann.label || 'Text'}</div>`,
                        })}
                        eventHandlers={{
                          click: (e) => {
                            L.DomEvent.stopPropagation(e);
                            if (activeTool === 'eraser') {
                              deleteAnnotationById(ann.id);
                            } else {
                              setSelectedAnnotationId(ann.id);
                            }
                          },
                        }}
                      />
                    );
                  }

                  if (ann.type === 'sphere' && ann.position) {
                    const heading =
                      ann.viewHeadingDeg ?? ann.carHeadingDeg ?? 0;
                    const conePolylines = buildChevronPolylines(
                      [
                        ann.position,
                        [
                          ann.position[0] +
                            0.0002 * Math.cos((heading * Math.PI) / 180),
                          ann.position[1] +
                            0.0002 * Math.sin((heading * Math.PI) / 180),
                        ],
                      ],
                      'forward',
                      mapZoom
                    );
                    return (
                      <React.Fragment key={ann.id}>
                        {conePolylines.length > 0 && (
                          <Polyline
                            positions={conePolylines}
                            pathOptions={{
                              color: ann.color || '#f59e0b',
                              weight: 3,
                              opacity: 0.9,
                            }}
                            interactive={false}
                          />
                        )}
                        <CircleMarker
                          center={ann.position}
                          radius={isSelected ? 8 : 6}
                          pathOptions={{
                            fillColor: ann.color || '#f59e0b',
                            fillOpacity: 0.95,
                            color: isSelected ? '#38bdf8' : '#ffffff',
                            weight: 2,
                          }}
                          eventHandlers={{
                            click: (e) => {
                              L.DomEvent.stopPropagation(e);
                              if (activeTool === 'eraser') {
                                deleteAnnotationById(ann.id);
                                return;
                              }
                              setSelectedAnnotationId(ann.id);
                              openStreetViewAt(
                                ann.position![0],
                                ann.position![1]
                              );
                            },
                          }}
                        />
                      </React.Fragment>
                    );
                  }

                  if (ann.type === 'pin' && ann.position) {
                    return (
                      <CircleMarker
                        key={ann.id}
                        center={ann.position}
                        radius={isSelected ? 9 : 7}
                        pathOptions={{
                          fillColor: ann.color || '#dc2626',
                          fillOpacity: 0.95,
                          color: isSelected ? '#38bdf8' : '#ffffff',
                          weight: 2,
                        }}
                        eventHandlers={{
                          click: (e) => {
                            L.DomEvent.stopPropagation(e);
                            if (activeTool === 'eraser') {
                              deleteAnnotationById(ann.id);
                            } else {
                              setSelectedAnnotationId(ann.id);
                            }
                          },
                        }}
                      />
                    );
                  }

                  return null;
                }
              )}

            {/* Point-to-point Draft Preview */}
            {draftPoints.length >= 1 && (
              <>
                {draftPoints.length >= 2 && (
                  <Polyline
                    positions={draftPoints}
                    pathOptions={{
                      color: activeColor,
                      weight: activeStrokeWidth,
                      dashArray: '6 4',
                    }}
                  />
                )}
                {draftPoints.map((pt, i) => (
                  <CircleMarker
                    key={i}
                    center={pt}
                    radius={4}
                    pathOptions={{
                      fillColor: '#ffffff',
                      fillOpacity: 1,
                      color: activeColor,
                      weight: 2,
                    }}
                  />
                ))}
              </>
            )}

            {/* Live Dragging Stroke Preview */}
            {liveDragPoints.length >= 2 && (
              <Polyline
                positions={liveDragPoints}
                pathOptions={{
                  color:
                    activeTool === 'side-line'
                      ? sideLineTagById.get(activeSideLineTagId)?.color ||
                        newSideLineTagColor
                      : activeColor,
                  weight: activeStrokeWidth,
                  dashArray:
                    activeTool === 'road-stretch' ? '6 4' : undefined,
                }}
              />
            )}

            {/* Active Coverage Sphere + Live Rotating Headlight Cone */}
            {svMeta && (
              <Marker
                position={[svMeta.lat, svMeta.lng]}
                icon={L.divIcon({
                  className: 'coverage-clean-text-icon',
                  html: `<div style="position:relative;width:64px;height:64px;transform:translate(-32px,-32px);pointer-events:none;">
                    <svg width="64" height="64" viewBox="-32 -32 64 64">
                      <g transform="rotate(${svViewHeading - 90})">
                        <polygon points="0,0 30,-14 30,14" fill="#f59e0b" fill-opacity="0.45" stroke="#f59e0b" stroke-width="1.5" />
                      </g>
                      <circle cx="0" cy="0" r="7" fill="#f59e0b" stroke="#ffffff" stroke-width="2.5" />
                    </svg>
                  </div>`,
                })}
              />
            )}
          </MapContainer>

          {/* Status Banner for Coverage Verification / Road Snapping */}
          {snapStatusMsg && (
            <div className="absolute bottom-3 left-3 z-[1000] px-3 py-1.5 rounded-lg bg-slate-900/95 border border-indigo-500/60 text-xs font-bold text-indigo-200 shadow-xl pointer-events-none">
              {snapStatusMsg}
            </div>
          )}
        </div>

        {/* Right Sidebar: Dedicated Tags & Filters Panel, Split-Screen Street View & Annotation Inspector */}
        {showRightSidebar && (
          <div className="w-full lg:w-[460px] xl:w-[520px] border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900 flex flex-col max-h-[60dvh] lg:max-h-none z-30 overflow-y-auto">
            {/* Section A: Tags & Filters Manager (when toggled open) */}
            {showTagManagerPanel && (
              <div className="p-3 border-b border-slate-800 bg-slate-900 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-indigo-400" />
                    TAGS & FILTERS
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTagManagerPanel(false)}
                    className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Hierarchical Tag Tree */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">
                      TAG TREE (Check to Filter)
                    </span>
                    {selectedFilterTagIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedFilterTagIds([])}
                        className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                      >
                        Clear Filter
                      </button>
                    )}
                  </div>

                  {tagTree.length === 0 ? (
                    <div className="text-[11px] text-slate-500 bg-slate-950 p-2 rounded border border-slate-800">
                      No tags created yet. Add root tags and subtags below.
                    </div>
                  ) : (
                    <div className="bg-slate-950 p-2 rounded border border-slate-800 max-h-44 overflow-y-auto space-y-0.5">
                      {renderTagTreeNodes(null, 0, 'filter')}
                    </div>
                  )}

                  <form onSubmit={handleAddTagNode} className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="New tag name..."
                        className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white text-[11px] outline-none"
                      />
                      <input
                        type="color"
                        value={newTagColor}
                        onChange={(e) => setNewTagColor(e.target.value)}
                        className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <select
                        value={newTagParentId}
                        onChange={(e) => setNewTagParentId(e.target.value)}
                        className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 text-[11px]"
                      >
                        <option value="">Root Tag (No Parent)</option>
                        {tagTree.map((t) => (
                          <option key={t.id} value={t.id}>
                            Subtag of: {t.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] cursor-pointer"
                      >
                        +Add Tag
                      </button>
                    </div>
                  </form>
                </div>

                {/* Side Line Tags & Cardinal Side-of-Road Filter */}
                <div className="border-t border-slate-800 pt-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">
                      SIDE LINE TAGS & CARDINAL SIDE FILTER
                    </span>
                    {(selectedFilterSideLineTagId !== 'all' ||
                      cardinalDirectionFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFilterSideLineTagId('all');
                          setCardinalDirectionFilter('all');
                        }}
                        className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] text-slate-400">
                      Filter by Side Line Tag:
                    </label>
                    <select
                      value={selectedFilterSideLineTagId}
                      onChange={(e) =>
                        setSelectedFilterSideLineTagId(e.target.value)
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white text-[11px]"
                    >
                      <option value="all">All / Any Side Line Tag</option>
                      {sideLineTags.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] text-slate-400">
                      Show where Side Line is on Cardinal Side of Road:
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          'all',
                          'N',
                          'S',
                          'E',
                          'W',
                          'NE',
                          'NW',
                          'SE',
                          'SW',
                        ] as const
                      ).map((dir) => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => setCardinalDirectionFilter(dir)}
                          className={`px-2 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                            cardinalDirectionFilter === dir
                              ? 'bg-emerald-600 border-emerald-400 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {dir === 'all' ? 'All Sides' : `${dir} of Road`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {sideLineTags.length > 0 && (
                    <div className="bg-slate-950 p-2 rounded border border-slate-800 space-y-1 max-h-32 overflow-y-auto">
                      {sideLineTags.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between text-[11px]"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-3 h-1.5 rounded"
                              style={{ backgroundColor: t.color }}
                            />
                            <span className="text-slate-200">{t.name}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteSideLineTag(t.id)}
                            className="text-slate-500 hover:text-rose-400 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <form
                    onSubmit={handleAddSideLineTag}
                    className="flex items-center gap-1 pt-1"
                  >
                    <input
                      type="text"
                      value={newSideLineTagName}
                      onChange={(e) => setNewSideLineTagName(e.target.value)}
                      placeholder="New side line tag..."
                      className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white text-[11px] outline-none"
                    />
                    <input
                      type="color"
                      value={newSideLineTagColor}
                      onChange={(e) => setNewSideLineTagColor(e.target.value)}
                      className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] cursor-pointer"
                    >
                      +Add
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* Section B: Official Street View Panorama Panel */}
            {showStreetViewPanel && (
              <div className="flex-1 flex flex-col min-h-[260px] border-b border-slate-800">
                <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                    <div className="truncate">
                      <div className="text-xs font-bold text-white truncate">
                        {svMeta
                          ? svMeta.description ||
                            `${svMeta.lat.toFixed(5)}, ${svMeta.lng.toFixed(5)}`
                          : 'Official Street View'}
                      </div>
                      {svMeta && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-2">
                          {svMeta.captureDate && (
                            <span className="text-emerald-400 font-bold">
                              Date: {svMeta.captureDate}
                            </span>
                          )}
                          <span className="text-sky-300 font-bold">
                            Car Dir: {formatCompassDirection(svMeta.carHeadingDeg)}
                          </span>
                          <span className="text-amber-300 font-bold">
                            View: {formatCompassDirection(svViewHeading)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {svMeta && (
                      <>
                        <button
                          type="button"
                          onClick={handleMarkOrUnmarkActiveSphere}
                          title={
                            markedSphereForActivePano
                              ? 'Delete Marked Coverage Sphere from Map'
                              : 'Mark (Keep) this Coverage Sphere on the Map'
                          }
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                            markedSphereForActivePano
                              ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                              : 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                          }`}
                        >
                          {markedSphereForActivePano ? (
                            <>
                              <Trash2 className="w-3 h-3" />
                              <span>Delete Sphere</span>
                            </>
                          ) : (
                            <>
                              <Bookmark className="w-3 h-3" />
                              <span>Mark Sphere</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setUseIframeFallback((v) => !v)}
                          title="Switch between Live-Headlight 360° Viewer and Google Embed"
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold cursor-pointer"
                        >
                          {useIframeFallback ? 'Live 360°' : 'Embed'}
                        </button>

                        <a
                          href={`https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(
                            svMeta.panoId
                          )}&viewpoint=${svMeta.lat},${
                            svMeta.lng
                          }&heading=${Math.round(svViewHeading)}&pitch=${Math.round(
                            svViewPitch
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold"
                        >
                          <span>Maps</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={closeTemporaryStreetView}
                      title="Close Street View (unmarked sphere will disappear)"
                      className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 relative bg-slate-950 min-h-[220px]">
                  {svLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-10 text-xs text-slate-300">
                      Loading official Google Street View panorama...
                    </div>
                  )}
                  {!svLoading && svStatusMessage && (
                    <div className="p-4 text-xs text-amber-300">
                      {svStatusMessage}
                    </div>
                  )}
                  {svMeta && !useIframeFallback && (
                    <StreetViewSphericalViewer
                      panoId={svMeta.panoId}
                      carHeadingDeg={svMeta.carHeadingDeg}
                      panoNorthDeg={svMeta.panoNorthDeg}
                      viewHeadingDeg={svViewHeading}
                      viewPitchDeg={svViewPitch}
                      neighborLinks={svMeta.neighborLinks}
                      onChangeViewAngle={(h, p) => {
                        setSvViewHeading(h);
                        setSvViewPitch(p);
                        if (markedSphereForActivePano) {
                          const next = annotations.map((a) =>
                            a.id === markedSphereForActivePano.id
                              ? { ...a, viewHeadingDeg: h, viewPitchDeg: p }
                              : a
                          );
                          setAnnotations(next);
                          saveNotebookAnnotations(activeNotebookId, next);
                        }
                      }}
                      onNavigateNeighbor={async (n) => {
                        if (n.lat !== undefined && n.lng !== undefined) {
                          await openStreetViewAt(n.lat, n.lng);
                        }
                      }}
                    />
                  )}
                  {svMeta && useIframeFallback && (
                    <iframe
                      key={`${svMeta.panoId}-${Math.round(svViewHeading)}`}
                      title="Google Street View Panorama"
                      src={`https://www.google.com/maps/embed?pb=!4v1700000000000!6m8!1m7!1s${encodeURIComponent(
                        svMeta.panoId
                      )}!2m2!1d${svMeta.lat}!2d${svMeta.lng}!3f${Math.round(
                        svViewHeading
                      )}!4f0!5f0.7820865974627469`}
                      className="w-full h-full border-0"
                      allowFullScreen
                    />
                  )}
                </div>
              </div>
            )}

            {/* Section C: Selected Annotation Inspector */}
            {selectedAnnotation && (
              <div className="p-3 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="font-bold text-white uppercase">
                    {selectedAnnotation.type.replace('-', ' ')} INSPECTOR
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => deleteAnnotationById(selectedAnnotation.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedAnnotationId(null)}
                      className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Label Input */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-300">
                    Label
                  </label>
                  <input
                    type="text"
                    value={selectedAnnotation.label || ''}
                    onChange={(e) =>
                      updateSelectedAnnotation({ label: e.target.value })
                    }
                    placeholder="Label..."
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Driving Direction Arrows */}
                {(selectedAnnotation.type === 'road-stretch' ||
                  selectedAnnotation.type === 'freehand') && (
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-300">
                      Driving Direction Arrows
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      {(
                        [
                          { id: 'forward', label: 'A → B' },
                          { id: 'reverse', label: 'B ← A' },
                          { id: 'both', label: 'A ↔ B' },
                          { id: 'none', label: 'None' },
                        ] as const
                      ).map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() =>
                            updateSelectedAnnotation({ direction: d.id })
                          }
                          className={`py-1 rounded font-bold text-[11px] border cursor-pointer ${
                            (selectedAnnotation.direction || 'none') === d.id
                              ? 'bg-indigo-600 border-indigo-400 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Points of Interest (POIs) Manager on Road Stretch */}
                {selectedAnnotation.type === 'road-stretch' &&
                  selectedAnnotation.points && (
                    <div className="space-y-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-300">
                          POINTS OF INTEREST ({(selectedAnnotation.roadPois || []).length})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const existing = selectedAnnotation.roadPois || [];
                            const frac = 0.5;
                            const pos = interpolatePointOnPolylineByFraction(
                              selectedAnnotation.points!,
                              frac
                            );
                            const nextPoi: RoadPointOfInterest = {
                              id: `poi-${Date.now()}`,
                              label: `P${existing.length + 1}`,
                              frac,
                              position: pos,
                              color: activeColor,
                            };
                            updateSelectedAnnotation({
                              roadPois: [...existing, nextPoi].sort(
                                (a, b) => a.frac - b.frac
                              ),
                            });
                          }}
                          className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer"
                        >
                          +Add POI
                        </button>
                      </div>

                      {(selectedAnnotation.roadPois || []).length === 0 ? (
                        <div className="text-[10px] text-slate-500">
                          Use the "Road POI" tool to click on this road stretch, or click "+Add POI" above.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {(selectedAnnotation.roadPois || []).map((poi) => (
                            <div
                              key={poi.id}
                              className="p-1.5 rounded bg-slate-900 border border-slate-800 space-y-1 text-[11px]"
                            >
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  value={poi.color || '#ffffff'}
                                  onChange={(e) => {
                                    const next = (
                                      selectedAnnotation.roadPois || []
                                    ).map((p) =>
                                      p.id === poi.id
                                        ? { ...p, color: e.target.value }
                                        : p
                                    );
                                    updateSelectedAnnotation({ roadPois: next });
                                  }}
                                  className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer"
                                />
                                <input
                                  type="text"
                                  value={poi.label}
                                  onChange={(e) => {
                                    const next = (
                                      selectedAnnotation.roadPois || []
                                    ).map((p) =>
                                      p.id === poi.id
                                        ? { ...p, label: e.target.value }
                                        : p
                                    );
                                    updateSelectedAnnotation({ roadPois: next });
                                  }}
                                  placeholder="POI label..."
                                  className="flex-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-white text-[11px] outline-none"
                                />
                                <span className="text-[10px] text-slate-400">
                                  {Math.round(poi.frac * 100)}%
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = (
                                      selectedAnnotation.roadPois || []
                                    ).filter((p) => p.id !== poi.id);
                                    updateSelectedAnnotation({ roadPois: next });
                                  }}
                                  className="text-slate-500 hover:text-rose-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={poi.frac}
                                onChange={(e) => {
                                  const f = Number(e.target.value);
                                  const pos = interpolatePointOnPolylineByFraction(
                                    selectedAnnotation.points!,
                                    f
                                  );
                                  const next = (
                                    selectedAnnotation.roadPois || []
                                  )
                                    .map((p) =>
                                      p.id === poi.id
                                        ? { ...p, frac: f, position: pos }
                                        : p
                                    )
                                    .sort((a, b) => a.frac - b.frac);
                                  updateSelectedAnnotation({ roadPois: next });
                                }}
                                className="w-full accent-indigo-500"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                {/* Road Stretch Side Lines Manager (Supports Both POI Boundaries and % Sliders) */}
                {selectedAnnotation.type === 'road-stretch' && (
                  <div className="space-y-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-300">
                        SIDE LINES ({(selectedAnnotation.sideLines || []).length})
                      </span>
                      {sideLineTags.length > 0 && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const tagId =
                                activeSideLineTagId || sideLineTags[0].id;
                              const nextSl: RoadSideLineAttachment = {
                                id: `sl-${Date.now()}`,
                                sideLineTagId: tagId,
                                side: 'left',
                                startFrac: 0,
                                endFrac: 1,
                              };
                              updateSelectedAnnotation({
                                sideLines: [
                                  ...(selectedAnnotation.sideLines || []),
                                  nextSl,
                                ],
                              });
                            }}
                            className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer"
                          >
                            +Left Side
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const tagId =
                                activeSideLineTagId || sideLineTags[0].id;
                              const nextSl: RoadSideLineAttachment = {
                                id: `sl-${Date.now()}`,
                                sideLineTagId: tagId,
                                side: 'right',
                                startFrac: 0,
                                endFrac: 1,
                              };
                              updateSelectedAnnotation({
                                sideLines: [
                                  ...(selectedAnnotation.sideLines || []),
                                  nextSl,
                                ],
                              });
                            }}
                            className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer"
                          >
                            +Right Side
                          </button>
                        </div>
                      )}
                    </div>

                    {(selectedAnnotation.sideLines || []).map((sl) => {
                      const def = sideLineTagById.get(sl.sideLineTagId);
                      const pois = selectedAnnotation.roadPois || [];
                      const [effStart, effEnd] = resolveSideLineFractions(
                        sl,
                        pois
                      );

                      return (
                        <div
                          key={sl.id}
                          className="p-2 rounded bg-slate-900 border border-slate-800 space-y-2 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <select
                              value={sl.sideLineTagId}
                              onChange={(e) => {
                                const next = (
                                  selectedAnnotation.sideLines || []
                                ).map((item) =>
                                  item.id === sl.id
                                    ? { ...item, sideLineTagId: e.target.value }
                                    : item
                                );
                                updateSelectedAnnotation({ sideLines: next });
                              }}
                              className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-white font-bold"
                              style={{
                                borderLeft: `4px solid ${def?.color || '#fff'}`,
                              }}
                            >
                              {sideLineTags.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (
                                    selectedAnnotation.sideLines || []
                                  ).map((item) =>
                                    item.id === sl.id
                                      ? {
                                          ...item,
                                          side:
                                            item.side === 'left'
                                              ? ('right' as const)
                                              : ('left' as const),
                                        }
                                      : item
                                  );
                                  updateSelectedAnnotation({ sideLines: next });
                                }}
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[10px] cursor-pointer"
                              >
                                Side: {sl.side.toUpperCase()}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (
                                    selectedAnnotation.sideLines || []
                                  ).filter((item) => item.id !== sl.id);
                                  updateSelectedAnnotation({ sideLines: next });
                                }}
                                className="text-slate-500 hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Start Boundary & End Boundary Selectors (POI or Custom %) */}
                          {pois.length > 0 && (
                            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                              <div>
                                <span className="text-slate-400 block mb-0.5">
                                  From Boundary:
                                </span>
                                <select
                                  value={
                                    sl.startPoiId
                                      ? `poi:${sl.startPoiId}`
                                      : sl.startFrac === 0
                                      ? 'start'
                                      : 'custom'
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const next = (
                                      selectedAnnotation.sideLines || []
                                    ).map((item) => {
                                      if (item.id !== sl.id) return item;
                                      if (val === 'start') {
                                        return {
                                          ...item,
                                          startPoiId: undefined,
                                          startFrac: 0,
                                        };
                                      }
                                      if (val.startsWith('poi:')) {
                                        const pid = val.slice(4);
                                        const found = pois.find(
                                          (p) => p.id === pid
                                        );
                                        return {
                                          ...item,
                                          startPoiId: pid,
                                          startFrac: found
                                            ? found.frac
                                            : item.startFrac,
                                        };
                                      }
                                      return { ...item, startPoiId: undefined };
                                    });
                                    updateSelectedAnnotation({ sideLines: next });
                                  }}
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-white"
                                >
                                  <option value="start">Road Start (0%)</option>
                                  {pois.map((p) => (
                                    <option key={p.id} value={`poi:${p.id}`}>
                                      POI: {p.label} ({Math.round(p.frac * 100)}%)
                                    </option>
                                  ))}
                                  <option value="custom">
                                    Custom % ({Math.round(effStart * 100)}%)
                                  </option>
                                </select>
                              </div>

                              <div>
                                <span className="text-slate-400 block mb-0.5">
                                  To Boundary:
                                </span>
                                <select
                                  value={
                                    sl.endPoiId
                                      ? `poi:${sl.endPoiId}`
                                      : sl.endFrac === 1
                                      ? 'end'
                                      : 'custom'
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const next = (
                                      selectedAnnotation.sideLines || []
                                    ).map((item) => {
                                      if (item.id !== sl.id) return item;
                                      if (val === 'end') {
                                        return {
                                          ...item,
                                          endPoiId: undefined,
                                          endFrac: 1,
                                        };
                                      }
                                      if (val.startsWith('poi:')) {
                                        const pid = val.slice(4);
                                        const found = pois.find(
                                          (p) => p.id === pid
                                        );
                                        return {
                                          ...item,
                                          endPoiId: pid,
                                          endFrac: found
                                            ? found.frac
                                            : item.endFrac,
                                        };
                                      }
                                      return { ...item, endPoiId: undefined };
                                    });
                                    updateSelectedAnnotation({ sideLines: next });
                                  }}
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-white"
                                >
                                  <option value="end">Road End (100%)</option>
                                  {pois.map((p) => (
                                    <option key={p.id} value={`poi:${p.id}`}>
                                      POI: {p.label} ({Math.round(p.frac * 100)}%)
                                    </option>
                                  ))}
                                  <option value="custom">
                                    Custom % ({Math.round(effEnd * 100)}%)
                                  </option>
                                </select>
                              </div>
                            </div>
                          )}

                          {/* Percentage Sliders along the Road */}
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <span>Start {Math.round(effStart * 100)}%</span>
                            <input
                              type="range"
                              min={0}
                              max={0.98}
                              step={0.01}
                              value={effStart}
                              onChange={(e) => {
                                const v = Math.min(
                                  Number(e.target.value),
                                  effEnd - 0.01
                                );
                                const next = (
                                  selectedAnnotation.sideLines || []
                                ).map((item) =>
                                  item.id === sl.id
                                    ? {
                                        ...item,
                                        startPoiId: undefined,
                                        startFrac: v,
                                      }
                                    : item
                                );
                                updateSelectedAnnotation({ sideLines: next });
                              }}
                              className="flex-1 accent-indigo-500"
                            />
                            <span>End {Math.round(effEnd * 100)}%</span>
                            <input
                              type="range"
                              min={0.02}
                              max={1}
                              step={0.01}
                              value={effEnd}
                              onChange={(e) => {
                                const v = Math.max(
                                  Number(e.target.value),
                                  effStart + 0.01
                                );
                                const next = (
                                  selectedAnnotation.sideLines || []
                                ).map((item) =>
                                  item.id === sl.id
                                    ? {
                                        ...item,
                                        endPoiId: undefined,
                                        endFrac: v,
                                      }
                                    : item
                                );
                                updateSelectedAnnotation({ sideLines: next });
                              }}
                              className="flex-1 accent-indigo-500"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Sketch Canvas for Pins */}
                {selectedAnnotation.type === 'pin' && (
                  <PinSketchCanvas
                    value={selectedAnnotation.sketchDataUrl}
                    onChange={(dataUrl) =>
                      updateSelectedAnnotation({ sketchDataUrl: dataUrl })
                    }
                  />
                )}

                {/* Assign Tags from Tag Tree */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-300">
                      Assigned Tags
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowTagManagerPanel(true)}
                      className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                    >
                      Open Tags & Filters
                    </button>
                  </div>
                  {tagTree.length === 0 ? (
                    <div className="text-[11px] text-slate-500">
                      Open "Tags & Filters" to create your Tag Tree.
                    </div>
                  ) : (
                    <div className="bg-slate-950 p-2 rounded border border-slate-800 max-h-36 overflow-y-auto">
                      {renderTagTreeNodes(null, 0, 'assign')}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-300">
                    Notes
                  </label>
                  <textarea
                    rows={3}
                    value={selectedAnnotation.notes || ''}
                    onChange={(e) =>
                      updateSelectedAnnotation({ notes: e.target.value })
                    }
                    placeholder="Notes..."
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500 resize-y"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

import type {
  CoverageAnnotation,
  CoverageNotebook,
  CoverageTagNode,
  OfficialStreetViewMetadata,
  SideLineTagDefinition,
} from '../types/coverageNotes';

const NOTEBOOKS_KEY = 'geo_coverage_notebooks_v2';
const ANNOTATIONS_PREFIX = 'geo_coverage_annotations_v2_';
const TAG_TREE_KEY = 'geo_coverage_tag_tree_v1';
const SIDE_LINE_TAGS_KEY = 'geo_coverage_side_line_tags_v1';
const SV_STYLE_KEY = 'geo_coverage_sv_style_v1';

const DEFAULT_NOTEBOOKS: CoverageNotebook[] = [
  {
    id: 'nb-default',
    name: 'Main Coverage Notebook',
    countryOrRegion: 'World',
    defaultCenter: [-22.15, 28.15],
    defaultZoom: 9,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export interface SvCoverageStylePrefs {
  color: string;
  opacity: number;
  visible: boolean;
}

export function loadSvCoverageStylePrefs(): SvCoverageStylePrefs {
  try {
    const raw = localStorage.getItem(SV_STYLE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        color: typeof parsed.color === 'string' ? parsed.color : '#38bdf8',
        opacity: typeof parsed.opacity === 'number' ? parsed.opacity : 0.3,
        visible: typeof parsed.visible === 'boolean' ? parsed.visible : true,
      };
    }
  } catch {
    // ignore
  }
  return { color: '#38bdf8', opacity: 0.3, visible: true };
}

export function saveSvCoverageStylePrefs(prefs: SvCoverageStylePrefs): void {
  try {
    localStorage.setItem(SV_STYLE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function loadCoverageTagTree(): CoverageTagNode[] {
  try {
    const raw = localStorage.getItem(TAG_TREE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CoverageTagNode[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCoverageTagTree(nodes: CoverageTagNode[]): void {
  try {
    localStorage.setItem(TAG_TREE_KEY, JSON.stringify(nodes));
  } catch {
    // ignore
  }
}

export function loadSideLineTags(): SideLineTagDefinition[] {
  try {
    const raw = localStorage.getItem(SIDE_LINE_TAGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SideLineTagDefinition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSideLineTags(tags: SideLineTagDefinition[]): void {
  try {
    localStorage.setItem(SIDE_LINE_TAGS_KEY, JSON.stringify(tags));
  } catch {
    // ignore
  }
}

export function loadCoverageNotebooks(): CoverageNotebook[] {
  try {
    const raw = localStorage.getItem(NOTEBOOKS_KEY);
    if (!raw) {
      localStorage.setItem(NOTEBOOKS_KEY, JSON.stringify(DEFAULT_NOTEBOOKS));
      return DEFAULT_NOTEBOOKS;
    }
    const parsed = JSON.parse(raw) as CoverageNotebook[];
    return parsed.length > 0 ? parsed : DEFAULT_NOTEBOOKS;
  } catch {
    return DEFAULT_NOTEBOOKS;
  }
}

export function saveCoverageNotebooks(notebooks: CoverageNotebook[]): void {
  try {
    localStorage.setItem(NOTEBOOKS_KEY, JSON.stringify(notebooks));
  } catch (err) {
    console.error('Failed to save coverage notebooks:', err);
  }
}

export function loadNotebookAnnotations(notebookId: string): CoverageAnnotation[] {
  try {
    const key = `${ANNOTATIONS_PREFIX}${notebookId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CoverageAnnotation[];
    // Filter out any legacy demo-* items if present
    return Array.isArray(parsed)
      ? parsed.filter((a) => !a.id.startsWith('demo-'))
      : [];
  } catch {
    return [];
  }
}

export function saveNotebookAnnotations(
  notebookId: string,
  annotations: CoverageAnnotation[]
): void {
  try {
    const key = `${ANNOTATIONS_PREFIX}${notebookId}`;
    localStorage.setItem(key, JSON.stringify(annotations));
  } catch (err) {
    console.error('Failed to save notebook annotations:', err);
  }
}

export interface CoverageExportBundle {
  version: 2;
  exportedAt: string;
  notebook: CoverageNotebook;
  annotations: CoverageAnnotation[];
  tagTree?: CoverageTagNode[];
  sideLineTags?: SideLineTagDefinition[];
}

export function exportNotebookJson(
  notebook: CoverageNotebook,
  annotations: CoverageAnnotation[],
  tagTree: CoverageTagNode[],
  sideLineTags: SideLineTagDefinition[]
): string {
  const bundle: CoverageExportBundle = {
    version: 2,
    exportedAt: new Date().toISOString(),
    notebook,
    annotations,
    tagTree,
    sideLineTags,
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Queries Google's internal Street View SingleImageSearch RPC endpoint
 * to find the nearest official Google Street View panorama (source filter: official only)
 * and extracts its panorama ID, coordinates, official Google car driving heading,
 * capture date, and connected road sequence.
 */
export async function fetchOfficialStreetViewAtLatLng(
  lat: number,
  lng: number,
  radiusMeters: number = 250
): Promise<OfficialStreetViewMetadata | null> {
  const url =
    'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch';
  const body = JSON.stringify([
    ['apiv3'],
    [[null, null, lat, lng], radiusMeters],
    [null, ['en', 'US'], [[[[2, true, 2]]]]],
    [[1, 2, 3, 4, 8, 6]],
  ]);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
      },
      body,
    });
    if (!res.ok) return null;
    const data = await res.json();

    if (!Array.isArray(data) || data[0]?.[0] !== 0 || !data[1]) {
      return null;
    }

    const meta = data[1];
    const panoId: string | undefined = meta?.[1]?.[1];
    if (!panoId) return null;

    const locationBlock = meta?.[5]?.[0]?.[1];
    const foundLat: number = locationBlock?.[0]?.[2] ?? lat;
    const foundLng: number = locationBlock?.[0]?.[3] ?? lng;
    const elevationMeters: number | undefined = locationBlock?.[1]?.[0];
    const carHeadingDeg: number = locationBlock?.[2]?.[0] ?? 0;
    const panoNorthDeg: number = data?.[2]?.[0] ?? carHeadingDeg;
    const countryCode: string | undefined = locationBlock?.[4];

    const descBlock = meta?.[3]?.[2]?.[0]?.[0];
    const description: string | undefined =
      typeof descBlock === 'string' ? descBlock : undefined;

    const dateArr = meta?.[6]?.[7];
    let captureDate: string | undefined;
    if (Array.isArray(dateArr) && dateArr.length >= 2) {
      const y = dateArr[0];
      const m = String(dateArr[1]).padStart(2, '0');
      captureDate = `${y}-${m}`;
    }

    // Extract nearby panoramas along the road
    const rawTargets = meta?.[5]?.[0]?.[3]?.[0];
    const roadSequence: Array<{
      panoId: string;
      lat: number;
      lng: number;
      carHeadingDeg: number;
    }> = [];
    const coordByPanoId = new Map<string, { lat: number; lng: number }>();

    if (Array.isArray(rawTargets)) {
      for (const item of rawTargets) {
        const pid = item?.[0]?.[1];
        const pLat = item?.[2]?.[0]?.[2];
        const pLng = item?.[2]?.[0]?.[3];
        const pHead = item?.[2]?.[2]?.[0] ?? carHeadingDeg;
        if (
          typeof pid === 'string' &&
          typeof pLat === 'number' &&
          typeof pLng === 'number'
        ) {
          coordByPanoId.set(pid, { lat: pLat, lng: pLng });
          roadSequence.push({
            panoId: pid,
            lat: pLat,
            lng: pLng,
            carHeadingDeg: pHead,
          });
        }
      }
    }

    const rawNeighbors = meta?.[5]?.[0]?.[6];
    const neighborLinks: Array<{
      panoId: string;
      headingDeg: number;
      lat?: number;
      lng?: number;
    }> = [];

    if (Array.isArray(rawNeighbors)) {
      for (const n of rawNeighbors) {
        const targetIndex = n?.[0];
        const headingDeg = n?.[1]?.[3];
        const targetPanoId =
          typeof targetIndex === 'number'
            ? rawTargets?.[targetIndex]?.[0]?.[1]
            : undefined;
        if (typeof targetPanoId === 'string' && typeof headingDeg === 'number') {
          const coords = coordByPanoId.get(targetPanoId);
          neighborLinks.push({
            panoId: targetPanoId,
            headingDeg,
            lat: coords?.lat,
            lng: coords?.lng,
          });
        }
      }
    }

    return {
      panoId,
      lat: foundLat,
      lng: foundLng,
      carHeadingDeg: Math.round(carHeadingDeg * 10) / 10,
      panoNorthDeg,
      elevationMeters:
        typeof elevationMeters === 'number'
          ? Math.round(elevationMeters)
          : undefined,
      captureDate,
      description,
      countryCode,
      neighborLinks,
      roadSequence,
    };
  } catch (err) {
    console.warn('Street View SingleImageSearch failed:', err);
    return null;
  }
}

/**
 * Snaps a sequence of drawn or clicked [lat, lng] points to the exact road geometry
 * using OSRM's driving route geometry endpoint.
 */
export async function snapPathToExactRoadGeometry(
  rawPoints: Array<[number, number]>
): Promise<Array<[number, number]>> {
  if (rawPoints.length < 2) return rawPoints;

  // Sample up to 12 waypoints evenly along the stroke so OSRM follows the exact drawn path
  const maxWaypoints = 12;
  const sampled: Array<[number, number]> = [];
  if (rawPoints.length <= maxWaypoints) {
    sampled.push(...rawPoints);
  } else {
    sampled.push(rawPoints[0]);
    for (let i = 1; i < maxWaypoints - 1; i++) {
      const idx = Math.floor((i / (maxWaypoints - 1)) * (rawPoints.length - 1));
      const pt = rawPoints[idx];
      const prev = sampled[sampled.length - 1];
      if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 0.00015) {
        sampled.push(pt);
      }
    }
    sampled.push(rawPoints[rawPoints.length - 1]);
  }

  const coordStr = sampled
    .map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(';');

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return rawPoints;
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      return coords.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
    }
  } catch (err) {
    console.warn('OSRM road snap fallback to raw points:', err);
  }

  return rawPoints;
}

/**
 * Given a single click on a road, finds the local road section around that click
 * using official Street View road sequence or OSRM local road segment.
 */
export async function fetchSingleClickRoadSection(
  lat: number,
  lng: number,
  zoom: number
): Promise<{
  points: Array<[number, number]>;
  carHeadingDeg?: number;
  captureDate?: string;
  panoId?: string;
} | null> {
  const sv = await fetchOfficialStreetViewAtLatLng(lat, lng, 500);
  // Span length scales inversely with zoom level so zoomed-out clicks select a longer road section
  const halfSpanMeters = Math.max(
    250,
    Math.min(18000, 400 * Math.pow(1.75, Math.max(0, 14 - zoom)))
  );

  const heading = sv?.carHeadingDeg ?? 90;
  const rad = (heading * Math.PI) / 180;
  const dLat = (halfSpanMeters / 111320) * Math.cos(rad);
  const dLng =
    (halfSpanMeters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))) *
    Math.sin(rad);

  const startPt: [number, number] = [
    (sv?.lat ?? lat) - dLat,
    (sv?.lng ?? lng) - dLng,
  ];
  const midPt: [number, number] = [sv?.lat ?? lat, sv?.lng ?? lng];
  const endPt: [number, number] = [
    (sv?.lat ?? lat) + dLat,
    (sv?.lng ?? lng) + dLng,
  ];

  const snapped = await snapPathToExactRoadGeometry([startPt, midPt, endPt]);
  if (snapped.length >= 2) {
    return {
      points: snapped,
      carHeadingDeg: sv?.carHeadingDeg,
      captureDate: sv?.captureDate,
      panoId: sv?.panoId,
    };
  }
  return null;
}

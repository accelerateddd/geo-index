import type {
  CameraGeneration,
  CoverageAnnotation,
  CoverageNotebook,
  CoverageSeason,
  CoverageTagNode,
  OfficialStreetViewMetadata,
  PoiTagDefinition,
  RoadAutoMetaSpan,
  SideLineTagDefinition,
} from '../types/coverageNotes';

const NOTEBOOKS_KEY = 'geo_coverage_notebooks_v2';
const ANNOTATIONS_PREFIX = 'geo_coverage_annotations_v2_';
const TAG_TREE_KEY = 'geo_coverage_tag_tree_v1';
const SIDE_LINE_TAGS_KEY = 'geo_coverage_side_line_tags_v1';
const POI_TAGS_KEY = 'geo_coverage_poi_tags_v1';
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
  sideLineMinZoom: number;
  poiMinZoom: number;
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
        sideLineMinZoom:
          typeof parsed.sideLineMinZoom === 'number' ? parsed.sideLineMinZoom : 9,
        poiMinZoom:
          typeof parsed.poiMinZoom === 'number' ? parsed.poiMinZoom : 9,
      };
    }
  } catch {
    // ignore
  }
  return {
    color: '#38bdf8',
    opacity: 0.3,
    visible: true,
    sideLineMinZoom: 9,
    poiMinZoom: 9,
  };
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
    return Array.isArray(parsed)
      ? parsed.map((t) => ({ ...t, parentId: t.parentId ?? null }))
      : [];
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

export function loadPoiTags(): PoiTagDefinition[] {
  try {
    const raw = localStorage.getItem(POI_TAGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PoiTagDefinition[];
    return Array.isArray(parsed)
      ? parsed.map((t) => ({ ...t, parentId: t.parentId ?? null }))
      : [];
  } catch {
    return [];
  }
}

export function savePoiTags(tags: PoiTagDefinition[]): void {
  try {
    localStorage.setItem(POI_TAGS_KEY, JSON.stringify(tags));
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
  poiTags?: PoiTagDefinition[];
}

export function exportNotebookJson(
  notebook: CoverageNotebook,
  annotations: CoverageAnnotation[],
  tagTree: CoverageTagNode[],
  sideLineTags: SideLineTagDefinition[],
  poiTags: PoiTagDefinition[]
): string {
  const bundle: CoverageExportBundle = {
    version: 2,
    exportedAt: new Date().toISOString(),
    notebook,
    annotations,
    tagTree,
    sideLineTags,
    poiTags,
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Computes meteorological season from month (1..12) and latitude (Southern vs Northern Hemisphere).
 */
export function computeHemisphereSeason(
  month: number,
  lat: number
): CoverageSeason {
  const isSouthern = lat < 0;
  if (month === 12 || month === 1 || month === 2) {
    return isSouthern ? 'Summer' : 'Winter';
  }
  if (month >= 3 && month <= 5) {
    return isSouthern ? 'Autumn' : 'Spring';
  }
  if (month >= 6 && month <= 8) {
    return isSouthern ? 'Winter' : 'Summer';
  }
  return isSouthern ? 'Spring' : 'Autumn';
}

/**
 * Infers Google Street View camera generation from full equirectangular dimensions [height, width] and capture year.
 */
export function inferCameraGeneration(
  worldSize: [number, number] | undefined,
  year: number | undefined
): CameraGeneration {
  if (!worldSize) return 'Unknown';
  const [h, w] = worldSize;
  if (w <= 3584 || h <= 1792) return 'Gen 1';
  if (w >= 15000 || h >= 7500) return 'Gen 4';
  if (w === 13312 || h === 6656) {
    if (year !== undefined && year <= 2010) return 'Gen 2';
    return 'Gen 3';
  }
  return 'Unknown';
}

/**
 * Updates a hierarchical tag selection when toggling `toggledId`:
 * - Checking a lower-level tag automatically selects all its higher-up ancestor tags
 *   (marking those ancestors in `autoSelectedIds` if they weren't already explicitly selected).
 * - Unchecking a lower-level tag automatically unselects higher-up ancestor tags
 *   ONLY if those higher-up tags were in `autoSelectedIds` and no other selected descendant still needs them.
 */
export function toggleTagWithAutoAncestors(
  toggledId: string,
  currentSelectedIds: string[],
  currentAutoSelectedIds: string[],
  tree: Array<{ id: string; parentId: string | null }>
): { selectedIds: string[]; autoSelectedIds: string[] } {
  const nodeById = new Map<string, { id: string; parentId: string | null }>();
  for (const n of tree) nodeById.set(n.id, n);

  const getAncestors = (id: string): string[] => {
    const ancestors: string[] = [];
    let curr = nodeById.get(id);
    const visited = new Set<string>();
    while (curr && curr.parentId && !visited.has(curr.parentId)) {
      visited.add(curr.parentId);
      ancestors.push(curr.parentId);
      curr = nodeById.get(curr.parentId);
    }
    return ancestors;
  };

  const getProperDescendants = (id: string): string[] => {
    const desc: string[] = [];
    const queue = [id];
    const visited = new Set<string>([id]);
    while (queue.length > 0) {
      const parent = queue.shift()!;
      for (const n of tree) {
        if (n.parentId === parent && !visited.has(n.id)) {
          visited.add(n.id);
          desc.push(n.id);
          queue.push(n.id);
        }
      }
    }
    return desc;
  };

  const selectedSet = new Set(currentSelectedIds);
  const autoSet = new Set(currentAutoSelectedIds);
  // Explicit selections are those in selectedSet that are NOT purely auto-selected
  const explicitSet = new Set(
    currentSelectedIds.filter((id) => !autoSet.has(id))
  );

  if (!selectedSet.has(toggledId)) {
    // Selecting `toggledId` explicitly
    explicitSet.add(toggledId);
    autoSet.delete(toggledId);

    for (const ancId of getAncestors(toggledId)) {
      if (!explicitSet.has(ancId)) {
        autoSet.add(ancId);
      }
    }
  } else {
    // Unselecting `toggledId`
    explicitSet.delete(toggledId);
    autoSet.delete(toggledId);

    // If user explicitly unchecks a parent category, also uncheck any descendants that were keeping it alive
    for (const descId of getProperDescendants(toggledId)) {
      explicitSet.delete(descId);
      autoSet.delete(descId);
    }

    // Recompute which auto-selected ancestors are still needed by remaining explicit selections
    const neededAutoAncestors = new Set<string>();
    for (const expId of explicitSet) {
      for (const ancId of getAncestors(expId)) {
        if (!explicitSet.has(ancId) && autoSet.has(ancId)) {
          neededAutoAncestors.add(ancId);
        }
      }
    }
    autoSet.clear();
    for (const id of neededAutoAncestors) autoSet.add(id);
  }

  const finalSelected = Array.from(new Set([...explicitSet, ...autoSet]));
  const finalAuto = Array.from(autoSet);
  return { selectedIds: finalSelected, autoSelectedIds: finalAuto };
}

/**
 * Queries Google's internal Street View SingleImageSearch RPC endpoint
 * to find the nearest official Google Street View panorama (strictly official launch imagery)
 * and extracts capture year, month, season, camera generation, country, region, road name,
 * elevation, car heading, and historical coverage years.
 */
export async function fetchOfficialStreetViewAtLatLng(
  lat: number,
  lng: number,
  radiusMeters: number = 250
): Promise<OfficialStreetViewMetadata | null> {
  const url =
    'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch';
  // Pass official source filter [[[2, true, 2]]] in slot [2][10] so user photospheres are ignored
  const body = JSON.stringify([
    ['apiv3'],
    [[null, null, lat, lng], radiusMeters],
    [null, ['en', 'US'], null, null, null, null, null, null, [1], null, [[[2, true, 2]]]],
    [[1, 2, 3, 4, 5, 6, 8]],
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
    // Strictly verify official Street View imagery (type 2 = official Google Street View)
    if (meta?.[2]?.[0] !== 2) {
      return null;
    }

    const panoId: string | undefined = meta?.[1]?.[1];
    if (!panoId) return null;

    const rawDims = meta?.[2]?.[2];
    const worldSize: [number, number] | undefined =
      Array.isArray(rawDims) &&
      typeof rawDims[0] === 'number' &&
      typeof rawDims[1] === 'number'
        ? [rawDims[0], rawDims[1]]
        : undefined;

    const locationBlock = meta?.[5]?.[0]?.[1];
    const foundLat: number = locationBlock?.[0]?.[2] ?? lat;
    const foundLng: number = locationBlock?.[0]?.[3] ?? lng;
    const elevationMeters: number | undefined = locationBlock?.[1]?.[0];
    const carHeadingDeg: number = locationBlock?.[2]?.[0] ?? 0;
    const pitchDeg: number | undefined = locationBlock?.[2]?.[1];
    const rollDeg: number | undefined = locationBlock?.[2]?.[2];
    const panoNorthDeg: number = data?.[2]?.[0] ?? carHeadingDeg;
    const countryCode: string | undefined = locationBlock?.[4];

    // Parse address lines from meta[3][2]
    // Usually [["Road Name", "en"], ["Locality, Region", "en"]] or [["Locality, Region", "en"]]
    const addrLines = meta?.[3]?.[2];
    let description: string | undefined;
    let roadName: string | undefined;
    let localityName: string | undefined;
    let regionName: string | undefined;

    if (Array.isArray(addrLines) && addrLines.length > 0) {
      const strs = addrLines
        .map((entry: unknown) =>
          Array.isArray(entry) && typeof entry[0] === 'string'
            ? entry[0].trim()
            : ''
        )
        .filter(Boolean);
      description = strs.join(' — ');
      if (strs.length >= 2) {
        roadName = strs[0];
      }
      const lastLine = strs[strs.length - 1];
      if (lastLine) {
        const parts = lastLine.split(',').map((s: string) => s.trim());
        if (parts.length >= 2) {
          regionName = parts[parts.length - 1];
          localityName = parts.slice(0, -1).join(', ');
        } else {
          regionName = parts[0];
        }
      }
    }

    const rpcCopyright: string | undefined = meta?.[4]?.[0]?.[0]?.[0]?.[0];

    const dateArr = meta?.[6]?.[7];
    let captureDate: string | undefined;
    let year: number | undefined;
    let month: number | undefined;
    let season: CoverageSeason | undefined;
    if (
      Array.isArray(dateArr) &&
      typeof dateArr[0] === 'number' &&
      typeof dateArr[1] === 'number'
    ) {
      year = dateArr[0];
      month = dateArr[1];
      captureDate = `${year}-${String(month).padStart(2, '0')}`;
      season = computeHemisphereSeason(month, foundLat);
    }

    const cameraGen = inferCameraGeneration(worldSize, year);

    // Extract historical coverage years from meta[5][0][8]
    const rawHist = meta?.[5]?.[0]?.[8];
    const histYearSet = new Set<number>();
    if (year !== undefined) histYearSet.add(year);
    if (Array.isArray(rawHist)) {
      for (const h of rawHist) {
        const hy = h?.[1]?.[0];
        if (typeof hy === 'number') histYearSet.add(hy);
      }
    }
    const historicalYears = Array.from(histYearSet).sort((a, b) => a - b);

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
      pitchDeg:
        typeof pitchDeg === 'number'
          ? Math.round((pitchDeg - 90) * 10) / 10
          : undefined,
      rollDeg:
        typeof rollDeg === 'number' ? Math.round(rollDeg * 10) / 10 : undefined,
      elevationMeters:
        typeof elevationMeters === 'number'
          ? Math.round(elevationMeters)
          : undefined,
      captureDate,
      year,
      month,
      season,
      cameraGen,
      worldSize,
      description,
      roadName,
      localityName,
      regionName,
      countryCode,
      rpcCopyright,
      historicalYears,
      neighborLinks,
      roadSequence,
    };
  } catch (err) {
    console.warn('Street View SingleImageSearch failed:', err);
    return null;
  }
}

async function fetchOsrmGeometryForWaypoints(
  waypoints: Array<[number, number]>
): Promise<Array<[number, number]>> {
  if (waypoints.length < 2) return waypoints;
  const coordStr = waypoints
    .map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(';');
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return waypoints;
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      return coords.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
    }
  } catch {
    // fallback to covered waypoints
  }
  return waypoints;
}

/**
 * Builds contiguous RoadAutoMetaSpan[] segments along a road stretch from sampled OfficialStreetViewMetadata checkpoints.
 * Adjacent checkpoints with matching (captureDate, cameraGen, countryCode, regionName) are merged into a single span.
 */
function buildAutoMetaSpansFromSamples(
  validSvs: OfficialStreetViewMetadata[]
): RoadAutoMetaSpan[] {
  if (validSvs.length === 0) return [];
  const n = validSvs.length;
  const rawSpans: RoadAutoMetaSpan[] = validSvs.map((sv, idx) => {
    const startFrac = idx === 0 ? 0 : idx / n;
    const endFrac = idx === n - 1 ? 1 : (idx + 1) / n;
    return {
      startFrac: Math.round(startFrac * 1000) / 1000,
      endFrac: Math.round(endFrac * 1000) / 1000,
      panoId: sv.panoId,
      year: sv.year,
      month: sv.month,
      captureDate: sv.captureDate,
      season: sv.season,
      cameraGen: sv.cameraGen,
      countryCode: sv.countryCode,
      regionName: sv.regionName,
      localityName: sv.localityName,
      roadName: sv.roadName,
      elevationMeters: sv.elevationMeters,
      carHeadingDeg: sv.carHeadingDeg,
      pitchDeg: sv.pitchDeg,
      rollDeg: sv.rollDeg,
      historicalYears: sv.historicalYears,
    };
  });

  // Merge consecutive spans with identical key metadata
  const merged: RoadAutoMetaSpan[] = [];
  for (const span of rawSpans) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.captureDate === span.captureDate &&
      prev.cameraGen === span.cameraGen &&
      prev.countryCode === span.countryCode &&
      prev.regionName === span.regionName
    ) {
      prev.endFrac = span.endFrac;
      if (span.historicalYears) {
        prev.historicalYears = Array.from(
          new Set([...(prev.historicalYears || []), ...span.historicalYears])
        ).sort((a, b) => a - b);
      }
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Strictly snaps a sequence of drawn or clicked [lat, lng] points ONLY to roads
 * that have official Google Street View coverage, and extracts per-segment auto-metadata spans.
 */
export async function snapPathToOfficialCoveredRoad(
  rawPoints: Array<[number, number]>,
  zoom: number
): Promise<{
  points: Array<[number, number]>;
  autoMetaSpans: RoadAutoMetaSpan[];
  primaryMeta: OfficialStreetViewMetadata;
} | null> {
  if (rawPoints.length < 2) return null;

  const snapRadiusMeters = Math.max(
    90,
    Math.min(750, Math.round(140 * Math.pow(1.4, Math.max(0, 13 - zoom))))
  );

  const maxCheckpoints = 9;
  const sampled: Array<[number, number]> = [];
  if (rawPoints.length <= maxCheckpoints) {
    sampled.push(...rawPoints);
  } else {
    sampled.push(rawPoints[0]);
    for (let i = 1; i < maxCheckpoints - 1; i++) {
      const idx = Math.floor((i / (maxCheckpoints - 1)) * (rawPoints.length - 1));
      sampled.push(rawPoints[idx]);
    }
    sampled.push(rawPoints[rawPoints.length - 1]);
  }

  const svResults = await Promise.all(
    sampled.map(([lat, lng]) =>
      fetchOfficialStreetViewAtLatLng(lat, lng, snapRadiusMeters)
    )
  );

  const validSvs = svResults.filter(
    (sv): sv is OfficialStreetViewMetadata => sv !== null
  );

  if (validSvs.length === 0) {
    return null;
  }

  const autoMetaSpans = buildAutoMetaSpansFromSamples(validSvs);
  const coveredWaypoints: Array<[number, number]> = [];
  for (const sv of validSvs) {
    const prev = coveredWaypoints[coveredWaypoints.length - 1];
    if (!prev || Math.hypot(sv.lat - prev[0], sv.lng - prev[1]) > 0.00005) {
      coveredWaypoints.push([sv.lat, sv.lng]);
    }
  }

  if (coveredWaypoints.length < 2) {
    const primary = validSvs[0];
    if (primary.roadSequence && primary.roadSequence.length >= 2) {
      return {
        points: primary.roadSequence.map((p) => [p.lat, p.lng]),
        autoMetaSpans,
        primaryMeta: primary,
      };
    }
    return null;
  }

  const routedPoints = await fetchOsrmGeometryForWaypoints(coveredWaypoints);

  if (routedPoints.length >= 4) {
    const mid1 = routedPoints[Math.floor(routedPoints.length * 0.33)];
    const mid2 = routedPoints[Math.floor(routedPoints.length * 0.67)];
    const [check1, check2] = await Promise.all([
      fetchOfficialStreetViewAtLatLng(
        mid1[0],
        mid1[1],
        Math.max(250, snapRadiusMeters)
      ),
      fetchOfficialStreetViewAtLatLng(
        mid2[0],
        mid2[1],
        Math.max(250, snapRadiusMeters)
      ),
    ]);

    if (!check1 || !check2) {
      return {
        points: coveredWaypoints,
        autoMetaSpans,
        primaryMeta: validSvs[0],
      };
    }
  }

  return {
    points: routedPoints,
    autoMetaSpans,
    primaryMeta: validSvs[0],
  };
}

/**
 * Given a single click on a road, verifies official Street View coverage at the click
 * and snaps ONLY to the officially covered road section around that point.
 */
export async function fetchSingleClickRoadSection(
  lat: number,
  lng: number,
  zoom: number
): Promise<{
  points: Array<[number, number]>;
  autoMetaSpans: RoadAutoMetaSpan[];
  primaryMeta: OfficialStreetViewMetadata;
} | null> {
  const clickRadiusMeters = Math.max(
    90,
    Math.min(600, Math.round(140 * Math.pow(1.4, Math.max(0, 13 - zoom))))
  );
  const sv = await fetchOfficialStreetViewAtLatLng(lat, lng, clickRadiusMeters);
  if (!sv) {
    return null;
  }

  const halfSpanMeters = Math.max(
    250,
    Math.min(12000, 350 * Math.pow(1.65, Math.max(0, 14 - zoom)))
  );

  const heading = sv.carHeadingDeg ?? 90;
  const rad = (heading * Math.PI) / 180;
  const dLat = (halfSpanMeters / 111320) * Math.cos(rad);
  const dLng =
    (halfSpanMeters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))) *
    Math.sin(rad);

  const probeBack: [number, number] = [sv.lat - dLat, sv.lng - dLng];
  const probeFwd: [number, number] = [sv.lat + dLat, sv.lng + dLng];

  const [svBack, svFwd] = await Promise.all([
    fetchOfficialStreetViewAtLatLng(
      probeBack[0],
      probeBack[1],
      halfSpanMeters * 0.6
    ),
    fetchOfficialStreetViewAtLatLng(
      probeFwd[0],
      probeFwd[1],
      halfSpanMeters * 0.6
    ),
  ]);

  const validSamples: OfficialStreetViewMetadata[] = [];
  const verifiedWaypoints: Array<[number, number]> = [];
  if (svBack) {
    validSamples.push(svBack);
    verifiedWaypoints.push([svBack.lat, svBack.lng]);
  }
  validSamples.push(sv);
  verifiedWaypoints.push([sv.lat, sv.lng]);
  if (svFwd) {
    validSamples.push(svFwd);
    verifiedWaypoints.push([svFwd.lat, svFwd.lng]);
  }

  const autoMetaSpans = buildAutoMetaSpansFromSamples(validSamples);

  if (verifiedWaypoints.length >= 2) {
    const snapped = await fetchOsrmGeometryForWaypoints(verifiedWaypoints);
    return {
      points: snapped,
      autoMetaSpans,
      primaryMeta: sv,
    };
  }

  if (sv.roadSequence && sv.roadSequence.length >= 2) {
    return {
      points: sv.roadSequence.map((p) => [p.lat, p.lng]),
      autoMetaSpans,
      primaryMeta: sv,
    };
  }

  return null;
}

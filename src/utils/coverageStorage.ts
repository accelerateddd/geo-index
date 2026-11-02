import type {
  CoverageAnnotation,
  CoverageNotebook,
  OfficialStreetViewMetadata,
} from '../types/coverageNotes';

const NOTEBOOKS_STORAGE_KEY = 'geoquiz_coverage_notebooks_v1';
const ANNOTATIONS_STORAGE_PREFIX = 'geoquiz_coverage_annotations_v1_';

export const DEFAULT_NOTEBOOKS: CoverageNotebook[] = [
  {
    id: 'nb-botswana',
    name: 'Botswana Learning',
    countryOrRegion: 'Botswana',
    center: [-22.05, 27.95],
    zoom: 9,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'nb-mongolia',
    name: 'Mongolia Coverage',
    countryOrRegion: 'Mongolia',
    center: [46.86, 103.85],
    zoom: 6,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'nb-kyrgyzstan',
    name: 'Kyrgyzstan Coverage',
    countryOrRegion: 'Kyrgyzstan',
    center: [41.2, 74.76],
    zoom: 7,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'nb-senegal',
    name: 'Senegal & Ghana',
    countryOrRegion: 'West Africa',
    center: [14.5, -14.45],
    zoom: 7,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'nb-world',
    name: 'Global Meta Notes',
    countryOrRegion: 'World',
    center: [15.0, 18.0],
    zoom: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export const QUICK_JUMP_REGIONS: Array<{
  label: string;
  center: [number, number];
  zoom: number;
}> = [
  { label: 'Botswana (East / Bobonong)', center: [-22.05, 28.15], zoom: 10 },
  { label: 'Botswana (Full)', center: [-22.3, 24.6], zoom: 6 },
  { label: 'Mongolia', center: [46.86, 103.85], zoom: 6 },
  { label: 'Kyrgyzstan', center: [41.2, 74.76], zoom: 7 },
  { label: 'Senegal', center: [14.5, -14.45], zoom: 7 },
  { label: 'Ghana', center: [7.95, -1.02], zoom: 7 },
  { label: 'Kenya', center: [0.02, 37.9], zoom: 7 },
  { label: 'Uganda', center: [1.37, 32.29], zoom: 7 },
  { label: 'Rwanda', center: [-1.94, 29.87], zoom: 9 },
  { label: 'Iceland', center: [64.96, -19.02], zoom: 6 },
  { label: 'Bolivia', center: [-16.29, -63.58], zoom: 6 },
  { label: 'Australia', center: [-25.27, 133.77], zoom: 4 },
  { label: 'World', center: [20.0, 15.0], zoom: 2 },
];

export function loadCoverageNotebooks(): CoverageNotebook[] {
  try {
    const raw = localStorage.getItem(NOTEBOOKS_STORAGE_KEY);
    if (!raw) return DEFAULT_NOTEBOOKS;
    const parsed = JSON.parse(raw) as CoverageNotebook[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_NOTEBOOKS;
  } catch {
    return DEFAULT_NOTEBOOKS;
  }
}

export function saveCoverageNotebooks(notebooks: CoverageNotebook[]): void {
  localStorage.setItem(NOTEBOOKS_STORAGE_KEY, JSON.stringify(notebooks));
}

export function loadNotebookAnnotations(notebookId: string): CoverageAnnotation[] {
  try {
    const raw = localStorage.getItem(`${ANNOTATIONS_STORAGE_PREFIX}${notebookId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CoverageAnnotation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveNotebookAnnotations(
  notebookId: string,
  annotations: CoverageAnnotation[]
): void {
  localStorage.setItem(
    `${ANNOTATIONS_STORAGE_PREFIX}${notebookId}`,
    JSON.stringify(annotations)
  );
}

/**
 * Queries Google's keyless MapsJsInternalService/SingleImageSearch RPC endpoint,
 * strictly filtered to Official Google Street View coverage (type 2 = outdoor official SV),
 * snapping to the nearest covered road within `radiusMeters`.
 */
export async function fetchOfficialStreetViewAtLatLng(
  lat: number,
  lng: number,
  radiusMeters: number = 1200
): Promise<OfficialStreetViewMetadata | null> {
  const endpoint =
    'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch';

  // Slot 2: [[null, null, lat, lng], radiusMeters]
  // Slot 3: [null, ["en", "US"], [[[[2, true, 2]]]]] -> restricts strictly to official Google Street View
  // Slot 4: [[1, 2, 3, 4, 8, 6]] -> requests location, car heading, capture date, and road neighbor links
  const payload = [
    ['apiv3'],
    [[null, null, lat, lng], radiusMeters],
    [null, ['en', 'US'], [[[[2, true, 2]]]]],
    [[1, 2, 3, 4, 8, 6]],
  ];

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Status [0] means OK; [5, "generic", "Search returned no images."] means no official road nearby
    if (!Array.isArray(data) || !Array.isArray(data[0]) || data[0][0] !== 0) {
      return null;
    }

    const meta = data[1];
    if (!Array.isArray(meta)) return null;

    const panoEntry = meta[1];
    const panoId = Array.isArray(panoEntry) ? String(panoEntry[1] || '') : '';
    if (!panoId) return null;

    // Description (e.g. "Bobonong, Central District")
    let description: string | null = null;
    try {
      const descArr = meta[3]?.[2]?.[0];
      if (Array.isArray(descArr) && typeof descArr[0] === 'string') {
        description = descArr[0];
      }
    } catch {
      // ignore
    }

    // Location, elevation, car heading, country code, and neighbor links in meta[5]
    let snappedLat = lat;
    let snappedLng = lng;
    let elevationMeters: number | null = null;
    let carHeadingDeg = 0;
    let pitchDeg = 0;
    let countryCode: string | null = null;
    const neighborLinks: OfficialStreetViewMetadata['neighborLinks'] = [];

    try {
      const poseBlock = meta[5]?.[0]?.[1];
      if (Array.isArray(poseBlock)) {
        if (Array.isArray(poseBlock[0])) {
          if (typeof poseBlock[0][2] === 'number') snappedLat = poseBlock[0][2];
          if (typeof poseBlock[0][3] === 'number') snappedLng = poseBlock[0][3];
        }
        if (Array.isArray(poseBlock[1]) && typeof poseBlock[1][0] === 'number') {
          elevationMeters = Math.round(poseBlock[1][0]);
        }
        if (Array.isArray(poseBlock[2])) {
          if (typeof poseBlock[2][0] === 'number') {
            carHeadingDeg = Number(poseBlock[2][0].toFixed(1));
          }
          if (typeof poseBlock[2][1] === 'number') {
            pitchDeg = Number((90 - poseBlock[2][1]).toFixed(1));
          }
        }
        if (typeof poseBlock[4] === 'string') {
          countryCode = poseBlock[4];
        }
      }

      // Extract connected road panoramas so we can step along the road or compute forward/backward headings
      const rawNeighbors = meta[5]?.[0]?.[3]?.[0];
      if (Array.isArray(rawNeighbors)) {
        for (const item of rawNeighbors) {
          const nPano = item?.[0]?.[1];
          const nCoords = item?.[2]?.[0];
          const nHeading = item?.[2]?.[2]?.[0];
          if (
            typeof nPano === 'string' &&
            nPano !== panoId &&
            Array.isArray(nCoords) &&
            typeof nCoords[2] === 'number' &&
            typeof nCoords[3] === 'number'
          ) {
            neighborLinks.push({
              panoId: nPano,
              lat: nCoords[2],
              lng: nCoords[3],
              headingDeg: typeof nHeading === 'number' ? Number(nHeading.toFixed(1)) : carHeadingDeg,
            });
          }
        }
      }
    } catch {
      // ignore
    }

    // Capture date in meta[6]?.[7] -> [year, month]
    let captureDate: string | null = null;
    try {
      const dateTuple = meta[6]?.[7];
      if (Array.isArray(dateTuple) && typeof dateTuple[0] === 'number') {
        const yr = dateTuple[0];
        const mo = typeof dateTuple[1] === 'number' ? dateTuple[1] : null;
        captureDate = mo ? `${yr}-${String(mo).padStart(2, '0')}` : `${yr}`;
      }
    } catch {
      // ignore
    }

    return {
      panoId,
      lat: snappedLat,
      lng: snappedLng,
      carHeadingDeg,
      pitchDeg,
      elevationMeters,
      captureDate,
      description,
      countryCode,
      neighborLinks,
    };
  } catch {
    return null;
  }
}

export function buildStreetViewEmbedUrl(
  panoId: string,
  lat: number,
  lng: number,
  headingDeg: number = 0,
  pitchDeg: number = 0
): string {
  const cleanHeading = ((headingDeg % 360) + 360) % 360;
  return `https://www.google.com/maps/embed?pb=!4v1700000000000!6m8!1m7!1s${encodeURIComponent(
    panoId
  )}!2m2!1d${lat}!2d${lng}!3f${cleanHeading.toFixed(1)}!4f${pitchDeg.toFixed(
    1
  )}!5f0.7820865974627469`;
}

export function buildGoogleMapsDirectPanoUrl(
  lat: number,
  lng: number,
  headingDeg: number = 0,
  panoId?: string
): string {
  const cleanHeading = ((headingDeg % 360) + 360) % 360;
  const base = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(
    6
  )},${lng.toFixed(6)}&heading=${cleanHeading.toFixed(1)}`;
  return panoId ? `${base}&pano=${encodeURIComponent(panoId)}` : base;
}

export function formatCompassCardinal(deg: number): string {
  const dirs = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const normalized = ((deg % 360) + 360) % 360;
  const idx = Math.round(normalized / 22.5) % 16;
  return `${Math.round(normalized)}° ${dirs[idx]}`;
}

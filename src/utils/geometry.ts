import polygonClipping from 'polygon-clipping';

export interface BBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export function computeFeatureCollectionBBox(fc: GeoJSON.FeatureCollection): BBox {
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;

  function visitCoords(coords: any) {
    if (!Array.isArray(coords) || coords.length === 0) return;
    if (typeof coords[0] === 'number') {
      const lon = coords[0];
      const lat = coords[1];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of coords) {
      visitCoords(child);
    }
  }

  for (const f of fc.features) {
    if (f.geometry && 'coordinates' in f.geometry) {
      visitCoords((f.geometry as any).coordinates);
    }
  }

  return { minLon, maxLon, minLat, maxLat };
}

export function computeFeaturesBBox(features: GeoJSON.Feature[]): BBox {
  return computeFeatureCollectionBBox({
    type: 'FeatureCollection',
    features,
  });
}

export function computeRingBBox(ring: number[][]): BBox {
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const pt of ring) {
    const lon = pt[0];
    const lat = pt[1];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

export function bboxesIntersect(a: BBox, b: BBox, marginDeg: number = 1.5): boolean {
  return !(
    b.minLon > a.maxLon + marginDeg ||
    b.maxLon < a.minLon - marginDeg ||
    b.minLat > a.maxLat + marginDeg ||
    b.maxLat < a.minLat - marginDeg
  );
}

function isPointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isRingStrictlyInsideLake(candRing: number[][], lakeGeom: GeoJSON.Geometry): boolean {
  if (!candRing || candRing.length < 3) return false;
  // Check 3 sampled vertices + centroid of candidate ring against lake exterior rings
  const idxs = [
    0,
    Math.floor(candRing.length / 3),
    Math.floor((candRing.length * 2) / 3),
  ];
  const outerRings: number[][][] = [];
  if (lakeGeom.type === 'Polygon' && lakeGeom.coordinates[0]) {
    outerRings.push(lakeGeom.coordinates[0]);
  } else if (lakeGeom.type === 'MultiPolygon') {
    for (const poly of lakeGeom.coordinates) {
      if (poly[0]) outerRings.push(poly[0]);
    }
  }
  if (outerRings.length === 0) return false;

  for (const idx of idxs) {
    const pt = candRing[idx];
    if (!pt) continue;
    const insideAny = outerRings.some((extRing) => isPointInRing(pt[0], pt[1], extRing));
    if (!insideAny) return false;
  }
  return true;
}

/**
 * Punches interior hole rings into lake polygons for any true island subdivision rings
 * (such as Likoma Island & Chizumulu Island in Lake Malawi) that lie strictly inside a lake polygon,
 * ensuring water bodies never obscure island subdivisions.
 */
export function punchIslandHolesInLakes(
  lakes: GeoJSON.FeatureCollection,
  subdivisions: GeoJSON.FeatureCollection | null
): GeoJSON.FeatureCollection {
  if (!subdivisions || subdivisions.features.length === 0) return lakes;

  const candidateIslandRings: Array<{ ring: number[][]; bbox: BBox; area: number }> = [];
  for (const f of subdivisions.features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && geom.coordinates[0]) {
      const ring = geom.coordinates[0];
      const bbox = computeRingBBox(ring);
      const area = Math.max(1e-8, (bbox.maxLon - bbox.minLon) * (bbox.maxLat - bbox.minLat));
      candidateIslandRings.push({ ring, bbox, area });
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (poly[0]) {
          const ring = poly[0];
          const bbox = computeRingBBox(ring);
          const area = Math.max(1e-8, (bbox.maxLon - bbox.minLon) * (bbox.maxLat - bbox.minLat));
          candidateIslandRings.push({ ring, bbox, area });
        }
      }
    }
  }

  if (candidateIslandRings.length === 0) return lakes;

  const updatedFeatures: GeoJSON.Feature[] = lakes.features.map((lakeFeature) => {
    const geom = lakeFeature.geometry;
    if (!geom) return lakeFeature;

    const lakeBBox = computeFeaturesBBox([lakeFeature]);
    const lakeArea = Math.max(
      1e-6,
      (lakeBBox.maxLon - lakeBBox.minLon) * (lakeBBox.maxLat - lakeBBox.minLat)
    );

    const matchingIslands = candidateIslandRings.filter((cand) => {
      if (cand.area > lakeArea * 0.25) return false;
      const tol = 0.01;
      const inBBox =
        cand.bbox.minLon >= lakeBBox.minLon - tol &&
        cand.bbox.maxLon <= lakeBBox.maxLon + tol &&
        cand.bbox.minLat >= lakeBBox.minLat - tol &&
        cand.bbox.maxLat <= lakeBBox.maxLat + tol;
      if (!inBBox) return false;
      return isRingStrictlyInsideLake(cand.ring, geom);
    });

    if (matchingIslands.length === 0) return lakeFeature;

    if (geom.type === 'Polygon') {
      return {
        ...lakeFeature,
        geometry: {
          type: 'Polygon',
          coordinates: [
            ...geom.coordinates,
            ...matchingIslands.map((m) => m.ring),
          ],
        },
      };
    }

    if (geom.type === 'MultiPolygon') {
      return {
        ...lakeFeature,
        geometry: {
          type: 'MultiPolygon',
          coordinates: geom.coordinates.map((poly, idx) =>
            idx === 0
              ? [...poly, ...matchingIslands.map((m) => m.ring)]
              : poly
          ),
        },
      };
    }

    return lakeFeature;
  });

  return {
    type: 'FeatureCollection',
    features: updatedFeatures,
  };
}

/**
 * Geometrically clips subdivision polygons against major lakes (which already have island holes punched out),
 * so straight-line administrative borders jutting across lakes (like Lake Victoria or Great Lakes)
 * are cleanly trimmed to the lake coastline, while island subdivisions remain 100% intact.
 */
export function clipSubdivisionsAgainstLakes(
  subdivisions: GeoJSON.FeatureCollection | null,
  lakesWithHoles: GeoJSON.FeatureCollection | null
): GeoJSON.FeatureCollection | null {
  if (!subdivisions || !lakesWithHoles || lakesWithHoles.features.length === 0) {
    return subdivisions;
  }

  const lakePolys: Array<{ bbox: BBox; coords: any }> = [];
  for (const lf of lakesWithHoles.features) {
    const g = lf.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      lakePolys.push({
        bbox: computeFeaturesBBox([lf]),
        coords: [g.coordinates],
      });
    } else if (g.type === 'MultiPolygon') {
      lakePolys.push({
        bbox: computeFeaturesBBox([lf]),
        coords: g.coordinates,
      });
    }
  }

  if (lakePolys.length === 0) return subdivisions;

  const clippedFeatures = subdivisions.features.map((f) => {
    const geom = f.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
      return f;
    }

    const fBBox = computeFeaturesBBox([f]);
    const overlappingLakes = lakePolys.filter((lp) =>
      bboxesIntersect(fBBox, lp.bbox, 0.01)
    );
    if (overlappingLakes.length === 0) return f;

    try {
      const subj =
        geom.type === 'Polygon'
          ? ([(geom.coordinates as any)] as polygonClipping.MultiPolygon)
          : (geom.coordinates as unknown as polygonClipping.MultiPolygon);

      const clips = overlappingLakes.map(
        (lp) => lp.coords as polygonClipping.MultiPolygon
      );
      const diff = polygonClipping.difference(subj, ...clips);
      if (!diff || diff.length === 0) {
        // Keep original feature if it was an island completely inside a lake
        return f;
      }
      if (diff.length === 1) {
        return {
          ...f,
          geometry: {
            type: 'Polygon' as const,
            coordinates: diff[0] as unknown as number[][][],
          },
        };
      }
      return {
        ...f,
        geometry: {
          type: 'MultiPolygon' as const,
          coordinates: diff as unknown as number[][][][],
        },
      };
    } catch {
      return f;
    }
  });

  return {
    type: 'FeatureCollection',
    features: clippedFeatures,
  };
}

export function isLineGeometry(features: GeoJSON.Feature[]): boolean {
  return features.some(
    (f) =>
      f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString'
  );
}

/**
 * Computes the geometric area-weighted centroid [lat, lng] of a list of GeoJSON features
 * sharing the same subdivision or river name. Supports Polygon, MultiPolygon, LineString, MultiLineString.
 */
export function computeSubdivisionCentroid(features: GeoJSON.Feature[]): [number, number] {
  let totalArea = 0;
  let sumLat = 0;
  let sumLon = 0;

  function processRing(ring: number[][]) {
    if (ring.length < 3) return;
    let ringArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const x0 = ring[j][0];
      const y0 = ring[j][1];
      const x1 = ring[i][0];
      const y1 = ring[i][1];
      const cross = x0 * y1 - x1 * y0;
      ringArea += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    ringArea *= 0.5;
    if (Math.abs(ringArea) > 1e-11) {
      const factor = 1 / (6 * ringArea);
      const centerLon = cx * factor;
      const centerLat = cy * factor;
      const absArea = Math.abs(ringArea);
      totalArea += absArea;
      sumLon += centerLon * absArea;
      sumLat += centerLat * absArea;
    }
  }

  let totalLineLength = 0;
  let sumLineLat = 0;
  let sumLineLon = 0;

  function processLine(line: number[][]) {
    for (let i = 1; i < line.length; i++) {
      const x0 = line[i - 1][0];
      const y0 = line[i - 1][1];
      const x1 = line[i][0];
      const y1 = line[i][1];
      const segLen = Math.hypot(x1 - x0, y1 - y0);
      if (segLen > 1e-9) {
        totalLineLength += segLen;
        sumLineLon += ((x0 + x1) / 2) * segLen;
        sumLineLat += ((y0 + y1) / 2) * segLen;
      }
    }
  }

  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      if (geom.coordinates[0]) processRing(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (poly[0]) processRing(poly[0]);
      }
    } else if (geom.type === 'LineString') {
      processLine(geom.coordinates);
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        processLine(line);
      }
    }
  }

  if (totalArea > 0) {
    return [sumLat / totalArea, sumLon / totalArea];
  }
  if (totalLineLength > 0) {
    return [sumLineLat / totalLineLength, sumLineLon / totalLineLength];
  }

  const bbox = computeFeaturesBBox(features);
  return [(bbox.minLat + bbox.maxLat) / 2, (bbox.minLon + bbox.maxLon) / 2];
}

/**
 * Converts a list of GeoJSON Polygon/MultiPolygon/LineString/MultiLineString features into an SVG path string (`d`)
 * normalized into a [0, width] x [0, height] viewBox with aspect-ratio preservation,
 * applying optional `rotationDeg` BEFORE bounding-box fitting.
 */
export function featuresToSvgPath(
  features: GeoJSON.Feature[],
  viewWidth: number = 600,
  viewHeight: number = 420,
  padding: number = 36,
  rotationDeg: number = 0
): string {
  const rawBBox = computeFeaturesBBox(features);
  const centerLon = (rawBBox.minLon + rawBBox.maxLon) / 2;
  const centerLat = (rawBBox.minLat + rawBBox.maxLat) / 2;
  const meanLatRad = (centerLat * Math.PI) / 180;
  const cosLat = Math.max(0.2, Math.cos(meanLatRad));

  const rad = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  const toRotatedPlane = (lon: number, lat: number): [number, number] => {
    const dx = (lon - centerLon) * cosLat;
    const dy = centerLat - lat;
    if (rotationDeg === 0) return [dx, dy];
    return [dx * cosR - dy * sinR, dx * sinR + dy * cosR];
  };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const rotatedPaths: Array<{ pts: Array<[number, number]>; closed: boolean }> = [];

  function collectPath(coords: number[][], closed: boolean) {
    if (!coords || coords.length < 2) return;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < coords.length; i++) {
      const [rx, ry] = toRotatedPlane(coords[i][0], coords[i][1]);
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
      pts.push([rx, ry]);
    }
    rotatedPaths.push({ pts, closed });
  }

  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) collectPath(ring, true);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        for (const ring of poly) collectPath(ring, true);
      }
    } else if (geom.type === 'LineString') {
      collectPath(geom.coordinates, false);
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        collectPath(line, false);
      }
    }
  }

  if (rotatedPaths.length === 0) return '';

  const spanX = Math.max(1e-5, maxX - minX);
  const spanY = Math.max(1e-5, maxY - minY);

  const availW = viewWidth - padding * 2;
  const availH = viewHeight - padding * 2;
  const scale = Math.min(availW / spanX, availH / spanY);

  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offsetX = (viewWidth - drawnW) / 2;
  const offsetY = (viewHeight - drawnH) / 2;

  const parts: string[] = [];
  for (const { pts, closed } of rotatedPaths) {
    for (let i = 0; i < pts.length; i++) {
      const x = Number((offsetX + (pts[i][0] - minX) * scale).toFixed(1));
      const y = Number((offsetY + (pts[i][1] - minY) * scale).toFixed(1));
      parts.push(`${i === 0 ? 'M' : 'L'}${x},${y}`);
    }
    if (closed) parts.push('Z');
  }

  return parts.join(' ');
}

export interface UnitVectorNeighbor {
  name: string;
  ux: number;
  uy: number;
  distanceKm: number;
  angleDeg: number;
}

export function computeClosestUnitVectors(
  targetName: string,
  centroids: Record<string, [number, number]>,
  n: number
): UnitVectorNeighbor[] {
  const target = centroids[targetName];
  if (!target) return [];
  const [lat0, lon0] = target;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);

  const neighbors: UnitVectorNeighbor[] = [];

  for (const [otherName, [lat1, lon1]] of Object.entries(centroids)) {
    if (otherName === targetName) continue;
    const dx = (lon1 - lon0) * cosLat;
    const dy = lat1 - lat0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;

    const ux = dx / len;
    const uy = -dy / len;
    const distanceKm = Math.round(len * 111.32);
    const angleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;

    neighbors.push({
      name: otherName,
      ux,
      uy,
      distanceKm,
      angleDeg,
    });
  }

  neighbors.sort((a, b) => a.distanceKm - b.distanceKm);
  return neighbors.slice(0, Math.max(1, n));
}

function geometryToMultiPolygonCoords(
  geom: GeoJSON.Geometry | null | undefined
): polygonClipping.MultiPolygon | null {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    return [geom.coordinates as unknown as polygonClipping.Polygon];
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates as unknown as polygonClipping.MultiPolygon;
  }
  return null;
}

/**
 * Filters a lake FeatureCollection so only lakes that geometrically penetrate or lie inside
 * the actual polygons of `territoryCollection` are kept.
 * Eliminates lakes in neighboring countries (e.g. Lake Balkhash in Kazakhstan on the Russia quiz)
 * that merely fall inside the outer lat/lon bounding box of a large country.
 */
export function filterLakesIntersectingTerritory(
  allLakes: GeoJSON.FeatureCollection,
  territoryCollection: GeoJSON.FeatureCollection | null
): GeoJSON.FeatureCollection | null {
  if (!territoryCollection || territoryCollection.features.length === 0) return null;

  const overallBBox = computeFeatureCollectionBBox(territoryCollection);
  const candidateLakes = allLakes.features.filter((lf) =>
    bboxesIntersect(overallBBox, computeFeaturesBBox([lf]), 0.05)
  );
  if (candidateLakes.length === 0) return null;

  const territoryPolys: Array<{ bbox: BBox; mp: polygonClipping.MultiPolygon }> = [];
  for (const tf of territoryCollection.features) {
    const mp = geometryToMultiPolygonCoords(tf.geometry);
    if (!mp) continue;
    territoryPolys.push({
      bbox: computeFeaturesBBox([tf]),
      mp,
    });
  }

  if (territoryPolys.length === 0) return null;

  const intersectingLakes = candidateLakes.filter((lf) => {
    const lakeMp = geometryToMultiPolygonCoords(lf.geometry);
    if (!lakeMp) return false;
    const lakeBBox = computeFeaturesBBox([lf]);

    for (const tp of territoryPolys) {
      if (!bboxesIntersect(lakeBBox, tp.bbox, 0.002)) continue;
      try {
        const inter = polygonClipping.intersection(lakeMp, tp.mp);
        if (inter && inter.length > 0) {
          return true;
        }
      } catch {
        // Fallback if degenerate ring: keep if bbox deeply overlaps
        return true;
      }
    }
    return false;
  });

  if (intersectingLakes.length === 0) return null;
  return {
    type: 'FeatureCollection',
    features: intersectingLakes,
  };
}

export interface RegionalCluster {
  clusterIndex: number;
  label: string;
  itemKeys: string[];
  center: [number, number];
}

/**
 * Partitions a quiz's items into N contiguous regional clusters ("bunches") for Learn Mode.
 * If N matches the number of natural parent regions (e.g., 12 statistical regions of Slovenia),
 * uses the exact natural regions; otherwise uses deterministic K-Means++ spatial clustering.
 */
export function partitionIntoRegionalClusters(
  itemKeys: string[],
  centroids: Record<string, [number, number]>,
  numClusters: number,
  naturalGroupByItem?: Record<string, string>
): RegionalCluster[] {
  const validKeys = itemKeys.filter((k) => centroids[k] !== undefined);
  const k = Math.max(1, Math.min(numClusters, validKeys.length));
  if (k <= 1 || validKeys.length === 0) {
    return [
      {
        clusterIndex: 0,
        label: `All Items (${itemKeys.length})`,
        itemKeys,
        center: validKeys[0] ? centroids[validKeys[0]] : [0, 0],
      },
    ];
  }

  // Check if natural groupings exist and match k
  if (naturalGroupByItem) {
    const groups: Record<string, string[]> = {};
    for (const key of validKeys) {
      const g = naturalGroupByItem[key];
      if (g) {
        if (!groups[g]) groups[g] = [];
        groups[g].push(key);
      }
    }
    const groupEntries = Object.entries(groups);
    if (groupEntries.length === k) {
      return groupEntries
        .map(([gName, keys], idx) => {
          const lat = keys.reduce((s, x) => s + centroids[x][0], 0) / keys.length;
          const lng = keys.reduce((s, x) => s + centroids[x][1], 0) / keys.length;
          return {
            clusterIndex: idx,
            label: `${gName} (${keys.length})`,
            itemKeys: keys,
            center: [lat, lng] as [number, number],
          };
        })
        .sort((a, b) => b.center[0] - a.center[0] || a.center[1] - b.center[1])
        .map((c, idx) => ({ ...c, clusterIndex: idx }));
    }
  }

  // Deterministic K-Means++ on projected [lat, lng * cosLat]
  const meanLat =
    validKeys.reduce((s, key) => s + centroids[key][0], 0) / validKeys.length;
  const cosLat = Math.max(0.2, Math.cos((meanLat * Math.PI) / 180));

  const pts = validKeys.map((key) => ({
    key,
    y: centroids[key][0],
    x: centroids[key][1] * cosLat,
    rawLat: centroids[key][0],
    rawLng: centroids[key][1],
  }));

  // Sort pts deterministically North-West to South-East to seed K-Means++
  const sortedPts = [...pts].sort((a, b) => b.y - a.y || a.x - b.x);
  const centers: Array<{ x: number; y: number }> = [
    { x: sortedPts[0].x, y: sortedPts[0].y },
  ];

  while (centers.length < k) {
    let bestPt = sortedPts[0];
    let maxMinDist = -1;
    for (const p of sortedPts) {
      let minDist = Infinity;
      for (const c of centers) {
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (d < minDist) minDist = d;
      }
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        bestPt = p;
      }
    }
    centers.push({ x: bestPt.x, y: bestPt.y });
  }

  const assignments = new Array<number>(pts.length).fill(0);
  for (let iter = 0; iter < 18; iter++) {
    let changed = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let bestC = 0;
      let bestD = Infinity;
      for (let cIdx = 0; cIdx < k; cIdx++) {
        const d = (p.x - centers[cIdx].x) ** 2 + (p.y - centers[cIdx].y) ** 2;
        if (d < bestD) {
          bestD = d;
          bestC = cIdx;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }
    if (!changed) break;

    for (let cIdx = 0; cIdx < k; cIdx++) {
      let sx = 0;
      let sy = 0;
      let cnt = 0;
      for (let i = 0; i < pts.length; i++) {
        if (assignments[i] === cIdx) {
          sx += pts[i].x;
          sy += pts[i].y;
          cnt++;
        }
      }
      if (cnt > 0) {
        centers[cIdx] = { x: sx / cnt, y: sy / cnt };
      }
    }
  }

  const buckets: Map<number, string[]> = new Map();
  for (let i = 0; i < pts.length; i++) {
    const cIdx = assignments[i];
    if (!buckets.has(cIdx)) buckets.set(cIdx, []);
    buckets.get(cIdx)!.push(pts[i].key);
  }

  const rawClusters: RegionalCluster[] = [];
  for (const [, keys] of buckets.entries()) {
    if (keys.length === 0) continue;
    const lat = keys.reduce((s, x) => s + centroids[x][0], 0) / keys.length;
    const lng = keys.reduce((s, x) => s + centroids[x][1], 0) / keys.length;
    rawClusters.push({
      clusterIndex: 0,
      label: '',
      itemKeys: keys,
      center: [lat, lng],
    });
  }

  // Sort spatially North-to-South, West-to-East so Group 1..N follow a logical geographical order
  rawClusters.sort((a, b) => b.center[0] - a.center[0] || a.center[1] - b.center[1]);
  return rawClusters.map((c, idx) => ({
    ...c,
    clusterIndex: idx,
    label: `Group ${idx + 1} (${c.itemKeys.length})`,
  }));
}

/**
 * Computes a spatial neighbor adjacency list for each item key so that in 'list-all' mode,
 * we can detect when all items surrounding an unnamed item have been named.
 */
export function computeSpatialNeighborsMap(
  bboxesByKey: Record<string, BBox>,
  centroidsByKey: Record<string, [number, number]>
): Record<string, string[]> {
  const keys = Object.keys(centroidsByKey);
  const result: Record<string, string[]> = {};
  if (keys.length <= 1) {
    for (const k of keys) result[k] = [];
    return result;
  }

  // Bucket by 2-degree spatial grid for fast O(N) neighbor lookup even on 3,500+ Mega Quiz items
  const cellSize = 2.0;
  const grid = new Map<string, string[]>();

  for (const k of keys) {
    const b = bboxesByKey[k];
    if (!b) continue;
    const x0 = Math.floor(b.minLon / cellSize);
    const x1 = Math.floor(b.maxLon / cellSize);
    const y0 = Math.floor(b.minLat / cellSize);
    const y1 = Math.floor(b.maxLat / cellSize);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const cellKey = `${x}:${y}`;
        let list = grid.get(cellKey);
        if (!list) {
          list = [];
          grid.set(cellKey, list);
        }
        list.push(k);
      }
    }
  }

  for (const k of keys) {
    const b = bboxesByKey[k];
    const neighbors = new Set<string>();
    if (b) {
      const span = Math.max(0.02, Math.min(0.25, Math.max(b.maxLon - b.minLon, b.maxLat - b.minLat) * 0.18));
      const x0 = Math.floor((b.minLon - span) / cellSize);
      const x1 = Math.floor((b.maxLon + span) / cellSize);
      const y0 = Math.floor((b.minLat - span) / cellSize);
      const y1 = Math.floor((b.maxLat + span) / cellSize);

      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const cellCandidates = grid.get(`${x}:${y}`);
          if (!cellCandidates) continue;
          for (const other of cellCandidates) {
            if (other === k || neighbors.has(other)) continue;
            const ob = bboxesByKey[other];
            if (ob && bboxesIntersect(b, ob, span)) {
              neighbors.add(other);
            }
          }
        }
      }
    }

    // If an island or isolated point has fewer than 2 touching bbox neighbors, link its 3 closest centroids
    if (neighbors.size < 2) {
      const [lat0, lon0] = centroidsByKey[k];
      const cosLat = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
      let best1 = { key: '', d: Infinity };
      let best2 = { key: '', d: Infinity };
      let best3 = { key: '', d: Infinity };

      for (const other of keys) {
        if (other === k) continue;
        const [lat1, lon1] = centroidsByKey[other];
        const d = ((lon1 - lon0) * cosLat) ** 2 + (lat1 - lat0) ** 2;
        if (d < best1.d) {
          best3 = best2;
          best2 = best1;
          best1 = { key: other, d };
        } else if (d < best2.d) {
          best3 = best2;
          best2 = { key: other, d };
        } else if (d < best3.d) {
          best3 = { key: other, d };
        }
      }
      if (best1.key) neighbors.add(best1.key);
      if (best2.key) neighbors.add(best2.key);
      if (best3.key) neighbors.add(best3.key);
    }

    result[k] = Array.from(neighbors);
  }

  return result;
}

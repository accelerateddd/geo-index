import fs from 'node:fs';
import path from 'node:path';

const SYDNEY_LGAS = [
  { rawName: 'SYDNEY', name: 'Sydney', slug: 'sydney' },
  { rawName: 'BAYSIDE', name: 'Bayside', slug: 'bayside' },
  { rawName: 'INNER WEST', name: 'Inner West', slug: 'inner-west' },
  { rawName: 'RANDWICK', name: 'Randwick', slug: 'randwick' },
  { rawName: 'WAVERLEY', name: 'Waverley', slug: 'waverley' },
  { rawName: 'WOOLLAHRA', name: 'Woollahra', slug: 'woollahra' },
  { rawName: 'NORTH SYDNEY', name: 'North Sydney', slug: 'north-sydney' },
  { rawName: 'MOSMAN', name: 'Mosman', slug: 'mosman' },
  { rawName: 'WILLOUGHBY', name: 'Willoughby', slug: 'willoughby' },
  { rawName: 'LANE COVE', name: 'Lane Cove', slug: 'lane-cove' },
  { rawName: 'KU-RING-GAI', name: 'Ku-ring-gai', slug: 'ku-ring-gai' },
  { rawName: 'NORTHERN BEACHES', name: 'Northern Beaches', slug: 'northern-beaches' },
  { rawName: 'HORNSBY', name: 'Hornsby', slug: 'hornsby' },
  { rawName: 'RYDE', name: 'Ryde', slug: 'ryde' },
  { rawName: 'HUNTERS HILL', name: 'Hunters Hill', slug: 'hunters-hill' },
  { rawName: 'CITY OF PARRAMATTA', name: 'Parramatta', slug: 'parramatta' },
  { rawName: 'CANADA BAY', name: 'Canada Bay', slug: 'canada-bay' },
  { rawName: 'BURWOOD', name: 'Burwood', slug: 'burwood' },
  { rawName: 'STRATHFIELD', name: 'Strathfield', slug: 'strathfield' },
  { rawName: 'CANTERBURY-BANKSTOWN', name: 'Canterbury-Bankstown', slug: 'canterbury-bankstown' },
  { rawName: 'GEORGES RIVER', name: 'Georges River', slug: 'georges-river' },
  { rawName: 'SUTHERLAND SHIRE', name: 'Sutherland', slug: 'sutherland' },
  { rawName: 'CUMBERLAND', name: 'Cumberland', slug: 'cumberland' },
  { rawName: 'FAIRFIELD', name: 'Fairfield', slug: 'fairfield' },
  { rawName: 'LIVERPOOL', name: 'Liverpool', slug: 'liverpool' },
  { rawName: 'CAMPBELLTOWN', name: 'Campbelltown', slug: 'campbelltown' },
  { rawName: 'CAMDEN', name: 'Camden', slug: 'camden' },
  { rawName: 'PENRITH', name: 'Penrith', slug: 'penrith' },
  { rawName: 'BLACKTOWN', name: 'Blacktown', slug: 'blacktown' },
  { rawName: 'THE HILLS SHIRE', name: 'The Hills', slug: 'the-hills' },
  { rawName: 'HAWKESBURY', name: 'Hawkesbury', slug: 'hawkesbury' },
  { rawName: 'BLUE MOUNTAINS', name: 'Blue Mountains', slug: 'blue-mountains' },
  { rawName: 'CENTRAL COAST', name: 'Central Coast', slug: 'central-coast' },
  { rawName: 'WOLLONDILLY', name: 'Wollondilly', slug: 'wollondilly' },
];

function toTitleCaseSuburb(upper) {
  if (upper === 'KU-RING-GAI CHASE') return 'Ku-ring-gai Chase';
  if (upper === 'MOUNT KURING-GAI') return 'Mount Kuring-gai';
  if (upper === 'BRIGHTON-LE-SANDS') return 'Brighton-Le-Sands';

  return upper
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/^Mc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`)
    .replace(/\sMc([a-z])/g, (_, c) => ` Mc${c.toUpperCase()}`);
}

function buildSuburbAliases(cleanName) {
  const aliases = new Set();
  if (cleanName === 'Sydney') {
    aliases.add('Sydney CBD');
    aliases.add('CBD');
    aliases.add('City');
  }
  if (cleanName.includes('-')) {
    aliases.add(cleanName.replace(/-/g, ' '));
    aliases.add(cleanName.replace(/-/g, ''));
  }
  if (/\bMount\b/.test(cleanName)) {
    aliases.add(cleanName.replace(/\bMount\b/g, 'Mt'));
  }
  if (/\bSt\b/.test(cleanName)) {
    aliases.add(cleanName.replace(/\bSt\b/g, 'Saint'));
  }
  aliases.delete(cleanName);
  return Array.from(aliases);
}

function getBbox(geom) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPoly(pt, coords) {
  if (!pointInRing(pt, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(pt, coords[i])) return false;
  }
  return true;
}

function pointInGeom(pt, geom) {
  if (geom.type === 'Polygon') return pointInPoly(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((c) => pointInPoly(pt, c));
  return false;
}

function overlapFraction(sub, lga) {
  const [minX, minY, maxX, maxY] = sub.bbox;
  let inSub = 0,
    inBoth = 0;
  const N = 22;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const pt = [
        minX + ((maxX - minX) * (i + 0.5)) / N,
        minY + ((maxY - minY) * (j + 0.5)) / N,
      ];
      if (pointInGeom(pt, sub.geometry)) {
        inSub++;
        if (pointInGeom(pt, lga.geometry)) inBoth++;
      }
    }
  }
  return inSub > 0 ? inBoth / inSub : 0;
}

function roundRing(ring) {
  const out = [];
  for (const pt of ring) {
    const x = Number(pt[0].toFixed(4));
    const y = Number(pt[1].toFixed(4));
    if (out.length === 0 || out[out.length - 1][0] !== x || out[out.length - 1][1] !== y) {
      out.push([x, y]);
    }
  }
  if (
    out.length >= 3 &&
    (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])
  ) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}

function roundGeometry(geom) {
  const cleanPoly = (coords) => {
    const rings = [];
    for (const r of coords) {
      const rr = roundRing(r);
      if (rr.length >= 4) rings.push(rr);
    }
    return rings;
  };
  if (geom.type === 'Polygon') {
    const rings = cleanPoly(geom.coordinates);
    return rings.length > 0 ? { type: 'Polygon', coordinates: rings } : geom;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = [];
    for (const poly of geom.coordinates) {
      const rings = cleanPoly(poly);
      if (rings.length > 0) polys.push(rings);
    }
    if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
    if (polys.length > 1) return { type: 'MultiPolygon', coordinates: polys };
  }
  return geom;
}

async function main() {
  const outGeoDir = path.resolve('public/data/sydney-suburbs');
  fs.mkdirSync(outGeoDir, { recursive: true });

  console.log('Fetching Greater Sydney LGA boundaries from NSW Spatial Services (Layer 8)...');
  const whereLga = `lganame IN (${SYDNEY_LGAS.map((s) => `'${s.rawName}'`).join(',')})`;
  const lgaUrl = `https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Administrative_Boundaries_Theme/FeatureServer/8/query?where=${encodeURIComponent(whereLga)}&outFields=lganame,councilname&returnGeometry=true&maxAllowableOffset=0.0001&outSR=4326&f=geojson`;
  const lgaRes = await fetch(lgaUrl).then((r) => r.json());
  if (!lgaRes.features || lgaRes.features.length === 0) {
    throw new Error('Failed to fetch NSW LGA boundaries');
  }

  const lgaByRaw = new Map();
  let allMinX = Infinity,
    allMinY = Infinity,
    allMaxX = -Infinity,
    allMaxY = -Infinity;

  for (const f of lgaRes.features) {
    const bbox = getBbox(f.geometry);
    if (bbox[0] < allMinX) allMinX = bbox[0];
    if (bbox[1] < allMinY) allMinY = bbox[1];
    if (bbox[2] > allMaxX) allMaxX = bbox[2];
    if (bbox[3] > allMaxY) allMaxY = bbox[3];
    lgaByRaw.set(f.properties.lganame, {
      geometry: f.geometry,
      bbox,
    });
  }

  console.log('Fetching Greater Sydney Suburb boundaries from NSW Spatial Services (Layer 2)...');
  const subWhere = `postcode IS NOT NULL OR suburbname = 'KU-RING-GAI CHASE'`;
  const subUrl = `https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Administrative_Boundaries_Theme/FeatureServer/2/query?geometry=${[allMinX, allMinY, allMaxX, allMaxY].join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&where=${encodeURIComponent(subWhere)}&outFields=suburbname,postcode&returnGeometry=true&maxAllowableOffset=0.0001&outSR=4326&f=geojson`;
  const subRes = await fetch(subUrl).then((r) => r.json());
  if (!subRes.features || subRes.features.length === 0) {
    throw new Error('Failed to fetch NSW Suburb boundaries');
  }
  console.log(`Fetched ${subRes.features.length} suburbs in Greater Sydney envelope.`);

  const suburbs = subRes.features.map((f) => {
    const cleanName = toTitleCaseSuburb(f.properties.suburbname);
    return {
      rawName: f.properties.suburbname,
      cleanName,
      postcode: f.properties.postcode,
      geometry: f.geometry,
      roundedGeometry: roundGeometry(f.geometry),
      bbox: getBbox(f.geometry),
    };
  });

  const quizzes = [];

  for (const meta of SYDNEY_LGAS) {
    const lgaGeomObj = lgaByRaw.get(meta.rawName);
    if (!lgaGeomObj) {
      throw new Error(`Missing LGA geometry for ${meta.rawName}`);
    }

    const matchedSuburbs = [];
    const seenNames = new Set();

    for (const sub of suburbs) {
      if (!bboxIntersects(lgaGeomObj.bbox, sub.bbox)) continue;
      const frac = overlapFraction(sub, lgaGeomObj);
      if (frac >= 0.04 && !seenNames.has(sub.cleanName)) {
        seenNames.add(sub.cleanName);
        matchedSuburbs.push(sub);
      }
    }

    matchedSuburbs.sort((a, b) => a.cleanName.localeCompare(b.cleanName));

    const aliases = {};
    const features = matchedSuburbs.map((sub) => {
      const subAliases = buildSuburbAliases(sub.cleanName);
      if (subAliases.length > 0) {
        aliases[sub.cleanName] = subAliases;
      }
      return {
        type: 'Feature',
        properties: {
          name: sub.cleanName,
          ...(sub.postcode ? { postcode: String(sub.postcode) } : {}),
        },
        geometry: sub.roundedGeometry,
      };
    });

    const fc = {
      type: 'FeatureCollection',
      features,
    };

    const outPath = path.join(outGeoDir, `${meta.slug}.geojson`);
    const jsonStr = JSON.stringify(fc);
    fs.writeFileSync(outPath, jsonStr, 'utf8');

    const [minX, minY, maxX, maxY] = lgaGeomObj.bbox;
    const centerLat = Number(((minY + maxY) / 2).toFixed(4));
    const centerLng = Number(((minX + maxX) / 2).toFixed(4));
    const span = Math.max(maxY - minY, maxX - minX);
    let defaultZoom = 10;
    if (span < 0.06) defaultZoom = 13;
    else if (span < 0.14) defaultZoom = 12;
    else if (span < 0.28) defaultZoom = 11;

    const quizConfig = {
      id: `syd-suburbs-${meta.slug}`,
      title: `Sydney Suburbs: ${meta.name} (${features.length})`,
      category: 'niche-subdivisions',
      format: 'map-polygon',
      countryOrRegion: 'Australia',
      geoJsonUrl: `/data/sydney-suburbs/${meta.slug}.geojson`,
      nameProperty: 'name',
      ...(Object.keys(aliases).length > 0 ? { aliases } : {}),
      defaultCenter: [centerLat, centerLng],
      defaultZoom,
      totalItems: features.length,
      tags: ['AUS', 'AU-NSW', 'sydney-suburbs', '3rd-level-divisions'],
    };

    quizzes.push(quizConfig);
    console.log(
      `Saved ${meta.slug}.geojson: ${features.length} suburbs (${(Buffer.byteLength(jsonStr) / 1024).toFixed(1)} KB)`
    );
  }

  const outQuizzesPath = path.resolve('src/data/sydneySuburbQuizzes.json');
  fs.writeFileSync(outQuizzesPath, JSON.stringify(quizzes, null, 2) + '\n', 'utf8');
  console.log(`Saved ${outQuizzesPath} with ${quizzes.length} Sydney LGA suburb quizzes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

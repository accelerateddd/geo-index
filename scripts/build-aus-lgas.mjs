import fs from 'node:fs';
import path from 'node:path';

const STATES = [
  {
    slug: 'nsw',
    code: 'NSW',
    stateCode2021: '1',
    name: 'New South Wales',
    defaultCenter: [-32.5, 147.0],
    defaultZoom: 6,
    maxOffset: 0.001,
  },
  {
    slug: 'vic',
    code: 'VIC',
    stateCode2021: '2',
    name: 'Victoria',
    defaultCenter: [-37.0, 144.5],
    defaultZoom: 6,
    maxOffset: 0.0008,
  },
  {
    slug: 'qld',
    code: 'QLD',
    stateCode2021: '3',
    name: 'Queensland',
    defaultCenter: [-21.5, 145.5],
    defaultZoom: 5,
    maxOffset: 0.0015,
  },
  {
    slug: 'wa',
    code: 'WA',
    stateCode2021: '5',
    name: 'Western Australia',
    defaultCenter: [-26.0, 121.0],
    defaultZoom: 5,
    maxOffset: 0.0015,
  },
  {
    slug: 'sa',
    code: 'SA',
    stateCode2021: '4',
    name: 'South Australia',
    defaultCenter: [-32.0, 136.5],
    defaultZoom: 6,
    maxOffset: 0.001,
  },
  {
    slug: 'tas',
    code: 'TAS',
    stateCode2021: '6',
    name: 'Tasmania',
    defaultCenter: [-42.0, 146.5],
    defaultZoom: 7,
    maxOffset: 0.0008,
  },
  {
    slug: 'nt',
    code: 'NT',
    stateCode2021: '7',
    name: 'Northern Territory',
    defaultCenter: [-19.5, 133.5],
    defaultZoom: 5,
    maxOffset: 0.0015,
  },
];

const EXTRA_ALIASES = {
  // NSW
  'Canterbury-Bankstown': ['Canterbury Bankstown', 'Bankstown', 'Canterbury'],
  'Ku-ring-gai': ['Kuringgai', 'Ku ring gai'],
  'The Hills': ['Hills', 'Hills Shire', 'The Hills Shire'],
  'Sutherland': ['Sutherland Shire', 'The Shire'],
  'Mid-Coast': ['Mid Coast', 'MidCoast'],
  'Mid-Western': ['Mid Western', 'Mid-Western Regional', 'Mudgee'],
  'Port Macquarie-Hastings': ['Port Macquarie Hastings', 'Port Macquarie', 'Hastings'],
  'Cootamundra-Gundagai': ['Cootamundra Gundagai', 'Cootamundra', 'Gundagai'],
  'Queanbeyan-Palerang': ['Queanbeyan Palerang', 'Queanbeyan'],
  'Armidale': ['Armidale Regional'],
  'Bathurst': ['Bathurst Regional'],
  'Dubbo': ['Dubbo Regional'],
  'Tamworth': ['Tamworth Regional'],
  'Snowy Monaro': ['Snowy Monaro Regional', 'Cooma'],
  'Glen Innes Severn': ['Glen Innes'],
  'Goulburn Mulwaree': ['Goulburn'],
  'Greater Hume': ['Greater Hume Shire'],
  'Upper Lachlan': ['Upper Lachlan Shire'],
  'Wagga Wagga': ['Wagga'],
  // VIC
  'Merri-bek': ['Merribek', 'Merri bek', 'Moreland'],
  'Greater Bendigo': ['Bendigo'],
  'Greater Dandenong': ['Dandenong'],
  'Greater Geelong': ['Geelong'],
  'Greater Shepparton': ['Shepparton'],
  'Colac Otway': ['Colac-Otway', 'Colac'],
  'Mornington Peninsula': ['Mornington'],
  // QLD
  'Moreton Bay': ['City of Moreton Bay'],
  'Sunshine Coast': ['Sunshine Coast Region'],
  'Gold Coast': ['City of Gold Coast'],
  'Fraser Coast': ['Hervey Bay', 'Maryborough'],
  'Cassowary Coast': ['Innisfail', 'Tully'],
  'Lockyer Valley': ['Gatton'],
  'Scenic Rim': ['Beaudesert'],
  'Southern Downs': ['Warwick', 'Stanthorpe'],
  'Western Downs': ['Dalby', 'Chinchilla'],
  'Whitsunday': ['Whitsundays', 'Bowen', 'Airlie Beach'],
  'North Burnett': ['Gayndah'],
  'South Burnett': ['Kingaroy'],
  'Tablelands': ['Atherton'],
  'Torres Strait Island': ['Torres Strait Islands'],
  // WA
  'Augusta Margaret River': ['Augusta-Margaret River', 'Margaret River'],
  'Bridgetown-Greenbushes': ['Bridgetown Greenbushes', 'Bridgetown'],
  'Broomehill-Tambellup': ['Broomehill Tambellup', 'Broomehill', 'Tambellup'],
  'Derby-West Kimberley': ['Derby West Kimberley', 'Derby', 'West Kimberley'],
  'Donnybrook-Balingup': ['Donnybrook Balingup', 'Donnybrook'],
  'Greater Geraldton': ['Geraldton'],
  'Kalgoorlie-Boulder': ['Kalgoorlie Boulder', 'Kalgoorlie'],
  'Serpentine-Jarrahdale': ['Serpentine Jarrahdale', 'Serpentine'],
  'Wongan-Ballidu': ['Wongan Ballidu', 'Wongan Hills'],
  'Wyndham-East Kimberley': ['Wyndham East Kimberley', 'Wyndham', 'East Kimberley', 'Kununurra'],
  // SA
  'Anangu Pitjantjatjara Yankunytjatjara': ['APY', 'APY Lands', 'Anangu Pitjantjatjara'],
  'Berri Barmera': ['Berri-Barmera', 'Berri'],
  'Clare and Gilbert Valleys': ['Clare & Gilbert Valleys', 'Clare Valley', 'Clare'],
  'Karoonda East Murray': ['Karoonda'],
  'Loxton Waikerie': ['Loxton-Waikerie', 'Loxton', 'Waikerie'],
  'Naracoorte Lucindale': ['Naracoorte-Lucindale', 'Naracoorte'],
  'Norwood Payneham and St Peters': ['Norwood Payneham & St Peters', 'Norwood'],
  'Orroroo Carrieton': ['Orroroo-Carrieton', 'Orroroo'],
  'Port Adelaide Enfield': ['Port Adelaide-Enfield', 'Port Adelaide'],
  'Port Pirie': ['Port Pirie Regional'],
  'Renmark Paringa': ['Renmark-Paringa', 'Renmark'],
  'Victor Harbor': ['Victor Harbour'],
  'Adelaide Plains': ['Mallala'],
  // TAS
  "Break O'Day": ['Break O Day', 'Break ODay'],
  'Glamorgan-Spring Bay': ['Glamorgan Spring Bay', 'Spring Bay'],
  'Waratah-Wynyard': ['Waratah Wynyard', 'Wynyard'],
  // NT
  'Darwin Waterfront Precinct': ['Darwin Waterfront'],
  'Groote Archipelago': ['Groote Eylandt'],
  'MacDonnell': ['MacDonnell Region'],
  'Victoria Daly': ['Victoria-Daly'],
};

function cleanLgaName(rawName) {
  return rawName.replace(/\s*\([^)]+\)\s*$/, '').trim();
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
  if (out.length >= 3 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}

function simplifyGeometry(geom, rawGeomFallback) {
  const cleanPoly = (coords) => {
    const rings = [];
    for (let i = 0; i < coords.length; i++) {
      const r = roundRing(coords[i]);
      if (r.length >= 4) rings.push(r);
    }
    return rings;
  };

  let res = null;
  if (geom.type === 'Polygon') {
    const rings = cleanPoly(geom.coordinates);
    if (rings.length > 0) res = { type: 'Polygon', coordinates: rings };
  } else if (geom.type === 'MultiPolygon') {
    const polys = [];
    for (const poly of geom.coordinates) {
      const rings = cleanPoly(poly);
      if (rings.length > 0) polys.push(rings);
    }
    if (polys.length === 1) res = { type: 'Polygon', coordinates: polys[0] };
    else if (polys.length > 1) res = { type: 'MultiPolygon', coordinates: polys };
  }
  if (!res && rawGeomFallback) {
    return simplifyGeometry(rawGeomFallback, null);
  }
  return res;
}

async function main() {
  const outGeoDir = path.resolve('public/data/aus-lga');
  fs.mkdirSync(outGeoDir, { recursive: true });

  const quizzes = [];

  for (const st of STATES) {
    console.log(`Fetching LGAs for ${st.name} (${st.code})...`);
    const where = `STATE_CODE_2021='${st.stateCode2021}' AND AREA_ALBERS_SQKM > 0`;
    const url = `https://geo.abs.gov.au/arcgis/rest/services/ASGS2025/LGA/MapServer/0/query?where=${encodeURIComponent(where)}&outFields=LGA_CODE_2025,LGA_NAME_2025,STATE_CODE_2021,STATE_NAME_2021,AREA_ALBERS_SQKM&returnGeometry=true&maxAllowableOffset=${st.maxOffset}&outSR=4326&f=geojson`;

    const data = await fetch(url).then((r) => r.json());
    if (!data.features) {
      throw new Error(`Failed to fetch features for ${st.name}`);
    }

    const features = [];
    const stateAliases = {};

    for (const f of data.features) {
      const rawName = f.properties.LGA_NAME_2025 || '';
      if (/unincorp|no usual|migratory|offshore|shipping/i.test(rawName)) {
        continue;
      }

      const cleanName = cleanLgaName(rawName);
      const lgaCode = f.properties.LGA_CODE_2025;

      let geom = simplifyGeometry(f.geometry, null);
      if (!geom) {
        // Fetch un-offset geometry for tiny LGA (e.g. Darwin Waterfront Precinct)
        const fullUrl = `https://geo.abs.gov.au/arcgis/rest/services/ASGS2025/LGA/MapServer/0/query?where=${encodeURIComponent(`LGA_CODE_2025='${lgaCode}'`)}&outFields=LGA_CODE_2025&returnGeometry=true&outSR=4326&f=geojson`;
        const fullData = await fetch(fullUrl).then((r) => r.json());
        if (fullData.features?.[0]?.geometry) {
          geom = simplifyGeometry(fullData.features[0].geometry, null);
        }
      }

      if (!geom) {
        console.warn(`Warning: empty geometry for ${rawName} (${lgaCode})`);
        continue;
      }

      const aliasSet = new Set();
      if (rawName !== cleanName) {
        aliasSet.add(rawName);
        aliasSet.add(rawName.replace(/\./g, ''));
      }
      if (cleanName.includes('-')) {
        aliasSet.add(cleanName.replace(/-/g, ' '));
      }
      if (cleanName.includes("'")) {
        aliasSet.add(cleanName.replace(/'/g, ''));
      }
      aliasSet.add(`City of ${cleanName}`);
      aliasSet.add(`${cleanName} City`);
      aliasSet.add(`Shire of ${cleanName}`);
      aliasSet.add(`${cleanName} Shire`);
      aliasSet.add(`${cleanName} Council`);

      if (EXTRA_ALIASES[cleanName]) {
        for (const a of EXTRA_ALIASES[cleanName]) aliasSet.add(a);
      }

      aliasSet.delete(cleanName);
      if (aliasSet.size > 0) {
        stateAliases[cleanName] = Array.from(aliasSet);
      }

      features.push({
        type: 'Feature',
        properties: {
          name: cleanName,
          code: lgaCode,
          state: st.code,
        },
        geometry: geom,
      });
    }

    features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));

    const fc = {
      type: 'FeatureCollection',
      features,
    };

    const outPath = path.join(outGeoDir, `${st.slug}.geojson`);
    const jsonStr = JSON.stringify(fc);
    fs.writeFileSync(outPath, jsonStr, 'utf8');
    console.log(
      `Saved ${outPath}: ${features.length} LGAs (${(Buffer.byteLength(jsonStr) / 1024).toFixed(1)} KB)`
    );

    quizzes.push({
      id: `aus-lga-${st.slug}`,
      title: `${st.name}: Local Government Areas (${features.length})`,
      category: 'niche-subdivisions',
      format: 'map-polygon',
      countryOrRegion: 'Australia',
      geoJsonUrl: `/data/aus-lga/${st.slug}.geojson`,
      nameProperty: 'name',
      aliases: stateAliases,
      defaultCenter: st.defaultCenter,
      defaultZoom: st.defaultZoom,
      totalItems: features.length,
      tags: ['AUS', `AU-${st.code}`, '2nd-level-divisions', 'aus-lga'],
    });
  }

  const outQuizzesPath = path.resolve('src/data/ausLgaQuizzes.json');
  fs.writeFileSync(outQuizzesPath, JSON.stringify(quizzes, null, 2) + '\n', 'utf8');
  console.log(`Saved ${outQuizzesPath} with ${quizzes.length} quizzes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

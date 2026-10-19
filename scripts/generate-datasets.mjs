import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Helper: round coordinates to 4 decimal places to keep GeoJSON files fast and compact
function roundCoords(coords) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === 'number') {
    return [Number(coords[0].toFixed(4)), Number(coords[1].toFixed(4))];
  }
  return coords.map(roundCoords);
}

// Compute bounding box of a GeoJSON geometry or feature list
function getFeaturesBBox(features, ignoreDatelineWrap = false) {
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  function walk(c) {
    if (!Array.isArray(c) || c.length === 0) return;
    if (typeof c[0] === 'number') {
      const lon = c[0];
      const lat = c[1];
      if (ignoreDatelineWrap && lon > 0) return;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of c) walk(child);
  }
  for (const f of features) {
    if (f.geometry && f.geometry.coordinates) {
      walk(f.geometry.coordinates);
    }
  }
  return { minLon, maxLon, minLat, maxLat };
}

function estimateZoomFromBBox(bbox) {
  const latSpan = Math.max(0.5, bbox.maxLat - bbox.minLat);
  const lonSpan = Math.max(0.5, bbox.maxLon - bbox.minLon);
  const maxSpan = Math.max(latSpan, lonSpan * 0.85);
  if (maxSpan > 80) return 3;
  if (maxSpan > 35) return 4;
  if (maxSpan > 14) return 5;
  if (maxSpan > 5.5) return 6;
  if (maxSpan > 2.5) return 7;
  return 8;
}

// Strip diacritics for alias generation
function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ============================================================================
// TASK 1: USA County Quizzes by State
// ============================================================================
const US_STATES = [
  { fips: '01', code: 'al', name: 'Alabama' },
  { fips: '02', code: 'ak', name: 'Alaska', subLabel: 'Boroughs & Census Areas' },
  { fips: '04', code: 'az', name: 'Arizona' },
  { fips: '05', code: 'ar', name: 'Arkansas' },
  { fips: '06', code: 'ca', name: 'California' },
  { fips: '08', code: 'co', name: 'Colorado' },
  { fips: '09', code: 'ct', name: 'Connecticut' },
  { fips: '10', code: 'de', name: 'Delaware' },
  { fips: '12', code: 'fl', name: 'Florida' },
  { fips: '13', code: 'ga', name: 'Georgia' },
  { fips: '15', code: 'hi', name: 'Hawaii' },
  { fips: '16', code: 'id', name: 'Idaho' },
  { fips: '17', code: 'il', name: 'Illinois' },
  { fips: '18', code: 'in', name: 'Indiana' },
  { fips: '19', code: 'ia', name: 'Iowa' },
  { fips: '20', code: 'ks', name: 'Kansas' },
  { fips: '21', code: 'ky', name: 'Kentucky' },
  { fips: '22', code: 'la', name: 'Louisiana', subLabel: 'Parishes' },
  { fips: '23', code: 'me', name: 'Maine' },
  { fips: '24', code: 'md', name: 'Maryland' },
  { fips: '25', code: 'ma', name: 'Massachusetts' },
  { fips: '26', code: 'mi', name: 'Michigan' },
  { fips: '27', code: 'mn', name: 'Minnesota' },
  { fips: '28', code: 'ms', name: 'Mississippi' },
  { fips: '29', code: 'mo', name: 'Missouri' },
  { fips: '30', code: 'mt', name: 'Montana' },
  { fips: '31', code: 'ne', name: 'Nebraska' },
  { fips: '32', code: 'nv', name: 'Nevada' },
  { fips: '33', code: 'nh', name: 'New Hampshire' },
  { fips: '34', code: 'nj', name: 'New Jersey' },
  { fips: '35', code: 'nm', name: 'New Mexico' },
  { fips: '36', code: 'ny', name: 'New York' },
  { fips: '37', code: 'nc', name: 'North Carolina' },
  { fips: '38', code: 'nd', name: 'North Dakota' },
  { fips: '39', code: 'oh', name: 'Ohio' },
  { fips: '40', code: 'ok', name: 'Oklahoma' },
  { fips: '41', code: 'or', name: 'Oregon' },
  { fips: '42', code: 'pa', name: 'Pennsylvania' },
  { fips: '44', code: 'ri', name: 'Rhode Island' },
  { fips: '45', code: 'sc', name: 'South Carolina' },
  { fips: '46', code: 'sd', name: 'South Dakota' },
  { fips: '47', code: 'tn', name: 'Tennessee' },
  { fips: '48', code: 'tx', name: 'Texas' },
  { fips: '49', code: 'ut', name: 'Utah' },
  { fips: '50', code: 'vt', name: 'Vermont' },
  { fips: '51', code: 'va', name: 'Virginia' },
  { fips: '53', code: 'wa', name: 'Washington' },
  { fips: '54', code: 'wv', name: 'West Virginia' },
  { fips: '55', code: 'wi', name: 'Wisconsin' },
  { fips: '56', code: 'wy', name: 'Wyoming' },
];

async function generateUsaCounties() {
  console.log('Fetching US counties GeoJSON from Plotly...');
  const res = await fetch('https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json');
  const buf = await res.arrayBuffer();
  const rawText = new TextDecoder('iso-8859-1').decode(buf);
  const countiesGeoJson = JSON.parse(rawText);

  const outDir = path.join(ROOT, 'public', 'data', 'usa-counties');
  ensureDir(outDir);

  const quizConfigs = [];

  for (const state of US_STATES) {
    const rawStateFeatures = countiesGeoJson.features.filter(
      (f) => f.properties && f.properties.STATE === state.fips
    );

    // Find any base NAME that appears more than once in the state (e.g., Baltimore County vs Baltimore city)
    const nameCounts = {};
    for (const f of rawStateFeatures) {
      const baseName = String(f.properties.NAME || '').trim();
      nameCounts[baseName] = (nameCounts[baseName] || 0) + 1;
    }

    const aliases = {};
    const cleanedFeatures = rawStateFeatures.map((f) => {
      let baseName = String(f.properties.NAME || '')
        .trim()
        .replace(/\s+(County|Parish|Borough|Census Area|Municipality|City and Borough)$/i, '');
      const lsad = String(f.properties.LSAD || '').trim();

      let canonicalName = baseName;
      if (nameCounts[baseName] > 1 && lsad.toLowerCase() === 'city') {
        canonicalName = `${baseName} City`;
      }

      const itemAliases = new Set();
      if (lsad) {
        itemAliases.add(`${baseName} ${lsad}`);
      }
      itemAliases.add(`${canonicalName} County`);
      if (state.code === 'la') itemAliases.add(`${canonicalName} Parish`);
      if (state.code === 'ak') {
        itemAliases.add(`${canonicalName} Borough`);
        itemAliases.add(`${canonicalName} Census Area`);
        itemAliases.add(`${canonicalName} Municipality`);
      }
      if (lsad.toLowerCase() === 'city') {
        itemAliases.add(`${baseName} City`);
        itemAliases.add(`City of ${baseName}`);
      }

      // St. / Ste. expansions
      if (/^St\.\s+/i.test(canonicalName)) {
        const rest = canonicalName.replace(/^St\.\s+/i, '');
        itemAliases.add(`Saint ${rest}`);
        itemAliases.add(`St ${rest}`);
        itemAliases.add(`Saint ${rest} County`);
        if (state.code === 'la') itemAliases.add(`Saint ${rest} Parish`);
      }
      if (/^Ste\.\s+/i.test(canonicalName)) {
        const rest = canonicalName.replace(/^Ste\.\s+/i, '');
        itemAliases.add(`Sainte ${rest}`);
        itemAliases.add(`Ste ${rest}`);
        itemAliases.add(`Saint ${rest}`);
      }

      // Diacritics / punctuation variants (e.g. Doña Ana, Prince George's, O'Brien, DeKalb)
      const ascii = stripDiacritics(canonicalName);
      if (ascii !== canonicalName) {
        itemAliases.add(ascii);
        itemAliases.add(`${ascii} County`);
      }
      if (canonicalName.includes("'")) {
        const noApostrophe = canonicalName.replace(/'/g, '');
        itemAliases.add(noApostrophe);
        itemAliases.add(`${noApostrophe} County`);
      }
      if (canonicalName.includes('-')) {
        const spaceJoined = canonicalName.replace(/-/g, ' ');
        itemAliases.add(spaceJoined);
        itemAliases.add(`${spaceJoined} County`);
      }

      itemAliases.delete(canonicalName);
      if (itemAliases.size > 0) {
        aliases[canonicalName] = Array.from(itemAliases);
      }

      return {
        type: 'Feature',
        properties: {
          name: canonicalName,
          fips: `${state.fips}${f.properties.COUNTY || ''}`,
          lsad: lsad || 'County',
        },
        geometry: {
          type: f.geometry.type,
          coordinates: roundCoords(f.geometry.coordinates),
        },
      };
    });

    cleanedFeatures.sort((a, b) => a.properties.name.localeCompare(b.properties.name));

    const stateFc = {
      type: 'FeatureCollection',
      features: cleanedFeatures,
    };

    const geoJsonFile = path.join(outDir, `${state.code}.geojson`);
    fs.writeFileSync(geoJsonFile, JSON.stringify(stateFc));

    let defaultCenter = [39.8, -98.6];
    let defaultZoom = 6;
    if (state.code === 'ak') {
      defaultCenter = [64.2, -152.5];
      defaultZoom = 4;
    } else if (state.code === 'hi') {
      defaultCenter = [20.6, -157.4];
      defaultZoom = 6;
    } else {
      const bbox = getFeaturesBBox(cleanedFeatures);
      defaultCenter = [
        Number(((bbox.minLat + bbox.maxLat) / 2).toFixed(4)),
        Number(((bbox.minLon + bbox.maxLon) / 2).toFixed(4)),
      ];
      defaultZoom = estimateZoomFromBBox(bbox);
    }

    const uniqueNames = new Set(cleanedFeatures.map((f) => f.properties.name));
    const count = uniqueNames.size;
    const subLabel = state.subLabel || 'Counties';

    quizConfigs.push({
      id: `usa-counties-${state.code}`,
      title: `USA (${state.name}): ${subLabel} (${count})`,
      category: 'niche-subdivisions',
      format: 'map-polygon',
      countryOrRegion: 'United States',
      geoJsonUrl: `/data/usa-counties/${state.code}.geojson`,
      nameProperty: 'name',
      aliases,
      defaultCenter,
      defaultZoom,
      totalItems: count,
      tags: ['USA', `US-${state.code.toUpperCase()}`, '2nd-level-divisions', 'usa-counties'],
    });
  }

  const outQuizFile = path.join(ROOT, 'src', 'data', 'usaCountyQuizzes.json');
  fs.writeFileSync(outQuizFile, JSON.stringify(quizConfigs, null, 2));
  console.log(`Generated ${quizConfigs.length} USA state county GeoJSONs and usaCountyQuizzes.json`);
}

// ============================================================================
// TASK 2: World Country Top Cities & World Capitals
// ============================================================================
// Authoritative list of 197 sovereign countries with ISO2, ISO3, Country Name, Aliases, and Capital
const SOVEREIGN_COUNTRIES = [
  // Oceania (14)
  { iso2: 'au', iso3: 'AUS', name: 'Australia', aliases: ['Commonwealth of Australia'], capital: 'Canberra', capLat: -35.2809, capLng: 149.13, capPop: 462000 },
  { iso2: 'nz', iso3: 'NZL', name: 'New Zealand', aliases: ['NZ', 'Aotearoa'], capital: 'Wellington', capLat: -41.2865, capLng: 174.7762, capPop: 418000 },
  { iso2: 'pg', iso3: 'PNG', name: 'Papua New Guinea', aliases: ['PNG'], capital: 'Port Moresby', capLat: -9.4438, capLng: 147.1803, capPop: 383000 },
  { iso2: 'fj', iso3: 'FJI', name: 'Fiji', aliases: ['Republic of Fiji'], capital: 'Suva', capLat: -18.1416, capLng: 178.4419, capPop: 185000 },
  { iso2: 'sb', iso3: 'SLB', name: 'Solomon Islands', aliases: [], capital: 'Honiara', capLat: -9.4333, capLng: 159.95, capPop: 92000 },
  { iso2: 'vu', iso3: 'VUT', name: 'Vanuatu', aliases: [], capital: 'Port Vila', capLat: -17.7333, capLng: 168.3167, capPop: 51000 },
  { iso2: 'ws', iso3: 'WSM', name: 'Samoa', aliases: ['Western Samoa'], capital: 'Apia', capLat: -13.8333, capLng: -171.7667, capPop: 37000 },
  { iso2: 'ki', iso3: 'KIR', name: 'Kiribati', aliases: [], capital: 'South Tarawa', capLat: 1.329, capLng: 172.979, capPop: 63000, capAliases: ['Tarawa', 'Bairiki'] },
  { iso2: 'to', iso3: 'TON', name: 'Tonga', aliases: [], capital: "Nuku'alofa", capLat: -21.1394, capLng: -175.2049, capPop: 28000, capAliases: ['Nukualofa'] },
  { iso2: 'fm', iso3: 'FSM', name: 'Micronesia', aliases: ['Federated States of Micronesia', 'FSM'], capital: 'Palikir', capLat: 6.9248, capLng: 158.1611, capPop: 7000 },
  { iso2: 'pw', iso3: 'PLW', name: 'Palau', aliases: ['Belau'], capital: 'Ngerulmud', capLat: 7.5004, capLng: 134.6243, capPop: 3000, capAliases: ['Koror'] },
  { iso2: 'mh', iso3: 'MHL', name: 'Marshall Islands', aliases: [], capital: 'Majuro', capLat: 7.0897, capLng: 171.3803, capPop: 28000 },
  { iso2: 'tv', iso3: 'TUV', name: 'Tuvalu', aliases: [], capital: 'Funafuti', capLat: -8.5211, capLng: 179.1962, capPop: 6300 },
  { iso2: 'nr', iso3: 'NRU', name: 'Nauru', aliases: [], capital: 'Yaren', capLat: -0.5477, capLng: 166.9209, capPop: 1100, capAliases: ['Yaren District'] },

  // Europe (46)
  { iso2: 'al', iso3: 'ALB', name: 'Albania', aliases: ['Shqiperia'], capital: 'Tirana', capLat: 41.3275, capLng: 19.8187, capPop: 557000, capAliases: ['Tiranë'] },
  { iso2: 'ad', iso3: 'AND', name: 'Andorra', aliases: [], capital: 'Andorra la Vella', capLat: 42.5063, capLng: 1.5218, capPop: 23000 },
  { iso2: 'at', iso3: 'AUT', name: 'Austria', aliases: ['Osterreich'], capital: 'Vienna', capLat: 48.2082, capLng: 16.3738, capPop: 1982000, capAliases: ['Wien'] },
  { iso2: 'by', iso3: 'BLR', name: 'Belarus', aliases: ['Byelorussia'], capital: 'Minsk', capLat: 53.9006, capLng: 27.559, capPop: 2009000 },
  { iso2: 'be', iso3: 'BEL', name: 'Belgium', aliases: ['Kingdom of Belgium'], capital: 'Brussels', capLat: 50.8503, capLng: 4.3517, capPop: 2110000, capAliases: ['Bruxelles', 'Brussel'] },
  { iso2: 'ba', iso3: 'BIH', name: 'Bosnia and Herzegovina', aliases: ['Bosnia', 'BiH'], capital: 'Sarajevo', capLat: 43.8563, capLng: 18.4131, capPop: 343000 },
  { iso2: 'bg', iso3: 'BGR', name: 'Bulgaria', aliases: [], capital: 'Sofia', capLat: 42.6977, capLng: 23.3219, capPop: 1280000 },
  { iso2: 'hr', iso3: 'HRV', name: 'Croatia', aliases: ['Hrvatska'], capital: 'Zagreb', capLat: 45.815, capLng: 15.9819, capPop: 767000 },
  { iso2: 'cy', iso3: 'CYP', name: 'Cyprus', aliases: [], capital: 'Nicosia', capLat: 35.1856, capLng: 33.3823, capPop: 330000, capAliases: ['Lefkosia'] },
  { iso2: 'cz', iso3: 'CZE', name: 'Czechia', aliases: ['Czech Republic'], capital: 'Prague', capLat: 50.0755, capLng: 14.4378, capPop: 1357000, capAliases: ['Praha'] },
  { iso2: 'dk', iso3: 'DNK', name: 'Denmark', aliases: [], capital: 'Copenhagen', capLat: 55.6761, capLng: 12.5683, capPop: 1366000, capAliases: ['Kobenhavn', 'København'] },
  { iso2: 'ee', iso3: 'EST', name: 'Estonia', aliases: ['Eesti'], capital: 'Tallinn', capLat: 59.437, capLng: 24.7536, capPop: 454000 },
  { iso2: 'fi', iso3: 'FIN', name: 'Finland', aliases: ['Suomi'], capital: 'Helsinki', capLat: 60.1699, capLng: 24.9384, capPop: 1328000 },
  { iso2: 'fr', iso3: 'FRA', name: 'France', aliases: ['French Republic'], capital: 'Paris', capLat: 48.8566, capLng: 2.3522, capPop: 11060000 },
  { iso2: 'de', iso3: 'DEU', name: 'Germany', aliases: ['Deutschland'], capital: 'Berlin', capLat: 52.52, capLng: 13.405, capPop: 3755000 },
  { iso2: 'gr', iso3: 'GRC', name: 'Greece', aliases: ['Hellas'], capital: 'Athens', capLat: 37.9838, capLng: 23.7275, capPop: 3153000, capAliases: ['Athina'] },
  { iso2: 'hu', iso3: 'HUN', name: 'Hungary', aliases: ['Magyarorszag'], capital: 'Budapest', capLat: 47.4979, capLng: 19.0402, capPop: 1771000 },
  { iso2: 'is', iso3: 'ISL', name: 'Iceland', aliases: [], capital: 'Reykjavik', capLat: 64.1466, capLng: -21.9426, capPop: 233000, capAliases: ['Reykjavík'] },
  { iso2: 'ie', iso3: 'IRL', name: 'Ireland', aliases: ['Republic of Ireland', 'Eire'], capital: 'Dublin', capLat: 53.3498, capLng: -6.2603, capPop: 1256000 },
  { iso2: 'it', iso3: 'ITA', name: 'Italy', aliases: ['Italia'], capital: 'Rome', capLat: 41.9028, capLng: 12.4964, capPop: 4316000, capAliases: ['Roma'] },
  { iso2: 'xk', iso3: 'KOS', name: 'Kosovo', aliases: ['Republic of Kosovo'], capital: 'Pristina', capLat: 42.6629, capLng: 21.1655, capPop: 210000, capAliases: ['Prishtina', 'Prishtinë'] },
  { iso2: 'lv', iso3: 'LVA', name: 'Latvia', aliases: ['Latvija'], capital: 'Riga', capLat: 56.9496, capLng: 24.1052, capPop: 614000, capAliases: ['Rīga'] },
  { iso2: 'li', iso3: 'LIE', name: 'Liechtenstein', aliases: [], capital: 'Vaduz', capLat: 47.141, capLng: 9.5209, capPop: 5800 },
  { iso2: 'lt', iso3: 'LTU', name: 'Lithuania', aliases: ['Lietuva'], capital: 'Vilnius', capLat: 54.6872, capLng: 25.2797, capPop: 592000 },
  { iso2: 'lu', iso3: 'LUX', name: 'Luxembourg', aliases: [], capital: 'Luxembourg City', capLat: 49.6116, capLng: 6.1319, capPop: 132000, capAliases: ['Luxembourg'] },
  { iso2: 'mt', iso3: 'MLT', name: 'Malta', aliases: [], capital: 'Valletta', capLat: 35.8989, capLng: 14.5146, capPop: 212000 },
  { iso2: 'md', iso3: 'MDA', name: 'Moldova', aliases: ['Republic of Moldova'], capital: 'Chisinau', capLat: 47.0105, capLng: 28.8638, capPop: 677000, capAliases: ['Chișinău', 'Kishinev'] },
  { iso2: 'mc', iso3: 'MCO', name: 'Monaco', aliases: [], capital: 'Monaco', capLat: 43.7384, capLng: 7.4246, capPop: 39000, capAliases: ['Monaco-Ville', 'Monte Carlo'] },
  { iso2: 'me', iso3: 'MNE', name: 'Montenegro', aliases: ['Crna Gora'], capital: 'Podgorica', capLat: 42.4304, capLng: 19.2594, capPop: 190000 },
  { iso2: 'nl', iso3: 'NLD', name: 'Netherlands', aliases: ['Holland', 'The Netherlands'], capital: 'Amsterdam', capLat: 52.3676, capLng: 4.9041, capPop: 1165000, capAliases: ['The Hague', 'Den Haag'] },
  { iso2: 'mk', iso3: 'MKD', name: 'North Macedonia', aliases: ['Macedonia'], capital: 'Skopje', capLat: 41.9981, capLng: 21.4254, capPop: 607000 },
  { iso2: 'no', iso3: 'NOR', name: 'Norway', aliases: ['Norge'], capital: 'Oslo', capLat: 59.9139, capLng: 10.7522, capPop: 1071000 },
  { iso2: 'pl', iso3: 'POL', name: 'Poland', aliases: ['Polska'], capital: 'Warsaw', capLat: 52.2297, capLng: 21.0122, capPop: 1860000, capAliases: ['Warszawa'] },
  { iso2: 'pt', iso3: 'PRT', name: 'Portugal', aliases: [], capital: 'Lisbon', capLat: 38.7223, capLng: -9.1393, capPop: 2989000, capAliases: ['Lisboa'] },
  { iso2: 'ro', iso3: 'ROU', name: 'Romania', aliases: [], capital: 'Bucharest', capLat: 44.4268, capLng: 26.1025, capPop: 1794000, capAliases: ['Bucuresti', 'București'] },
  { iso2: 'ru', iso3: 'RUS', name: 'Russia', aliases: ['Russian Federation'], capital: 'Moscow', capLat: 55.7558, capLng: 37.6173, capPop: 12640000, capAliases: ['Moskva'] },
  { iso2: 'sm', iso3: 'SMR', name: 'San Marino', aliases: [], capital: 'San Marino', capLat: 43.9356, capLng: 12.4473, capPop: 4100, capAliases: ['City of San Marino'] },
  { iso2: 'rs', iso3: 'SRB', name: 'Serbia', aliases: ['Srbija'], capital: 'Belgrade', capLat: 44.7866, capLng: 20.4489, capPop: 1405000, capAliases: ['Beograd'] },
  { iso2: 'sk', iso3: 'SVK', name: 'Slovakia', aliases: ['Slovak Republic'], capital: 'Bratislava', capLat: 48.1486, capLng: 17.1077, capPop: 475000 },
  { iso2: 'si', iso3: 'SVN', name: 'Slovenia', aliases: ['Slovenija'], capital: 'Ljubljana', capLat: 46.0569, capLng: 14.5058, capPop: 295000 },
  { iso2: 'es', iso3: 'ESP', name: 'Spain', aliases: ['Espana', 'España'], capital: 'Madrid', capLat: 40.4168, capLng: -3.7038, capPop: 6714000 },
  { iso2: 'se', iso3: 'SWE', name: 'Sweden', aliases: ['Sverige'], capital: 'Stockholm', capLat: 59.3293, capLng: 18.0686, capPop: 1679000 },
  { iso2: 'ch', iso3: 'CHE', name: 'Switzerland', aliases: ['Swiss Confederation'], capital: 'Bern', capLat: 46.948, capLng: 7.4474, capPop: 422000, capAliases: ['Berne'] },
  { iso2: 'ua', iso3: 'UKR', name: 'Ukraine', aliases: ['Ukraina'], capital: 'Kyiv', capLat: 50.4501, capLng: 30.5234, capPop: 2962000, capAliases: ['Kiev'] },
  { iso2: 'gb', iso3: 'GBR', name: 'United Kingdom', aliases: ['UK', 'Great Britain', 'Britain'], capital: 'London', capLat: 51.5074, capLng: -0.1278, capPop: 11262000 },
  { iso2: 'va', iso3: 'VAT', name: 'Vatican City', aliases: ['Vatican', 'Holy See'], capital: 'Vatican City', capLat: 41.9029, capLng: 12.4534, capPop: 825, capAliases: ['Vatican'] },

  // Asia (48)
  { iso2: 'af', iso3: 'AFG', name: 'Afghanistan', aliases: [], capital: 'Kabul', capLat: 34.5553, capLng: 69.2075, capPop: 4458000 },
  { iso2: 'am', iso3: 'ARM', name: 'Armenia', aliases: ['Hayastan'], capital: 'Yerevan', capLat: 40.1792, capLng: 44.4991, capPop: 1092000 },
  { iso2: 'az', iso3: 'AZE', name: 'Azerbaijan', aliases: [], capital: 'Baku', capLat: 40.4093, capLng: 49.8671, capPop: 2401000 },
  { iso2: 'bh', iso3: 'BHR', name: 'Bahrain', aliases: [], capital: 'Manama', capLat: 26.2285, capLng: 50.586, capPop: 689000 },
  { iso2: 'bd', iso3: 'BGD', name: 'Bangladesh', aliases: [], capital: 'Dhaka', capLat: 23.8103, capLng: 90.4125, capPop: 22478000, capAliases: ['Dacca'] },
  { iso2: 'bt', iso3: 'BTN', name: 'Bhutan', aliases: [], capital: 'Thimphu', capLat: 27.4728, capLng: 89.639, capPop: 115000 },
  { iso2: 'bn', iso3: 'BRN', name: 'Brunei', aliases: ['Brunei Darussalam'], capital: 'Bandar Seri Begawan', capLat: 4.9031, capLng: 114.9398, capPop: 280000, capAliases: ['BSB'] },
  { iso2: 'kh', iso3: 'KHM', name: 'Cambodia', aliases: ['Kampuchea'], capital: 'Phnom Penh', capLat: 11.5564, capLng: 104.9282, capPop: 2216000 },
  { iso2: 'cn', iso3: 'CHN', name: 'China', aliases: ['PRC', "People's Republic of China"], capital: 'Beijing', capLat: 39.9042, capLng: 116.4074, capPop: 21542000, capAliases: ['Peking'] },
  { iso2: 'ge', iso3: 'GEO', name: 'Georgia', aliases: ['Sakartvelo'], capital: 'Tbilisi', capLat: 41.7151, capLng: 44.8271, capPop: 1202000 },
  { iso2: 'in', iso3: 'IND', name: 'India', aliases: ['Republic of India', 'Bharat'], capital: 'New Delhi', capLat: 28.6139, capLng: 77.209, capPop: 32066000, capAliases: ['Delhi'] },
  { iso2: 'id', iso3: 'IDN', name: 'Indonesia', aliases: ['Republic of Indonesia'], capital: 'Jakarta', capLat: -6.2088, capLng: 106.8456, capPop: 11075000 },
  { iso2: 'ir', iso3: 'IRN', name: 'Iran', aliases: ['Persia', 'Islamic Republic of Iran'], capital: 'Tehran', capLat: 35.6892, capLng: 51.389, capPop: 9382000 },
  { iso2: 'iq', iso3: 'IRQ', name: 'Iraq', aliases: [], capital: 'Baghdad', capLat: 33.3152, capLng: 44.3661, capPop: 7512000 },
  { iso2: 'il', iso3: 'ISR', name: 'Israel', aliases: ['State of Israel'], capital: 'Jerusalem', capLat: 31.7683, capLng: 35.2137, capPop: 971000 },
  { iso2: 'jp', iso3: 'JPN', name: 'Japan', aliases: ['Nippon'], capital: 'Tokyo', capLat: 35.6762, capLng: 139.6503, capPop: 37274000 },
  { iso2: 'jo', iso3: 'JOR', name: 'Jordan', aliases: [], capital: 'Amman', capLat: 31.9454, capLng: 35.9284, capPop: 4061000 },
  { iso2: 'kz', iso3: 'KAZ', name: 'Kazakhstan', aliases: [], capital: 'Astana', capLat: 51.1694, capLng: 71.4491, capPop: 1350000, capAliases: ['Nur-Sultan', 'Aqmola'] },
  { iso2: 'kw', iso3: 'KWT', name: 'Kuwait', aliases: [], capital: 'Kuwait City', capLat: 29.3759, capLng: 47.9774, capPop: 3239000, capAliases: ['Kuwait'] },
  { iso2: 'kg', iso3: 'KGZ', name: 'Kyrgyzstan', aliases: ['Kyrgyz Republic'], capital: 'Bishkek', capLat: 42.8746, capLng: 74.5698, capPop: 1088000 },
  { iso2: 'la', iso3: 'LAO', name: 'Laos', aliases: ['Lao PDR'], capital: 'Vientiane', capLat: 17.9757, capLng: 102.6331, capPop: 948000 },
  { iso2: 'lb', iso3: 'LBN', name: 'Lebanon', aliases: [], capital: 'Beirut', capLat: 33.8938, capLng: 35.5018, capPop: 2421000 },
  { iso2: 'my', iso3: 'MYS', name: 'Malaysia', aliases: [], capital: 'Kuala Lumpur', capLat: 3.139, capLng: 101.6869, capPop: 8420000, capAliases: ['KL', 'Putrajaya'] },
  { iso2: 'mv', iso3: 'MDV', name: 'Maldives', aliases: [], capital: 'Malé', capLat: 4.1755, capLng: 73.5093, capPop: 212000, capAliases: ['Male'] },
  { iso2: 'mn', iso3: 'MNG', name: 'Mongolia', aliases: [], capital: 'Ulaanbaatar', capLat: 47.8864, capLng: 106.9057, capPop: 1645000, capAliases: ['Ulan Bator'] },
  { iso2: 'mm', iso3: 'MMR', name: 'Myanmar', aliases: ['Burma'], capital: 'Naypyidaw', capLat: 19.7633, capLng: 96.0785, capPop: 1160000, capAliases: ['Nay Pyi Taw'] },
  { iso2: 'np', iso3: 'NPL', name: 'Nepal', aliases: [], capital: 'Kathmandu', capLat: 27.7172, capLng: 85.324, capPop: 1521000 },
  { iso2: 'kp', iso3: 'PRK', name: 'North Korea', aliases: ['DPRK'], capital: 'Pyongyang', capLat: 39.0392, capLng: 125.7625, capPop: 3133000 },
  { iso2: 'om', iso3: 'OMN', name: 'Oman', aliases: [], capital: 'Muscat', capLat: 23.588, capLng: 58.3829, capPop: 1623000 },
  { iso2: 'pk', iso3: 'PAK', name: 'Pakistan', aliases: [], capital: 'Islamabad', capLat: 33.6844, capLng: 73.0479, capPop: 1198000 },
  { iso2: 'ps', iso3: 'PSE', name: 'Palestine', aliases: ['State of Palestine'], capital: 'Ramallah', capLat: 31.9038, capLng: 35.2034, capPop: 389000, capAliases: ['East Jerusalem', 'Al-Quds'] },
  { iso2: 'ph', iso3: 'PHL', name: 'Philippines', aliases: ['The Philippines'], capital: 'Manila', capLat: 14.5995, capLng: 120.9842, capPop: 14406000 },
  { iso2: 'qa', iso3: 'QAT', name: 'Qatar', aliases: [], capital: 'Doha', capLat: 25.2854, capLng: 51.531, capPop: 2382000 },
  { iso2: 'sa', iso3: 'SAU', name: 'Saudi Arabia', aliases: ['KSA', 'Kingdom of Saudi Arabia'], capital: 'Riyadh', capLat: 24.7136, capLng: 46.6753, capPop: 7538000 },
  { iso2: 'sg', iso3: 'SGP', name: 'Singapore', aliases: [], capital: 'Singapore', capLat: 1.3521, capLng: 103.8198, capPop: 5917000 },
  { iso2: 'kr', iso3: 'KOR', name: 'South Korea', aliases: ['ROK', 'Korea', 'Republic of Korea'], capital: 'Seoul', capLat: 37.5665, capLng: 126.978, capPop: 9976000 },
  { iso2: 'lk', iso3: 'LKA', name: 'Sri Lanka', aliases: ['Ceylon'], capital: 'Colombo', capLat: 6.9271, capLng: 79.8612, capPop: 2190000, capAliases: ['Sri Jayawardenepura Kotte', 'Kotte'] },
  { iso2: 'sy', iso3: 'SYR', name: 'Syria', aliases: ['Syrian Arab Republic'], capital: 'Damascus', capLat: 33.5138, capLng: 36.2765, capPop: 2503000 },
  { iso2: 'tw', iso3: 'TWN', name: 'Taiwan', aliases: ['ROC', 'Republic of China'], capital: 'Taipei', capLat: 25.033, capLng: 121.5654, capPop: 2706000 },
  { iso2: 'tj', iso3: 'TJK', name: 'Tajikistan', aliases: [], capital: 'Dushanbe', capLat: 38.5598, capLng: 68.787, capPop: 987000 },
  { iso2: 'th', iso3: 'THA', name: 'Thailand', aliases: ['Siam'], capital: 'Bangkok', capLat: 13.7563, capLng: 100.5018, capPop: 10899000, capAliases: ['Krung Thep'] },
  { iso2: 'tl', iso3: 'TLS', name: 'Timor-Leste', aliases: ['East Timor'], capital: 'Dili', capLat: -8.5569, capLng: 125.5603, capPop: 281000 },
  { iso2: 'tr', iso3: 'TUR', name: 'Turkey', aliases: ['Turkiye', 'Türkiye'], capital: 'Ankara', capLat: 39.9334, capLng: 32.8597, capPop: 5309000 },
  { iso2: 'tm', iso3: 'TKM', name: 'Turkmenistan', aliases: [], capital: 'Ashgabat', capLat: 37.9601, capLng: 58.3261, capPop: 904000 },
  { iso2: 'ae', iso3: 'ARE', name: 'United Arab Emirates', aliases: ['UAE', 'Emirates'], capital: 'Abu Dhabi', capLat: 24.4539, capLng: 54.3773, capPop: 1540000 },
  { iso2: 'uz', iso3: 'UZB', name: 'Uzbekistan', aliases: [], capital: 'Tashkent', capLat: 41.2995, capLng: 69.2401, capPop: 2956000 },
  { iso2: 'vn', iso3: 'VNM', name: 'Vietnam', aliases: ['Viet Nam'], capital: 'Hanoi', capLat: 21.0285, capLng: 105.8542, capPop: 5253000, capAliases: ['Ha Noi'] },
  { iso2: 'ye', iso3: 'YEM', name: 'Yemen', aliases: [], capital: "Sana'a", capLat: 15.3694, capLng: 44.191, capPop: 3182000, capAliases: ['Sanaa'] },

  // Africa (54)
  { iso2: 'dz', iso3: 'DZA', name: 'Algeria', aliases: [], capital: 'Algiers', capLat: 36.7538, capLng: 3.0588, capPop: 2854000, capAliases: ['Alger'] },
  { iso2: 'ao', iso3: 'AGO', name: 'Angola', aliases: [], capital: 'Luanda', capLat: -8.839, capLng: 13.2894, capPop: 8952000 },
  { iso2: 'bj', iso3: 'BEN', name: 'Benin', aliases: [], capital: 'Porto-Novo', capLat: 6.4969, capLng: 2.6289, capPop: 294000, capAliases: ['Porto Novo', 'Cotonou'] },
  { iso2: 'bw', iso3: 'BWA', name: 'Botswana', aliases: [], capital: 'Gaborone', capLat: -24.6282, capLng: 25.9231, capPop: 289000 },
  { iso2: 'bf', iso3: 'BFA', name: 'Burkina Faso', aliases: [], capital: 'Ouagadougou', capLat: 12.3714, capLng: -1.5197, capPop: 3056000 },
  { iso2: 'bi', iso3: 'BDI', name: 'Burundi', aliases: [], capital: 'Gitega', capLat: -3.4271, capLng: 29.9246, capPop: 135000, capAliases: ['Bujumbura'] },
  { iso2: 'cv', iso3: 'CPV', name: 'Cabo Verde', aliases: ['Cape Verde'], capital: 'Praia', capLat: 14.933, capLng: -23.5133, capPop: 168000 },
  { iso2: 'cm', iso3: 'CMR', name: 'Cameroon', aliases: [], capital: 'Yaoundé', capLat: 3.848, capLng: 11.5021, capPop: 4337000, capAliases: ['Yaounde'] },
  { iso2: 'cf', iso3: 'CAF', name: 'Central African Republic', aliases: ['CAR'], capital: 'Bangui', capLat: 4.3947, capLng: 18.5582, capPop: 933000 },
  { iso2: 'td', iso3: 'TCD', name: 'Chad', aliases: ['Tchad'], capital: "N'Djamena", capLat: 12.1348, capLng: 15.0557, capPop: 1533000, capAliases: ['Ndjamena'] },
  { iso2: 'km', iso3: 'COM', name: 'Comoros', aliases: [], capital: 'Moroni', capLat: -11.7172, capLng: 43.2473, capPop: 85000 },
  { iso2: 'cd', iso3: 'COD', name: 'Democratic Republic of the Congo', aliases: ['DRC', 'DR Congo', 'Congo-Kinshasa'], capital: 'Kinshasa', capLat: -4.4419, capLng: 15.2663, capPop: 15628000 },
  { iso2: 'cg', iso3: 'COG', name: 'Republic of the Congo', aliases: ['Congo', 'Congo-Brazzaville'], capital: 'Brazzaville', capLat: -4.2634, capLng: 15.2429, capPop: 2553000 },
  { iso2: 'ci', iso3: 'CIV', name: 'Ivory Coast', aliases: ["Cote d'Ivoire", "Côte d'Ivoire"], capital: 'Yamoussoukro', capLat: 6.8276, capLng: -5.2893, capPop: 372000, capAliases: ['Abidjan'] },
  { iso2: 'dj', iso3: 'DJI', name: 'Djibouti', aliases: [], capital: 'Djibouti', capLat: 11.5721, capLng: 43.1456, capPop: 604000, capAliases: ['Djibouti City'] },
  { iso2: 'eg', iso3: 'EGY', name: 'Egypt', aliases: ['Arab Republic of Egypt'], capital: 'Cairo', capLat: 30.0444, capLng: 31.2357, capPop: 21750000, capAliases: ['Al-Qahirah'] },
  { iso2: 'gq', iso3: 'GNQ', name: 'Equatorial Guinea', aliases: [], capital: 'Malabo', capLat: 3.7504, capLng: 8.7371, capPop: 297000, capAliases: ['Ciudad de la Paz'] },
  { iso2: 'er', iso3: 'ERI', name: 'Eritrea', aliases: [], capital: 'Asmara', capLat: 15.3229, capLng: 38.9251, capPop: 1035000 },
  { iso2: 'sz', iso3: 'SWZ', name: 'Eswatini', aliases: ['Swaziland'], capital: 'Mbabane', capLat: -26.3054, capLng: 31.1367, capPop: 95000, capAliases: ['Lobamba'] },
  { iso2: 'et', iso3: 'ETH', name: 'Ethiopia', aliases: [], capital: 'Addis Ababa', capLat: 9.032, capLng: 38.7469, capPop: 5228000 },
  { iso2: 'ga', iso3: 'GAB', name: 'Gabon', aliases: [], capital: 'Libreville', capLat: 0.4162, capLng: 9.4673, capPop: 857000 },
  { iso2: 'gm', iso3: 'GMB', name: 'Gambia', aliases: ['The Gambia'], capital: 'Banjul', capLat: 13.4549, capLng: -16.579, capPop: 467000 },
  { iso2: 'gh', iso3: 'GHA', name: 'Ghana', aliases: [], capital: 'Accra', capLat: 5.6037, capLng: -0.187, capPop: 2605000 },
  { iso2: 'gn', iso3: 'GIN', name: 'Guinea', aliases: ['Guinea-Conakry'], capital: 'Conakry', capLat: 9.6412, capLng: -13.5784, capPop: 2049000 },
  { iso2: 'gw', iso3: 'GNB', name: 'Guinea-Bissau', aliases: [], capital: 'Bissau', capLat: 11.8817, capLng: -15.6178, capPop: 642000 },
  { iso2: 'ke', iso3: 'KEN', name: 'Kenya', aliases: [], capital: 'Nairobi', capLat: -1.2921, capLng: 36.8219, capPop: 5119000 },
  { iso2: 'ls', iso3: 'LSO', name: 'Lesotho', aliases: [], capital: 'Maseru', capLat: -29.3151, capLng: 27.4869, capPop: 343000 },
  { iso2: 'lr', iso3: 'LBR', name: 'Liberia', aliases: [], capital: 'Monrovia', capLat: 6.3156, capLng: -10.8074, capPop: 1623000 },
  { iso2: 'ly', iso3: 'LBY', name: 'Libya', aliases: [], capital: 'Tripoli', capLat: 32.8872, capLng: 13.1913, capPop: 1176000 },
  { iso2: 'mg', iso3: 'MDG', name: 'Madagascar', aliases: [], capital: 'Antananarivo', capLat: -18.8792, capLng: 47.5079, capPop: 3699000 },
  { iso2: 'mw', iso3: 'MWI', name: 'Malawi', aliases: [], capital: 'Lilongwe', capLat: -13.9626, capLng: 33.7741, capPop: 1222000 },
  { iso2: 'ml', iso3: 'MLI', name: 'Mali', aliases: [], capital: 'Bamako', capLat: 12.6392, capLng: -8.0029, capPop: 2817000 },
  { iso2: 'mr', iso3: 'MRT', name: 'Mauritania', aliases: [], capital: 'Nouakchott', capLat: 18.0735, capLng: -15.9582, capPop: 1432000 },
  { iso2: 'mu', iso3: 'MUS', name: 'Mauritius', aliases: [], capital: 'Port Louis', capLat: -20.1609, capLng: 57.5012, capPop: 149000 },
  { iso2: 'ma', iso3: 'MAR', name: 'Morocco', aliases: ['Kingdom of Morocco'], capital: 'Rabat', capLat: 34.0209, capLng: -6.8416, capPop: 1932000 },
  { iso2: 'mz', iso3: 'MOZ', name: 'Mozambique', aliases: [], capital: 'Maputo', capLat: -25.9692, capLng: 32.5732, capPop: 1139000 },
  { iso2: 'na', iso3: 'NAM', name: 'Namibia', aliases: [], capital: 'Windhoek', capLat: -22.5609, capLng: 17.0658, capPop: 461000 },
  { iso2: 'ne', iso3: 'NER', name: 'Niger', aliases: [], capital: 'Niamey', capLat: 13.5116, capLng: 2.1254, capPop: 1384000 },
  { iso2: 'ng', iso3: 'NGA', name: 'Nigeria', aliases: [], capital: 'Abuja', capLat: 9.0765, capLng: 7.3986, capPop: 3652000 },
  { iso2: 'rw', iso3: 'RWA', name: 'Rwanda', aliases: [], capital: 'Kigali', capLat: -1.9441, capLng: 30.0619, capPop: 1208000 },
  { iso2: 'st', iso3: 'STP', name: 'Sao Tome and Principe', aliases: ['São Tomé and Príncipe'], capital: 'São Tomé', capLat: 0.3365, capLng: 6.7273, capPop: 89000, capAliases: ['Sao Tome'] },
  { iso2: 'sn', iso3: 'SEN', name: 'Senegal', aliases: [], capital: 'Dakar', capLat: 14.7167, capLng: -17.4677, capPop: 3326000 },
  { iso2: 'sc', iso3: 'SYC', name: 'Seychelles', aliases: [], capital: 'Victoria', capLat: -4.6191, capLng: 55.4513, capPop: 29000 },
  { iso2: 'sl', iso3: 'SLE', name: 'Sierra Leone', aliases: [], capital: 'Freetown', capLat: 8.4657, capLng: -13.2317, capPop: 1272000 },
  { iso2: 'so', iso3: 'SOM', name: 'Somalia', aliases: [], capital: 'Mogadishu', capLat: 2.0469, capLng: 45.3182, capPop: 2497000 },
  { iso2: 'za', iso3: 'ZAF', name: 'South Africa', aliases: ['RSA', 'Republic of South Africa'], capital: 'Pretoria', capLat: -25.7479, capLng: 28.2293, capPop: 2739000, capAliases: ['Cape Town', 'Bloemfontein'] },
  { iso2: 'ss', iso3: 'SSD', name: 'South Sudan', aliases: [], capital: 'Juba', capLat: 4.8594, capLng: 31.5713, capPop: 440000 },
  { iso2: 'sd', iso3: 'SDN', name: 'Sudan', aliases: [], capital: 'Khartoum', capLat: 15.5007, capLng: 32.5599, capPop: 6160000 },
  { iso2: 'tz', iso3: 'TZA', name: 'Tanzania', aliases: ['United Republic of Tanzania'], capital: 'Dodoma', capLat: -6.163, capLng: 35.7516, capPop: 326000, capAliases: ['Dar es Salaam'] },
  { iso2: 'tg', iso3: 'TGO', name: 'Togo', aliases: [], capital: 'Lomé', capLat: 6.1375, capLng: 1.2123, capPop: 1926000, capAliases: ['Lome'] },
  { iso2: 'tn', iso3: 'TUN', name: 'Tunisia', aliases: [], capital: 'Tunis', capLat: 36.8065, capLng: 10.1815, capPop: 2439000 },
  { iso2: 'ug', iso3: 'UGA', name: 'Uganda', aliases: [], capital: 'Kampala', capLat: 0.3476, capLng: 32.5825, capPop: 3652000 },
  { iso2: 'zm', iso3: 'ZMB', name: 'Zambia', aliases: [], capital: 'Lusaka', capLat: -15.3875, capLng: 28.3228, capPop: 3042000 },
  { iso2: 'zw', iso3: 'ZWE', name: 'Zimbabwe', aliases: [], capital: 'Harare', capLat: -17.8252, capLng: 31.0335, capPop: 1558000 },

  // Americas (35)
  { iso2: 'ag', iso3: 'ATG', name: 'Antigua and Barbuda', aliases: ['Antigua'], capital: "St. John's", capLat: 17.1175, capLng: -61.8456, capPop: 24000, capAliases: ['Saint Johns', 'St Johns'] },
  { iso2: 'ar', iso3: 'ARG', name: 'Argentina', aliases: ['Argentine Republic'], capital: 'Buenos Aires', capLat: -34.6037, capLng: -58.3816, capPop: 15370000 },
  { iso2: 'bs', iso3: 'BHS', name: 'Bahamas', aliases: ['The Bahamas'], capital: 'Nassau', capLat: 25.0443, capLng: -77.3504, capPop: 280000 },
  { iso2: 'bb', iso3: 'BRB', name: 'Barbados', aliases: [], capital: 'Bridgetown', capLat: 13.1132, capLng: -59.5988, capPop: 110000 },
  { iso2: 'bz', iso3: 'BLZ', name: 'Belize', aliases: [], capital: 'Belmopan', capLat: 17.251, capLng: -88.759, capPop: 25000 },
  { iso2: 'bo', iso3: 'BOL', name: 'Bolivia', aliases: ['Plurinational State of Bolivia'], capital: 'La Paz', capLat: -16.4897, capLng: -68.1193, capPop: 1920000, capAliases: ['Sucre'] },
  { iso2: 'br', iso3: 'BRA', name: 'Brazil', aliases: ['Brasil', 'Federative Republic of Brazil'], capital: 'Brasília', capLat: -15.7975, capLng: -47.8919, capPop: 4804000, capAliases: ['Brasilia'] },
  { iso2: 'ca', iso3: 'CAN', name: 'Canada', aliases: [], capital: 'Ottawa', capLat: 45.4215, capLng: -75.6972, capPop: 1423000 },
  { iso2: 'cl', iso3: 'CHL', name: 'Chile', aliases: [], capital: 'Santiago', capLat: -33.4489, capLng: -70.6693, capPop: 6857000 },
  { iso2: 'co', iso3: 'COL', name: 'Colombia', aliases: [], capital: 'Bogotá', capLat: 4.711, capLng: -74.0721, capPop: 11344000, capAliases: ['Bogota'] },
  { iso2: 'cr', iso3: 'CRI', name: 'Costa Rica', aliases: [], capital: 'San José', capLat: 9.9281, capLng: -84.0907, capPop: 1441000, capAliases: ['San Jose'] },
  { iso2: 'cu', iso3: 'CUB', name: 'Cuba', aliases: [], capital: 'Havana', capLat: 23.1136, capLng: -82.3666, capPop: 2147000, capAliases: ['La Habana'] },
  { iso2: 'dm', iso3: 'DMA', name: 'Dominica', aliases: [], capital: 'Roseau', capLat: 15.3092, capLng: -61.3794, capPop: 16000 },
  { iso2: 'do', iso3: 'DOM', name: 'Dominican Republic', aliases: ['DR'], capital: 'Santo Domingo', capLat: 18.4861, capLng: -69.9312, capPop: 3458000 },
  { iso2: 'ec', iso3: 'ECU', name: 'Ecuador', aliases: [], capital: 'Quito', capLat: -0.1807, capLng: -78.4678, capPop: 2952000 },
  { iso2: 'sv', iso3: 'SLV', name: 'El Salvador', aliases: [], capital: 'San Salvador', capLat: 13.6929, capLng: -89.2182, capPop: 1111000 },
  { iso2: 'gd', iso3: 'GRD', name: 'Grenada', aliases: [], capital: "St. George's", capLat: 12.0561, capLng: -61.7488, capPop: 39000, capAliases: ['Saint Georges', 'St Georges'] },
  { iso2: 'gt', iso3: 'GTM', name: 'Guatemala', aliases: [], capital: 'Guatemala City', capLat: 14.6349, capLng: -90.5069, capPop: 3014000, capAliases: ['Guatemala'] },
  { iso2: 'gy', iso3: 'GUY', name: 'Guyana', aliases: [], capital: 'Georgetown', capLat: 6.8013, capLng: -58.1551, capPop: 235000 },
  { iso2: 'ht', iso3: 'HTI', name: 'Haiti', aliases: [], capital: 'Port-au-Prince', capLat: 18.5944, capLng: -72.3074, capPop: 2915000, capAliases: ['Port au Prince'] },
  { iso2: 'hn', iso3: 'HND', name: 'Honduras', aliases: [], capital: 'Tegucigalpa', capLat: 14.0723, capLng: -87.1921, capPop: 1527000 },
  { iso2: 'jm', iso3: 'JAM', name: 'Jamaica', aliases: [], capital: 'Kingston', capLat: 17.9714, capLng: -76.7936, capPop: 592000 },
  { iso2: 'mx', iso3: 'MEX', name: 'Mexico', aliases: ['United Mexican States'], capital: 'Mexico City', capLat: 19.4326, capLng: -99.1332, capPop: 22085000, capAliases: ['CDMX', 'Ciudad de Mexico'] },
  { iso2: 'ni', iso3: 'NIC', name: 'Nicaragua', aliases: [], capital: 'Managua', capLat: 12.115, capLng: -86.2362, capPop: 1083000 },
  { iso2: 'pa', iso3: 'PAN', name: 'Panama', aliases: [], capital: 'Panama City', capLat: 8.9824, capLng: -79.5199, capPop: 1938000, capAliases: ['Ciudad de Panama'] },
  { iso2: 'py', iso3: 'PRY', name: 'Paraguay', aliases: [], capital: 'Asunción', capLat: -25.2637, capLng: -57.5759, capPop: 3452000, capAliases: ['Asuncion'] },
  { iso2: 'pe', iso3: 'PER', name: 'Peru', aliases: [], capital: 'Lima', capLat: -12.0464, capLng: -77.0428, capPop: 11045000 },
  { iso2: 'kn', iso3: 'KNA', name: 'Saint Kitts and Nevis', aliases: ['St Kitts and Nevis'], capital: 'Basseterre', capLat: 17.3026, capLng: -62.7177, capPop: 15000 },
  { iso2: 'lc', iso3: 'LCA', name: 'Saint Lucia', aliases: ['St Lucia'], capital: 'Castries', capLat: 14.0101, capLng: -60.9875, capPop: 22000 },
  { iso2: 'vc', iso3: 'VCT', name: 'Saint Vincent and the Grenadines', aliases: ['St Vincent'], capital: 'Kingstown', capLat: 13.16, capLng: -61.2248, capPop: 27000 },
  { iso2: 'sr', iso3: 'SUR', name: 'Suriname', aliases: [], capital: 'Paramaribo', capLat: 5.852, capLng: -55.2038, capPop: 241000 },
  { iso2: 'tt', iso3: 'TTO', name: 'Trinidad and Tobago', aliases: ['Trinidad'], capital: 'Port of Spain', capLat: 10.6549, capLng: -61.5019, capPop: 545000, capAliases: ['Port-of-Spain'] },
  { iso2: 'us', iso3: 'USA', name: 'United States', aliases: ['USA', 'United States of America', 'America'], capital: 'Washington, D.C.', capLat: 38.9072, capLng: -77.0369, capPop: 5379000, capAliases: ['Washington', 'Washington DC', 'DC'] },
  { iso2: 'uy', iso3: 'URY', name: 'Uruguay', aliases: [], capital: 'Montevideo', capLat: -34.9011, capLng: -56.1645, capPop: 1765000 },
  { iso2: 've', iso3: 'VEN', name: 'Venezuela', aliases: [], capital: 'Caracas', capLat: 10.4806, capLng: -66.9036, capPop: 2956000 },
];

// Supplemental cities for smaller countries so more sovereign countries reach >= 3 cities
const SUPPLEMENTAL_CITIES = {
  SVN: [
    { name: 'Ljubljana', lat: 46.0569, lng: 14.5058, population: 295000, isCapital: true },
    { name: 'Maribor', lat: 46.5547, lng: 15.6459, population: 112000, isCapital: false },
    { name: 'Celje', lat: 46.2397, lng: 15.2677, population: 49000, isCapital: false },
    { name: 'Kranj', lat: 46.2389, lng: 14.3556, population: 57000, isCapital: false },
    { name: 'Koper', lat: 45.5481, lng: 13.7302, population: 53000, isCapital: false },
  ],
  MNE: [
    { name: 'Podgorica', lat: 42.4304, lng: 19.2594, population: 190000, isCapital: true },
    { name: 'Nikšić', lat: 42.7731, lng: 18.9445, population: 72000, isCapital: false },
    { name: 'Bar', lat: 42.0931, lng: 19.1003, population: 44000, isCapital: false },
    { name: 'Herceg Novi', lat: 42.4531, lng: 18.5375, population: 31000, isCapital: false },
    { name: 'Budva', lat: 42.2864, lng: 18.84, population: 27000, isCapital: false },
  ],
  TTO: [
    { name: 'Chaguanas', lat: 10.5167, lng: -61.4167, population: 101000, isCapital: false },
    { name: 'San Fernando', lat: 10.2833, lng: -61.4667, population: 83000, isCapital: false },
    { name: 'Port of Spain', lat: 10.6549, lng: -61.5019, population: 54000, isCapital: true },
    { name: 'Arima', lat: 10.6374, lng: -61.2823, population: 35000, isCapital: false },
  ],
  MUS: [
    { name: 'Port Louis', lat: -20.1609, lng: 57.5012, population: 149000, isCapital: true },
    { name: 'Vacoas-Phoenix', lat: -20.2981, lng: 57.4783, population: 115000, isCapital: false },
    { name: 'Beau Bassin-Rose Hill', lat: -20.2333, lng: 57.4667, population: 104000, isCapital: false },
    { name: 'Curepipe', lat: -20.3167, lng: 57.5167, population: 79000, isCapital: false },
  ],
  BHS: [
    { name: 'Nassau', lat: 25.0443, lng: -77.3504, population: 280000, isCapital: true },
    { name: 'Freeport', lat: 26.5333, lng: -78.7, population: 47000, isCapital: false },
    { name: 'Marsh Harbour', lat: 26.5412, lng: -77.0636, population: 6300, isCapital: false },
  ],
  CPV: [
    { name: 'Praia', lat: 14.933, lng: -23.5133, population: 168000, isCapital: true },
    { name: 'Mindelo', lat: 16.8901, lng: -24.9804, population: 76000, isCapital: false },
    { name: 'Santa Maria', lat: 16.598, lng: -22.9051, population: 32000, isCapital: false },
  ],
  QAT: [
    { name: 'Doha', lat: 25.2854, lng: 51.531, population: 2382000, isCapital: true },
    { name: 'Al Rayyan', lat: 25.2919, lng: 51.4244, population: 605000, isCapital: false },
    { name: 'Al Wakrah', lat: 25.1715, lng: 51.6034, population: 94000, isCapital: false },
    { name: 'Al Khor', lat: 25.6804, lng: 51.4969, population: 202000, isCapital: false },
  ],
  BHR: [
    { name: 'Manama', lat: 26.2285, lng: 50.586, population: 689000, isCapital: true },
    { name: 'Riffa', lat: 26.13, lng: 50.555, population: 215000, isCapital: false },
    { name: 'Muharraq', lat: 26.2572, lng: 50.6119, population: 176000, isCapital: false },
    { name: 'Hamad Town', lat: 26.1153, lng: 50.5069, population: 133000, isCapital: false },
  ],
  BRN: [
    { name: 'Bandar Seri Begawan', lat: 4.9031, lng: 114.9398, population: 280000, isCapital: true },
    { name: 'Kuala Belait', lat: 4.5836, lng: 114.2312, population: 31000, isCapital: false },
    { name: 'Seria', lat: 4.6064, lng: 114.3248, population: 21000, isCapital: false },
    { name: 'Tutong', lat: 4.8028, lng: 114.6492, population: 19000, isCapital: false },
  ],
  TLS: [
    { name: 'Dili', lat: -8.5569, lng: 125.5603, population: 281000, isCapital: true },
    { name: 'Baucau', lat: -8.4711, lng: 126.4583, population: 47000, isCapital: false },
    { name: 'Maliana', lat: -8.9917, lng: 125.2197, population: 29000, isCapital: false },
    { name: 'Suai', lat: -9.3128, lng: 125.2565, population: 26000, isCapital: false },
  ],
  COM: [
    { name: 'Moroni', lat: -11.7172, lng: 43.2473, population: 85000, isCapital: true },
    { name: 'Mutsamudu', lat: -12.1667, lng: 44.4, population: 38000, isCapital: false },
    { name: 'Fomboni', lat: -12.28, lng: 43.7425, population: 21000, isCapital: false },
  ],
  VUT: [
    { name: 'Port Vila', lat: -17.7333, lng: 168.3167, population: 51000, isCapital: true },
    { name: 'Luganville', lat: -15.5199, lng: 167.1624, population: 18000, isCapital: false },
    { name: 'Isangel', lat: -19.5417, lng: 169.2817, population: 5000, isCapital: false },
  ],
  WSM: [
    { name: 'Apia', lat: -13.8333, lng: -171.7667, population: 37000, isCapital: true },
    { name: 'Vaitele', lat: -13.822, lng: -171.805, population: 8000, isCapital: false },
    { name: 'Faleula', lat: -13.796, lng: -171.855, population: 5000, isCapital: false },
  ],
  TON: [
    { name: "Nuku'alofa", lat: -21.1394, lng: -175.2049, population: 28000, isCapital: true },
    { name: 'Neiafu', lat: -18.6506, lng: -173.984, population: 6000, isCapital: false },
    { name: 'Haveluloto', lat: -21.1558, lng: -175.2133, population: 4000, isCapital: false },
  ],
  MLT: [
    { name: 'Birkirkara', lat: 35.8972, lng: 14.4611, population: 25000, isCapital: false },
    { name: 'Valletta', lat: 35.8989, lng: 14.5146, population: 212000, isCapital: true },
    { name: 'Mosta', lat: 35.9092, lng: 14.4256, population: 21000, isCapital: false },
    { name: 'Qormi', lat: 35.876, lng: 14.472, population: 18000, isCapital: false },
  ],
  LUX: [
    { name: 'Luxembourg City', lat: 49.6116, lng: 6.1319, population: 132000, isCapital: true },
    { name: 'Esch-sur-Alzette', lat: 49.4958, lng: 5.9806, population: 36000, isCapital: false },
    { name: 'Differdange', lat: 49.5242, lng: 5.8914, population: 29000, isCapital: false },
    { name: 'Dudelange', lat: 49.4806, lng: 6.0875, population: 22000, isCapital: false },
  ],
};

async function generateCapitalsAndTopCities() {
  console.log('Fetching Natural Earth 10m Populated Places...');
  const res = await fetch(
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson'
  );
  const places = await res.json();

  // Group places by ISO2 and ADM0_A3
  const byIso3 = {};
  const byIso2 = {};
  for (const f of places.features) {
    const p = f.properties || {};
    const a3 = (p.adm0_a3 || p.sov_a3 || '').toUpperCase();
    const a2 = (p.iso_a2 || '').toLowerCase();
    const entry = {
      name: p.nameascii || p.name,
      displayName: p.name || p.nameascii,
      lat: Number(Number(p.latitude).toFixed(4)),
      lng: Number(Number(p.longitude).toFixed(4)),
      population: Number(p.pop_max || p.pop_min || 0),
      isCapital: p.adm0cap === 1 || p.featurecla === 'Admin-0 capital',
    };
    if (a3) {
      if (!byIso3[a3]) byIso3[a3] = [];
      byIso3[a3].push(entry);
    }
    if (a2 && a2 !== '-99') {
      if (!byIso2[a2]) byIso2[a2] = [];
      byIso2[a2].push(entry);
    }
  }

  const topCitiesDataset = [];
  const capitalCityItems = [];

  for (const country of SOVEREIGN_COUNTRIES) {
    // 1. Build capital item for worldCapitalsQuiz.json
    const capAliases = new Set(country.capAliases || []);
    const asciiCap = stripDiacritics(country.capital);
    if (asciiCap !== country.capital) capAliases.add(asciiCap);
    capAliases.delete(country.capital);

    capitalCityItems.push({
      name: country.capital,
      lat: country.capLat,
      lng: country.capLng,
      stateOrRegion: country.name,
      population: country.capPop,
      ...(capAliases.size > 0 ? { aliases: Array.from(capAliases) } : {}),
    });

    // 2. Build top cities list for world-country-top-cities.json
    let rawCities = [];
    if (SUPPLEMENTAL_CITIES[country.iso3]) {
      rawCities = [...SUPPLEMENTAL_CITIES[country.iso3]];
    } else {
      rawCities = [...(byIso3[country.iso3] || byIso2[country.iso2] || [])];
    }

    // Deduplicate by normalized name
    const seen = new Map();
    const capNorm = stripDiacritics(country.capital).toLowerCase();
    for (const c of rawCities) {
      const cName = c.displayName || c.name;
      const key = stripDiacritics(cName).toLowerCase();
      const isCap =
        c.isCapital ||
        key === capNorm ||
        (country.capAliases || []).some((a) => stripDiacritics(a).toLowerCase() === key);
      const existing = seen.get(key);
      if (!existing || c.population > existing.population) {
        seen.set(key, {
          name: isCap ? country.capital : cName,
          lat: c.lat,
          lng: c.lng,
          population: c.population,
          isCapital: Boolean(isCap),
        });
      }
    }

    // Ensure national capital is included and marked isCapital: true
    let cityList = Array.from(seen.values());
    const hasCap = cityList.some((c) => c.isCapital);
    if (!hasCap) {
      cityList.push({
        name: country.capital,
        lat: country.capLat,
        lng: country.capLng,
        population: country.capPop,
        isCapital: true,
      });
    } else {
      // Ensure only one city is marked isCapital (the official capital)
      let foundOfficial = false;
      for (const c of cityList) {
        if (stripDiacritics(c.name).toLowerCase() === capNorm) {
          c.isCapital = true;
          c.name = country.capital;
          foundOfficial = true;
        } else {
          c.isCapital = false;
        }
      }
      if (!foundOfficial) {
        cityList[0].isCapital = true;
      }
    }

    // Sort by population descending
    cityList.sort((a, b) => b.population - a.population);

    // Keep top 15 cities, ensuring the capital is inside the top 15
    if (cityList.length > 15) {
      const top15 = cityList.slice(0, 15);
      if (!top15.some((c) => c.isCapital)) {
        const capEntry = cityList.find((c) => c.isCapital);
        if (capEntry) {
          top15[14] = capEntry;
          top15.sort((a, b) => b.population - a.population);
        }
      }
      cityList = top15;
    }

    if (cityList.length >= 3) {
      topCitiesDataset.push({
        iso3: country.iso3,
        iso2: country.iso2,
        countryName: country.name,
        aliases: country.aliases || [],
        cities: cityList,
      });
    }
  }

  topCitiesDataset.sort((a, b) => a.countryName.localeCompare(b.countryName));
  capitalCityItems.sort((a, b) => (a.stateOrRegion || '').localeCompare(b.stateOrRegion || ''));

  const specialDir = path.join(ROOT, 'public', 'data', 'special');
  ensureDir(specialDir);
  fs.writeFileSync(
    path.join(specialDir, 'world-country-top-cities.json'),
    JSON.stringify(topCitiesDataset, null, 2)
  );

  const worldCapitalsQuiz = {
    id: 'world-capitals',
    title: `World: Sovereign Country Capitals (${capitalCityItems.length})`,
    category: 'cities',
    format: 'map-point',
    countryOrRegion: 'World',
    backgroundGeoJsonUrl: '/data/world-countries.geojson',
    defaultCenter: [20, 10],
    defaultZoom: 2,
    totalItems: capitalCityItems.length,
    tags: ['WORLD', 'world-capitals', 'capital-cities'],
    cityItems: capitalCityItems,
  };

  fs.writeFileSync(
    path.join(ROOT, 'src', 'data', 'worldCapitalsQuiz.json'),
    JSON.stringify(worldCapitalsQuiz, null, 2)
  );

  console.log(
    `Generated world-country-top-cities.json (${topCitiesDataset.length} countries with >=3 cities) and worldCapitalsQuiz.json (${capitalCityItems.length} capitals)`
  );
}

// ============================================================================
// TASK 3: Major Rivers by Continent
// ============================================================================
// Convert a LineString coordinate array into a crisp closed Polygon ribbon
// so Leaflet fillColor, click-named mode, isolated-shape SVG, and centroid calculations work seamlessly!
function lineToRibbonPolygon(lineCoords, halfWidthDeg = 0.12) {
  if (!lineCoords || lineCoords.length < 2) return null;

  // Simplify consecutive points that are extremely close to keep GeoJSON compact
  const pts = [lineCoords[0]];
  for (let i = 1; i < lineCoords.length; i++) {
    const prev = pts[pts.length - 1];
    const cur = lineCoords[i];
    const dist = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    if (dist >= 0.04 || i === lineCoords.length - 1) {
      pts.push(cur);
    }
  }
  if (pts.length < 2) return null;

  const leftSide = [];
  const rightSide = [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let dx = 0, dy = 0;
    if (i === 0) {
      dx = pts[1][0] - pts[0][0];
      dy = pts[1][1] - pts[0][1];
    } else if (i === pts.length - 1) {
      dx = pts[i][0] - pts[i - 1][0];
      dy = pts[i][1] - pts[i - 1][1];
    } else {
      dx = pts[i + 1][0] - pts[i - 1][0];
      dy = pts[i + 1][1] - pts[i - 1][1];
    }
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * halfWidthDeg;
    const ny = (dx / len) * halfWidthDeg;

    leftSide.push([Number((p[0] + nx).toFixed(4)), Number((p[1] + ny).toFixed(4))]);
    rightSide.push([Number((p[0] - nx).toFixed(4)), Number((p[1] - ny).toFixed(4))]);
  }

  rightSide.reverse();
  const ring = [...leftSide, ...rightSide, leftSide[0]];
  return [ring];
}

function linesToMultiPolygonGeometry(lines, halfWidthDeg = 0.12) {
  const polygons = [];
  for (const line of lines) {
    const poly = lineToRibbonPolygon(line, halfWidthDeg);
    if (poly) polygons.push(poly);
  }
  return {
    type: 'MultiPolygon',
    coordinates: polygons,
  };
}

const CONTINENT_RIVER_SPECS = [
  {
    slug: 'europe',
    titleContinent: 'Europe',
    countryOrRegion: 'Europe',
    tag: 'EUROPE',
    defaultCenter: [51.0, 20.0],
    defaultZoom: 4,
    halfWidthDeg: 0.11,
    bbox: [-15, 68, 35, 72],
    rivers: [
      { name: 'Volga', match: ['volga'], aliases: ['Volga River'] },
      { name: 'Danube', match: ['danube', 'donau'], aliases: ['Danube River', 'Donau'] },
      { name: 'Ural', match: ['ural'], aliases: ['Ural River'] },
      { name: 'Dnieper', match: ['dnieper', 'dnipro'], aliases: ['Dnipro', 'Dnieper River'] },
      { name: 'Don', match: ['don'], aliases: ['Don River'] },
      { name: 'Pechora', match: ['pechora'], aliases: ['Pechora River'] },
      { name: 'Kama', match: ['kama'], aliases: ['Kama River'] },
      { name: 'Oka', match: ['oka'], aliases: ['Oka River'] },
      { name: 'Rhine', match: ['rhine', 'rhein'], aliases: ['Rhine River', 'Rhein'] },
      { name: 'Elbe', match: ['elbe'], aliases: ['Elbe River', 'Labe'] },
      { name: 'Vistula', match: ['vistula', 'wisła', 'wisla'], aliases: ['Vistula River', 'Wisla'] },
      { name: 'Tagus', match: ['tagus', 'tejo', 'tajo'], aliases: ['Tajo', 'Tejo', 'Tagus River'] },
      { name: 'Daugava', match: ['daugava', 'western dvina'], aliases: ['Western Dvina', 'Daugava River'] },
      { name: 'Loire', match: ['loire'], aliases: ['Loire River'] },
      { name: 'Rhône', match: ['rhône', 'rhone'], aliases: ['Rhone', 'Rhone River'] },
      { name: 'Seine', match: ['seine'], aliases: ['Seine River'] },
      { name: 'Po', match: ['po'], aliases: ['Po River'] },
      { name: 'Ebro', match: ['ebro'], aliases: ['Ebro River'] },
    ],
  },
  {
    slug: 'asia',
    titleContinent: 'Asia',
    countryOrRegion: 'Asia',
    tag: 'ASIA',
    defaultCenter: [34.0, 92.0],
    defaultZoom: 3,
    halfWidthDeg: 0.14,
    bbox: [35, 180, 0, 78],
    rivers: [
      { name: 'Yangtze', match: ['yangtze', 'chang jiang', 'jinsha'], aliases: ['Chang Jiang', 'Yangtze River'] },
      { name: 'Yellow', match: ['yellow', 'huang he'], aliases: ['Yellow River', 'Huang He'] },
      { name: 'Mekong', match: ['mekong', 'lancang'], aliases: ['Mekong River'] },
      { name: 'Lena', match: ['lena'], aliases: ['Lena River'] },
      { name: 'Irtysh', match: ['irtysh', 'irtish'], aliases: ['Irtysh River'] },
      { name: 'Yenisey', match: ['yenisey', 'yenisei', 'verkhniy yenisey', 'bol’shoy yenisey', 'malyy yenisey'], aliases: ['Yenisei', 'Yenisey River'] },
      { name: 'Ob', match: ['ob', 'malaya ob'], aliases: ['Ob River'] },
      { name: 'Indus', match: ['indus'], aliases: ['Indus River'] },
      { name: 'Brahmaputra', match: ['brahmaputra', 'tsangpo', 'jamuna'], aliases: ['Brahmaputra River', 'Tsangpo'] },
      { name: 'Ganges', match: ['ganges', 'ganga', 'padma'], aliases: ['Ganga', 'Ganges River'] },
      { name: 'Amur', match: ['amur', 'heilong'], aliases: ['Amur River', 'Heilong Jiang'] },
      { name: 'Euphrates', match: ['euphrates'], aliases: ['Euphrates River'] },
      { name: 'Tigris', match: ['tigris'], aliases: ['Tigris River'] },
      { name: 'Salween', match: ['salween', 'nu'], aliases: ['Salween River', 'Nu River'] },
      { name: 'Irrawaddy', match: ['irrawaddy', 'irrawaddy delta', 'ayeyarwady'], aliases: ['Ayeyarwady', 'Irrawaddy River'] },
      { name: 'Syr Darya', match: ['syr darya'], aliases: ['Syrdarya', 'Syr Darya River'] },
      { name: 'Amu Darya', match: ['amu darya'], aliases: ['Amudarya', 'Amu Darya River', 'Oxus'] },
    ],
  },
  {
    slug: 'africa',
    titleContinent: 'Africa',
    countryOrRegion: 'Africa',
    tag: 'AFRICA',
    defaultCenter: [2.0, 21.0],
    defaultZoom: 3,
    halfWidthDeg: 0.14,
    bbox: [-20, 55, -36, 38],
    rivers: [
      { name: 'Nile', match: ['nile', 'white nile', 'blue nile', 'victoria nile', 'albert nile', 'mountain nile'], aliases: ['Nile River'] },
      { name: 'Congo', match: ['congo', 'lualaba'], aliases: ['Congo River', 'Zaire River'] },
      { name: 'Niger', match: ['niger'], aliases: ['Niger River'] },
      { name: 'Zambezi', match: ['zambezi'], aliases: ['Zambezi River'] },
      { name: 'Orange', match: ['orange'], aliases: ['Orange River'] },
      { name: 'Limpopo', match: ['limpopo'], aliases: ['Limpopo River'] },
      { name: 'Senegal', match: ['sénégal', 'senegal'], aliases: ['Sénégal', 'Senegal River'] },
      { name: 'Volta', match: ['volta', 'black volta', 'white volta'], aliases: ['Volta River'] },
      { name: 'Benue', match: ['benue'], aliases: ['Benue River'] },
      { name: 'Ogooué', match: ['ogooué', 'ogooue'], aliases: ['Ogooue', 'Ogooue River'] },
      { name: 'Shebelle', match: ['shabeelle', 'shebele', 'shebelle'], aliases: ['Shabelle', 'Shabeelle', 'Shebelle River'] },
      { name: 'Juba', match: ['jubba', 'juba'], aliases: ['Jubba', 'Juba River'] },
      { name: 'Kasai', match: ['kasai', 'kasaï'], aliases: ['Kasai River'] },
      { name: 'Ubangi', match: ['ubangi', 'oubangui'], aliases: ['Oubangui', 'Ubangi River'] },
      { name: 'Okavango', match: ['okavango', 'cubango'], aliases: ['Cubango', 'Okavango River'] },
    ],
  },
  {
    slug: 'north-america',
    titleContinent: 'North America',
    countryOrRegion: 'North America',
    tag: 'NORTH-AMERICA',
    defaultCenter: [45.0, -100.0],
    defaultZoom: 3,
    halfWidthDeg: 0.13,
    bbox: [-170, -50, 15, 75],
    rivers: [
      { name: 'Mississippi', match: ['mississippi'], aliases: ['Mississippi River'] },
      { name: 'Missouri', match: ['missouri'], aliases: ['Missouri River'] },
      { name: 'Mackenzie', match: ['mackenzie'], aliases: ['Mackenzie River'] },
      { name: 'Yukon', match: ['yukon'], aliases: ['Yukon River'] },
      { name: 'Rio Grande', match: ['rio grande', 'río bravo'], aliases: ['Rio Bravo', 'Rio Grande River'] },
      { name: 'St. Lawrence', match: ['st. lawrence', 'saint lawrence'], aliases: ['Saint Lawrence', 'St Lawrence', 'St. Lawrence River'] },
      { name: 'Colorado', match: ['colorado'], filter: (b) => b.cx < -102, aliases: ['Colorado River'] },
      { name: 'Columbia', customRivernum: 64, aliases: ['Columbia River'] },
      { name: 'Saskatchewan', match: ['saskatchewan', 'north saskatchewan', 'south saskatchewan'], aliases: ['Saskatchewan River'] },
      { name: 'Peace', match: ['peace'], aliases: ['Peace River'] },
      { name: 'Ottawa', match: ['ottawa'], aliases: ['Ottawa River'] },
      { name: 'Ohio', match: ['ohio'], aliases: ['Ohio River'] },
      { name: 'Arkansas', match: ['arkansas'], aliases: ['Arkansas River'] },
      { name: 'Red', match: ['red', 'prairie dog town fork red'], filter: (b) => b.cy < 40, aliases: ['Red River', 'Red River of the South'] },
      { name: 'Snake', customRivernum: 103, aliases: ['Snake River'] },
    ],
  },
  {
    slug: 'south-america',
    titleContinent: 'South America',
    countryOrRegion: 'South America',
    tag: 'SOUTH-AMERICA',
    defaultCenter: [-16.0, -60.0],
    defaultZoom: 3,
    halfWidthDeg: 0.14,
    bbox: [-82, -34, -56, 13],
    rivers: [
      { name: 'Amazon', match: ['amazonas', 'amazon', 'solimões'], aliases: ['Amazonas', 'Amazon River'] },
      { name: 'Paraná', customParana: true, aliases: ['Parana', 'Parana River'] },
      { name: 'Madeira', match: ['madeira'], aliases: ['Madeira River'] },
      { name: 'Purus', match: ['purús', 'purus'], aliases: ['Purús', 'Purus River'] },
      { name: 'São Francisco', match: ['são francisco', 'sao francisco'], aliases: ['Sao Francisco', 'Sao Francisco River'] },
      { name: 'Tocantins', match: ['tocantins'], aliases: ['Tocantins River'] },
      { name: 'Orinoco', match: ['orinoco'], aliases: ['Orinoco River'] },
      { name: 'Paraguay', customParaguay: true, aliases: ['Paraguay River'] },
      { name: 'Juruá', match: ['juruá', 'jurua'], aliases: ['Jurua', 'Jurua River'] },
      { name: 'Negro', match: ['negro'], filter: (b) => b.cy > -10, aliases: ['Rio Negro', 'Negro River'] },
      { name: 'Xingu', match: ['xingu'], aliases: ['Xingu River'] },
      { name: 'Tapajós', match: ['tapajós', 'tapajos'], aliases: ['Tapajos', 'Tapajos River'] },
      { name: 'Magdalena', match: ['magdalena'], aliases: ['Magdalena River'] },
      { name: 'Uruguay', match: ['uruguay'], aliases: ['Uruguay River'] },
      { name: 'Pilcomayo', match: ['pilcomayo'], aliases: ['Pilcomayo River'] },
    ],
  },
  {
    slug: 'oceania',
    titleContinent: 'Oceania',
    countryOrRegion: 'Oceania',
    tag: 'OCEANIA',
    defaultCenter: [-25.0, 142.0],
    defaultZoom: 4,
    halfWidthDeg: 0.12,
    bbox: [110, 180, -48, 0],
    rivers: [
      { name: 'Murray', match: ['murray'], aliases: ['Murray River'] },
      { name: 'Darling', match: ['darling'], aliases: ['Darling River'] },
      { name: 'Murrumbidgee', match: ['murrumbidgee'], aliases: ['Murrumbidgee River'] },
      { name: 'Lachlan', match: ['lachlan'], aliases: ['Lachlan River'] },
      { name: 'Cooper Creek', match: ['cooper', 'cooper creek'], aliases: ['Cooper', 'Barcoo'] },
      { name: 'Flinders', match: ['flinders'], aliases: ['Flinders River'] },
      { name: 'Diamantina', match: ['diamantina'], aliases: ['Diamantina River'] },
      { name: 'Victoria', match: ['victoria'], aliases: ['Victoria River'] },
      { name: 'Fitzroy', match: ['fitzroy'], aliases: ['Fitzroy River'] },
      { name: 'Waikato', match: ['waikato'], aliases: ['Waikato River'] },
      { name: 'Clutha', match: ['clutha'], aliases: ['Clutha River'] },
      { name: 'Fly', match: ['fly'], aliases: ['Fly River'] },
      { name: 'Sepik', match: ['sepik'], aliases: ['Sepik River'] },
    ],
  },
];

async function generateRivers() {
  console.log('Fetching Natural Earth 10m Rivers + Australia supplement...');
  const [resMain, resAus] = await Promise.all([
    fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson'),
    fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_australia.geojson'),
  ]);
  const mainData = await resMain.json();
  const ausData = await resAus.json();
  const allFeatures = [...mainData.features, ...ausData.features];

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function getGeomBBox(geom) {
    let minX = 180, maxX = -180, minY = 90, maxY = -90;
    function walk(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
        return;
      }
      for (const x of c) walk(x);
    }
    walk(geom.coordinates);
    return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  function extractLines(features) {
    const lines = [];
    for (const f of features) {
      if (!f.geometry) continue;
      if (f.geometry.type === 'LineString') {
        lines.push(f.geometry.coordinates);
      } else if (f.geometry.type === 'MultiLineString') {
        for (const l of f.geometry.coordinates) lines.push(l);
      }
    }
    return lines;
  }

  const riversDir = path.join(ROOT, 'public', 'data', 'rivers');
  ensureDir(riversDir);

  const riverQuizzes = [];

  for (const cont of CONTINENT_RIVER_SPECS) {
    const [minLon, maxLon, minLat, maxLat] = cont.bbox;
    const continentFeatures = [];
    const aliasesMap = {};

    for (const r of cont.rivers) {
      let lines = [];

      if (r.customRivernum !== undefined) {
        const matched = mainData.features.filter((f) => f.properties.rivernum === r.customRivernum);
        lines = extractLines(matched);
      } else if (r.customParaguay) {
        // Line 0 of 36River is the Paraguay River from Mato Grosso to confluence with Paraná
        const f36 = mainData.features.find((f) => f.properties.dissolve === '36River');
        if (f36 && f36.geometry.type === 'MultiLineString') {
          lines = [f36.geometry.coordinates[0]];
        }
      } else if (r.customParana) {
        // Lines 1..4 of 36River + all of rivernum 99 are the Paraná River
        const f36 = mainData.features.find((f) => f.properties.dissolve === '36River');
        const f99 = mainData.features.filter((f) => f.properties.rivernum === 99);
        if (f36 && f36.geometry.type === 'MultiLineString') {
          lines.push(...f36.geometry.coordinates.slice(1));
        }
        lines.push(...extractLines(f99));
      } else {
        const matched = allFeatures.filter((f) => {
          const b = getGeomBBox(f.geometry);
          if (b.cx < minLon || b.cx > maxLon || b.cy < minLat || b.cy > maxLat) return false;
          if (r.filter && !r.filter(b)) return false;
          const n1 = norm(f.properties.name);
          const n2 = norm(f.properties.name_en);
          const n3 = norm(f.properties.name_alt);
          return r.match.includes(n1) || r.match.includes(n2) || r.match.includes(n3);
        });
        lines = extractLines(matched);
      }

      if (lines.length === 0) {
        throw new Error(`No lines found for river ${r.name} in ${cont.slug}`);
      }

      const geom = linesToMultiPolygonGeometry(lines, cont.halfWidthDeg);
      continentFeatures.push({
        type: 'Feature',
        properties: {
          name: r.name,
          continent: cont.titleContinent,
        },
        geometry: geom,
      });

      if (r.aliases && r.aliases.length > 0) {
        aliasesMap[r.name] = r.aliases;
      }
    }

    const fc = {
      type: 'FeatureCollection',
      features: continentFeatures,
    };

    fs.writeFileSync(path.join(riversDir, `${cont.slug}.geojson`), JSON.stringify(fc));

    riverQuizzes.push({
      id: `rivers-${cont.slug}`,
      title: `${cont.titleContinent}: Major Rivers (${continentFeatures.length})`,
      category: 'landscapes',
      format: 'map-polygon',
      countryOrRegion: cont.countryOrRegion,
      geoJsonUrl: `/data/rivers/${cont.slug}.geojson`,
      backgroundGeoJsonUrl: '/data/world-countries.geojson',
      nameProperty: 'name',
      aliases: aliasesMap,
      defaultCenter: cont.defaultCenter,
      defaultZoom: cont.defaultZoom,
      totalItems: continentFeatures.length,
      tags: ['RIVERS', cont.tag, 'landscapes'],
    });
  }

  fs.writeFileSync(
    path.join(ROOT, 'src', 'data', 'riverQuizzes.json'),
    JSON.stringify(riverQuizzes, null, 2)
  );
  console.log(`Generated 6 continent river GeoJSON files and src/data/riverQuizzes.json`);
}

async function main() {
  await generateUsaCounties();
  await generateCapitalsAndTopCities();
  await generateRivers();
  console.log('All dataset generation tasks completed successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import type {
  CameraGeneration,
  CardinalDirectionFilter,
  CoverageAnnotation,
  CoverageSeason,
  CoverageTagNode,
  PoiTagDefinition,
  RoadAutoMetaSpan,
  SideLineTagDefinition,
} from '../types/coverageNotes';

export function getDescendantIdsInclusive(
  rootId: string,
  tree: Array<{ id: string; parentId: string | null }>
): Set<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of tree) {
      if (n.parentId && result.has(n.parentId) && !result.has(n.id)) {
        result.add(n.id);
        changed = true;
      }
    }
  }
  return result;
}

export interface AutoMetadataSummary {
  years: number[];
  months: number[];
  seasons: CoverageSeason[];
  cameraGens: CameraGeneration[];
  countries: string[];
  regions: string[];
}

export function collectAvailableAutoMetadata(
  annotations: CoverageAnnotation[]
): AutoMetadataSummary {
  const years = new Set<number>();
  const months = new Set<number>();
  const seasons = new Set<CoverageSeason>();
  const cameraGens = new Set<CameraGeneration>();
  const countries = new Set<string>();
  const regions = new Set<string>();

  for (const ann of annotations) {
    if (ann.captureDate) {
      const [yStr, mStr] = ann.captureDate.split('-');
      const y = Number(yStr);
      const m = Number(mStr);
      if (Number.isFinite(y)) years.add(y);
      if (Number.isFinite(m)) months.add(m);
    }
    if (ann.cameraGen && ann.cameraGen !== 'Unknown') {
      cameraGens.add(ann.cameraGen);
    }
    if (ann.countryCode) countries.add(ann.countryCode);
    if (ann.regionName) regions.add(ann.regionName);

    for (const span of ann.autoMetaSpans || []) {
      if (span.year !== undefined) years.add(span.year);
      if (span.month !== undefined) months.add(span.month);
      if (span.season) seasons.add(span.season);
      if (span.cameraGen && span.cameraGen !== 'Unknown') {
        cameraGens.add(span.cameraGen);
      }
      if (span.countryCode) countries.add(span.countryCode);
      if (span.regionName) regions.add(span.regionName);
      for (const hy of span.historicalYears || []) {
        years.add(hy);
      }
    }
  }

  return {
    years: Array.from(years).sort((a, b) => a - b),
    months: Array.from(months).sort((a, b) => a - b),
    seasons: Array.from(seasons),
    cameraGens: Array.from(cameraGens),
    countries: Array.from(countries).sort(),
    regions: Array.from(regions).sort(),
  };
}

export interface FilterContext {
  ann: CoverageAnnotation;
  span?: RoadAutoMetaSpan;
  tagTree: CoverageTagNode[];
  sideLineTags: SideLineTagDefinition[];
  poiTags?: PoiTagDefinition[];
  matchingSideTagIds?: Set<string>;
}

type Token =
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'NOT' }
  | { type: 'TERM'; value: string };

function tokenizeBooleanQuery(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = query.length;

  while (i < n) {
    const ch = query[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }
    if (ch === '&') {
      if (query[i + 1] === '&') i += 2;
      else i++;
      tokens.push({ type: 'AND' });
      continue;
    }
    if (ch === '|') {
      if (query[i + 1] === '|') i += 2;
      else i++;
      tokens.push({ type: 'OR' });
      continue;
    }
    if (ch === '!') {
      tokens.push({ type: 'NOT' });
      i++;
      continue;
    }

    // Read a term (supporting quoted strings inside terms like region:"Central District")
    let term = '';
    while (i < n && !/\s|[()&|!]/.test(query[i])) {
      if (query[i] === '"') {
        i++;
        while (i < n && query[i] !== '"') {
          term += query[i++];
        }
        if (query[i] === '"') i++;
      } else {
        term += query[i++];
      }
    }

    const upper = term.toUpperCase();
    if (upper === 'AND') {
      tokens.push({ type: 'AND' });
    } else if (upper === 'OR') {
      tokens.push({ type: 'OR' });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT' });
    } else if (term.length > 0) {
      tokens.push({ type: 'TERM', value: term });
    }
  }

  return tokens;
}

function evaluateSingleTerm(term: string, ctx: FilterContext): boolean {
  const { ann, span, tagTree, sideLineTags } = ctx;
  const lower = term.toLowerCase();

  const colonIdx = term.indexOf(':');
  if (colonIdx > 0) {
    const prefix = term.slice(0, colonIdx).toLowerCase();
    const val = term.slice(colonIdx + 1).trim().toLowerCase();

    if (prefix === 'year' || prefix === 'yr') {
      const targetYear = Number(val);
      if (span) {
        return (
          span.year === targetYear ||
          Boolean(span.historicalYears?.includes(targetYear))
        );
      }
      if (ann.captureDate?.startsWith(`${targetYear}-`)) return true;
      return (ann.autoMetaSpans || []).some(
        (s) => s.year === targetYear || s.historicalYears?.includes(targetYear)
      );
    }

    if (prefix === 'month' || prefix === 'mo') {
      const monthNames = [
        'jan',
        'feb',
        'mar',
        'apr',
        'may',
        'jun',
        'jul',
        'aug',
        'sep',
        'oct',
        'nov',
        'dec',
      ];
      let targetMonth = Number(val);
      if (!Number.isFinite(targetMonth)) {
        const mIdx = monthNames.findIndex((m) => val.startsWith(m));
        if (mIdx >= 0) targetMonth = mIdx + 1;
      }
      if (span) return span.month === targetMonth;
      return (ann.autoMetaSpans || []).some((s) => s.month === targetMonth);
    }

    if (prefix === 'season') {
      if (span) return (span.season || '').toLowerCase() === val;
      return (ann.autoMetaSpans || []).some(
        (s) => (s.season || '').toLowerCase() === val
      );
    }

    if (prefix === 'gen' || prefix === 'cam') {
      const normGen = val.replace(/^gen\s*/, '');
      const matchGen = (g?: string) =>
        Boolean(g && g.toLowerCase().includes(normGen));
      if (span) return matchGen(span.cameraGen);
      if (matchGen(ann.cameraGen)) return true;
      return (ann.autoMetaSpans || []).some((s) => matchGen(s.cameraGen));
    }

    if (prefix === 'country' || prefix === 'cc') {
      if (span) return (span.countryCode || '').toLowerCase() === val;
      if ((ann.countryCode || '').toLowerCase() === val) return true;
      return (ann.autoMetaSpans || []).some(
        (s) => (s.countryCode || '').toLowerCase() === val
      );
    }

    if (prefix === 'region' || prefix === 'reg' || prefix === 'state') {
      if (span) return Boolean(span.regionName?.toLowerCase().includes(val));
      if (ann.regionName?.toLowerCase().includes(val)) return true;
      return (ann.autoMetaSpans || []).some((s) =>
        Boolean(s.regionName?.toLowerCase().includes(val))
      );
    }

    if (prefix === 'road') {
      if (span) return Boolean(span.roadName?.toLowerCase().includes(val));
      return (ann.autoMetaSpans || []).some((s) =>
        Boolean(s.roadName?.toLowerCase().includes(val))
      );
    }

    if (prefix === 'sideline' || prefix === 'sl') {
      const matchedSideTags = sideLineTags.filter(
        (t) => t.name.toLowerCase() === val || t.id.toLowerCase() === val
      );
      const allowedIds = new Set<string>();
      for (const mt of matchedSideTags) {
        for (const id of getDescendantIdsInclusive(mt.id, sideLineTags)) {
          allowedIds.add(id);
        }
      }
      return (ann.sideLines || []).some(
        (sl) =>
          allowedIds.has(sl.sideLineTagId) ||
          Boolean(sl.label && sl.label.toLowerCase().includes(val))
      );
    }

    if (prefix === 'poi') {
      const poiTree = ctx.poiTags || [];
      const matchedPoiTags = poiTree.filter(
        (t) => t.name.toLowerCase() === val || t.id.toLowerCase() === val
      );
      const allowedPoiTagIds = new Set<string>();
      for (const pt of matchedPoiTags) {
        for (const id of getDescendantIdsInclusive(pt.id, poiTree)) {
          allowedPoiTagIds.add(id);
        }
      }
      if ((ann.poiTagIds || []).some((id) => allowedPoiTagIds.has(id))) {
        return true;
      }
      return (ann.roadPois || []).some(
        (p) =>
          p.label.toLowerCase().includes(val) ||
          (p.tagIds || []).some((id) => allowedPoiTagIds.has(id))
      );
    }

    if (prefix === 'tag') {
      const matchedNodes = tagTree.filter(
        (t) => t.name.toLowerCase() === val || t.id.toLowerCase() === val
      );
      const allowedIds = new Set<string>();
      for (const mn of matchedNodes) {
        for (const id of getDescendantIdsInclusive(mn.id, tagTree)) {
          allowedIds.add(id);
        }
      }
      return (ann.tagIds || []).some((tid) => allowedIds.has(tid));
    }

    if (prefix === 'text' || prefix === 'note' || prefix === 'label') {
      return (
        Boolean(ann.label?.toLowerCase().includes(val)) ||
        Boolean(ann.notes?.toLowerCase().includes(val))
      );
    }
  }

  // Unprefixed term: check if it matches any tag name in the Tag Tree, Side Line Tag Tree, label, notes, or region
  const matchedTagNodes = tagTree.filter(
    (t) => t.name.toLowerCase() === lower || t.id.toLowerCase() === lower
  );
  if (matchedTagNodes.length > 0) {
    const allowedIds = new Set<string>();
    for (const mn of matchedTagNodes) {
      for (const id of getDescendantIdsInclusive(mn.id, tagTree)) {
        allowedIds.add(id);
      }
    }
    if ((ann.tagIds || []).some((tid) => allowedIds.has(tid))) {
      return true;
    }
  }

  const matchedSideNodes = sideLineTags.filter(
    (t) => t.name.toLowerCase() === lower || t.id.toLowerCase() === lower
  );
  if (matchedSideNodes.length > 0) {
    const allowedIds = new Set<string>();
    for (const mn of matchedSideNodes) {
      for (const id of getDescendantIdsInclusive(mn.id, sideLineTags)) {
        allowedIds.add(id);
      }
    }
    if ((ann.sideLines || []).some((sl) => allowedIds.has(sl.sideLineTagId))) {
      return true;
    }
  }

  if (ann.label?.toLowerCase().includes(lower)) return true;
  if (ann.notes?.toLowerCase().includes(lower)) return true;
  if (span?.regionName?.toLowerCase().includes(lower)) return true;
  if (span?.captureDate?.toLowerCase().includes(lower)) return true;

  return false;
}

/**
 * Evaluates a boolean query string (supporting parentheses, AND, OR, NOT) against a FilterContext.
 */
export function evaluateBooleanQueryString(
  query: string,
  ctx: FilterContext
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const tokens = tokenizeBooleanQuery(trimmed);
  if (tokens.length === 0) return true;

  let pos = 0;

  // Grammar:
  // Expr   := OrExpr
  // OrExpr := AndExpr ( 'OR' AndExpr )*
  // AndExpr:= NotExpr ( ['AND'] NotExpr )*
  // NotExpr:= 'NOT' NotExpr | Primary
  // Primary:= '(' Expr ')' | TERM

  const parseOr = (): boolean => {
    let left = parseAnd();
    while (pos < tokens.length && tokens[pos].type === 'OR') {
      pos++;
      const right = parseAnd();
      left = left || right;
    }
    return left;
  };

  const parseAnd = (): boolean => {
    let left = parseNot();
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.type === 'AND') {
        pos++;
        const right = parseNot();
        left = left && right;
      } else if (
        tok.type === 'NOT' ||
        tok.type === 'LPAREN' ||
        tok.type === 'TERM'
      ) {
        // Implicit AND when two terms/groups are adjacent without OR
        const right = parseNot();
        left = left && right;
      } else {
        break;
      }
    }
    return left;
  };

  const parseNot = (): boolean => {
    if (pos < tokens.length && tokens[pos].type === 'NOT') {
      pos++;
      return !parseNot();
    }
    return parsePrimary();
  };

  const parsePrimary = (): boolean => {
    if (pos >= tokens.length) return true;
    const tok = tokens[pos];
    if (tok.type === 'LPAREN') {
      pos++;
      const val = parseOr();
      if (pos < tokens.length && tokens[pos].type === 'RPAREN') {
        pos++;
      }
      return val;
    }
    if (tok.type === 'TERM') {
      pos++;
      return evaluateSingleTerm(tok.value, ctx);
    }
    pos++;
    return true;
  };

  try {
    return parseOr();
  } catch {
    return true;
  }
}

export interface StructuredAutoMetaFilters {
  year: string;
  month: string;
  season: string;
  cameraGen: string;
  country: string;
  region: string;
  sideLineTagId: string;
  cardinalDirection: CardinalDirectionFilter;
}

export function doesSpanMatchAutoMetaFilters(
  ann: CoverageAnnotation,
  span: RoadAutoMetaSpan | undefined,
  filters: StructuredAutoMetaFilters
): boolean {
  if (filters.year !== 'all') {
    const targetYear = Number(filters.year);
    if (span) {
      if (
        span.year !== targetYear &&
        !span.historicalYears?.includes(targetYear)
      ) {
        return false;
      }
    } else if (!ann.captureDate?.startsWith(`${targetYear}-`)) {
      return false;
    }
  }

  if (filters.month !== 'all') {
    const targetMonth = Number(filters.month);
    if (span) {
      if (span.month !== targetMonth) return false;
    } else if (
      !ann.captureDate?.endsWith(`-${String(targetMonth).padStart(2, '0')}`)
    ) {
      return false;
    }
  }

  if (filters.season !== 'all') {
    if (!span || span.season !== filters.season) return false;
  }

  if (filters.cameraGen !== 'all') {
    const gen = span?.cameraGen || ann.cameraGen;
    if (gen !== filters.cameraGen) return false;
  }

  if (filters.country !== 'all') {
    const cc = span?.countryCode || ann.countryCode;
    if (cc !== filters.country) return false;
  }

  if (filters.region !== 'all') {
    const reg = span?.regionName || ann.regionName;
    if (reg !== filters.region) return false;
  }

  return true;
}

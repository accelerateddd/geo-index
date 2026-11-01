import React, { useMemo } from 'react';
import { Activity, Map as MapIcon, Minimize2, TrendingUp } from 'lucide-react';

interface RegionStatusLite {
  name: string;
  state: 'pending' | 'correct' | 'missed';
}

export interface ActiveSubRegionStats {
  slotKey: string;
  widerLabel: string;
  named: number;
  total: number;
  pct: number;
}

interface MegaProgressPanelProps {
  quizId?: string;
  geoJsonData: GeoJSON.FeatureCollection | null;
  getFeatureKey: (f: GeoJSON.Feature) => string;
  getFeatureSlot: (f: GeoJSON.Feature) => string;
  regionStatuses: Record<string, RegionStatusLite>;
  timeline: Array<{ elapsedSeconds: number; correctCount: number }>;
  elapsedSeconds: number;
  totalCount: number;
  correctCount: number;
  isSubRegionModeEnabled?: boolean;
  activeSubRegionStats?: ActiveSubRegionStats | null;
  activeRegionSlot: string | null;
  onSelectRegionSlot?: (slot: string | null) => void;
  onClose: () => void;
}

interface ProjectedFeaturePath {
  key: string;
  slot: string;
  d: string;
}

interface InsetBoxOutline {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MegaProgressPanel: React.FC<MegaProgressPanelProps> = ({
  quizId,
  geoJsonData,
  getFeatureKey,
  getFeatureSlot,
  regionStatuses,
  timeline,
  elapsedSeconds,
  totalCount,
  correctCount,
  isSubRegionModeEnabled = false,
  activeSubRegionStats = null,
  activeRegionSlot,
  onSelectRegionSlot,
  onClose,
}) => {
  const [showGraph, setShowGraph] = React.useState(true);
  const viewW = 460;
  const viewH = 265;
  const pad = 8;

  // Precompute space-optimized SVG paths (with automatic inset frames for distant territories such as Alaska & Hawaii)
  const { projectedPaths, insetBoxes } = useMemo<{
    projectedPaths: ProjectedFeaturePath[];
    insetBoxes: InsetBoxOutline[];
  }>(() => {
    if (!geoJsonData || geoJsonData.features.length === 0) {
      return { projectedPaths: [], insetBoxes: [] };
    }

    const computeRawFeatureBBox = (f: GeoJSON.Feature, normalizeDateline = false) => {
      let minLon = 180;
      let maxLon = -180;
      let minLat = 90;
      let maxLat = -90;
      const visit = (coords: any) => {
        if (!Array.isArray(coords) || coords.length === 0) return;
        if (typeof coords[0] === 'number') {
          let lon = coords[0];
          const lat = coords[1];
          if (normalizeDateline && lon > 0) lon -= 360;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          return;
        }
        for (const ch of coords) visit(ch);
      };
      if (f.geometry && 'coordinates' in f.geometry) {
        visit((f.geometry as any).coordinates);
      }
      return {
        minLon,
        maxLon,
        minLat,
        maxLat,
        cLon: (minLon + maxLon) / 2,
        cLat: (minLat + maxLat) / 2,
      };
    };

    const isUsMap =
      quizId === 'mega-usa-counties' ||
      geoJsonData.features.some((f) => {
        const s = getFeatureSlot(f);
        return s === 'Alaska' || s === 'Hawaii' || s === 'California' || s === 'Texas';
      });

    const makeProjector = (
      minLon: number,
      maxLon: number,
      minLat: number,
      maxLat: number,
      boxX: number,
      boxY: number,
      boxW: number,
      boxH: number,
      boxPad: number,
      normalizeDateline = false
    ) => {
      const centerLat = (minLat + maxLat) / 2;
      const cosLat = Math.max(0.25, Math.cos((centerLat * Math.PI) / 180));
      const spanX = Math.max(0.01, (maxLon - minLon) * cosLat);
      const spanY = Math.max(0.01, maxLat - minLat);
      const scale = Math.min((boxW - boxPad * 2) / spanX, (boxH - boxPad * 2) / spanY);
      const drawnW = spanX * scale;
      const drawnH = spanY * scale;
      const ox = boxX + (boxW - drawnW) / 2;
      const oy = boxY + (boxH - drawnH) / 2;

      return (lonInput: number, lat: number): [number, number] => {
        const lon = normalizeDateline && lonInput > 0 ? lonInput - 360 : lonInput;
        return [
          ox + (lon - minLon) * cosLat * scale,
          oy + (maxLat - lat) * scale,
        ];
      };
    };

    const buildFeaturePath = (
      f: GeoJSON.Feature,
      toXY: (lon: number, lat: number) => [number, number]
    ): string => {
      const g = f.geometry;
      if (!g) return '';
      const buildRing = (ring: number[][]): string => {
        if (!ring || ring.length < 3) return '';
        const step = ring.length > 80 ? Math.ceil(ring.length / 40) : 1;
        const pts: string[] = [];
        for (let i = 0; i < ring.length; i += step) {
          const [x, y] = toXY(ring[i][0], ring[i][1]);
          pts.push(`${pts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
        }
        pts.push('Z');
        return pts.join('');
      };

      if (g.type === 'Polygon') {
        return g.coordinates[0] ? buildRing(g.coordinates[0]) : '';
      }
      if (g.type === 'MultiPolygon') {
        const parts: string[] = [];
        for (const poly of g.coordinates) {
          if (poly[0]) {
            const r = buildRing(poly[0]);
            if (r) parts.push(r);
          }
        }
        return parts.join(' ');
      }
      return '';
    };

    // Case 1: United States map (Contiguous 48 fills main canvas + Alaska & Hawaii insets)
    if (isUsMap) {
      const mainToXY = makeProjector(-125.0, -66.8, 24.4, 49.5, 0, 0, viewW, viewH - 18, pad);
      const akBox: InsetBoxOutline = { label: 'AK', x: 6, y: viewH - 86, w: 112, h: 80 };
      const hiBox: InsetBoxOutline = { label: 'HI', x: 124, y: viewH - 64, w: 82, h: 58 };
      const akToXY = makeProjector(
        -179.5,
        -129.8,
        51.2,
        71.4,
        akBox.x,
        akBox.y,
        akBox.w,
        akBox.h,
        4,
        true
      );
      const hiToXY = makeProjector(
        -160.3,
        -154.7,
        18.8,
        22.3,
        hiBox.x,
        hiBox.y,
        hiBox.w,
        hiBox.h,
        4
      );

      const paths: ProjectedFeaturePath[] = [];
      let hasAk = false;
      let hasHi = false;

      for (const f of geoJsonData.features) {
        const key = getFeatureKey(f);
        const slot = getFeatureSlot(f);
        const fb = computeRawFeatureBBox(f, slot === 'Alaska');
        let proj = mainToXY;
        if (slot === 'Alaska' || fb.cLat > 50.5) {
          proj = akToXY;
          hasAk = true;
        } else if (slot === 'Hawaii' || (fb.cLon < -150 && fb.cLat < 24)) {
          proj = hiToXY;
          hasHi = true;
        }
        const d = buildFeaturePath(f, proj);
        if (d) paths.push({ key, slot, d });
      }

      const boxes: InsetBoxOutline[] = [];
      if (hasAk) boxes.push(akBox);
      if (hasHi) boxes.push(hiBox);
      return { projectedPaths: paths, insetBoxes: boxes };
    }

    // Case 2: General map — detect if small external territories exist far outside the 2nd–98th percentile core landmass
    const fBoxes = geoJsonData.features.map((f) => ({
      f,
      b: computeRawFeatureBBox(f),
    }));
    const lons = fBoxes.map((x) => x.b.cLon).sort((a, b) => a - b);
    const lats = fBoxes.map((x) => x.b.cLat).sort((a, b) => a - b);

    const pLowIdx = Math.floor(fBoxes.length * 0.02);
    const pHighIdx = Math.min(fBoxes.length - 1, Math.ceil(fBoxes.length * 0.98));
    const coreLonSpan = Math.max(0.05, lons[pHighIdx] - lons[pLowIdx]);
    const coreLatSpan = Math.max(0.05, lats[pHighIdx] - lats[pLowIdx]);

    const fullMinLon = Math.min(...fBoxes.map((x) => x.b.minLon));
    const fullMaxLon = Math.max(...fBoxes.map((x) => x.b.maxLon));
    const fullMinLat = Math.min(...fBoxes.map((x) => x.b.minLat));
    const fullMaxLat = Math.max(...fBoxes.map((x) => x.b.maxLat));

    const isWorldMap = quizId === 'mega-world-subdivisions' || fullMaxLon - fullMinLon > 260;

    // If external territories stretch the bounding box by more than 45% beyond the core 96% of items (on non-world maps),
    // fit the main view tightly to the core mainland and place external territories in a bottom-left inset
    const marginLon = coreLonSpan * 0.18;
    const marginLat = coreLatSpan * 0.18;
    const coreAllowedMinLon = lons[pLowIdx] - marginLon;
    const coreAllowedMaxLon = lons[pHighIdx] + marginLon;
    const coreAllowedMinLat = lats[pLowIdx] - marginLat;
    const coreAllowedMaxLat = lats[pHighIdx] + marginLat;

    const coreFeatures: typeof fBoxes = [];
    const outlierFeatures: typeof fBoxes = [];

    if (!isWorldMap && fBoxes.length >= 25) {
      for (const item of fBoxes) {
        if (
          item.b.cLon < coreAllowedMinLon ||
          item.b.cLon > coreAllowedMaxLon ||
          item.b.cLat < coreAllowedMinLat ||
          item.b.cLat > coreAllowedMaxLat
        ) {
          outlierFeatures.push(item);
        } else {
          coreFeatures.push(item);
        }
      }
    }

    if (
      outlierFeatures.length > 0 &&
      outlierFeatures.length <= fBoxes.length * 0.08 &&
      coreFeatures.length > 0
    ) {
      const cMinLon = Math.min(...coreFeatures.map((x) => x.b.minLon));
      const cMaxLon = Math.max(...coreFeatures.map((x) => x.b.maxLon));
      const cMinLat = Math.min(...coreFeatures.map((x) => x.b.minLat));
      const cMaxLat = Math.max(...coreFeatures.map((x) => x.b.maxLat));

      const oMinLon = Math.min(...outlierFeatures.map((x) => x.b.minLon));
      const oMaxLon = Math.max(...outlierFeatures.map((x) => x.b.maxLon));
      const oMinLat = Math.min(...outlierFeatures.map((x) => x.b.minLat));
      const oMaxLat = Math.max(...outlierFeatures.map((x) => x.b.maxLat));

      const mainToXY = makeProjector(cMinLon, cMaxLon, cMinLat, cMaxLat, 0, 0, viewW, viewH, pad);
      const insetBox: InsetBoxOutline = {
        label: 'External Territories',
        x: 6,
        y: viewH - 76,
        w: 118,
        h: 70,
      };
      const insetToXY = makeProjector(
        oMinLon,
        oMaxLon,
        oMinLat,
        oMaxLat,
        insetBox.x,
        insetBox.y,
        insetBox.w,
        insetBox.h,
        5
      );

      const paths: ProjectedFeaturePath[] = [];
      for (const { f } of coreFeatures) {
        const d = buildFeaturePath(f, mainToXY);
        if (d) paths.push({ key: getFeatureKey(f), slot: getFeatureSlot(f), d });
      }
      for (const { f } of outlierFeatures) {
        const d = buildFeaturePath(f, insetToXY);
        if (d) paths.push({ key: getFeatureKey(f), slot: getFeatureSlot(f), d });
      }
      return { projectedPaths: paths, insetBoxes: [insetBox] };
    }

    // Standard full-bounds projection (e.g. World map or compact region like Sydney Suburbs)
    const clampMinLat = isWorldMap ? Math.max(-58, fullMinLat) : fullMinLat;
    const clampMaxLat = isWorldMap ? Math.min(76, fullMaxLat) : fullMaxLat;
    const stdToXY = makeProjector(
      fullMinLon,
      fullMaxLon,
      clampMinLat,
      clampMaxLat,
      0,
      0,
      viewW,
      viewH,
      pad
    );

    const paths: ProjectedFeaturePath[] = [];
    for (const { f } of fBoxes) {
      const d = buildFeaturePath(f, stdToXY);
      if (d) paths.push({ key: getFeatureKey(f), slot: getFeatureSlot(f), d });
    }
    return { projectedPaths: paths, insetBoxes: [] };
  }, [geoJsonData, quizId]);

  // Compute per-slot regional progress
  const slotStats = useMemo(() => {
    const map: Record<string, { total: number; correct: number }> = {};
    for (const key of Object.keys(regionStatuses)) {
      const sepIdx = key.indexOf('::');
      const slot = sepIdx !== -1 ? key.slice(0, sepIdx) : 'All';
      if (!map[slot]) map[slot] = { total: 0, correct: 0 };
      map[slot].total++;
      if (regionStatuses[key].state === 'correct') {
        map[slot].correct++;
      }
    }
    return map;
  }, [regionStatuses]);

  const activeSlotStat = activeRegionSlot ? slotStats[activeRegionSlot] : null;
  const activeSlotPct =
    activeSubRegionStats?.pct ??
    (activeSlotStat && activeSlotStat.total > 0
      ? Math.round((activeSlotStat.correct / activeSlotStat.total) * 100)
      : 0);
  const activeSlotNamed = activeSubRegionStats?.named ?? activeSlotStat?.correct ?? 0;
  const activeSlotTotal = activeSubRegionStats?.total ?? activeSlotStat?.total ?? 0;
  const activeSlotLabel =
    activeSubRegionStats?.widerLabel ?? activeRegionSlot ?? 'None Selected';

  // Build SVG polyline for Progress vs Time graph
  const graphData = useMemo(() => {
    const gW = 420;
    const gH = 120;
    const gPadL = 36;
    const gPadR = 14;
    const gPadT = 12;
    const gPadB = 22;
    const plotW = gW - gPadL - gPadR;
    const plotH = gH - gPadT - gPadB;

    const pts = [
      { elapsedSeconds: 0, correctCount: 0 },
      ...timeline,
      { elapsedSeconds: Math.max(1, elapsedSeconds), correctCount },
    ];
    const maxT = Math.max(60, elapsedSeconds, ...pts.map((p) => p.elapsedSeconds));
    const maxY = Math.max(10, totalCount);

    const polyPoints = pts
      .map((p) => {
        const x = gPadL + (p.elapsedSeconds / maxT) * plotW;
        const y = gPadT + plotH - (p.correctCount / maxY) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    const areaPoints = `${gPadL},${gPadT + plotH} ${polyPoints} ${(
      gPadL +
      (Math.max(1, elapsedSeconds) / maxT) * plotW
    ).toFixed(1)},${gPadT + plotH}`;

    const ratePerMin =
      elapsedSeconds >= 5 ? ((correctCount / elapsedSeconds) * 60).toFixed(1) : '0.0';

    return {
      gW,
      gH,
      gPadL,
      gPadR,
      gPadT,
      gPadB,
      plotW,
      plotH,
      maxT,
      maxY,
      polyPoints,
      areaPoints,
      ratePerMin,
    };
  }, [timeline, elapsedSeconds, correctCount, totalCount]);

  const overallPct = totalCount > 0 ? ((correctCount / totalCount) * 100).toFixed(1) : '0.0';

  return (
    <div className="absolute top-3 right-3 bottom-3 w-[350px] sm:w-[420px] max-w-[calc(100vw-24px)] max-h-[calc(100%-24px)] bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl flex flex-col z-20 overflow-y-auto font-mono">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <MapIcon className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-bold text-white">Progress Overview</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
          title="Close Progress Overview"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3.5 space-y-3">
        {/* Overall Completion Bar */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Overall Progress</span>
            <span className="font-bold text-emerald-400">
              {correctCount} / {totalCount} ({overallPct}%)
            </span>
          </div>
          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${Math.min(100, Number(overallPct))}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
            <span>Pace: {graphData.ratePerMin} items/min</span>
            <span>Remaining: {totalCount - correctCount}</span>
          </div>
        </div>

        {/* Current Sub-Region Progress Bar (Shown when Sub-Region Focus Mode is enabled or a Sub-Region is selected) */}
        {(isSubRegionModeEnabled || (activeRegionSlot && activeSlotTotal > 0)) && (
          <div className="bg-indigo-950/30 border border-indigo-500/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-indigo-300 font-bold truncate">
                Current Sub-Region: {activeRegionSlot ? activeSlotLabel : 'None Selected'}
              </span>
              {activeRegionSlot && activeSlotTotal > 0 ? (
                <span className="font-bold text-white shrink-0">
                  {activeSlotNamed} / {activeSlotTotal} ({activeSlotPct}%)
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 shrink-0">Click map to select</span>
              )}
            </div>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-indigo-500/30">
              <div
                className="h-full bg-indigo-400 transition-all duration-300"
                style={{ width: `${activeRegionSlot ? activeSlotPct : 0}%` }}
              />
            </div>
            {activeRegionSlot && onSelectRegionSlot && (
              <div className="flex justify-end pt-0.5">
                <button
                  onClick={() => onSelectRegionSlot(null)}
                  className="text-[10px] text-indigo-300 hover:text-white underline cursor-pointer"
                >
                  Clear sub-region selection
                </button>
              </div>
            )}
          </div>
        )}

        {/* Space-Optimized Whole-Map Overview */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
            <span>Whole-Map Overview</span>
            <span className="text-emerald-400">■ Named</span>
          </div>
          <svg
            viewBox={`0 0 ${viewW} ${viewH}`}
            className="w-full h-auto bg-slate-950 rounded border border-slate-900"
          >
            {insetBoxes.map((b) => (
              <g key={b.label}>
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  rx={3}
                  fill="#090d16"
                  stroke="#334155"
                  strokeWidth={0.9}
                />
                <text
                  x={b.x + 4}
                  y={b.y + 10}
                  fill="#64748b"
                  fontSize={8}
                  fontWeight="bold"
                >
                  {b.label}
                </text>
              </g>
            ))}

            {projectedPaths.map((p, idx) => {
              const st = regionStatuses[p.key]?.state;
              const isSelectedSlot = activeRegionSlot && p.slot === activeRegionSlot;
              const fill =
                st === 'correct'
                  ? '#10b981'
                  : st === 'missed'
                  ? '#f43f5e'
                  : isSelectedSlot
                  ? '#312e81'
                  : '#1e293b';
              const stroke =
                st === 'correct'
                  ? '#059669'
                  : isSelectedSlot
                  ? '#818cf8'
                  : '#334155';
              return (
                <path
                  key={`${p.key}-${idx}`}
                  d={p.d}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={isSelectedSlot ? 0.65 : 0.35}
                />
              );
            })}
          </svg>
        </div>

        {/* Optional Progress vs Time Graph */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowGraph((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-300 hover:text-white cursor-pointer"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Progress Over Time</span>
            </button>
            <button
              onClick={() => setShowGraph((v) => !v)}
              className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              {showGraph ? 'Hide' : 'Show'}
            </button>
          </div>

          {showGraph && (
            <svg
              viewBox={`0 0 ${graphData.gW} ${graphData.gH}`}
              className="w-full h-auto overflow-visible"
            >
              <line
                x1={graphData.gPadL}
                y1={graphData.gPadT}
                x2={graphData.gW - graphData.gPadR}
                y2={graphData.gPadT}
                stroke="#1e293b"
                strokeDasharray="2 2"
              />
              <line
                x1={graphData.gPadL}
                y1={graphData.gPadT + graphData.plotH / 2}
                x2={graphData.gW - graphData.gPadR}
                y2={graphData.gPadT + graphData.plotH / 2}
                stroke="#1e293b"
                strokeDasharray="2 2"
              />
              <line
                x1={graphData.gPadL}
                y1={graphData.gPadT + graphData.plotH}
                x2={graphData.gW - graphData.gPadR}
                y2={graphData.gPadT + graphData.plotH}
                stroke="#334155"
              />
              <line
                x1={graphData.gPadL}
                y1={graphData.gPadT}
                x2={graphData.gPadL}
                y2={graphData.gPadT + graphData.plotH}
                stroke="#334155"
              />

              <text
                x={graphData.gPadL - 4}
                y={graphData.gPadT + 4}
                textAnchor="end"
                fill="#64748b"
                fontSize={8.5}
              >
                {graphData.maxY}
              </text>
              <text
                x={graphData.gPadL - 4}
                y={graphData.gPadT + graphData.plotH / 2 + 3}
                textAnchor="end"
                fill="#64748b"
                fontSize={8.5}
              >
                {Math.round(graphData.maxY / 2)}
              </text>
              <text
                x={graphData.gPadL - 4}
                y={graphData.gPadT + graphData.plotH}
                textAnchor="end"
                fill="#64748b"
                fontSize={8.5}
              >
                0
              </text>

              <text
                x={graphData.gPadL}
                y={graphData.gH - 5}
                textAnchor="start"
                fill="#64748b"
                fontSize={8.5}
              >
                0m
              </text>
              <text
                x={graphData.gW - graphData.gPadR}
                y={graphData.gH - 5}
                textAnchor="end"
                fill="#64748b"
                fontSize={8.5}
              >
                {Math.max(1, Math.round(graphData.maxT / 60))}m
              </text>

              <polygon points={graphData.areaPoints} fill="#10b981" fillOpacity={0.16} />
              <polyline
                fill="none"
                stroke="#10b981"
                strokeWidth={2}
                points={graphData.polyPoints}
              />
            </svg>
          )}
        </div>

        {/* Regional Progress Table */}
        {Object.keys(slotStats).length > 1 && (
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Activity className="w-3 h-3 text-indigo-400" />
                Sub-Region Breakdown ({Object.keys(slotStats).length})
              </span>
              <span>Click to Focus</span>
            </div>
            <div className="max-h-44 overflow-y-auto divide-y divide-slate-900 text-[11px]">
              {Object.entries(slotStats)
                .sort((a, b) => {
                  const pctA = a[1].total > 0 ? a[1].correct / a[1].total : 0;
                  const pctB = b[1].total > 0 ? b[1].correct / b[1].total : 0;
                  return pctB - pctA || a[0].localeCompare(b[0]);
                })
                .map(([slot, st]) => {
                  const pct = st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0;
                  const isActive = activeRegionSlot === slot;
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() =>
                        onSelectRegionSlot &&
                        onSelectRegionSlot(isActive ? null : slot)
                      }
                      className={`w-full py-1.5 px-2 flex items-center justify-between gap-2 text-left transition cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600/25 text-indigo-200 font-bold'
                          : 'hover:bg-slate-900 text-slate-300'
                      }`}
                    >
                      <span className="truncate">{slot}</span>
                      <span
                        className={`shrink-0 ${
                          pct === 100
                            ? 'text-emerald-400 font-bold'
                            : pct > 0
                            ? 'text-amber-300'
                            : 'text-slate-500'
                        }`}
                      >
                        {st.correct}/{st.total} ({pct}%)
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

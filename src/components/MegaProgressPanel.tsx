import React, { useMemo } from 'react';
import { Activity, Map as MapIcon, Minimize2, TrendingUp } from 'lucide-react';

interface RegionStatusLite {
  name: string;
  state: 'pending' | 'correct' | 'missed';
}

interface MegaProgressPanelProps {
  geoJsonData: GeoJSON.FeatureCollection | null;
  getFeatureKey: (f: GeoJSON.Feature) => string;
  getFeatureSlot: (f: GeoJSON.Feature) => string;
  regionStatuses: Record<string, RegionStatusLite>;
  timeline: Array<{ elapsedSeconds: number; correctCount: number }>;
  elapsedSeconds: number;
  totalCount: number;
  correctCount: number;
  activeRegionSlot: string | null;
  onSelectRegionSlot?: (slot: string | null) => void;
  onClose: () => void;
}

interface ProjectedFeaturePath {
  key: string;
  slot: string;
  d: string;
}

export const MegaProgressPanel: React.FC<MegaProgressPanelProps> = ({
  geoJsonData,
  getFeatureKey,
  getFeatureSlot,
  regionStatuses,
  timeline,
  elapsedSeconds,
  totalCount,
  correctCount,
  activeRegionSlot,
  onSelectRegionSlot,
  onClose,
}) => {
  const [showGraph, setShowGraph] = React.useState(true);
  const viewW = 460;
  const viewH = 260;
  const pad = 10;

  // Precompute SVG paths for the zoomed-out bird's-eye whole-map view once per dataset load
  const projectedPaths = useMemo<ProjectedFeaturePath[]>(() => {
    if (!geoJsonData || geoJsonData.features.length === 0) return [];
    let minLon = 180;
    let maxLon = -180;
    let minLat = 90;
    let maxLat = -90;

    const visit = (coords: any) => {
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
      for (const ch of coords) visit(ch);
    };

    for (const f of geoJsonData.features) {
      if (f.geometry && 'coordinates' in f.geometry) {
        visit((f.geometry as any).coordinates);
      }
    }

    const centerLat = (minLat + maxLat) / 2;
    const cosLat = Math.max(0.25, Math.cos((centerLat * Math.PI) / 180));
    const spanX = Math.max(0.01, (maxLon - minLon) * cosLat);
    const spanY = Math.max(0.01, maxLat - minLat);
    const scale = Math.min((viewW - pad * 2) / spanX, (viewH - pad * 2) / spanY);
    const drawnW = spanX * scale;
    const drawnH = spanY * scale;
    const ox = (viewW - drawnW) / 2;
    const oy = (viewH - drawnH) / 2;

    const toXY = (lon: number, lat: number): [number, number] => [
      ox + (lon - minLon) * cosLat * scale,
      oy + (maxLat - lat) * scale,
    ];

    const buildRing = (ring: number[][]): string => {
      if (!ring || ring.length < 3) return '';
      // Decimate dense vertices for crisp, fast overview rendering
      const step = ring.length > 80 ? Math.ceil(ring.length / 40) : 1;
      const pts: string[] = [];
      for (let i = 0; i < ring.length; i += step) {
        const [x, y] = toXY(ring[i][0], ring[i][1]);
        pts.push(`${pts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
      }
      pts.push('Z');
      return pts.join('');
    };

    const result: ProjectedFeaturePath[] = [];
    for (const f of geoJsonData.features) {
      const g = f.geometry;
      if (!g) continue;
      const key = getFeatureKey(f);
      const slot = getFeatureSlot(f);
      let d = '';
      if (g.type === 'Polygon') {
        if (g.coordinates[0]) d = buildRing(g.coordinates[0]);
      } else if (g.type === 'MultiPolygon') {
        const parts: string[] = [];
        for (const poly of g.coordinates) {
          if (poly[0]) {
            const r = buildRing(poly[0]);
            if (r) parts.push(r);
          }
        }
        d = parts.join(' ');
      }
      if (d) {
        result.push({ key, slot, d });
      }
    }
    return result;
  }, [geoJsonData]);

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
    activeSlotStat && activeSlotStat.total > 0
      ? Math.round((activeSlotStat.correct / activeSlotStat.total) * 100)
      : 0;

  // Build SVG polyline for Progress vs Time graph
  const graphData = useMemo(() => {
    const gW = 420;
    const gH = 125;
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
    <div className="w-full lg:w-[440px] bg-slate-900/95 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col shrink-0 z-20 overflow-y-auto font-mono">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
        <div className="flex items-center gap-2">
          <MapIcon className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-bold text-white">
            PROGRESS_VIEWER & TIMELAPSE MAP
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
          title="Collapse Progress Viewer"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3.5 space-y-3.5">
        {/* Overall Completion Bar */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">OVERALL PROGRESS</span>
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
            <span>AVG RATE: {graphData.ratePerMin} items/min</span>
            <span>REMAINING: {totalCount - correctCount}</span>
          </div>
        </div>

        {/* Active Region Partial Progress Bar */}
        {activeRegionSlot && activeSlotStat && (
          <div className="bg-indigo-950/30 border border-indigo-500/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-indigo-300 font-bold truncate">
                CURRENT REGION: {activeRegionSlot.toUpperCase()}
              </span>
              <span className="font-bold text-white shrink-0">
                {activeSlotStat.correct} / {activeSlotStat.total} ({activeSlotPct}%)
              </span>
            </div>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-indigo-500/30">
              <div
                className="h-full bg-indigo-400 transition-all duration-300"
                style={{ width: `${activeSlotPct}%` }}
              />
            </div>
            {onSelectRegionSlot && (
              <div className="flex justify-end pt-0.5">
                <button
                  onClick={() => onSelectRegionSlot(null)}
                  className="text-[10px] text-indigo-300 hover:text-white underline cursor-pointer"
                >
                  Clear region lock (Accept all regions)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Zoomed-Out Whole-Map Bird's-Eye View (For Timelapsing) */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
            <span>WHOLE-MAP OVERVIEW (TIMELAPSE VIEW)</span>
            <span className="text-emerald-400">■ NAMED</span>
          </div>
          <svg
            viewBox={`0 0 ${viewW} ${viewH}`}
            className="w-full h-auto bg-slate-950 rounded border border-slate-900"
          >
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
                  strokeWidth={isSelectedSlot ? 0.7 : 0.35}
                />
              );
            })}
          </svg>
        </div>

        {/* Optional Progress vs Time Graph Pop-Out */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowGraph((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-300 hover:text-white cursor-pointer"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>PROGRESS VS. TIME GRAPH</span>
            </button>
            <button
              onClick={() => setShowGraph((v) => !v)}
              className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              {showGraph ? 'HIDE' : 'SHOW'}
            </button>
          </div>

          {showGraph && (
            <svg
              viewBox={`0 0 ${graphData.gW} ${graphData.gH}`}
              className="w-full h-auto overflow-visible"
            >
              {/* Grid lines */}
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

              {/* Y-axis labels */}
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

              {/* X-axis labels */}
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

              {/* Filled curve area & line */}
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
                REGIONAL PROGRESS BREAKDOWN ({Object.keys(slotStats).length})
              </span>
              <span>CLICK TO FOCUS</span>
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

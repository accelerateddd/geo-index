import React, { useMemo } from 'react';
import type { SpecialCountryCitiesItem } from '../types/quiz';

interface SpecialCitiesCanvasProps {
  item: SpecialCountryCitiesItem;
  countryFeature: GeoJSON.Feature | null;
  topN: number;
  showCapitalStar: boolean;
  scaleByPopulation: boolean;
  showScaleReference: boolean;
  isRevealed: boolean;
}

interface ScaleReferenceObject {
  name: string;
  spanKm: number;
  /** Real-world polygon outline vertices in kilometers relative to its center (East = +x, North = -y) */
  ringsKm: Array<Array<[number, number]>>;
}

// Accurate real-world non-country geographical reference silhouettes in km (East = +X, South = +Y for SVG)
const SCALE_REFERENCE_OBJECTS: ScaleReferenceObject[] = [
  {
    name: 'OAHU (HAWAII)',
    spanKm: 68,
    ringsKm: [
      [
        [-32, -8], [-24, -22], [-10, -25], [2, -16], [14, -4], [29, 8],
        [33, 16], [22, 22], [6, 18], [-6, 19], [-18, 12], [-31, 4], [-32, -8],
      ],
    ],
  },
  {
    name: 'CORSICA',
    spanKm: 183,
    ringsKm: [
      [
        [8, -91], [15, -88], [16, -64], [34, -42], [41, -12], [38, 22],
        [30, 52], [14, 82], [2, 91], [-12, 80], [-28, 56], [-36, 26],
        [-41, -6], [-32, -36], [-18, -56], [2, -66], [8, -91],
      ],
    ],
  },
  {
    name: 'SICILY',
    spanKm: 285,
    ringsKm: [
      [
        [138, -78], [142, -62], [116, -12], [104, 34], [88, 86], [56, 92],
        [10, 68], [-44, 42], [-96, 18], [-138, -4], [-142, -28], [-108, -46],
        [-54, -44], [6, -52], [68, -62], [118, -74], [138, -78],
      ],
    ],
  },
  {
    name: 'HISPANIOLA',
    spanKm: 650,
    ringsKm: [
      [
        [-315, 62], [-240, 58], [-165, 36], [-115, 32], [-185, -18], [-255, -26],
        [-248, -54], [-165, -88], [-75, -96], [25, -82], [115, -62], [195, -45],
        [245, -18], [322, 16], [305, 48], [218, 42], [148, 55], [88, 98],
        [45, 82], [-18, 46], [-95, 52], [-185, 76], [-275, 82], [-315, 62],
      ],
    ],
  },
  {
    name: 'BORNEO',
    spanKm: 1180,
    ringsKm: [
      [
        [185, -560], [265, -485], [395, -365], [515, -245], [415, -145],
        [385, 25], [345, 215], [245, 385], [85, 445], [-95, 425],
        [-265, 365], [-425, 225], [-515, 65], [-465, -65], [-315, -165],
        [-145, -285], [25, -425], [185, -560],
      ],
    ],
  },
];

function formatPop(pop: number): string {
  if (!pop || pop <= 0) return '';
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `${Math.round(pop / 1_000)}k`;
  return String(pop);
}

function createStarPath(cx: number, cy: number, outerR: number): string {
  const innerR = outerR * 0.44;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  pts.push('Z');
  return pts.join(' ');
}

export const SpecialCitiesCanvas: React.FC<SpecialCitiesCanvasProps> = ({
  item,
  countryFeature,
  topN,
  showCapitalStar,
  scaleByPopulation,
  showScaleReference,
  isRevealed,
}) => {
  // Select the N cities to display (if showCapitalStar is true, ensure the capital is included in the N cities)
  const displayedCities = useMemo(() => {
    const sorted = [...item.cities].sort((a, b) => (b.population || 0) - (a.population || 0));
    const slice = sorted.slice(0, topN);
    if (showCapitalStar) {
      const hasCap = slice.some((c) => c.isCapital);
      if (!hasCap) {
        const cap = sorted.find((c) => c.isCapital);
        if (cap && slice.length > 0) {
          slice[slice.length - 1] = cap;
        }
      }
    }
    return slice;
  }, [item.cities, topN, showCapitalStar]);

  const viewW = 780;
  const viewH = 480;
  const pad = 68;

  // Project cities (and country outline if revealed) into local metric km space
  const projection = useMemo(() => {
    const lats = displayedCities.map((c) => c.lat);
    const lngs = displayedCities.map((c) => c.lng);

    // Also include country outline bounds when revealed so the country outline fits cleanly
    if (isRevealed && countryFeature?.geometry) {
      const visit = (coords: any) => {
        if (!Array.isArray(coords) || coords.length === 0) return;
        if (typeof coords[0] === 'number') {
          lngs.push(coords[0]);
          lats.push(coords[1]);
          return;
        }
        for (const child of coords) visit(child);
      };
      if ('coordinates' in countryFeature.geometry) {
        visit((countryFeature.geometry as any).coordinates);
      }
    }

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));

    const toKm = (lng: number, lat: number): [number, number] => [
      (lng - centerLng) * 111.32 * cosLat,
      (centerLat - lat) * 111.32, // +Y down in SVG
    ];

    const spanXKm = Math.max(30, (maxLng - minLng) * 111.32 * cosLat);
    const spanYKm = Math.max(30, (maxLat - minLat) * 111.32);
    const maxSpanKm = Math.max(spanXKm, spanYKm);

    const availW = viewW - pad * 2;
    const availH = viewH - pad * 2;
    const pxPerKm = Math.min(availW / spanXKm, availH / spanYKm);

    const toScreen = (lng: number, lat: number): [number, number] => {
      const [xKm, yKm] = toKm(lng, lat);
      return [viewW / 2 + xKm * pxPerKm, viewH / 2 + yKm * pxPerKm];
    };

    return {
      pxPerKm,
      maxSpanKm,
      toScreen,
    };
  }, [displayedCities, isRevealed, countryFeature]);

  // Country outline SVG path (shown upon guess reveal)
  const countrySvgPath = useMemo(() => {
    if (!isRevealed || !countryFeature?.geometry) return '';
    const geom = countryFeature.geometry;
    const parts: string[] = [];

    const addRing = (ring: number[][]) => {
      if (!ring || ring.length < 2) return;
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = projection.toScreen(ring[i][0], ring[i][1]);
        parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
      }
      parts.push('Z');
    };

    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) addRing(ring);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        for (const ring of poly) addRing(ring);
      }
    }
    return parts.join(' ');
  }, [isRevealed, countryFeature, projection]);

  // Pick the non-country scale reference object whose real-world size fits best (~14%-24% of viewport)
  const scaleRefRender = useMemo(() => {
    if (!showScaleReference) return null;
    const targetRefKm = projection.maxSpanKm * 0.22;
    let best = SCALE_REFERENCE_OBJECTS[0];
    let bestRatio = Infinity;
    for (const cand of SCALE_REFERENCE_OBJECTS) {
      const ratio = Math.abs(Math.log(cand.spanKm / Math.max(20, targetRefKm)));
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = cand;
      }
    }

    // Clamp display scale if the country is extremely huge or tiny so the corner box stays neat
    const rawPxSpan = best.spanKm * projection.pxPerKm;
    const effectivePxPerKm =
      rawPxSpan > 165
        ? 165 / best.spanKm
        : rawPxSpan < 42
        ? 42 / best.spanKm
        : projection.pxPerKm;

    const refCenterX = viewW - 105;
    const refCenterY = viewH - 78;

    const pathParts: string[] = [];
    for (const ring of best.ringsKm) {
      for (let i = 0; i < ring.length; i++) {
        const x = refCenterX + ring[i][0] * effectivePxPerKm;
        const y = refCenterY + ring[i][1] * effectivePxPerKm;
        pathParts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
      }
      pathParts.push('Z');
    }

    return {
      name: best.name,
      spanKm: best.spanKm,
      pathD: pathParts.join(' '),
      centerX: refCenterX,
      centerY: refCenterY,
    };
  }, [showScaleReference, projection]);

  const maxPop = useMemo(
    () => Math.max(1, ...displayedCities.map((c) => c.population || 1)),
    [displayedCities]
  );

  return (
    <div className="w-full h-full flex items-center justify-center p-4 bg-ink-950">
      <div className="max-w-4xl w-full bg-ink-900 border border-ink-800 rounded-xl p-4 flex flex-col items-center justify-center shadow-2xl relative">
        <div className="w-full flex items-center justify-between text-[11px] text-ink-400 px-2 pb-2 border-b border-ink-800/80 uppercase tracking-wide">
          <div className="flex items-center gap-3">
            <span>
              Cities shown: <strong className="text-white">{displayedCities.length}</strong>
            </span>
            {showCapitalStar && (
              <span className="text-amber-300 font-bold">★ Capital</span>
            )}
            {scaleByPopulation && (
              <span className="text-ink-500">Dot size scaled by population</span>
            )}
          </div>
          <div>
            {isRevealed ? (
              <span className="text-emerald-400 font-bold">
                Answer: {item.countryName}
              </span>
            ) : (
              <span className="text-ink-500">City positions</span>
            )}
          </div>
        </div>

        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          className="w-full h-auto max-h-[68dvh] overflow-visible"
        >
          {/* Subtle Technical Coordinate Grid */}
          <g stroke="#1e293b" strokeWidth={1} strokeDasharray="3 3">
            <line x1={viewW * 0.25} y1={20} x2={viewW * 0.25} y2={viewH - 20} />
            <line x1={viewW * 0.5} y1={20} x2={viewW * 0.5} y2={viewH - 20} />
            <line x1={viewW * 0.75} y1={20} x2={viewW * 0.75} y2={viewH - 20} />
            <line x1={20} y1={viewH * 0.25} x2={viewW - 20} y2={viewH * 0.25} />
            <line x1={20} y1={viewH * 0.5} x2={viewW - 20} y2={viewH * 0.5} />
            <line x1={20} y1={viewH * 0.75} x2={viewW - 20} y2={viewH * 0.75} />
          </g>

          {/* Revealed Country Outline Context */}
          {isRevealed && countrySvgPath && (
            <path
              d={countrySvgPath}
              fill="#1e293b"
              fillOpacity={0.75}
              stroke="#6366f1"
              strokeWidth={2.2}
              strokeLinejoin="round"
            />
          )}

          {/* City Dots & Capital Star */}
          {displayedCities.map((city, idx) => {
            const [cx, cy] = projection.toScreen(city.lng, city.lat);
            const popRatio = Math.sqrt(Math.max(0.04, (city.population || 1) / maxPop));
            const radius = scaleByPopulation ? 4.5 + 8.5 * popRatio : 7;
            const isCapStar = showCapitalStar && city.isCapital;

            return (
              <g key={`${city.name}-${idx}`}>
                {isCapStar ? (
                  <path
                    d={createStarPath(cx, cy, Math.max(9.5, radius * 1.35))}
                    fill="#facc15"
                    stroke="#020617"
                    strokeWidth={1.8}
                  />
                ) : (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill="#38bdf8"
                    fillOpacity={0.92}
                    stroke="#ffffff"
                    strokeWidth={1.8}
                  />
                )}

                {isRevealed && (
                  <g>
                    <rect
                      x={cx + radius + 5}
                      y={cy - 10}
                      width={
                        (city.name.length + (city.population ? 7 : 0)) * 6.4 + 10
                      }
                      height={19}
                      rx={3}
                      fill="#020617"
                      fillOpacity={0.88}
                      stroke="#334155"
                      strokeWidth={1}
                    />
                    <text
                      x={cx + radius + 10}
                      y={cy + 3}
                      fill={isCapStar ? '#fde047' : '#ffffff'}
                      fontSize={11}
                      fontWeight="bold"
                    >
                      {isCapStar ? '★ ' : ''}
                      {city.name}
                      {city.population ? ` (${formatPop(city.population)})` : ''}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Corner Scale Reference Silhouette */}
          {scaleRefRender && (
            <g>
              <rect
                x={viewW - 205}
                y={viewH - 145}
                width={195}
                height={135}
                rx={6}
                fill="#020617"
                fillOpacity={0.82}
                stroke="#334155"
                strokeWidth={1}
              />
              <text
                x={viewW - 195}
                y={viewH - 127}
                fill="#94a3b8"
                fontSize={9.5}
                fontWeight="bold"
              >
                SCALE REFERENCE: {scaleRefRender.name}
              </text>
              <text
                x={viewW - 195}
                y={viewH - 114}
                fill="#64748b"
                fontSize={8.5}
              >
                (~{scaleRefRender.spanKm} km span at same scale)
              </text>
              <path
                d={scaleRefRender.pathD}
                fill="#334155"
                fillOpacity={0.65}
                stroke="#94a3b8"
                strokeWidth={1.3}
                strokeLinejoin="round"
              />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};

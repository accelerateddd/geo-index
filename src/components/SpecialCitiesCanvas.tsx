import React, { useMemo } from 'react';
import type { CityPopulationBasis, SpecialCountryCitiesItem } from '../types/quiz';

interface SpecialCitiesCanvasProps {
  item: SpecialCountryCitiesItem;
  countryFeature: GeoJSON.Feature | null;
  topN: number;
  showCapitalStar: boolean;
  showRelativePopulation: boolean;
  showAbsolutePopulation: boolean;
  cityPopulationBasis: CityPopulationBasis;
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
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(2)}M`;
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

interface CandidateCorner {
  id: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  rectX: number;
  rectY: number;
  shiftX: number; // Direction to nudge constellation if compaction is needed
  shiftY: number;
}

export const SpecialCitiesCanvas: React.FC<SpecialCitiesCanvasProps> = ({
  item,
  countryFeature,
  topN,
  showCapitalStar,
  showRelativePopulation,
  showAbsolutePopulation,
  cityPopulationBasis = 'metro',
  showScaleReference,
  isRevealed,
}) => {
  const sourceCities = useMemo(() => {
    if (
      cityPopulationBasis === 'city-proper' &&
      item.citiesProper &&
      item.citiesProper.length >= 3
    ) {
      return item.citiesProper;
    }
    return item.cities;
  }, [item.cities, item.citiesProper, cityPopulationBasis]);

  // Select the N cities to display (if showCapitalStar is true, ensure the capital is included in the N cities)
  // Also preserve 1-based population rank for each city
  const displayedCities = useMemo(() => {
    const sorted = [...sourceCities]
      .sort((a, b) => (b.population || 0) - (a.population || 0))
      .map((c, idx) => ({ ...c, rank: idx + 1 }));
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
  }, [sourceCities, topN, showCapitalStar]);

  const viewW = 780;
  const viewH = 480;
  const basePad = 68;
  const boxW = 195;
  const boxH = 135;

  const candidateCorners: CandidateCorner[] = useMemo(
    () => [
      { id: 'bottom-right', rectX: viewW - boxW - 10, rectY: viewH - boxH - 10, shiftX: -1, shiftY: -1 },
      { id: 'bottom-left', rectX: 10, rectY: viewH - boxH - 10, shiftX: 1, shiftY: -1 },
      { id: 'top-right', rectX: viewW - boxW - 10, rectY: 10, shiftX: -1, shiftY: 1 },
      { id: 'top-left', rectX: 10, rectY: 10, shiftX: 1, shiftY: 1 },
    ],
    []
  );

  // Project cities (and country outline if revealed) into local metric km space,
  // automatically selecting a free corner for the scale reference or compacting the constellation if all 4 corners are occupied.
  const projection = useMemo(() => {
    const lats = displayedCities.map((c) => c.lat);
    const lngs = displayedCities.map((c) => c.lng);

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

    const availW = viewW - basePad * 2;
    const availH = viewH - basePad * 2;
    let pxPerKm = Math.min(availW / spanXKm, availH / spanYKm);
    let offsetX = viewW / 2;
    let offsetY = viewH / 2;
    let chosenCorner = candidateCorners[0];

    const hasLabel = showRelativePopulation || showAbsolutePopulation || isRevealed;
    const labelExtraRight = hasLabel ? 92 : 16;

    const countCornerCollisions = (
      corner: CandidateCorner,
      scalePxPerKm: number,
      ox: number,
      oy: number
    ) => {
      let collisions = 0;
      let minClearance = Infinity;
      const boxLeft = corner.rectX - 14;
      const boxRight = corner.rectX + boxW + 14;
      const boxTop = corner.rectY - 14;
      const boxBottom = corner.rectY + boxH + 14;
      const boxCenterX = corner.rectX + boxW / 2;
      const boxCenterY = corner.rectY + boxH / 2;

      for (const c of displayedCities) {
        const [xKm, yKm] = toKm(c.lng, c.lat);
        const cx = ox + xKm * scalePxPerKm;
        const cy = oy + yKm * scalePxPerKm;

        const cityLeft = cx - 14;
        const cityRight = cx + labelExtraRight;
        const cityTop = cy - 16;
        const cityBottom = cy + 16;

        const overlaps =
          cityRight >= boxLeft &&
          cityLeft <= boxRight &&
          cityBottom >= boxTop &&
          cityTop <= boxBottom;
        if (overlaps) collisions++;

        const dist = Math.hypot(cx - boxCenterX, cy - boxCenterY);
        if (dist < minClearance) minClearance = dist;
      }
      return { collisions, minClearance };
    };

    if (showScaleReference) {
      // 1. Check if any of the 4 corners is already 100% free at full scale
      let bestFreeCorner: CandidateCorner | null = null;
      let bestFreeClearance = -1;

      for (const corner of candidateCorners) {
        const { collisions, minClearance } = countCornerCollisions(
          corner,
          pxPerKm,
          offsetX,
          offsetY
        );
        if (collisions === 0 && minClearance > bestFreeClearance) {
          bestFreeClearance = minClearance;
          bestFreeCorner = corner;
        }
      }

      if (bestFreeCorner) {
        chosenCorner = bestFreeCorner;
      } else {
        // 2. All 4 corners had a city in them at full scale:
        // Pick the corner with the fewest collisions & largest clearance, then compact/nudge the constellation until 0 collisions
        let bestCandidate = candidateCorners[0];
        let bestScore = Infinity;
        for (const corner of candidateCorners) {
          const { collisions, minClearance } = countCornerCollisions(
            corner,
            pxPerKm,
            offsetX,
            offsetY
          );
          const score = collisions * 1000 - minClearance;
          if (score < bestScore) {
            bestScore = score;
            bestCandidate = corner;
          }
        }
        chosenCorner = bestCandidate;

        for (let step = 1; step <= 8; step++) {
          const factor = 1 - step * 0.055; // Down to ~0.56x if needed
          const testPxPerKm = pxPerKm * factor;
          const testOx = viewW / 2 + chosenCorner.shiftX * step * 11;
          const testOy = viewH / 2 + chosenCorner.shiftY * step * 8;
          const { collisions } = countCornerCollisions(
            chosenCorner,
            testPxPerKm,
            testOx,
            testOy
          );
          pxPerKm = testPxPerKm;
          offsetX = testOx;
          offsetY = testOy;
          if (collisions === 0) break;
        }
      }
    }

    const toScreen = (lng: number, lat: number): [number, number] => {
      const [xKm, yKm] = toKm(lng, lat);
      return [offsetX + xKm * pxPerKm, offsetY + yKm * pxPerKm];
    };

    return {
      pxPerKm,
      maxSpanKm,
      toScreen,
      chosenCorner,
    };
  }, [
    displayedCities,
    isRevealed,
    countryFeature,
    showScaleReference,
    showRelativePopulation,
    showAbsolutePopulation,
    candidateCorners,
  ]);

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

    const rawPxSpan = best.spanKm * projection.pxPerKm;
    const effectivePxPerKm =
      rawPxSpan > 165
        ? 165 / best.spanKm
        : rawPxSpan < 42
        ? 42 / best.spanKm
        : projection.pxPerKm;

    const { rectX, rectY } = projection.chosenCorner;
    const refCenterX = rectX + boxW / 2;
    const refCenterY = rectY + boxH / 2 + 12;

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
      rectX,
      rectY,
    };
  }, [showScaleReference, projection]);

  const maxPop = useMemo(
    () => Math.max(1, ...displayedCities.map((c) => c.population || 1)),
    [displayedCities]
  );

  return (
    <div className="w-full h-full flex items-center justify-center p-4 bg-slate-950">
      <div className="max-w-4xl w-full bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center shadow-2xl relative">
        <div className="w-full flex items-center justify-between text-[11px] text-slate-400 px-2 pb-2 border-b border-slate-800/80 flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span>
              PLOTTED_CITIES: <strong className="text-white">{displayedCities.length}</strong>
            </span>
            <span className="text-slate-300">
              BASIS:{' '}
              <strong className="text-emerald-300">
                {cityPopulationBasis === 'city-proper' ? 'CITY_PROPER' : 'METRO_AREA'}
              </strong>
            </span>
            {showCapitalStar && (
              <span className="text-amber-300 font-bold">★ = CAPITAL</span>
            )}
            {showRelativePopulation && (
              <span className="text-sky-300 font-semibold">
                RELATIVE_POP (SIZE ∝ √POP + RANK #)
              </span>
            )}
            {showAbsolutePopulation && (
              <span className="text-indigo-300 font-semibold">
                ABSOLUTE_POP SHOWN
              </span>
            )}
          </div>
          <div>
            {isRevealed ? (
              <span className="text-emerald-400 font-bold">
                REVEALED: {item.countryName.toUpperCase()}
              </span>
            ) : (
              <span className="text-slate-500">NORMALIZED RELATIVE POSITIONS</span>
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

          {/* Corner Scale Reference Silhouette (Placed in a verified collision-free corner) */}
          {scaleRefRender && (
            <g>
              <rect
                x={scaleRefRender.rectX}
                y={scaleRefRender.rectY}
                width={boxW}
                height={boxH}
                rx={6}
                fill="#020617"
                fillOpacity={0.84}
                stroke="#334155"
                strokeWidth={1}
              />
              <text
                x={scaleRefRender.rectX + 10}
                y={scaleRefRender.rectY + 18}
                fill="#94a3b8"
                fontSize={9.5}
                fontWeight="bold"
              >
                SCALE REF: {scaleRefRender.name}
              </text>
              <text
                x={scaleRefRender.rectX + 10}
                y={scaleRefRender.rectY + 31}
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

          {/* City Dots & Capital Star */}
          {displayedCities.map((city, idx) => {
            const [cx, cy] = projection.toScreen(city.lng, city.lat);
            const popRatio = Math.sqrt(Math.max(0.04, (city.population || 1) / maxPop));
            const scaleProportional = showRelativePopulation || showAbsolutePopulation;
            const radius = scaleProportional ? 4.8 + 8.5 * popRatio : 7;
            const isCapStar = showCapitalStar && city.isCapital;

            const preRevealParts: string[] = [];
            if (showRelativePopulation) {
              preRevealParts.push(`#${city.rank}`);
            }
            if (showAbsolutePopulation && city.population) {
              preRevealParts.push(formatPop(city.population));
            }
            const preRevealText = preRevealParts.join(' • ');

            const revealedText = `${isCapStar ? '★ ' : ''}${
              showRelativePopulation ? `#${city.rank} ` : ''
            }${city.name}${city.population ? ` (${formatPop(city.population)})` : ''}`;

            const activeLabel = isRevealed ? revealedText : preRevealText;

            return (
              <g key={`${city.name}-${idx}`}>
                {isCapStar ? (
                  <path
                    d={createStarPath(cx, cy, Math.max(9.5, radius * 1.35))}
                    fill="#facc15"
                    stroke="#0f172a"
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

                {activeLabel && (
                  <g>
                    <rect
                      x={cx + radius + 5}
                      y={cy - 10}
                      width={activeLabel.length * 6.3 + 10}
                      height={19}
                      rx={3}
                      fill="#020617"
                      fillOpacity={0.88}
                      stroke={isRevealed ? '#475569' : '#1e293b'}
                      strokeWidth={1}
                    />
                    <text
                      x={cx + radius + 10}
                      y={cy + 3}
                      fill={
                        isRevealed
                          ? isCapStar
                            ? '#fde047'
                            : '#f8fafc'
                          : isCapStar
                          ? '#fde047'
                          : '#bae6fd'
                      }
                      fontSize={11}
                      fontWeight="bold"
                    >
                      {activeLabel}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

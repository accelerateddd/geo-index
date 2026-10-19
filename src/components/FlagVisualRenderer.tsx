import React, { useEffect, useRef, useState } from 'react';
import type { FlagDisplayMode, FlagFilterId, FlagQuizItem } from '../types/quiz';
import {
  applyFlagFiltersToCanvas,
  computeFlagColorPieSlices,
  type ColorPieSlice,
} from '../utils/flagEffects';
import { resolveAssetUrl } from '../utils/assetUrl';

interface FlagVisualRendererProps {
  item: FlagQuizItem;
  displayMode: FlagDisplayMode;
  activeFilters: FlagFilterId[];
  size?: 'large' | 'small';
}

export const FlagVisualRenderer: React.FC<FlagVisualRendererProps> = ({
  item,
  displayMode,
  activeFilters,
  size = 'large',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pieSlices, setPieSlices] = useState<ColorPieSlice[]>([]);
  const [loadedUrl, setLoadedUrl] = useState<string>('');
  const resolvedImageUrl = resolveAssetUrl(item.imageUrl);

  useEffect(() => {
    if (displayMode === 'standard') return;

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.width = 450;
    img.height = 300;

    img.onload = () => {
      if (cancelled) return;
      if (displayMode === 'filtered' && canvasRef.current) {
        const w = size === 'large' ? 450 : 210;
        const h = size === 'large' ? 300 : 140;
        applyFlagFiltersToCanvas(img, canvasRef.current, activeFilters, w, h);
      } else if (displayMode === 'pie-chart') {
        const slices = computeFlagColorPieSlices(img);
        setPieSlices(slices);
      }
      setLoadedUrl(item.imageUrl);
    };

    img.src = resolvedImageUrl;

    return () => {
      cancelled = true;
    };
  }, [item.imageUrl, resolvedImageUrl, displayMode, activeFilters, size]);

  if (displayMode === 'standard') {
    return (
      <img
        src={resolvedImageUrl}
        alt="Flag"
        className={
          size === 'large'
            ? 'max-h-72 max-w-full object-contain rounded border border-slate-700 shadow-lg'
            : 'max-h-24 max-w-full object-contain rounded border border-slate-700'
        }
      />
    );
  }

  if (displayMode === 'filtered') {
    return (
      <canvas
        ref={canvasRef}
        className={
          size === 'large'
            ? 'max-h-72 max-w-full object-contain rounded border border-slate-700 shadow-lg bg-slate-950'
            : 'max-h-24 max-w-full object-contain rounded border border-slate-700 bg-slate-950'
        }
      />
    );
  }

  // Pie Chart Mode
  const radius = 92;
  let cumulativeAngle = -Math.PI / 2; // Start at 12 o'clock

  return (
    <div
      className={`flex ${
        size === 'large'
          ? 'flex-col sm:flex-row items-center gap-6'
          : 'flex-row items-center gap-3'
      }`}
    >
      <svg
        viewBox="-115 -115 230 230"
        className={size === 'large' ? 'w-56 h-56 shrink-0' : 'w-24 h-24 shrink-0'}
      >
        {pieSlices.length === 1 ? (
          <circle
            cx={0}
            cy={0}
            r={radius}
            fill={pieSlices[0].hex}
            stroke="#0f172a"
            strokeWidth={2}
          />
        ) : (
          pieSlices.map((slice, idx) => {
            const sliceAngle = (slice.percent / 100) * Math.PI * 2;
            const startAngle = cumulativeAngle;
            const endAngle = cumulativeAngle + sliceAngle;
            cumulativeAngle = endAngle;

            const x1 = Math.cos(startAngle) * radius;
            const y1 = Math.sin(startAngle) * radius;
            const x2 = Math.cos(endAngle) * radius;
            const y2 = Math.sin(endAngle) * radius;
            const largeArcFlag = sliceAngle > Math.PI ? 1 : 0;

            const d = [
              `M 0 0`,
              `L ${x1.toFixed(2)} ${y1.toFixed(2)}`,
              `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
              `Z`,
            ].join(' ');

            return (
              <path
                key={`${idx}-${slice.hex}`}
                d={d}
                fill={slice.hex}
                stroke="#0f172a"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            );
          })
        )}
        <circle
          cx={0}
          cy={0}
          r={radius}
          fill="none"
          stroke="#475569"
          strokeWidth={2}
        />
      </svg>

      {loadedUrl === item.imageUrl && pieSlices.length > 0 && (
        <div className={size === 'large' ? 'space-y-1.5 min-w-[140px]' : 'space-y-1'}>
          {size === 'large' && (
            <div className="text-[10px] text-slate-500 font-bold tracking-wider">
              COLOUR_MAKEUP
            </div>
          )}
          {pieSlices.map((slice, idx) => (
            <div
              key={`${idx}-${slice.hex}`}
              className="flex items-center justify-between gap-2.5 text-xs bg-slate-950 border border-slate-800 rounded px-2 py-1"
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-3.5 h-3.5 rounded-sm border border-slate-600 shrink-0"
                  style={{ backgroundColor: slice.hex }}
                />
                {size === 'large' && (
                  <span className="text-[11px] text-slate-400">{slice.hex}</span>
                )}
              </div>
              <span className="font-bold text-white text-[11px]">{slice.percent}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

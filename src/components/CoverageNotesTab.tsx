import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import {
  ArrowUpRight,
  Check,
  Compass,
  Download,
  Eraser,
  Eye,
  EyeOff,
  ExternalLink,
  FolderPlus,
  GitCommitHorizontal,
  Layers,
  MapPin,
  MousePointer,
  MoveRight,
  Navigation,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Sliders,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type {
  CoverageAnnotation,
  CoverageNotebook,
  CoverageToolId,
  DrivingDirectionMode,
  MetaPinCategory,
  OfficialStreetViewMetadata,
} from '../types/coverageNotes';
import {
  QUICK_JUMP_REGIONS,
  buildGoogleMapsDirectPanoUrl,
  buildStreetViewEmbedUrl,
  fetchOfficialStreetViewAtLatLng,
  formatCompassCardinal,
  loadCoverageNotebooks,
  loadNotebookAnnotations,
  saveCoverageNotebooks,
  saveNotebookAnnotations,
} from '../utils/coverageStorage';

// Exact Google Non-Terrain Roadmap & Official Street View Coverage Tile URLs
const GOOGLE_ROADMAP_TILES =
  'https://mt1.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}';
const GOOGLE_HYBRID_TILES =
  'https://mt1.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}';
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Official Google Street View Coverage blue lines tile layer (same layer used by map-making.app)
const GOOGLE_OFFICIAL_SV_COVERAGE_TILES =
  'https://mts1.google.com/vt?pb=!1m4!1m3!1i{z}!2i{x}!3i{y}!2m8!1e2!2ssvv!4m2!1scc!2s*211m3*211e2*212b1*213e2*212b1*214b1!4m2!1ssvl!2s*212b1!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0';

const ANNOTATION_COLORS = [
  { id: '#2563eb', label: 'Blue' },
  { id: '#16a34a', label: 'Green' },
  { id: '#db2777', label: 'Pink' },
  { id: '#ea580c', label: 'Orange' },
  { id: '#dc2626', label: 'Red' },
  { id: '#7c3aed', label: 'Purple' },
  { id: '#0891b2', label: 'Cyan' },
  { id: '#ca8a04', label: 'Gold' },
  { id: '#111827', label: 'Black' },
];

const COMMON_META_TAGS = [
  'driving-dir',
  'weather',
  'clouds',
  'pole',
  'bollard',
  'dead-pixel',
  'hills',
  'soil',
  'vegetation',
  'car-meta',
];

const PIN_CATEGORY_INFO: Record<
  MetaPinCategory,
  { label: string; shortCode: string; badgeBg: string }
> = {
  pole: { label: 'Utility Pole', shortCode: 'POLE', badgeBg: '#dc2626' },
  sign: { label: 'Sign / Bollard', shortCode: 'SIGN', badgeBg: '#ea580c' },
  weather: { label: 'Weather / Sky', shortCode: 'SKY', badgeBg: '#2563eb' },
  camera: { label: 'Camera / Dead Pixel', shortCode: 'CAM', badgeBg: '#7c3aed' },
  landscape: { label: 'Hills / Vegetation', shortCode: 'LAND', badgeBg: '#16a34a' },
  intersection: { label: 'Junction / Turnoff', shortCode: 'JCT', badgeBg: '#0891b2' },
  note: { label: 'General Note', shortCode: 'NOTE', badgeBg: '#334155' },
};

function offsetLatLngByHeading(
  lat: number,
  lng: number,
  headingDeg: number,
  distanceMeters: number
): [number, number] {
  const rad = (headingDeg * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos(rad)) / 111320;
  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const dLng = (distanceMeters * Math.sin(rad)) / (111320 * cosLat);
  return [lat + dLat, lng + dLng];
}

// Mini canvas for sketching pole tops, insulators, bollards, or horizon shapes inside a note
const MiniPoleSketchCanvas: React.FC<{
  initialDataUrl?: string;
  onSave: (dataUrl: string | undefined) => void;
}> = ({ initialDataUrl, onSave }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#ef4444');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (initialDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = initialDataUrl;
    }
  }, [initialDataUrl]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * e.currentTarget.width,
      ((e.clientY - rect.top) / rect.height) * e.currentTarget.height,
    ];
  };

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = getPos(e);
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const [x, y] = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handleUp = () => {
    if (!drawing) return;
    setDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      onSave(canvas.toDataURL('image/png'));
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onSave(undefined);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span>Mini Sketch (Pole / Sign / Horizon)</span>
        <div className="flex items-center gap-1">
          {['#ef4444', '#38bdf8', '#22c55e', '#facc15', '#ffffff'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setPenColor(c)}
              className={`w-3.5 h-3.5 rounded-full border cursor-pointer ${
                penColor === c ? 'border-white scale-110' : 'border-slate-700'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="ml-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={240}
        height={130}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        className="w-full h-[115px] rounded border border-slate-700 bg-slate-950 touch-none cursor-crosshair"
      />
    </div>
  );
};

// Map View Controller for programmatic flyTo / jump
const MapViewportController: React.FC<{
  flyTarget: { center: [number, number]; zoom: number; seq: number } | null;
  disableDragging: boolean;
  onViewportChange: (center: [number, number], zoom: number) => void;
}> = ({ flyTarget, disableDragging, onViewportChange }) => {
  const map = useMap();

  useEffect(() => {
    if (disableDragging) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [map, disableDragging]);

  useEffect(() => {
    if (!flyTarget) return;
    map.setView(flyTarget.center, flyTarget.zoom, { animate: true });
  }, [map, flyTarget]);

  useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onViewportChange([c.lat, c.lng], map.getZoom());
    },
    zoomend: () => {
      const c = map.getCenter();
      onViewportChange([c.lat, c.lng], map.getZoom());
    },
  });

  return null;
};

// Geographic Vector Annotation Overlay (renders Road Stretches with repeating directional chevrons, Arrows, Freehand strokes, Labels, and Pins)
const CoverageVectorOverlay: React.FC<{
  annotations: CoverageAnnotation[];
  selectedId: string | null;
  draftPoints: Array<[number, number]>;
  cursorLatLng: [number, number] | null;
  activeTool: CoverageToolId;
  activeColor: string;
  activeStrokeWidth: number;
  activeDirection: DrivingDirectionMode;
  activeStreetViewMeta: OfficialStreetViewMetadata | null;
  hideAllAnnotations: boolean;
  onSelectAnnotation: (id: string) => void;
  onEraseAnnotation: (id: string) => void;
  onMapClickLatLng: (lat: number, lng: number, altOrRightClick: boolean) => void;
  onMapDoubleClick: () => void;
  onFinishFreehandOrDragArrow: (pts: Array<[number, number]>) => void;
}> = ({
  annotations,
  selectedId,
  draftPoints,
  cursorLatLng,
  activeTool,
  activeColor,
  activeStrokeWidth,
  activeDirection,
  activeStreetViewMeta,
  hideAllAnnotations,
  onSelectAnnotation,
  onEraseAnnotation,
  onMapClickLatLng,
  onMapDoubleClick,
  onFinishFreehandOrDragArrow,
}) => {
  const map = useMap();
  const [, setRenderTick] = useState(0);
  const isPointerDrawingRef = useRef(false);
  const pointerPointsRef = useRef<Array<[number, number]>>([]);
  const [liveDragPoints, setLiveDragPoints] = useState<Array<[number, number]>>([]);

  useEffect(() => {
    const trigger = () => setRenderTick((t) => t + 1);
    map.on('move zoom viewreset resize', trigger);
    return () => {
      map.off('move zoom viewreset resize', trigger);
    };
  }, [map]);

  useMapEvents({
    click: (e) => {
      if (activeTool === 'freehand') return;
      onMapClickLatLng(
        e.latlng.lat,
        e.latlng.lng,
        Boolean(e.originalEvent.altKey || e.originalEvent.shiftKey)
      );
    },
    contextmenu: (e) => {
      e.originalEvent.preventDefault();
      // Right-click anywhere immediately opens Street View at that point
      onMapClickLatLng(e.latlng.lat, e.latlng.lng, true);
    },
    dblclick: (e) => {
      if (activeTool === 'road-stretch') {
        e.originalEvent.preventDefault();
        onMapDoubleClick();
      }
    },
  });

  const size = map.getSize();
  const project = (lat: number, lng: number): [number, number] => {
    const pt = map.latLngToContainerPoint([lat, lng]);
    return [pt.x, pt.y];
  };

  // Compute directional chevron polygons along a projected pixel polyline
  const buildDirectionChevrons = (
    ptsPx: Array<[number, number]>,
    direction: DrivingDirectionMode,
    spacingPx: number = 58,
    chevronSize: number = 7.5
  ): Array<{ tipX: number; tipY: number; angleDeg: number }> => {
    if (direction === 'none' || ptsPx.length < 2) return [];
    const chevrons: Array<{ tipX: number; tipY: number; angleDeg: number }> = [];

    for (let i = 0; i < ptsPx.length - 1; i++) {
      const [x0, y0] = ptsPx[i];
      const [x1, y1] = ptsPx[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 16) continue;

      const forwardAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const count = Math.max(1, Math.floor(segLen / spacingPx));

      for (let k = 1; k <= count; k++) {
        const t = k / (count + 1);
        const cx = x0 + dx * t;
        const cy = y0 + dy * t;
        if (direction === 'forward') {
          chevrons.push({ tipX: cx, tipY: cy, angleDeg: forwardAngle });
        } else if (direction === 'reverse') {
          chevrons.push({ tipX: cx, tipY: cy, angleDeg: forwardAngle + 180 });
        } else if (direction === 'both') {
          chevrons.push({
            tipX: cx + (dx / segLen) * (chevronSize * 0.9),
            tipY: cy + (dy / segLen) * (chevronSize * 0.9),
            angleDeg: forwardAngle,
          });
          chevrons.push({
            tipX: cx - (dx / segLen) * (chevronSize * 0.9),
            tipY: cy - (dy / segLen) * (chevronSize * 0.9),
            angleDeg: forwardAngle + 180,
          });
        }
      }
    }
    return chevrons;
  };

  // Handle pointer-based Freehand drawing and Click-and-Drag Driving Arrows
  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2 || e.altKey || e.shiftKey) return;
    if (activeTool !== 'freehand' && activeTool !== 'driving-arrow') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const ll = map.containerPointToLatLng([px, py]);
    isPointerDrawingRef.current = true;
    pointerPointsRef.current = [[ll.lat, ll.lng]];
    setLiveDragPoints([[ll.lat, ll.lng]]);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const ll = map.containerPointToLatLng([px, py]);

    if (!isPointerDrawingRef.current) return;

    if (activeTool === 'driving-arrow') {
      const start = pointerPointsRef.current[0];
      if (start) {
        pointerPointsRef.current = [start, [ll.lat, ll.lng]];
        setLiveDragPoints([start, [ll.lat, ll.lng]]);
      }
      return;
    }

    if (activeTool === 'freehand') {
      const prev = pointerPointsRef.current[pointerPointsRef.current.length - 1];
      if (prev) {
        const prevPt = map.latLngToContainerPoint(prev);
        if (Math.hypot(px - prevPt.x, py - prevPt.y) < 3.5) return;
      }
      pointerPointsRef.current.push([ll.lat, ll.lng]);
      setLiveDragPoints([...pointerPointsRef.current]);
    }
  };

  const handleSvgPointerUp = () => {
    if (!isPointerDrawingRef.current) return;
    isPointerDrawingRef.current = false;
    const pts = pointerPointsRef.current;
    pointerPointsRef.current = [];
    setLiveDragPoints([]);
    onFinishFreehandOrDragArrow(pts);
  };

  const handleAnnotationClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (activeTool === 'eraser') {
      onEraseAnnotation(id);
    } else {
      onSelectAnnotation(id);
    }
  };

  const isCaptureSurfaceActive =
    activeTool === 'freehand' || activeTool === 'driving-arrow';

  return (
    <div className="leaflet-pane" style={{ zIndex: 460, pointerEvents: 'none' }}>
      <svg
        width={size.x}
        height={size.y}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size.x,
          height: size.y,
          pointerEvents: isCaptureSurfaceActive ? 'auto' : 'none',
          touchAction: isCaptureSurfaceActive ? 'none' : 'auto',
        }}
      >
        {!hideAllAnnotations &&
          annotations.map((ann) => {
            const isSelected = ann.id === selectedId;

            if (
              ann.kind === 'road-stretch' ||
              ann.kind === 'driving-arrow' ||
              ann.kind === 'freehand'
            ) {
              if (ann.points.length < 2) return null;
              const ptsPx = ann.points.map(([lat, lng]) => project(lat, lng));
              const polyStr = ptsPx
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ');

              const dirMode: DrivingDirectionMode =
                ann.kind === 'freehand'
                  ? ann.arrowEnd
                    ? 'forward'
                    : 'none'
                  : ann.direction;

              const chevrons =
                ann.kind === 'road-stretch'
                  ? buildDirectionChevrons(ptsPx, dirMode, 56, 7.5)
                  : ann.kind === 'driving-arrow' ||
                    (ann.kind === 'freehand' && ann.arrowEnd)
                  ? (() => {
                      const n = ptsPx.length;
                      const [x0, y0] = ptsPx[n - 2];
                      const [x1, y1] = ptsPx[n - 1];
                      const ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
                      const list: Array<{ tipX: number; tipY: number; angleDeg: number }> =
                        [];
                      if (dirMode === 'forward' || dirMode === 'both') {
                        list.push({ tipX: x1, tipY: y1, angleDeg: ang });
                      }
                      if (dirMode === 'reverse' || dirMode === 'both') {
                        const [sx0, sy0] = ptsPx[0];
                        const [sx1, sy1] = ptsPx[1];
                        const rAng =
                          (Math.atan2(sy0 - sy1, sx0 - sx1) * 180) / Math.PI;
                        list.push({ tipX: sx0, tipY: sy0, angleDeg: rAng });
                      }
                      return list;
                    })()
                  : [];

              const midIdx = Math.floor(ptsPx.length / 2);
              const midPt = ptsPx[midIdx] || ptsPx[0];

              return (
                <g
                  key={ann.id}
                  onClick={(e) => handleAnnotationClick(e, ann.id)}
                  style={{ pointerEvents: 'visibleStroke', cursor: 'pointer' }}
                >
                  {/* Transparent fat hit target for easy clicking */}
                  <polyline
                    points={polyStr}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(16, ann.strokeWidth + 12)}
                  />
                  {/* White/Dark contrast casing */}
                  <polyline
                    points={polyStr}
                    fill="none"
                    stroke={isSelected ? '#facc15' : '#ffffff'}
                    strokeWidth={ann.strokeWidth + (isSelected ? 4.5 : 2.5)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity={0.9}
                  />
                  {/* Primary colored road stretch / arrow / freehand stroke */}
                  <polyline
                    points={polyStr}
                    fill="none"
                    stroke={ann.color}
                    strokeWidth={ann.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={
                      ann.kind === 'road-stretch' && ann.dashed ? '7 5' : undefined
                    }
                  />

                  {/* Directional Arrowheads / Chevrons */}
                  {chevrons.map((ch, cIdx) => {
                    const sz = Math.max(6.5, ann.strokeWidth * 2.1);
                    return (
                      <g
                        key={cIdx}
                        transform={`translate(${ch.tipX.toFixed(1)}, ${ch.tipY.toFixed(
                          1
                        )}) rotate(${ch.angleDeg.toFixed(1)})`}
                        style={{ pointerEvents: 'auto' }}
                      >
                        <polygon
                          points={`${sz * 0.45},0 ${-sz},${-sz * 0.72} ${
                            -sz * 0.55
                          },0 ${-sz},${sz * 0.72}`}
                          fill={ann.color}
                          stroke="#ffffff"
                          strokeWidth={1.3}
                        />
                      </g>
                    );
                  })}

                  {/* Inline Road Stretch Label */}
                  {ann.label && midPt && (
                    <g
                      transform={`translate(${midPt[0].toFixed(1)}, ${(
                        midPt[1] - 10
                      ).toFixed(1)})`}
                      style={{ pointerEvents: 'auto' }}
                    >
                      <rect
                        x={-ann.label.length * 3.6 - 6}
                        y={-10}
                        width={ann.label.length * 7.2 + 12}
                        height={18}
                        rx={4}
                        fill="#0f172a"
                        fillOpacity={0.9}
                        stroke={isSelected ? '#facc15' : ann.color}
                        strokeWidth={1.4}
                      />
                      <text
                        x={0}
                        y={2.5}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize={10.5}
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        {ann.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            }

            if (ann.kind === 'text') {
              const [px, py] = project(ann.position[0], ann.position[1]);
              return (
                <g
                  key={ann.id}
                  transform={`translate(${px.toFixed(1)}, ${py.toFixed(1)})`}
                  onClick={(e) => handleAnnotationClick(e, ann.id)}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                >
                  <text
                    x={0}
                    y={0}
                    textAnchor="middle"
                    fill={ann.color}
                    stroke="#ffffff"
                    strokeWidth={3.2}
                    paintOrder="stroke"
                    fontSize={ann.fontSize || 13}
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {ann.text}
                  </text>
                  {isSelected && (
                    <circle
                      cx={0}
                      cy={-4}
                      r={4}
                      fill="#facc15"
                      stroke="#0f172a"
                      strokeWidth={1}
                    />
                  )}
                </g>
              );
            }

            if (ann.kind === 'pin') {
              const [px, py] = project(ann.position[0], ann.position[1]);
              const catInfo = PIN_CATEGORY_INFO[ann.category] || PIN_CATEGORY_INFO.note;
              return (
                <g
                  key={ann.id}
                  transform={`translate(${px.toFixed(1)}, ${py.toFixed(1)})`}
                  onClick={(e) => handleAnnotationClick(e, ann.id)}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                >
                  <circle
                    cx={0}
                    cy={0}
                    r={isSelected ? 11 : 8.5}
                    fill={ann.color || catInfo.badgeBg}
                    stroke={isSelected ? '#facc15' : '#ffffff'}
                    strokeWidth={isSelected ? 2.8 : 2}
                  />
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={7.5}
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {catInfo.shortCode.slice(0, 2)}
                  </text>
                  {ann.label && (
                    <text
                      x={0}
                      y={-12}
                      textAnchor="middle"
                      fill="#0f172a"
                      stroke="#ffffff"
                      strokeWidth={3}
                      paintOrder="stroke"
                      fontSize={10.5}
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {ann.label}
                    </text>
                  )}
                </g>
              );
            }

            return null;
          })}

        {/* Live Draft Road Stretch Preview */}
        {activeTool === 'road-stretch' && draftPoints.length > 0 && (
          <g style={{ pointerEvents: 'none' }}>
            {(() => {
              const allPts = cursorLatLng ? [...draftPoints, cursorLatLng] : draftPoints;
              const ptsPx = allPts.map(([lat, lng]) => project(lat, lng));
              const polyStr = ptsPx
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ');
              const chevrons = buildDirectionChevrons(ptsPx, activeDirection, 52, 7);
              return (
                <>
                  <polyline
                    points={polyStr}
                    fill="none"
                    stroke={activeColor}
                    strokeWidth={activeStrokeWidth}
                    strokeDasharray="5 4"
                  />
                  {chevrons.map((ch, idx) => (
                    <g
                      key={idx}
                      transform={`translate(${ch.tipX.toFixed(1)}, ${ch.tipY.toFixed(
                        1
                      )}) rotate(${ch.angleDeg.toFixed(1)})`}
                    >
                      <polygon
                        points="4,0 -7,-5 -4,0 -7,5"
                        fill={activeColor}
                        stroke="#ffffff"
                        strokeWidth={1}
                      />
                    </g>
                  ))}
                  {ptsPx.map(([x, y], idx) => (
                    <circle
                      key={idx}
                      cx={x}
                      cy={y}
                      r={4}
                      fill="#ffffff"
                      stroke={activeColor}
                      strokeWidth={2}
                    />
                  ))}
                </>
              );
            })()}
          </g>
        )}

        {/* Live Freehand or Dragging Arrow Preview */}
        {liveDragPoints.length > 1 && (
          <polyline
            points={liveDragPoints
              .map(([lat, lng]) => {
                const [x, y] = project(lat, lng);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ')}
            fill="none"
            stroke={activeColor}
            strokeWidth={activeStrokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Active Street View Pegman / Car Heading Indicator on Map */}
        {activeStreetViewMeta && (
          <g
            transform={(() => {
              const [px, py] = project(
                activeStreetViewMeta.lat,
                activeStreetViewMeta.lng
              );
              return `translate(${px.toFixed(1)}, ${py.toFixed(1)})`;
            })()}
            style={{ pointerEvents: 'none' }}
          >
            {/* View / Car Heading Cone */}
            <g transform={`rotate(${activeStreetViewMeta.carHeadingDeg - 90})`}>
              <polygon
                points="0,0 28,-13 28,13"
                fill="#f59e0b"
                fillOpacity={0.42}
                stroke="#f59e0b"
                strokeWidth={1.2}
              />
            </g>
            <circle
              cx={0}
              cy={0}
              r={7.5}
              fill="#f59e0b"
              stroke="#ffffff"
              strokeWidth={2.5}
            />
          </g>
        )}
      </svg>
    </div>
  );
};

export const CoverageNotesTab: React.FC = () => {
  const [notebooks, setNotebooks] = useState<CoverageNotebook[]>(() =>
    loadCoverageNotebooks()
  );
  const [activeNotebookId, setActiveNotebookId] = useState<string>(
    () => loadCoverageNotebooks()[0]?.id || 'nb-botswana'
  );
  const activeNotebook = useMemo(
    () => notebooks.find((n) => n.id === activeNotebookId) || notebooks[0],
    [notebooks, activeNotebookId]
  );

  const [annotations, setAnnotations] = useState<CoverageAnnotation[]>(() =>
    loadNotebookAnnotations(activeNotebookId)
  );
  const [undoStack, setUndoStack] = useState<CoverageAnnotation[][]>([]);
  const [redoStack, setRedoStack] = useState<CoverageAnnotation[][]>([]);

  useEffect(() => {
    setAnnotations(loadNotebookAnnotations(activeNotebookId));
    setUndoStack([]);
    setRedoStack([]);
    setSelectedAnnotationId(null);
    setDraftPoints([]);
  }, [activeNotebookId]);

  const commitAnnotations = useCallback(
    (next: CoverageAnnotation[]) => {
      setUndoStack((prev) => [...prev.slice(-29), annotations]);
      setRedoStack([]);
      setAnnotations(next);
      saveNotebookAnnotations(activeNotebookId, next);
    },
    [annotations, activeNotebookId]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, annotations]);
    setUndoStack((u) => u.slice(0, -1));
    setAnnotations(prev);
    saveNotebookAnnotations(activeNotebookId, prev);
  }, [undoStack, annotations, activeNotebookId]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, annotations]);
    setRedoStack((r) => r.slice(0, -1));
    setAnnotations(next);
    saveNotebookAnnotations(activeNotebookId, next);
  }, [redoStack, annotations, activeNotebookId]);

  // Map Layer & Coverage Opacity States (Default 30% so non-annotated roads are subtle)
  const [baseLayer, setBaseLayer] = useState<'roadmap' | 'hybrid' | 'osm'>('roadmap');
  const [showOfficialCoverage, setShowOfficialCoverage] = useState<boolean>(true);
  const [coverageOpacity, setCoverageOpacity] = useState<number>(0.3);
  const [hideAllAnnotations, setHideAllAnnotations] = useState<boolean>(false);

  // Active Drawing Tool & Styling States
  const [activeTool, setActiveTool] = useState<CoverageToolId>('inspect');
  const [activeColor, setActiveColor] = useState<string>('#2563eb');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(3.5);
  const [activeDirection, setActiveDirection] =
    useState<DrivingDirectionMode>('forward');
  const [autoDetectCarDirOnClick, setAutoDetectCarDirOnClick] =
    useState<boolean>(false);
  const [freehandArrowEnd, setFreehandArrowEnd] = useState<boolean>(false);
  const [activePinCategory, setActivePinCategory] =
    useState<MetaPinCategory>('pole');

  // Draft polyline points for multi-point Road Stretch tool
  const [draftPoints, setDraftPoints] = useState<Array<[number, number]>>([]);
  const [cursorLatLng] = useState<[number, number] | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(
    null
  );

  const selectedAnnotation = useMemo(
    () => annotations.find((a) => a.id === selectedAnnotationId) || null,
    [annotations, selectedAnnotationId]
  );

  // Split-Screen Street View Panorama States
  const [svMeta, setSvMeta] = useState<OfficialStreetViewMetadata | null>(null);
  const [svViewHeading, setSvViewHeading] = useState<number>(0);
  const [svLoading, setSvLoading] = useState<boolean>(false);
  const [svStatusMessage, setSvStatusMessage] = useState<string | null>(null);
  const [showStreetViewPanel, setShowStreetViewPanel] = useState<boolean>(false);

  // Place Search & Fly Controller
  const [placeQuery, setPlaceQuery] = useState<string>('');
  const [flyTarget, setFlyTarget] = useState<{
    center: [number, number];
    zoom: number;
    seq: number;
  } | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const visibleAnnotations = useMemo(() => {
    if (!tagFilter) return annotations;
    return annotations.filter((a) => a.tags?.includes(tagFilter));
  }, [annotations, tagFilter]);

  // Keyboard shortcuts (Ctrl+Z, Ctrl+Y, Enter to finish road stretch, Esc to cancel)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Enter' && activeTool === 'road-stretch' && draftPoints.length >= 2) {
        e.preventDefault();
        finalizeDraftRoadStretch();
      } else if (e.key === 'Escape') {
        setDraftPoints([]);
        setSelectedAnnotationId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, activeTool, draftPoints]);

  const openStreetViewAt = async (
    lat: number,
    lng: number,
    autoStampArrow: boolean = false
  ) => {
    setSvLoading(true);
    setSvStatusMessage('Locating nearest official Google Street View coverage...');
    setShowStreetViewPanel(true);

    // Try 350m snap first, then 2000m snap
    let found = await fetchOfficialStreetViewAtLatLng(lat, lng, 350);
    if (!found) {
      found = await fetchOfficialStreetViewAtLatLng(lat, lng, 2200);
    }

    setSvLoading(false);
    if (!found) {
      setSvStatusMessage(
        'No official Google Street View coverage found near this point.'
      );
      return;
    }

    setSvStatusMessage(null);
    setSvMeta(found);
    setSvViewHeading(found.carHeadingDeg);

    if (autoStampArrow) {
      const p1 = offsetLatLngByHeading(
        found.lat,
        found.lng,
        found.carHeadingDeg + 180,
        240
      );
      const p2 = offsetLatLngByHeading(
        found.lat,
        found.lng,
        found.carHeadingDeg,
        240
      );
      const newArrow: CoverageAnnotation = {
        id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        kind: 'driving-arrow',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        points: [p1, p2],
        direction: 'forward',
        autoDetectedHeading: found.carHeadingDeg,
        label: found.captureDate || undefined,
        tags: ['driving-dir'],
        svPanoId: found.panoId,
        svLat: found.lat,
        svLng: found.lng,
        svHeading: found.carHeadingDeg,
        svDate: found.captureDate || undefined,
      };
      commitAnnotations([...annotations, newArrow]);
      setSelectedAnnotationId(newArrow.id);
    }
  };

  const finalizeDraftRoadStretch = () => {
    if (draftPoints.length < 2) {
      setDraftPoints([]);
      return;
    }
    const newStretch: CoverageAnnotation = {
      id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      notebookId: activeNotebookId,
      kind: 'road-stretch',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      color: activeColor,
      strokeWidth: activeStrokeWidth,
      points: draftPoints,
      direction: activeDirection,
      tags: activeDirection !== 'none' ? ['driving-dir'] : [],
      svPanoId: svMeta?.panoId,
      svLat: svMeta?.lat,
      svLng: svMeta?.lng,
      svHeading: svMeta?.carHeadingDeg,
      svDate: svMeta?.captureDate || undefined,
    };
    commitAnnotations([...annotations, newStretch]);
    setDraftPoints([]);
    setSelectedAnnotationId(newStretch.id);
  };

  const handleMapClickLatLng = (
    lat: number,
    lng: number,
    altOrRightClick: boolean
  ) => {
    if (altOrRightClick || activeTool === 'inspect') {
      openStreetViewAt(lat, lng, false);
      return;
    }

    if (activeTool === 'driving-arrow' && autoDetectCarDirOnClick) {
      openStreetViewAt(lat, lng, true);
      return;
    }

    if (activeTool === 'road-stretch') {
      setDraftPoints((prev) => [...prev, [lat, lng]]);
      return;
    }

    if (activeTool === 'text') {
      const entered = window.prompt(
        'Enter map text label (e.g. "W", "SS", "tan hills", "2012 overcast"):',
        'W'
      );
      if (!entered || !entered.trim()) return;
      const newText: CoverageAnnotation = {
        id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        kind: 'text',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        position: [lat, lng],
        text: entered.trim(),
        fontSize: 13,
      };
      commitAnnotations([...annotations, newText]);
      setSelectedAnnotationId(newText.id);
      return;
    }

    if (activeTool === 'pin') {
      const newPin: CoverageAnnotation = {
        id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        kind: 'pin',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        position: [lat, lng],
        category: activePinCategory,
        label: PIN_CATEGORY_INFO[activePinCategory].shortCode,
        tags: [activePinCategory],
        svPanoId: svMeta?.panoId,
        svLat: svMeta?.lat,
        svLng: svMeta?.lng,
        svHeading: svMeta?.carHeadingDeg,
        svDate: svMeta?.captureDate || undefined,
      };
      commitAnnotations([...annotations, newPin]);
      setSelectedAnnotationId(newPin.id);
      return;
    }

    if (activeTool === 'select') {
      setSelectedAnnotationId(null);
    }
  };

  const handleFinishFreehandOrDragArrow = (pts: Array<[number, number]>) => {
    if (pts.length < 2) {
      if (
        activeTool === 'driving-arrow' &&
        autoDetectCarDirOnClick &&
        pts.length === 1
      ) {
        openStreetViewAt(pts[0][0], pts[0][1], true);
      }
      return;
    }

    if (activeTool === 'driving-arrow') {
      const newArrow: CoverageAnnotation = {
        id: `arr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        kind: 'driving-arrow',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        points: [pts[0], pts[pts.length - 1]],
        direction: activeDirection === 'none' ? 'forward' : activeDirection,
        tags: ['driving-dir'],
      };
      commitAnnotations([...annotations, newArrow]);
      setSelectedAnnotationId(newArrow.id);
      return;
    }

    if (activeTool === 'freehand') {
      const newStroke: CoverageAnnotation = {
        id: `fh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        kind: 'freehand',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        points: pts,
        arrowEnd: freehandArrowEnd,
      };
      commitAnnotations([...annotations, newStroke]);
      setSelectedAnnotationId(newStroke.id);
    }
  };

  const updateSelectedAnnotation = (patch: Partial<CoverageAnnotation>) => {
    if (!selectedAnnotationId) return;
    const next = annotations.map((a) =>
      a.id === selectedAnnotationId
        ? ({ ...a, ...patch, updatedAt: Date.now() } as CoverageAnnotation)
        : a
    );
    commitAnnotations(next);
  };

  const deleteAnnotationById = (id: string) => {
    commitAnnotations(annotations.filter((a) => a.id !== id));
    if (selectedAnnotationId === id) setSelectedAnnotationId(null);
  };

  const handlePlaceSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = placeQuery.trim();
    if (!q) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          q
        )}&limit=1`
      );
      if (!res.ok) return;
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const lat = parseFloat(list[0].lat);
        const lon = parseFloat(list[0].lon);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          setFlyTarget({ center: [lat, lon], zoom: 11, seq: Date.now() });
        }
      }
    } catch {
      // ignore
    }
  };

  const handleCreateNotebook = () => {
    const name = window.prompt('New Coverage Notebook Name (e.g. "Botswana Roads", "Ghana Poles"):');
    if (!name || !name.trim()) return;
    const nb: CoverageNotebook = {
      id: `nb-${Date.now()}`,
      name: name.trim(),
      countryOrRegion: name.trim(),
      center: activeNotebook?.center || [-22.05, 27.95],
      zoom: activeNotebook?.zoom || 8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [...notebooks, nb];
    setNotebooks(next);
    saveCoverageNotebooks(next);
    setActiveNotebookId(nb.id);
  };

  const handleExportJson = () => {
    const payload = {
      notebook: activeNotebook,
      exportedAt: new Date().toISOString(),
      annotations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(activeNotebook?.name || 'coverage-notes')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed.annotations)) {
          commitAnnotations(parsed.annotations);
        }
      } catch {
        window.alert('Invalid Coverage Notes JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const disableMapDragging =
    activeTool === 'freehand' || activeTool === 'driving-arrow';

  return (
    <div className="flex flex-col h-[calc(100dvh-56px)] bg-slate-950 text-slate-100 overflow-hidden font-mono">
      {/* Top Bar 1: Notebook Selector, Quick Jump, Place Search, Base Map & Subtle Coverage Opacity */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 z-20 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-400 font-bold">Notebook:</span>
          <select
            value={activeNotebookId}
            onChange={(e) => {
              const nextId = e.target.value;
              setActiveNotebookId(nextId);
              const nb = notebooks.find((n) => n.id === nextId);
              if (nb) {
                setFlyTarget({ center: nb.center, zoom: nb.zoom, seq: Date.now() });
              }
            }}
            className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white font-bold text-xs outline-none focus:border-indigo-500 cursor-pointer"
          >
            {notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nb.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleCreateNotebook}
            title="Create New Coverage Notebook"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">New</span>
          </button>

          {/* Quick Jump Region Selector */}
          <select
            defaultValue=""
            onChange={(e) => {
              const idx = Number(e.target.value);
              const item = QUICK_JUMP_REGIONS[idx];
              if (item) {
                setFlyTarget({
                  center: item.center,
                  zoom: item.zoom,
                  seq: Date.now(),
                });
              }
              e.target.value = '';
            }}
            className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 text-xs outline-none cursor-pointer"
          >
            <option value="" disabled>
              Jump to Country / Region...
            </option>
            {QUICK_JUMP_REGIONS.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label}
              </option>
            ))}
          </select>

          {/* Place / Road Search */}
          <form onSubmit={handlePlaceSearch} className="relative">
            <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              placeholder="Search town or road..."
              className="w-36 sm:w-44 pl-6 pr-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-white outline-none focus:border-indigo-500"
            />
          </form>
        </div>

        {/* Map Layer & Subtle Official Coverage Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
            {(
              [
                { id: 'roadmap', label: 'Google Map' },
                { id: 'hybrid', label: 'Satellite' },
                { id: 'osm', label: 'OSM' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setBaseLayer(m.id)}
                className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                  baseLayer === m.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Official SV Coverage Toggle + Dimming Slider (Default 30% so unannotated roads stay subtle) */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800">
            <button
              type="button"
              onClick={() => setShowOfficialCoverage((v) => !v)}
              className={`inline-flex items-center gap-1 font-bold text-[11px] cursor-pointer ${
                showOfficialCoverage ? 'text-sky-400' : 'text-slate-500'
              }`}
              title="Toggle Official Google Street View Coverage Overlay"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>SV Lines</span>
            </button>
            {showOfficialCoverage && (
              <>
                <input
                  type="range"
                  min={0.08}
                  max={1}
                  step={0.05}
                  value={coverageOpacity}
                  onChange={(e) => setCoverageOpacity(Number(e.target.value))}
                  title={`Unannotated Coverage Line Opacity: ${Math.round(
                    coverageOpacity * 100
                  )}%`}
                  className="w-16 accent-sky-500 cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 w-7 text-right">
                  {Math.round(coverageOpacity * 100)}%
                </span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setHideAllAnnotations((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
              hideAllAnnotations
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
            }`}
            title="Temporarily hide your notes to test yourself blind"
          >
            {hideAllAnnotations ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span>Notes Hidden</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Notes ({annotations.length})</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            title="Export Notebook to JSON"
            className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <label
            title="Import Notebook from JSON"
            className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <input
              type="file"
              accept=".json"
              onChange={handleImportJson}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Top Bar 2: Annotation Tools, Driving Direction Controls, Color Palette, Undo/Redo */}
      <div className="bg-slate-900/95 border-b border-slate-800 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 z-20 text-xs">
        <div className="flex items-center gap-1 flex-wrap">
          {(
            [
              {
                id: 'inspect',
                label: 'Street View Inspect',
                icon: Navigation,
                hint: 'Click any covered road to open Street View & see car heading/date (or Right-Click anytime)',
              },
              {
                id: 'road-stretch',
                label: 'Road Stretch',
                icon: GitCommitHorizontal,
                hint: 'Click points along a road, then Double-Click or press Enter to save with driving direction arrows',
              },
              {
                id: 'driving-arrow',
                label: 'Driving Arrow',
                icon: MoveRight,
                hint: 'Drag to draw a driving direction arrow (or enable Auto-Detect to stamp official car direction on click)',
              },
              {
                id: 'freehand',
                label: 'Freehand Pen',
                icon: Pencil,
                hint: 'Draw freely on the map (poles, horizon hills, custom symbols)',
              },
              {
                id: 'text',
                label: 'Text Label',
                icon: Type,
                hint: 'Click map to place a visible text note (e.g. "W", "SS", "tan hills")',
              },
              {
                id: 'pin',
                label: 'Meta Pin / Pole',
                icon: MapPin,
                hint: 'Drop a pin for a specific pole, sign, bollard, cloud, or dead pixel with sketch pad',
              },
              {
                id: 'select',
                label: 'Select / Edit',
                icon: MousePointer,
                hint: 'Click any existing annotation to edit notes, flip direction, or recolor',
              },
              {
                id: 'eraser',
                label: 'Eraser',
                icon: Eraser,
                hint: 'Click any annotation on the map to delete it',
              },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                title={t.hint}
                onClick={() => {
                  if (activeTool === 'road-stretch' && draftPoints.length >= 2) {
                    finalizeDraftRoadStretch();
                  } else {
                    setDraftPoints([]);
                  }
                  setActiveTool(t.id);
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-bold transition cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-slate-950 border border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}

          {activeTool === 'road-stretch' && draftPoints.length >= 2 && (
            <button
              type="button"
              onClick={finalizeDraftRoadStretch}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer animate-pulse"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Finish Road Stretch [Enter]</span>
            </button>
          )}
        </div>

        {/* Context Sub-Options: Driving Direction, Auto-Car-Heading, Pin Type, Colors & Undo/Redo */}
        <div className="flex items-center gap-2 flex-wrap">
          {(activeTool === 'road-stretch' || activeTool === 'driving-arrow') && (
            <div className="inline-flex items-center rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
              <span className="px-1.5 text-slate-500">Car Dir:</span>
              {(
                [
                  { id: 'forward', label: 'A → B' },
                  { id: 'reverse', label: 'B ← A' },
                  { id: 'both', label: 'A ↔ B' },
                  { id: 'none', label: 'No Arrow' },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setActiveDirection(d.id)}
                  className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                    activeDirection === d.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}

          {activeTool === 'driving-arrow' && (
            <button
              type="button"
              onClick={() => setAutoDetectCarDirOnClick((v) => !v)}
              title="When enabled, clicking a covered road queries Google Street View and automatically stamps an arrow in the official Google car's driving direction!"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
                autoDetectCarDirOnClick
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>
                Auto-Stamp Official Car Dir: {autoDetectCarDirOnClick ? 'On' : 'Off'}
              </span>
            </button>
          )}

          {activeTool === 'freehand' && (
            <button
              type="button"
              onClick={() => setFreehandArrowEnd((v) => !v)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
                freehandArrowEnd
                  ? 'bg-indigo-500/20 border-indigo-400 text-indigo-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Arrowhead End: {freehandArrowEnd ? 'On' : 'Off'}</span>
            </button>
          )}

          {activeTool === 'pin' && (
            <select
              value={activePinCategory}
              onChange={(e) => setActivePinCategory(e.target.value as MetaPinCategory)}
              className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white text-[11px] font-bold cursor-pointer"
            >
              {Object.entries(PIN_CATEGORY_INFO).map(([k, v]) => (
                <option key={k} value={k}>
                  Pin: {v.label}
                </option>
              ))}
            </select>
          )}

          {/* Color Swatches & Stroke Width */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onClick={() => {
                  setActiveColor(c.id);
                  if (selectedAnnotation) {
                    updateSelectedAnnotation({ color: c.id });
                  }
                }}
                className={`w-4 h-4 rounded-full border transition cursor-pointer ${
                  activeColor === c.id
                    ? 'border-white scale-125 shadow'
                    : 'border-slate-700 opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: c.id }}
              />
            ))}
            <select
              value={activeStrokeWidth}
              onChange={(e) => {
                const w = Number(e.target.value);
                setActiveStrokeWidth(w);
                if (selectedAnnotation) {
                  updateSelectedAnnotation({ strokeWidth: w });
                }
              }}
              title="Line / Stroke Thickness"
              className="ml-1 bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-300 cursor-pointer"
            >
              <option value={2}>Thin</option>
              <option value={3.5}>Medium</option>
              <option value={5.5}>Thick</option>
            </select>
          </div>

          {/* Undo / Redo / Reset */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Undo (Ctrl+Z)"
              className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title="Redo (Ctrl+Y)"
              className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  annotations.length > 0 &&
                  window.confirm(
                    `Clear all ${annotations.length} annotations in "${activeNotebook?.name}"?`
                  )
                ) {
                  commitAnnotations([]);
                  setSelectedAnnotationId(null);
                }
              }}
              title="Clear All Annotations in Current Notebook"
              className="p-1 rounded bg-slate-950 border border-slate-800 text-rose-400 hover:bg-rose-500/15 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Split-Screen Workspace: Map + Vector Overlay on Left, Interactive Street View Panorama + Note Inspector on Right */}
      <div className="relative flex-1 flex flex-col lg:flex-row w-full h-full overflow-hidden">
        {/* Left / Main Map Area */}
        <div className="relative flex-1 h-full w-full">
          <MapContainer
            center={activeNotebook?.center || [-22.05, 27.95]}
            zoom={activeNotebook?.zoom || 9}
            className="w-full h-full z-0"
            zoomControl={true}
            doubleClickZoom={activeTool !== 'road-stretch'}
          >
            <MapViewportController
              flyTarget={flyTarget}
              disableDragging={disableMapDragging}
              onViewportChange={(center, zoom) => {
                const updated = notebooks.map((n) =>
                  n.id === activeNotebookId ? { ...n, center, zoom } : n
                );
                setNotebooks(updated);
                saveCoverageNotebooks(updated);
              }}
            />

            {/* Base Map Layer (Exact Google Non-Terrain Roadmap by default) */}
            <TileLayer
              key={`base-${baseLayer}`}
              url={
                baseLayer === 'roadmap'
                  ? GOOGLE_ROADMAP_TILES
                  : baseLayer === 'hybrid'
                  ? GOOGLE_HYBRID_TILES
                  : OSM_TILES
              }
              maxZoom={20}
              attribution="&copy; Google Maps"
            />

            {/* Official Google Street View Coverage Blue Lines Layer (Dimmed to 30% by default so unannotated roads stay subtle) */}
            {showOfficialCoverage && (
              <TileLayer
                key="official-sv-coverage"
                url={GOOGLE_OFFICIAL_SV_COVERAGE_TILES}
                opacity={coverageOpacity}
                maxZoom={20}
                zIndex={250}
              />
            )}

            {/* Geographic Vector Annotation Layer */}
            <CoverageVectorOverlay
              annotations={visibleAnnotations}
              selectedId={selectedAnnotationId}
              draftPoints={draftPoints}
              cursorLatLng={cursorLatLng}
              activeTool={activeTool}
              activeColor={activeColor}
              activeStrokeWidth={activeStrokeWidth}
              activeDirection={activeDirection}
              activeStreetViewMeta={svMeta}
              hideAllAnnotations={hideAllAnnotations}
              onSelectAnnotation={(id) => setSelectedAnnotationId(id)}
              onEraseAnnotation={(id) => deleteAnnotationById(id)}
              onMapClickLatLng={handleMapClickLatLng}
              onMapDoubleClick={finalizeDraftRoadStretch}
              onFinishFreehandOrDragArrow={handleFinishFreehandOrDragArrow}
            />
          </MapContainer>

          {/* Bottom-Left Helper Hint & Tag Filter Bar */}
          <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-1.5 max-w-[calc(100%-24px)] pointer-events-auto">
            <div className="px-2.5 py-1 rounded-lg bg-slate-900/90 backdrop-blur border border-slate-700 text-[11px] text-slate-300 shadow-lg">
              {activeTool === 'inspect' &&
                'Click any covered road to open Street View & see official car driving direction'}
              {activeTool === 'road-stretch' &&
                `Click points along road (${draftPoints.length} pts) • Double-click or press Enter to finish`}
              {activeTool === 'driving-arrow' &&
                (autoDetectCarDirOnClick
                  ? 'Click any covered road to auto-stamp the Google car driving direction arrow!'
                  : 'Click and drag to draw a directional arrow (or Right-Click for Street View)')}
              {activeTool === 'freehand' &&
                'Drag to draw freehand notes/diagrams on the map (Right-Click for Street View)'}
              {activeTool === 'text' &&
                'Click anywhere on the map to place a text label'}
              {activeTool === 'pin' &&
                `Click map to place a ${PIN_CATEGORY_INFO[activePinCategory].label} pin`}
              {activeTool === 'select' &&
                'Click any annotation to edit its label, driving direction, sketch, or notes'}
              {activeTool === 'eraser' && 'Click any annotation to delete it'}
            </div>

            {annotations.length > 0 && (
              <div className="flex items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg px-2 py-1 text-[10px]">
                <span className="text-slate-400">Filter Tag:</span>
                <button
                  type="button"
                  onClick={() => setTagFilter(null)}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    tagFilter === null
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                {COMMON_META_TAGS.slice(0, 6).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTagFilter(tagFilter === t ? null : t)}
                    className={`px-1.5 py-0.5 rounded cursor-pointer ${
                      tagFilter === t
                        ? 'bg-indigo-600 text-white font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Floating Selected Annotation Inspector Card */}
          {selectedAnnotation && (
            <div className="absolute top-3 left-3 z-20 w-80 max-w-[calc(100%-24px)] max-h-[calc(100%-64px)] overflow-y-auto bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl p-3.5 shadow-2xl space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="capitalize">
                    {selectedAnnotation.kind.replace('-', ' ')} Note
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => deleteAnnotationById(selectedAnnotation.id)}
                    title="Delete Annotation"
                    className="p-1 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAnnotationId(null)}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Map Label / Text */}
              <div className="space-y-1">
                <label className="block text-[10px] text-slate-400 font-bold">
                  {selectedAnnotation.kind === 'text'
                    ? 'Map Text'
                    : 'On-Map Label (e.g. W, SS, tan hills, 2012)'}
                </label>
                <input
                  type="text"
                  value={
                    selectedAnnotation.kind === 'text'
                      ? selectedAnnotation.text
                      : selectedAnnotation.label || ''
                  }
                  onChange={(e) => {
                    if (selectedAnnotation.kind === 'text') {
                      updateSelectedAnnotation({ text: e.target.value });
                    } else {
                      updateSelectedAnnotation({ label: e.target.value });
                    }
                  }}
                  placeholder="Label shown on map..."
                  className="w-full px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500"
                />
              </div>

              {/* Driving Direction Controls for Road Stretches & Arrows */}
              {(selectedAnnotation.kind === 'road-stretch' ||
                selectedAnnotation.kind === 'driving-arrow') && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold">
                      Car Driving Direction
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const cur = selectedAnnotation.direction;
                        const flipped: DrivingDirectionMode =
                          cur === 'forward'
                            ? 'reverse'
                            : cur === 'reverse'
                            ? 'forward'
                            : cur;
                        updateSelectedAnnotation({ direction: flipped });
                      }}
                      className="text-[10px] text-indigo-300 hover:text-white underline cursor-pointer"
                    >
                      Flip A ↔ B
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(
                      [
                        { id: 'forward', label: 'A → B' },
                        { id: 'reverse', label: 'B ← A' },
                        { id: 'both', label: 'A ↔ B' },
                        { id: 'none', label: 'None' },
                      ] as const
                    ).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => updateSelectedAnnotation({ direction: d.id })}
                        className={`py-1 rounded text-[11px] font-bold border cursor-pointer ${
                          selectedAnnotation.direction === d.id
                            ? 'bg-indigo-600 border-indigo-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Detailed Road / Meta Notes */}
              <div className="space-y-1">
                <label className="block text-[10px] text-slate-400 font-bold">
                  Detailed Meta Notes (Weather, Poles, Clouds, Sun/Moon, Dead Pixels)
                </label>
                <textarea
                  rows={3}
                  value={selectedAnnotation.notes || ''}
                  onChange={(e) => updateSelectedAnnotation({ notes: e.target.value })}
                  placeholder="Write road meta notes..."
                  className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-white text-xs outline-none focus:border-indigo-500 resize-y"
                />
              </div>

              {/* Mini Sketch Canvas for Pole / Sign / Horizon */}
              {selectedAnnotation.kind === 'pin' && (
                <MiniPoleSketchCanvas
                  initialDataUrl={selectedAnnotation.imageDataUrl}
                  onSave={(dataUrl) =>
                    updateSelectedAnnotation({ imageDataUrl: dataUrl })
                  }
                />
              )}

              {/* Tags */}
              <div className="space-y-1">
                <span className="block text-[10px] text-slate-400 font-bold">Tags</span>
                <div className="flex flex-wrap gap-1">
                  {COMMON_META_TAGS.map((tag) => {
                    const has = selectedAnnotation.tags?.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          const cur = selectedAnnotation.tags || [];
                          const next = has
                            ? cur.filter((t) => t !== tag)
                            : [...cur, tag];
                          updateSelectedAnnotation({ tags: next });
                        }}
                        className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                          has
                            ? 'bg-indigo-600/30 border-indigo-400 text-indigo-200 font-bold'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Open Street View at Annotation */}
              <button
                type="button"
                onClick={() => {
                  if (
                    selectedAnnotation.kind === 'pin' ||
                    selectedAnnotation.kind === 'text'
                  ) {
                    openStreetViewAt(
                      selectedAnnotation.position[0],
                      selectedAnnotation.position[1],
                      false
                    );
                  } else if (selectedAnnotation.points.length > 0) {
                    const mid =
                      selectedAnnotation.points[
                        Math.floor(selectedAnnotation.points.length / 2)
                      ];
                    openStreetViewAt(mid[0], mid[1], false);
                  }
                }}
                className="w-full py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Open Street View Here</span>
              </button>
            </div>
          )}
        </div>

        {/* Right / Split-Screen Interactive Official Street View Panorama Panel */}
        {showStreetViewPanel && (
          <div className="w-full lg:w-[45%] xl:w-[48%] h-[46%] lg:h-full bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col shrink-0 z-20">
            {/* Street View Panel Header */}
            <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Compass className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="truncate">
                  <span className="font-bold text-white">
                    {svMeta?.description || 'Official Street View'}
                  </span>
                  {svMeta?.captureDate && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                      {svMeta.captureDate}
                    </span>
                  )}
                  {svMeta && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
                      Car Dir: {formatCompassCardinal(svMeta.carHeadingDeg)}
                    </span>
                  )}
                  {svMeta?.elevationMeters !== null &&
                    svMeta?.elevationMeters !== undefined && (
                      <span className="ml-1.5 text-[10px] text-slate-400">
                        {svMeta.elevationMeters}m
                      </span>
                    )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {svMeta && (
                  <a
                    href={buildGoogleMapsDirectPanoUrl(
                      svMeta.lat,
                      svMeta.lng,
                      svViewHeading,
                      svMeta.panoId
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold"
                  >
                    <span>Google Maps</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setShowStreetViewPanel(false)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Quick Road-Meta Stamp Bar Inside Street View Panel */}
            {svMeta && (
              <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const p1 = offsetLatLngByHeading(
                        svMeta.lat,
                        svMeta.lng,
                        svMeta.carHeadingDeg + 180,
                        240
                      );
                      const p2 = offsetLatLngByHeading(
                        svMeta.lat,
                        svMeta.lng,
                        svMeta.carHeadingDeg,
                        240
                      );
                      const newArrow: CoverageAnnotation = {
                        id: `arr-${Date.now()}`,
                        notebookId: activeNotebookId,
                        kind: 'driving-arrow',
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        color: activeColor,
                        strokeWidth: activeStrokeWidth,
                        points: [p1, p2],
                        direction: 'forward',
                        autoDetectedHeading: svMeta.carHeadingDeg,
                        label: svMeta.captureDate || undefined,
                        tags: ['driving-dir'],
                        svPanoId: svMeta.panoId,
                        svLat: svMeta.lat,
                        svLng: svMeta.lng,
                        svHeading: svMeta.carHeadingDeg,
                        svDate: svMeta.captureDate || undefined,
                      };
                      commitAnnotations([...annotations, newArrow]);
                      setSelectedAnnotationId(newArrow.id);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 font-bold cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>
                      Stamp Car Arrow ({formatCompassCardinal(svMeta.carHeadingDeg)})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const newPin: CoverageAnnotation = {
                        id: `pin-${Date.now()}`,
                        notebookId: activeNotebookId,
                        kind: 'pin',
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        color: activeColor,
                        strokeWidth: activeStrokeWidth,
                        position: [svMeta.lat, svMeta.lng],
                        category: activePinCategory,
                        label:
                          svMeta.captureDate ||
                          PIN_CATEGORY_INFO[activePinCategory].shortCode,
                        tags: [activePinCategory],
                        svPanoId: svMeta.panoId,
                        svLat: svMeta.lat,
                        svLng: svMeta.lng,
                        svHeading: svMeta.carHeadingDeg,
                        svDate: svMeta.captureDate || undefined,
                      };
                      commitAnnotations([...annotations, newPin]);
                      setSelectedAnnotationId(newPin.id);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 font-bold cursor-pointer"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Drop Meta Pin Here</span>
                  </button>
                </div>

                {/* Orientation / Step Along Road Controls */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSvViewHeading(svMeta.carHeadingDeg)}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    title="Face Forward in Car Driving Direction"
                  >
                    Face Forward
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSvViewHeading((svMeta.carHeadingDeg + 180) % 360)
                    }
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    title="Face Backward (Check Rear Car / Sun / Follow Car)"
                  >
                    Face Back
                  </button>
                </div>
              </div>
            )}

            {/* Embedded Interactive 360° Panorama Viewer */}
            <div className="relative flex-1 bg-slate-950">
              {svLoading ? (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                  Loading official Google Street View panorama...
                </div>
              ) : svStatusMessage ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-2">
                  <p className="text-xs text-amber-300 font-bold">{svStatusMessage}</p>
                  <p className="text-[11px] text-slate-500">
                    Click closer to a blue Street View line on the map to load its panorama.
                  </p>
                </div>
              ) : svMeta ? (
                <iframe
                  key={`${svMeta.panoId}-${Math.round(svViewHeading)}`}
                  src={buildStreetViewEmbedUrl(
                    svMeta.panoId,
                    svMeta.lat,
                    svMeta.lng,
                    svViewHeading,
                    0
                  )}
                  className="w-full h-full border-0"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Official Google Street View Panorama"
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import {
  ArrowUpRight,
  Bookmark,
  Compass,
  Crosshair,
  Download,
  Eraser,
  Eye,
  EyeOff,
  ExternalLink,
  Filter,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  Layers,
  MapPin,
  Maximize2,
  MousePointer,
  Navigation,
  Pencil,
  Redo2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type {
  CardinalDirectionFilter,
  CoverageAnnotation,
  CoverageNotebook,
  CoverageTagNode,
  CoverageToolId,
  DrivingDirectionMode,
  OfficialStreetViewMetadata,
  RoadPointOfInterest,
  RoadSideLineAttachment,
  RoadSnapSubMode,
  SideLineTagDefinition,
} from '../types/coverageNotes';
import {
  exportNotebookJson,
  fetchOfficialStreetViewAtLatLng,
  fetchSingleClickRoadSection,
  loadCoverageNotebooks,
  loadCoverageTagTree,
  loadNotebookAnnotations,
  loadSideLineTags,
  loadSvCoverageStylePrefs,
  saveCoverageNotebooks,
  saveCoverageTagTree,
  saveNotebookAnnotations,
  saveSideLineTags,
  saveSvCoverageStylePrefs,
  snapPathToOfficialCoveredRoad,
  toggleTagWithAutoAncestors,
  type CoverageExportBundle,
} from '../utils/coverageStorage';
import {
  collectAvailableAutoMetadata,
  doesSpanMatchAutoMetaFilters,
  evaluateBooleanQueryString,
  getDescendantIdsInclusive,
  type StructuredAutoMetaFilters,
} from '../utils/coverageFilterEngine';
import {
  PinSketchCanvas,
  StreetViewSphericalViewer,
  buildChevronPolylines,
  computeCompassBearing,
  computeSideOutwardCompassBearing,
  extractSubPolylineByFraction,
  formatCompassDirection,
  hexToRgbNormalized,
  interpolatePointOnPolylineByFraction,
  isAngleWithinCardinalFilter,
  offsetPolylinePerpendicular,
  projectPointOntoRoadStretch,
  resolveSideLineFractions,
} from './CoverageSubComponents';

const GOOGLE_ROADMAP_TILES =
  'https://mt1.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}';
const GOOGLE_HYBRID_TILES =
  'https://mt1.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}';
const GOOGLE_OFFICIAL_SV_COVERAGE_TILES =
  'https://mts1.google.com/vt?pb=!1m4!1m3!1i{z}!2i{x}!3i{y}!2m8!1e2!2ssvv!4m2!1scc!2s*211m3*211e2*212b1*213e2*212b1*214b1!4m2!1ssvl!2s*212b1!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0';

const ANNOTATION_COLORS = [
  { id: '#2563eb', label: 'Blue' },
  { id: '#ec4899', label: 'Pink' },
  { id: '#f97316', label: 'Orange' },
  { id: '#16a34a', label: 'Green' },
  { id: '#dc2626', label: 'Red' },
  { id: '#9333ea', label: 'Purple' },
  { id: '#eab308', label: 'Yellow' },
  { id: '#06b6d4', label: 'Cyan' },
  { id: '#1e293b', label: 'Black' },
];

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MapInteractionController: React.FC<{
  activeTool: CoverageToolId;
  roadSnapSubMode: RoadSnapSubMode;
  onZoomChange: (zoom: number) => void;
  onMapSingleClick: (lat: number, lng: number, altOrRight: boolean) => void;
  onMapDoubleClick: () => void;
  onFinishDragStroke: (pts: Array<[number, number]>) => void;
  onUpdateLiveDrag: (pts: Array<[number, number]>) => void;
}> = ({
  activeTool,
  roadSnapSubMode,
  onZoomChange,
  onMapSingleClick,
  onMapDoubleClick,
  onFinishDragStroke,
  onUpdateLiveDrag,
}) => {
  const map = useMap();
  const isDraggingStrokeRef = useRef(false);
  const strokePtsRef = useRef<Array<[number, number]>>([]);

  const isDragDrawingMode =
    activeTool === 'freehand' ||
    activeTool === 'side-line' ||
    (activeTool === 'road-stretch' && roadSnapSubMode === 'freedraw-snap');

  useEffect(() => {
    if (isDragDrawingMode) {
      map.dragging.disable();
      map.doubleClickZoom.disable();
    } else if (activeTool === 'road-stretch') {
      map.dragging.enable();
      map.doubleClickZoom.disable();
    } else {
      map.dragging.enable();
      map.doubleClickZoom.enable();
    }
  }, [map, activeTool, isDragDrawingMode]);

  useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    },
    click: (e) => {
      const orig = e.originalEvent as MouseEvent;
      if (isDragDrawingMode) return;
      onMapSingleClick(
        e.latlng.lat,
        e.latlng.lng,
        orig.altKey || orig.button === 2
      );
    },
    contextmenu: (e) => {
      e.originalEvent.preventDefault();
      onMapSingleClick(e.latlng.lat, e.latlng.lng, true);
    },
    dblclick: () => {
      if (activeTool === 'road-stretch' && roadSnapSubMode === 'point-to-point') {
        onMapDoubleClick();
      }
    },
    mousedown: (e) => {
      const orig = e.originalEvent as MouseEvent;
      if (orig.button !== 0 || orig.altKey || !isDragDrawingMode) return;
      isDraggingStrokeRef.current = true;
      const startPt: [number, number] = [e.latlng.lat, e.latlng.lng];
      strokePtsRef.current = [startPt];
      onUpdateLiveDrag([startPt]);
    },
    mousemove: (e) => {
      if (!isDraggingStrokeRef.current) return;
      const nextPt: [number, number] = [e.latlng.lat, e.latlng.lng];
      const prev = strokePtsRef.current[strokePtsRef.current.length - 1];
      if (
        !prev ||
        Math.hypot(nextPt[0] - prev[0], nextPt[1] - prev[1]) > 0.00004
      ) {
        strokePtsRef.current.push(nextPt);
        onUpdateLiveDrag([...strokePtsRef.current]);
      }
    },
    mouseup: () => {
      if (!isDraggingStrokeRef.current) return;
      isDraggingStrokeRef.current = false;
      const pts = [...strokePtsRef.current];
      strokePtsRef.current = [];
      onUpdateLiveDrag([]);
      if (pts.length >= 1) {
        onFinishDragStroke(pts);
      }
    },
  });

  return null;
};

const MapFlyController: React.FC<{
  target: { center: [number, number]; zoom: number; seq: number } | null;
}> = ({ target }) => {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.setView(target.center, target.zoom, { animate: true });
  }, [map, target]);
  return null;
};

export const CoverageNotesTab: React.FC = () => {
  const [notebooks, setNotebooks] = useState<CoverageNotebook[]>(() =>
    loadCoverageNotebooks()
  );
  const [activeNotebookId, setActiveNotebookId] = useState<string>(
    () => loadCoverageNotebooks()[0]?.id || 'nb-default'
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

  // Hierarchical Tag Tree & Hierarchical Side Line Tag Tree
  const [tagTree, setTagTree] = useState<CoverageTagNode[]>(() =>
    loadCoverageTagTree()
  );
  const [sideLineTags, setSideLineTags] = useState<SideLineTagDefinition[]>(() =>
    loadSideLineTags()
  );
  const [activeSideLineTagId, setActiveSideLineTagId] = useState<string>('');

  useEffect(() => {
    if (
      sideLineTags.length > 0 &&
      !sideLineTags.some((t) => t.id === activeSideLineTagId)
    ) {
      setActiveSideLineTagId(sideLineTags[0].id);
    }
  }, [sideLineTags, activeSideLineTagId]);

  // Customizable Official SV Coverage Style + Side Line Min Zoom
  const initialSvPrefs = useMemo(() => loadSvCoverageStylePrefs(), []);
  const [baseLayer, setBaseLayer] = useState<'roadmap' | 'hybrid' | 'osm'>(
    'roadmap'
  );
  const [showOfficialCoverage, setShowOfficialCoverage] = useState<boolean>(
    initialSvPrefs.visible
  );
  const [coverageOpacity, setCoverageOpacity] = useState<number>(
    initialSvPrefs.opacity
  );
  const [svLineColor, setSvLineColor] = useState<string>(initialSvPrefs.color);
  const [sideLineMinZoom, setSideLineMinZoom] = useState<number>(
    initialSvPrefs.sideLineMinZoom
  );
  const [hideAllAnnotations, setHideAllAnnotations] = useState<boolean>(false);

  useEffect(() => {
    saveSvCoverageStylePrefs({
      color: svLineColor,
      opacity: coverageOpacity,
      visible: showOfficialCoverage,
      sideLineMinZoom,
    });
  }, [svLineColor, coverageOpacity, showOfficialCoverage, sideLineMinZoom]);

  // Default tool is 'select' (Select / Edit), placed first and slightly highlighted
  const [activeTool, setActiveTool] = useState<CoverageToolId>('select');
  const [roadSnapSubMode, setRoadSnapSubMode] =
    useState<RoadSnapSubMode>('freedraw-snap');
  const [activeColor, setActiveColor] = useState<string>('#2563eb');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(4);
  const [activeDirection, setActiveDirection] =
    useState<DrivingDirectionMode>('forward');
  const [autoDetectCarDir, setAutoDetectCarDir] = useState<boolean>(false);
  const [freehandArrowEnd, setFreehandArrowEnd] = useState<boolean>(false);

  // Map Zoom & Live Drawing States
  const [mapZoom, setMapZoom] = useState<number>(activeNotebook.defaultZoom);
  const [draftPoints, setDraftPoints] = useState<Array<[number, number]>>([]);
  const [liveDragPoints, setLiveDragPoints] = useState<Array<[number, number]>>(
    []
  );
  const [snapStatusMsg, setSnapStatusMsg] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(null);

  // Split-Screen Street View Panorama States & Panel Size
  const [svMeta, setSvMeta] = useState<OfficialStreetViewMetadata | null>(null);
  const [svViewHeading, setSvViewHeading] = useState<number>(0);
  const [svViewPitch, setSvViewPitch] = useState<number>(0);
  const [svLoading, setSvLoading] = useState<boolean>(false);
  const [svStatusMessage, setSvStatusMessage] = useState<string | null>(null);
  const [showStreetViewPanel, setShowStreetViewPanel] =
    useState<boolean>(false);
  const [useIframeFallback, setUseIframeFallback] = useState<boolean>(false);
  const [sidebarSize, setSidebarSize] = useState<'compact' | 'standard' | 'wide'>(
    'standard'
  );

  // Tags & Filters Panel + Boolean Expression + Auto-Meta Filters
  const [showTagManagerPanel, setShowTagManagerPanel] =
    useState<boolean>(false);
  const [booleanQuery, setBooleanQuery] = useState<string>('');
  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState<string[]>(
    []
  );
  const [autoSelectedFilterTagIds, setAutoSelectedFilterTagIds] = useState<
    string[]
  >([]);
  const [filterCombinationMode, setFilterCombinationMode] = useState<
    'AND' | 'OR'
  >('AND');

  // Auto-Metadata & Side-Line Cardinal Filters
  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterSeason, setFilterSeason] = useState<string>('all');
  const [filterCameraGen, setFilterCameraGen] = useState<string>('all');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [filterRegion, setFilterRegion] = useState<string>('all');
  const [selectedFilterSideLineTagId, setSelectedFilterSideLineTagId] =
    useState<string>('all');
  const [cardinalDirectionFilter, setCardinalDirectionFilter] =
    useState<CardinalDirectionFilter>('all');

  // Tag Creation Inputs (Road Tag Tree)
  const [newTagName, setNewTagName] = useState<string>('');
  const [newTagParentId, setNewTagParentId] = useState<string>('');
  const [newTagColor, setNewTagColor] = useState<string>('#38bdf8');

  // Side Line Tag Creation Inputs (Side Line Tag Tree)
  const [newSideLineTagName, setNewSideLineTagName] = useState<string>('');
  const [newSideLineTagParentId, setNewSideLineTagParentId] =
    useState<string>('');
  const [newSideLineTagColor, setNewSideLineTagColor] =
    useState<string>('#ef4444');

  // Place Search & Fly Controller
  const [placeQuery, setPlaceQuery] = useState<string>('');
  const [flyTarget, setFlyTarget] = useState<{
    center: [number, number];
    zoom: number;
    seq: number;
  } | null>(null);

  useEffect(() => {
    const loaded = loadNotebookAnnotations(activeNotebookId);
    setAnnotations(loaded);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedAnnotationId(null);
    setDraftPoints([]);
  }, [activeNotebookId]);

  const commitAnnotations = useCallback(
    (next: CoverageAnnotation[]) => {
      setUndoStack((prev) => [...prev.slice(-35), annotations]);
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

  const selectedAnnotation = useMemo(
    () => annotations.find((a) => a.id === selectedAnnotationId) || null,
    [annotations, selectedAnnotationId]
  );

  const updateSelectedAnnotation = (patch: Partial<CoverageAnnotation>) => {
    if (!selectedAnnotationId) return;
    const next = annotations.map((a) =>
      a.id === selectedAnnotationId
        ? { ...a, ...patch, updatedAt: Date.now() }
        : a
    );
    commitAnnotations(next);
  };

  const deleteAnnotationById = (id: string) => {
    const next = annotations.filter((a) => a.id !== id);
    commitAnnotations(next);
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  };

  const closeTemporaryStreetView = useCallback(() => {
    setShowStreetViewPanel(false);
    setSvMeta(null);
    setSvStatusMessage(null);
  }, []);

  const markedSphereForActivePano = useMemo(() => {
    if (!svMeta) return null;
    return (
      annotations.find(
        (a) => a.type === 'sphere' && a.panoId === svMeta.panoId
      ) || null
    );
  }, [annotations, svMeta]);

  const handleMarkOrUnmarkActiveSphere = () => {
    if (!svMeta) return;
    if (markedSphereForActivePano) {
      deleteAnnotationById(markedSphereForActivePano.id);
      return;
    }
    const newSphere: CoverageAnnotation = {
      id: `sph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      notebookId: activeNotebookId,
      type: 'sphere',
      position: [svMeta.lat, svMeta.lng],
      color: '#f59e0b',
      panoId: svMeta.panoId,
      carHeadingDeg: svMeta.carHeadingDeg,
      viewHeadingDeg: svViewHeading,
      viewPitchDeg: svViewPitch,
      captureDate: svMeta.captureDate,
      cameraGen: svMeta.cameraGen,
      countryCode: svMeta.countryCode,
      regionName: svMeta.regionName,
      elevationMeters: svMeta.elevationMeters,
      label: '',
      notes: '',
      tagIds: [],
      autoSelectedTagIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    commitAnnotations([...annotations, newSphere]);
    setSelectedAnnotationId(newSphere.id);
  };

  const openStreetViewAt = async (lat: number, lng: number) => {
    setSvLoading(true);
    setSvStatusMessage('Locating official Google Street View coverage...');
    setShowStreetViewPanel(true);

    let found = await fetchOfficialStreetViewAtLatLng(lat, lng, 350);
    if (!found) {
      found = await fetchOfficialStreetViewAtLatLng(lat, lng, 1800);
    }

    setSvLoading(false);
    if (!found) {
      setSvStatusMessage(
        'No official Google Street View coverage found near this point.'
      );
      setSvMeta(null);
      return;
    }

    setSvStatusMessage(null);
    setSvMeta(found);
    setSvViewHeading(found.carHeadingDeg);
    setSvViewPitch(0);
  };

  /**
   * Snaps a Road Stretch strictly to roads with official Google Street View coverage
   * and attaches per-segment `autoMetaSpans` (year, month, season, cameraGen, country, region).
   */
  const createSnappedRoadStretch = async (
    rawPoints: Array<[number, number]>
  ) => {
    if (rawPoints.length < 2) return;
    setSnapStatusMsg(
      'Verifying official Street View coverage & extracting metadata...'
    );
    const result = await snapPathToOfficialCoveredRoad(rawPoints, mapZoom);

    if (!result || result.points.length < 2) {
      setSnapStatusMsg(
        'Rejected: No official Street View coverage on that road section.'
      );
      window.setTimeout(() => setSnapStatusMsg(null), 3200);
      setDraftPoints([]);
      return;
    }

    const snappedPoints = result.points;
    const primary = result.primaryMeta;
    let directionToUse: DrivingDirectionMode = activeDirection;

    if (
      autoDetectCarDir &&
      primary.carHeadingDeg !== undefined &&
      snappedPoints.length >= 2
    ) {
      const startPt = snappedPoints[0];
      const endPt = snappedPoints[snappedPoints.length - 1];
      const drawnBearing = computeCompassBearing(
        startPt[0],
        startPt[1],
        endPt[0],
        endPt[1]
      );
      const angleDiff = Math.abs(
        (((primary.carHeadingDeg - drawnBearing) % 360) + 540) % 360 - 180
      );
      directionToUse = angleDiff <= 90 ? 'forward' : 'reverse';
    }

    setSnapStatusMsg(null);

    const newStretch: CoverageAnnotation = {
      id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      notebookId: activeNotebookId,
      type: 'road-stretch',
      points: snappedPoints,
      color: activeColor,
      strokeWidth: activeStrokeWidth,
      direction: directionToUse,
      label: '',
      notes: '',
      tagIds: [],
      autoSelectedTagIds: [],
      roadPois: [],
      sideLines: [],
      autoMetaSpans: result.autoMetaSpans,
      panoId: primary.panoId,
      carHeadingDeg: primary.carHeadingDeg,
      captureDate: primary.captureDate,
      cameraGen: primary.cameraGen,
      countryCode: primary.countryCode,
      regionName: primary.regionName,
      elevationMeters: primary.elevationMeters,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    commitAnnotations([...annotations, newStretch]);
    setSelectedAnnotationId(newStretch.id);
    setDraftPoints([]);
  };

  const addPointOfInterestOnRoadStretch = (lat: number, lng: number) => {
    const roadStretches = annotations.filter(
      (a) => a.type === 'road-stretch' && a.points && a.points.length >= 2
    );
    if (roadStretches.length === 0) {
      setSnapStatusMsg('Mark a road stretch first before adding a Road POI.');
      window.setTimeout(() => setSnapStatusMsg(null), 2600);
      return;
    }

    let bestStretch: CoverageAnnotation | null = null;
    let bestProj: ReturnType<typeof projectPointOntoRoadStretch> | null = null;

    for (const rs of roadStretches) {
      const proj = projectPointOntoRoadStretch(lat, lng, rs.points!);
      if (!bestProj || proj.distanceDeg < bestProj.distanceDeg) {
        bestProj = proj;
        bestStretch = rs;
      }
    }

    if (!bestStretch || !bestProj) return;

    const existingPois = bestStretch.roadPois || [];
    const newPoi: RoadPointOfInterest = {
      id: `poi-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: `P${existingPois.length + 1}`,
      frac: Math.round(bestProj.frac * 1000) / 1000,
      position: bestProj.snappedPos,
      color: activeColor,
    };

    const nextAnnotations = annotations.map((a) =>
      a.id === bestStretch!.id
        ? {
            ...a,
            roadPois: [...existingPois, newPoi].sort((x, y) => x.frac - y.frac),
            updatedAt: Date.now(),
          }
        : a
    );
    commitAnnotations(nextAnnotations);
    setSelectedAnnotationId(bestStretch.id);
  };

  const attachSideLineFromStroke = (strokePts: Array<[number, number]>) => {
    let tagId = activeSideLineTagId;
    if (!tagId) {
      const defaultTag: SideLineTagDefinition = {
        id: `slt-${Date.now()}`,
        name: newSideLineTagName.trim() || 'Side Line 1',
        parentId: null,
        color: newSideLineTagColor,
      };
      const nextTags = [...sideLineTags, defaultTag];
      setSideLineTags(nextTags);
      saveSideLineTags(nextTags);
      tagId = defaultTag.id;
      setActiveSideLineTagId(tagId);
    }

    const roadStretches = annotations.filter(
      (a) => a.type === 'road-stretch' && a.points && a.points.length >= 2
    );
    if (roadStretches.length === 0) return;

    const firstPt = strokePts[0];
    const lastPt = strokePts[strokePts.length - 1];

    let bestStretch: CoverageAnnotation | null = null;
    let bestDist = Infinity;
    for (const rs of roadStretches) {
      const proj = projectPointOntoRoadStretch(
        firstPt[0],
        firstPt[1],
        rs.points!
      );
      if (proj.distanceDeg < bestDist) {
        bestDist = proj.distanceDeg;
        bestStretch = rs;
      }
    }

    if (!bestStretch || !bestStretch.points) return;

    const projStart = projectPointOntoRoadStretch(
      firstPt[0],
      firstPt[1],
      bestStretch.points
    );
    const projEnd = projectPointOntoRoadStretch(
      lastPt[0],
      lastPt[1],
      bestStretch.points
    );

    const sortedPois = [...(bestStretch.roadPois || [])].sort(
      (a, b) => a.frac - b.frac
    );

    const isSingleClick =
      strokePts.length === 1 ||
      Math.abs(projEnd.frac - projStart.frac) < 0.025;

    let startFrac = 0;
    let endFrac = 1;
    let startPoiId: string | undefined;
    let endPoiId: string | undefined;

    if (isSingleClick) {
      if (sortedPois.length > 0) {
        const clickF = projStart.frac;
        const prevPoi = [...sortedPois].reverse().find((p) => p.frac <= clickF);
        const nextPoi = sortedPois.find((p) => p.frac > clickF);
        if (prevPoi) {
          startFrac = prevPoi.frac;
          startPoiId = prevPoi.id;
        }
        if (nextPoi) {
          endFrac = nextPoi.frac;
          endPoiId = nextPoi.id;
        }
      }
    } else {
      const rawStart = Math.max(0, Math.min(projStart.frac, projEnd.frac));
      const rawEnd = Math.min(1, Math.max(projStart.frac, projEnd.frac));
      startFrac = rawStart;
      endFrac = rawEnd;

      const nearStartPoi = sortedPois.find(
        (p) => Math.abs(p.frac - rawStart) <= 0.04
      );
      if (nearStartPoi) {
        startFrac = nearStartPoi.frac;
        startPoiId = nearStartPoi.id;
      }
      const nearEndPoi = sortedPois.find(
        (p) =>
          p.id !== nearStartPoi?.id && Math.abs(p.frac - rawEnd) <= 0.04
      );
      if (nearEndPoi) {
        endFrac = nearEndPoi.frac;
        endPoiId = nearEndPoi.id;
      }
    }

    const newAttachment: RoadSideLineAttachment = {
      id: `sl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sideLineTagId: tagId,
      side: projStart.side,
      startFrac: Math.round(startFrac * 1000) / 1000,
      endFrac: Math.round(endFrac * 1000) / 1000,
      startPoiId,
      endPoiId,
    };

    const nextAnnotations = annotations.map((a) =>
      a.id === bestStretch!.id
        ? {
            ...a,
            sideLines: [...(a.sideLines || []), newAttachment],
            updatedAt: Date.now(),
          }
        : a
    );
    commitAnnotations(nextAnnotations);
    setSelectedAnnotationId(bestStretch.id);
  };

  const handleFinishDragStroke = async (pts: Array<[number, number]>) => {
    if (activeTool === 'road-stretch' && roadSnapSubMode === 'freedraw-snap') {
      if (pts.length >= 2) {
        await createSnappedRoadStretch(pts);
      }
      return;
    }

    if (activeTool === 'side-line') {
      attachSideLineFromStroke(pts);
      return;
    }

    if (activeTool === 'freehand' && pts.length >= 2) {
      const newFreehand: CoverageAnnotation = {
        id: `fh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        type: 'freehand',
        points: pts,
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        direction: freehandArrowEnd ? 'forward' : 'none',
        label: '',
        notes: '',
        tagIds: [],
        autoSelectedTagIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      commitAnnotations([...annotations, newFreehand]);
      setSelectedAnnotationId(newFreehand.id);
    }
  };

  const handleMapSingleClick = async (
    lat: number,
    lng: number,
    altOrRight: boolean
  ) => {
    if (altOrRight || activeTool === 'inspect') {
      await openStreetViewAt(lat, lng);
      return;
    }

    if (svMeta && !markedSphereForActivePano) {
      closeTemporaryStreetView();
    }

    if (activeTool === 'select') {
      setSelectedAnnotationId(null);
      return;
    }

    if (activeTool === 'road-poi') {
      addPointOfInterestOnRoadStretch(lat, lng);
      return;
    }

    if (activeTool === 'road-stretch') {
      if (roadSnapSubMode === 'single-section') {
        setSnapStatusMsg(
          'Verifying official Street View coverage & snapping section...'
        );
        const section = await fetchSingleClickRoadSection(lat, lng, mapZoom);
        if (!section || section.points.length < 2) {
          setSnapStatusMsg(
            'Rejected: No official Street View coverage at that location.'
          );
          window.setTimeout(() => setSnapStatusMsg(null), 3200);
          return;
        }
        setSnapStatusMsg(null);
        const primary = section.primaryMeta;
        const newStretch: CoverageAnnotation = {
          id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          notebookId: activeNotebookId,
          type: 'road-stretch',
          points: section.points,
          color: activeColor,
          strokeWidth: activeStrokeWidth,
          direction: activeDirection,
          autoMetaSpans: section.autoMetaSpans,
          panoId: primary.panoId,
          carHeadingDeg: primary.carHeadingDeg,
          captureDate: primary.captureDate,
          cameraGen: primary.cameraGen,
          countryCode: primary.countryCode,
          regionName: primary.regionName,
          elevationMeters: primary.elevationMeters,
          label: '',
          notes: '',
          tagIds: [],
          autoSelectedTagIds: [],
          roadPois: [],
          sideLines: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        commitAnnotations([...annotations, newStretch]);
        setSelectedAnnotationId(newStretch.id);
        return;
      }

      if (roadSnapSubMode === 'point-to-point') {
        setDraftPoints((prev) => [...prev, [lat, lng]]);
        return;
      }
    }

    if (activeTool === 'text') {
      const newText: CoverageAnnotation = {
        id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        type: 'text',
        position: [lat, lng],
        color: activeColor,
        label: 'Label',
        notes: '',
        tagIds: [],
        autoSelectedTagIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      commitAnnotations([...annotations, newText]);
      setSelectedAnnotationId(newText.id);
      return;
    }

    if (activeTool === 'pin') {
      const newPin: CoverageAnnotation = {
        id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        notebookId: activeNotebookId,
        type: 'pin',
        position: [lat, lng],
        color: activeColor,
        label: '',
        notes: '',
        tagIds: [],
        autoSelectedTagIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      commitAnnotations([...annotations, newPin]);
      setSelectedAnnotationId(newPin.id);
    }
  };

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
      } else if (
        e.key === 'Enter' &&
        activeTool === 'road-stretch' &&
        draftPoints.length >= 2
      ) {
        e.preventDefault();
        createSnappedRoadStretch(draftPoints);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedAnnotationId
      ) {
        e.preventDefault();
        deleteAnnotationById(selectedAnnotationId);
      } else if (e.key === 'Escape') {
        setDraftPoints([]);
        setSelectedAnnotationId(null);
        closeTemporaryStreetView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    activeTool,
    draftPoints,
    selectedAnnotationId,
    closeTemporaryStreetView,
  ]);

  const availableAutoMeta = useMemo(
    () => collectAvailableAutoMetadata(annotations),
    [annotations]
  );

  const sideLineTagById = useMemo(() => {
    const map = new Map<string, SideLineTagDefinition>();
    for (const t of sideLineTags) map.set(t.id, t);
    return map;
  }, [sideLineTags]);

  const formatSideLineHierarchicalLabel = useCallback(
    (tag: SideLineTagDefinition): string => {
      const parts = [tag.name];
      let curr = tag;
      const visited = new Set<string>([tag.id]);
      while (curr.parentId && !visited.has(curr.parentId)) {
        visited.add(curr.parentId);
        const parent = sideLineTagById.get(curr.parentId);
        if (!parent) break;
        parts.unshift(parent.name);
        curr = parent;
      }
      return parts.join(' › ');
    },
    [sideLineTagById]
  );

  // Explicit filter tags (ignoring auto-selected parent tags when checking AND combinations)
  const explicitFilterTagIds = useMemo(() => {
    const autoSet = new Set(autoSelectedFilterTagIds);
    return selectedFilterTagIds.filter((id) => !autoSet.has(id));
  }, [selectedFilterTagIds, autoSelectedFilterTagIds]);

  const structuredAutoFilters: StructuredAutoMetaFilters = useMemo(
    () => ({
      year: filterYear,
      month: filterMonth,
      season: filterSeason,
      cameraGen: filterCameraGen,
      country: filterCountry,
      region: filterRegion,
      sideLineTagId: selectedFilterSideLineTagId,
      cardinalDirection: cardinalDirectionFilter,
    }),
    [
      filterYear,
      filterMonth,
      filterSeason,
      filterCameraGen,
      filterCountry,
      filterRegion,
      selectedFilterSideLineTagId,
      cardinalDirectionFilter,
    ]
  );

  const hasAnyActiveFilter =
    booleanQuery.trim().length > 0 ||
    explicitFilterTagIds.length > 0 ||
    filterYear !== 'all' ||
    filterMonth !== 'all' ||
    filterSeason !== 'all' ||
    filterCameraGen !== 'all' ||
    filterCountry !== 'all' ||
    filterRegion !== 'all' ||
    selectedFilterSideLineTagId !== 'all' ||
    cardinalDirectionFilter !== 'all';

  /**
   * Evaluates all active filters (Boolean Expression, Tag Tree checkboxes with AND/OR,
   * Auto-Metadata filters per road sub-span, and Side-Line Cardinal filters).
   * Returns both the matching annotations AND the exact sub-polylines of road stretches
   * and side lines that match!
   */
  const filteredRenderItems = useMemo(() => {
    const hasSideLineFilter =
      selectedFilterSideLineTagId !== 'all' || cardinalDirectionFilter !== 'all';
    const allowedSideLineTagIds =
      selectedFilterSideLineTagId !== 'all'
        ? getDescendantIdsInclusive(selectedFilterSideLineTagId, sideLineTags)
        : null;

    const hasSpanLevelAutoFilter =
      filterYear !== 'all' ||
      filterMonth !== 'all' ||
      filterSeason !== 'all' ||
      filterCameraGen !== 'all' ||
      filterCountry !== 'all' ||
      filterRegion !== 'all';

    return annotations
      .map((ann) => {
        // 1. Check Tag Tree Checkbox Filter (explicit selections combined via AND or OR)
        if (explicitFilterTagIds.length > 0) {
          const annTagSet = new Set(ann.tagIds || []);
          const checkSingleTag = (filterTagId: string) => {
            const descIds = getDescendantIdsInclusive(filterTagId, tagTree);
            for (const id of descIds) {
              if (annTagSet.has(id)) return true;
            }
            return false;
          };
          const matchesTags =
            filterCombinationMode === 'AND'
              ? explicitFilterTagIds.every(checkSingleTag)
              : explicitFilterTagIds.some(checkSingleTag);
          if (!matchesTags) return null;
        }

        // 2. Check Sub-Span Auto-Metadata + Boolean Query
        let matchingRoadSubPolylines: Array<Array<[number, number]>> | null =
          null;

        if (
          ann.type === 'road-stretch' &&
          ann.points &&
          ann.points.length >= 2 &&
          ann.autoMetaSpans &&
          ann.autoMetaSpans.length > 0 &&
          (hasSpanLevelAutoFilter || booleanQuery.trim().length > 0)
        ) {
          const matchingSpans = ann.autoMetaSpans.filter((span) => {
            if (!doesSpanMatchAutoMetaFilters(ann, span, structuredAutoFilters)) {
              return false;
            }
            if (booleanQuery.trim().length > 0) {
              return evaluateBooleanQueryString(booleanQuery, {
                ann,
                span,
                tagTree,
                sideLineTags,
              });
            }
            return true;
          });

          if (matchingSpans.length === 0) return null;

          // If only a subset of the road stretch's spans matched, extract those exact sub-polylines!
          if (matchingSpans.length < ann.autoMetaSpans.length) {
            matchingRoadSubPolylines = matchingSpans
              .map((sp) =>
                extractSubPolylineByFraction(
                  ann.points!,
                  sp.startFrac,
                  sp.endFrac
                )
              )
              .filter((pts) => pts.length >= 2);
            if (matchingRoadSubPolylines.length === 0) return null;
          }
        } else {
          // Annotation without multi-spans
          if (
            hasSpanLevelAutoFilter &&
            !doesSpanMatchAutoMetaFilters(ann, undefined, structuredAutoFilters)
          ) {
            return null;
          }
          if (
            booleanQuery.trim().length > 0 &&
            !evaluateBooleanQueryString(booleanQuery, {
              ann,
              tagTree,
              sideLineTags,
            })
          ) {
            return null;
          }
        }

        // 3. Check Side-Line & Cardinal Side-of-Road Filter
        if (!hasSideLineFilter) {
          return {
            ann,
            matchingRoadSubPolylines,
            matchingSideSegments: null,
          };
        }

        if (
          ann.type !== 'road-stretch' ||
          !ann.points ||
          ann.points.length < 2 ||
          !ann.sideLines ||
          ann.sideLines.length === 0
        ) {
          return null;
        }

        const matchingSideSegments: Array<{
          id: string;
          color: string;
          points: Array<[number, number]>;
        }> = [];

        ann.sideLines.forEach((sl, idx) => {
          if (
            allowedSideLineTagIds &&
            !allowedSideLineTagIds.has(sl.sideLineTagId)
          ) {
            return;
          }
          const slDef = sideLineTagById.get(sl.sideLineTagId);
          const color = slDef?.color || '#f43f5e';
          const [resolvedStart, resolvedEnd] = resolveSideLineFractions(
            sl,
            ann.roadPois
          );
          const subPts = extractSubPolylineByFraction(
            ann.points!,
            resolvedStart,
            resolvedEnd
          );
          if (subPts.length < 2) return;

          const offsetPts = offsetPolylinePerpendicular(
            subPts,
            sl.side,
            7 + (idx % 4) * 4.5,
            mapZoom
          );

          if (cardinalDirectionFilter === 'all') {
            matchingSideSegments.push({
              id: sl.id,
              color,
              points: offsetPts,
            });
            return;
          }

          let currentRun: Array<[number, number]> = [];
          for (let i = 0; i < subPts.length - 1; i++) {
            const outwardBearing = computeSideOutwardCompassBearing(
              subPts[i],
              subPts[i + 1],
              sl.side
            );
            const matchesCardinal = isAngleWithinCardinalFilter(
              outwardBearing,
              cardinalDirectionFilter
            );
            if (matchesCardinal) {
              if (currentRun.length === 0) {
                currentRun.push(offsetPts[i]);
              }
              currentRun.push(offsetPts[i + 1]);
            } else if (currentRun.length >= 2) {
              matchingSideSegments.push({
                id: `${sl.id}-${i}`,
                color,
                points: currentRun,
              });
              currentRun = [];
            } else {
              currentRun = [];
            }
          }
          if (currentRun.length >= 2) {
            matchingSideSegments.push({
              id: `${sl.id}-end`,
              color,
              points: currentRun,
            });
          }
        });

        if (matchingSideSegments.length === 0) return null;
        return {
          ann,
          matchingRoadSubPolylines,
          matchingSideSegments,
        };
      })
      .filter(
        (
          item
        ): item is {
          ann: CoverageAnnotation;
          matchingRoadSubPolylines: Array<Array<[number, number]>> | null;
          matchingSideSegments: Array<{
            id: string;
            color: string;
            points: Array<[number, number]>;
          }> | null;
        } => item !== null
      );
  }, [
    annotations,
    explicitFilterTagIds,
    filterCombinationMode,
    booleanQuery,
    structuredAutoFilters,
    selectedFilterSideLineTagId,
    cardinalDirectionFilter,
    tagTree,
    sideLineTags,
    sideLineTagById,
    mapZoom,
    filterYear,
    filterMonth,
    filterSeason,
    filterCameraGen,
    filterCountry,
    filterRegion,
  ]);

  const handleAddTagNode = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    const node: CoverageTagNode = {
      id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: trimmed,
      parentId: newTagParentId || null,
      color: newTagColor,
    };
    const next = [...tagTree, node];
    setTagTree(next);
    saveCoverageTagTree(next);
    setNewTagName('');
  };

  const handleDeleteTagNode = (tagId: string) => {
    const toRemove = getDescendantIdsInclusive(tagId, tagTree);
    const next = tagTree.filter((t) => !toRemove.has(t.id));
    setTagTree(next);
    saveCoverageTagTree(next);
    setSelectedFilterTagIds((prev) => prev.filter((id) => !toRemove.has(id)));
  };

  const handleAddSideLineTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSideLineTagName.trim();
    if (!trimmed) return;
    const def: SideLineTagDefinition = {
      id: `slt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: trimmed,
      parentId: newSideLineTagParentId || null,
      color: newSideLineTagColor,
    };
    const next = [...sideLineTags, def];
    setSideLineTags(next);
    saveSideLineTags(next);
    setActiveSideLineTagId(def.id);
    setNewSideLineTagName('');
  };

  const handleDeleteSideLineTag = (id: string) => {
    const toRemove = getDescendantIdsInclusive(id, sideLineTags);
    const next = sideLineTags.filter((t) => !toRemove.has(t.id));
    setSideLineTags(next);
    saveSideLineTags(next);
    if (toRemove.has(selectedFilterSideLineTagId)) {
      setSelectedFilterSideLineTagId('all');
    }
  };

  const insertTokenIntoBooleanQuery = (token: string) => {
    setBooleanQuery((prev) => {
      const trimmed = prev.trimEnd();
      if (!trimmed) return token;
      if (trimmed.endsWith('(')) return `${trimmed}${token}`;
      return `${trimmed} ${token}`;
    });
  };

  const handlePlaceSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = placeQuery.trim();
    if (!q) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
          q
        )}`
      );
      if (!res.ok) return;
      const items = await res.json();
      if (Array.isArray(items) && items.length > 0) {
        const lat = Number(items[0].lat);
        const lon = Number(items[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setFlyTarget({ center: [lat, lon], zoom: 11, seq: Date.now() });
        }
      }
    } catch {
      // ignore
    }
  };

  const handleCreateNotebook = () => {
    const name = window.prompt('Notebook Name:');
    if (!name || !name.trim()) return;
    const nb: CoverageNotebook = {
      id: `nb-${Date.now()}`,
      name: name.trim(),
      countryOrRegion: name.trim(),
      defaultCenter: [20, 0],
      defaultZoom: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [...notebooks, nb];
    setNotebooks(next);
    saveCoverageNotebooks(next);
    setActiveNotebookId(nb.id);
  };

  const handleExportJson = () => {
    const json = exportNotebookJson(
      activeNotebook,
      annotations,
      tagTree,
      sideLineTags
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeNotebook.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}-coverage.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as CoverageExportBundle;
        if (Array.isArray(parsed.annotations)) {
          commitAnnotations(parsed.annotations);
        }
        if (Array.isArray(parsed.tagTree)) {
          setTagTree(parsed.tagTree);
          saveCoverageTagTree(parsed.tagTree);
        }
        if (Array.isArray(parsed.sideLineTags)) {
          setSideLineTags(parsed.sideLineTags);
          saveSideLineTags(parsed.sideLineTags);
        }
      } catch {
        window.alert('Invalid Coverage Notes JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [svR, svG, svB] = useMemo(
    () => hexToRgbNormalized(svLineColor),
    [svLineColor]
  );

  // Recursive Road Tag Tree Renderer with Auto-Selected Ancestor Propagation
  const renderTagTreeNodes = (
    parentId: string | null,
    depth: number,
    mode: 'filter' | 'assign'
  ): React.ReactNode => {
    const children = tagTree.filter((t) => (t.parentId || null) === parentId);
    if (children.length === 0) return null;

    return children.map((node) => {
      const currentSelected =
        mode === 'filter'
          ? selectedFilterTagIds
          : selectedAnnotation?.tagIds || [];
      const currentAuto =
        mode === 'filter'
          ? autoSelectedFilterTagIds
          : selectedAnnotation?.autoSelectedTagIds || [];

      const isChecked = currentSelected.includes(node.id);
      const isAutoAncestor = currentAuto.includes(node.id);

      return (
        <div
          key={node.id}
          style={{ paddingLeft: depth * 12 }}
          className="space-y-0.5"
        >
          <div className="flex items-center justify-between gap-1.5 py-0.5 px-1.5 rounded hover:bg-slate-800/70">
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-200 flex-1 min-w-0">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => {
                  const res = toggleTagWithAutoAncestors(
                    node.id,
                    currentSelected,
                    currentAuto,
                    tagTree
                  );
                  if (mode === 'filter') {
                    setSelectedFilterTagIds(res.selectedIds);
                    setAutoSelectedFilterTagIds(res.autoSelectedIds);
                  } else if (selectedAnnotation) {
                    updateSelectedAnnotation({
                      tagIds: res.selectedIds,
                      autoSelectedTagIds: res.autoSelectedIds,
                    });
                  }
                }}
                className="accent-indigo-500 cursor-pointer"
              />
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: node.color }}
              />
              <span
                className={`truncate ${
                  isAutoAncestor ? 'text-slate-400 italic' : 'text-slate-100'
                }`}
              >
                {node.name}
              </span>
              {isAutoAncestor && (
                <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400">
                  auto
                </span>
              )}
            </label>
            {mode === 'filter' && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Insert into Boolean Query"
                  onClick={() =>
                    insertTokenIntoBooleanQuery(
                      node.name.includes(' ') ? `"${node.name}"` : node.name
                    )
                  }
                  className="px-1 text-[9px] rounded bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white cursor-pointer"
                >
                  +Expr
                </button>
                <button
                  type="button"
                  title={`Add subtag under "${node.name}"`}
                  onClick={() => setNewTagParentId(node.id)}
                  className="px-1 text-[10px] rounded bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white cursor-pointer"
                >
                  +Sub
                </button>
                <button
                  type="button"
                  title="Delete tag"
                  onClick={() => handleDeleteTagNode(node.id)}
                  className="text-slate-500 hover:text-rose-400 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          {renderTagTreeNodes(node.id, depth + 1, mode)}
        </div>
      );
    });
  };

  // Recursive Side Line Tag Tree Renderer
  const renderSideLineTagTreeNodes = (
    parentId: string | null,
    depth: number
  ): React.ReactNode => {
    const children = sideLineTags.filter(
      (t) => (t.parentId || null) === parentId
    );
    if (children.length === 0) return null;

    return children.map((node) => {
      const isFiltered = selectedFilterSideLineTagId === node.id;
      return (
        <div
          key={node.id}
          style={{ paddingLeft: depth * 12 }}
          className="space-y-0.5"
        >
          <div className="flex items-center justify-between gap-1.5 py-0.5 px-1.5 rounded hover:bg-slate-800/70 text-[11px]">
            <button
              type="button"
              onClick={() =>
                setSelectedFilterSideLineTagId((prev) =>
                  prev === node.id ? 'all' : node.id
                )
              }
              className={`flex items-center gap-1.5 text-left flex-1 min-w-0 cursor-pointer ${
                isFiltered ? 'text-emerald-300 font-bold' : 'text-slate-200'
              }`}
            >
              <span
                className="w-3 h-1.5 rounded shrink-0"
                style={{ backgroundColor: node.color }}
              />
              <span className="truncate">{node.name}</span>
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Insert into Boolean Query"
                onClick={() =>
                  insertTokenIntoBooleanQuery(
                    `sideline:${
                      node.name.includes(' ') ? `"${node.name}"` : node.name
                    }`
                  )
                }
                className="px-1 text-[9px] rounded bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white cursor-pointer"
              >
                +Expr
              </button>
              <button
                type="button"
                title={`Add subtag under "${node.name}"`}
                onClick={() => setNewSideLineTagParentId(node.id)}
                className="px-1 text-[10px] rounded bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white cursor-pointer"
              >
                +Sub
              </button>
              <button
                type="button"
                title="Delete side line tag"
                onClick={() => handleDeleteSideLineTag(node.id)}
                className="text-slate-500 hover:text-rose-400 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          {renderSideLineTagTreeNodes(node.id, depth + 1)}
        </div>
      );
    });
  };

  const showRightSidebar =
    showTagManagerPanel || showStreetViewPanel || Boolean(selectedAnnotation);

  const sidebarWidthClass =
    sidebarSize === 'compact'
      ? 'w-full lg:w-[360px]'
      : sidebarSize === 'wide'
      ? 'w-full lg:w-[56vw] xl:w-[60vw]'
      : 'w-full lg:w-[460px] xl:w-[520px]';

  // Side lines are only rendered when zoomed in enough (mapZoom >= sideLineMinZoom) or when actively filtering by side line
  const shouldRenderSideLines =
    mapZoom >= sideLineMinZoom ||
    selectedFilterSideLineTagId !== 'all' ||
    cardinalDirectionFilter !== 'all';

  return (
    <div className="h-[calc(100dvh-3.5rem)] flex flex-col bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Hidden SVG Filter that recolors the official Google Street View coverage tiles */}
      <svg className="w-0 h-0 absolute pointer-events-none" aria-hidden="true">
        <defs>
          <filter id="sv-custom-line-color" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values={`0 0 0 0 ${svR}  0 0 0 0 ${svG}  0 0 0 0 ${svB}  0 0 0 1 0`}
            />
          </filter>
        </defs>
      </svg>
      <style>{`
        .sv-coverage-custom-tiles img.leaflet-tile {
          filter: url(#sv-custom-line-color);
        }
        .coverage-clean-text-icon {
          background: transparent !important;
          border: none !important;
        }
      `}</style>

      {/* Top Control & Tool Bar */}
      <div className="border-b border-slate-800 bg-slate-900/95 px-3 py-2 flex flex-wrap items-center justify-between gap-2 z-30">
        {/* Left: Notebook Selector & Search */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
            <Compass className="w-3.5 h-3.5 text-indigo-400" />
            <select
              value={activeNotebookId}
              onChange={(e) => {
                const nextId = e.target.value;
                setActiveNotebookId(nextId);
                const nb = notebooks.find((n) => n.id === nextId);
                if (nb) {
                  setFlyTarget({
                    center: nb.defaultCenter,
                    zoom: nb.defaultZoom,
                    seq: Date.now(),
                  });
                }
              }}
              className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
            >
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id} className="bg-slate-900">
                  {nb.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateNotebook}
              title="New Notebook"
              className="ml-1 p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>

          <form onSubmit={handlePlaceSearch} className="relative">
            <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              placeholder="Search place..."
              className="w-36 sm:w-44 pl-6 pr-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-white outline-none focus:border-indigo-500"
            />
          </form>
        </div>

        {/* Center/Right: Map Layer, Customizable SV Coverage Color & Opacity, Tags & Filters */}
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

          {/* Customizable SV Coverage Line Color & Opacity */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800">
            <button
              type="button"
              onClick={() => setShowOfficialCoverage((v) => !v)}
              className={`inline-flex items-center gap-1 font-bold text-[11px] cursor-pointer ${
                showOfficialCoverage ? 'text-white' : 'text-slate-500'
              }`}
              title="Toggle Official Google Street View Coverage Overlay"
            >
              <Layers
                className="w-3.5 h-3.5"
                style={{ color: showOfficialCoverage ? svLineColor : undefined }}
              />
              <span>SV Lines</span>
            </button>
            {showOfficialCoverage && (
              <>
                <input
                  type="color"
                  value={svLineColor}
                  onChange={(e) => setSvLineColor(e.target.value)}
                  title="Customize Street View Coverage Line Color"
                  className="w-4 h-4 rounded border-0 bg-transparent cursor-pointer"
                />
                <input
                  type="range"
                  min={0.08}
                  max={1}
                  step={0.04}
                  value={coverageOpacity}
                  onChange={(e) => setCoverageOpacity(Number(e.target.value))}
                  title={`Coverage Line Opacity: ${Math.round(coverageOpacity * 100)}%`}
                  className="w-14 accent-indigo-500 cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 w-7 text-right">
                  {Math.round(coverageOpacity * 100)}%
                </span>
              </>
            )}
          </div>

          {/* Tags & Filters Sidebar Toggle */}
          <button
            type="button"
            onClick={() => setShowTagManagerPanel((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-bold cursor-pointer ${
              showTagManagerPanel || hasAnyActiveFilter
                ? 'bg-indigo-600 border-indigo-400 text-white'
                : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Tags & Filters</span>
            {hasAnyActiveFilter && (
              <span className="px-1 rounded bg-amber-400 text-slate-950 text-[10px]">
                Active
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setHideAllAnnotations((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
              hideAllAnnotations
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            {hideAllAnnotations ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span>Notes Hidden</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Hide Notes</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            title="Export Notebook, Tag Tree & Side Line Tags JSON"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Export</span>
          </button>
          <label
            title="Import Notebook JSON"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Import</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImportJson}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Second Row: Annotation Tools (Select / Edit First and Highlighted) & Active Tool Options */}
      <div className="border-b border-slate-800 bg-slate-900/75 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-1 flex-wrap">
          {(
            [
              {
                id: 'select',
                label: 'Select / Edit',
                icon: MousePointer,
                primary: true,
                tip: 'Primary Tool: Select and edit any road stretch, POI, side line, sphere, text, or pin',
              },
              {
                id: 'inspect',
                label: 'Street View',
                icon: Navigation,
                primary: false,
                tip: 'Click any covered road to open 360° Street View (Alt+Click works in any tool)',
              },
              {
                id: 'road-stretch',
                label: 'Road Stretch',
                icon: GitCommitHorizontal,
                primary: false,
                tip: 'Snap road stretches strictly to roads with official Street View coverage',
              },
              {
                id: 'road-poi',
                label: 'Road POI',
                icon: Crosshair,
                primary: false,
                tip: 'Click along any marked road stretch to add a Point of Interest (usable as a Side Line boundary)',
              },
              {
                id: 'side-line',
                label: 'Road Side Line',
                icon: GitBranch,
                primary: false,
                tip: 'Click or drag along either side of a marked road stretch to attach a side line',
              },
              {
                id: 'freehand',
                label: 'Freehand Pen',
                icon: Pencil,
                primary: false,
                tip: 'Draw freehand lines on the map',
              },
              {
                id: 'text',
                label: 'Text Label',
                icon: Type,
                primary: false,
                tip: 'Place clean text on the map',
              },
              {
                id: 'pin',
                label: 'Pin',
                icon: MapPin,
                primary: false,
                tip: 'Drop a pin with optional sketch canvas',
              },
              {
                id: 'eraser',
                label: 'Eraser',
                icon: Eraser,
                primary: false,
                tip: 'Click any road stretch, POI, side line, marked sphere, text, or pin to delete it',
              },
            ] as const
          ).map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                title={tool.tip}
                onClick={() => {
                  setActiveTool(tool.id);
                  setDraftPoints([]);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  active
                    ? tool.primary
                      ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-300/60'
                      : 'bg-indigo-600 text-white shadow'
                    : tool.primary
                    ? 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 border border-amber-500/40'
                    : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Sub-options for the active tool */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeTool === 'road-stretch' && (
            <>
              <div className="inline-flex items-center rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
                {(
                  [
                    { id: 'freedraw-snap', label: 'Freedraw Snap' },
                    { id: 'single-section', label: '1-Click Section' },
                    { id: 'point-to-point', label: 'Click Points' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setRoadSnapSubMode(m.id);
                      setDraftPoints([]);
                    }}
                    className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                      roadSnapSubMode === m.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
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

              <button
                type="button"
                onClick={() => setAutoDetectCarDir((v) => !v)}
                title="Automatically orient the driving arrow to match the official Google car direction"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
                  autoDetectCarDir
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto Car Dir: {autoDetectCarDir ? 'On' : 'Off'}</span>
              </button>

              {roadSnapSubMode === 'point-to-point' && draftPoints.length >= 2 && (
                <button
                  type="button"
                  onClick={() => createSnappedRoadStretch(draftPoints)}
                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                >
                  Snap Road ({draftPoints.length} pts)
                </button>
              )}
            </>
          )}

          {activeTool === 'side-line' && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800 text-[11px]">
              <span className="text-slate-400 font-bold">Side Line Tag:</span>
              {sideLineTags.length > 0 ? (
                <select
                  value={activeSideLineTagId}
                  onChange={(e) => setActiveSideLineTagId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-white font-bold cursor-pointer"
                >
                  {sideLineTags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {formatSideLineHierarchicalLabel(t)}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                type="text"
                value={newSideLineTagName}
                onChange={(e) => setNewSideLineTagName(e.target.value)}
                placeholder="New side line tag..."
                className="w-28 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-white text-[11px] outline-none"
              />
              <input
                type="color"
                value={newSideLineTagColor}
                onChange={(e) => setNewSideLineTagColor(e.target.value)}
                className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer"
              />
              <button
                type="button"
                onClick={handleAddSideLineTag}
                className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] cursor-pointer"
              >
                +Add
              </button>
            </div>
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
              <span>Arrowhead: {freehandArrowEnd ? 'On' : 'Off'}</span>
            </button>
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
              className="ml-1 bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-300 cursor-pointer"
            >
              <option value={2.5}>Thin</option>
              <option value={4}>Med</option>
              <option value={6}>Thick</option>
            </select>
          </div>

          {/* Undo / Redo / Clear */}
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
                  window.confirm(
                    `Clear all annotations in "${activeNotebook.name}"?`
                  )
                ) {
                  commitAnnotations([]);
                  setSelectedAnnotationId(null);
                }
              }}
              title="Clear All Annotations"
              className="p-1 rounded bg-slate-950 border border-slate-800 text-rose-400 hover:bg-rose-500/15 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 relative overflow-hidden">
        {/* Left / Main Map Canvas */}
        <div className="flex-1 relative min-h-[320px]">
          <MapContainer
            center={activeNotebook.defaultCenter}
            zoom={activeNotebook.defaultZoom}
            minZoom={2}
            maxZoom={20}
            zoomControl={true}
            className="w-full h-full bg-slate-900"
          >
            <MapFlyController target={flyTarget} />
            <MapInteractionController
              activeTool={activeTool}
              roadSnapSubMode={roadSnapSubMode}
              onZoomChange={setMapZoom}
              onMapSingleClick={handleMapSingleClick}
              onMapDoubleClick={() => createSnappedRoadStretch(draftPoints)}
              onFinishDragStroke={handleFinishDragStroke}
              onUpdateLiveDrag={setLiveDragPoints}
            />

            {baseLayer === 'roadmap' && (
              <TileLayer
                key="google-roadmap"
                url={GOOGLE_ROADMAP_TILES}
                maxZoom={20}
                attribution="&copy; Google Maps"
              />
            )}
            {baseLayer === 'hybrid' && (
              <TileLayer
                key="google-hybrid"
                url={GOOGLE_HYBRID_TILES}
                maxZoom={20}
                attribution="&copy; Google Maps"
              />
            )}
            {baseLayer === 'osm' && (
              <TileLayer
                key="osm-standard"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
                attribution="&copy; OpenStreetMap"
              />
            )}

            {showOfficialCoverage && (
              <TileLayer
                key="official-sv-coverage"
                className="sv-coverage-custom-tiles"
                url={GOOGLE_OFFICIAL_SV_COVERAGE_TILES}
                opacity={coverageOpacity}
                maxZoom={20}
                zIndex={250}
              />
            )}

            {/* Native Leaflet Vector Layers */}
            {!hideAllAnnotations &&
              filteredRenderItems.map(
                ({ ann, matchingRoadSubPolylines, matchingSideSegments }) => {
                  const isSelected = ann.id === selectedAnnotationId;

                  if (
                    (ann.type === 'road-stretch' || ann.type === 'freehand') &&
                    ann.points &&
                    ann.points.length >= 2
                  ) {
                    const roadPolylinesToRender = matchingRoadSubPolylines || [
                      ann.points,
                    ];

                    const chevrons = roadPolylinesToRender.flatMap((segPts) =>
                      buildChevronPolylines(
                        segPts,
                        ann.direction || 'none',
                        mapZoom
                      )
                    );
                    const midPt = ann.points[Math.floor(ann.points.length / 2)];

                    const sidePolylines: Array<{
                      id: string;
                      color: string;
                      points: Array<[number, number]>;
                    }> = !shouldRenderSideLines
                      ? []
                      : matchingSideSegments !== null
                      ? matchingSideSegments
                      : (ann.sideLines || [])
                          .map((sl, idx) => {
                            const def = sideLineTagById.get(sl.sideLineTagId);
                            const [resolvedStart, resolvedEnd] =
                              resolveSideLineFractions(sl, ann.roadPois);
                            const subPts = extractSubPolylineByFraction(
                              ann.points!,
                              resolvedStart,
                              resolvedEnd
                            );
                            if (subPts.length < 2) return null;
                            return {
                              id: sl.id,
                              color: def?.color || '#f43f5e',
                              points: offsetPolylinePerpendicular(
                                subPts,
                                sl.side,
                                7 + (idx % 4) * 4.5,
                                mapZoom
                              ),
                            };
                          })
                          .filter(
                            (
                              x
                            ): x is {
                              id: string;
                              color: string;
                              points: Array<[number, number]>;
                            } => x !== null
                          );

                    return (
                      <React.Fragment key={ann.id}>
                        {isSelected && (
                          <Polyline
                            positions={ann.points}
                            pathOptions={{
                              color: '#38bdf8',
                              weight: (ann.strokeWidth || 4) + 6,
                              opacity: 0.45,
                            }}
                          />
                        )}

                        {/* When sub-span filtering is active and only part of the road stretch matches, dim the full road slightly and render matching sub-spans at full brightness */}
                        {matchingRoadSubPolylines && (
                          <Polyline
                            positions={ann.points}
                            pathOptions={{
                              color: ann.color,
                              weight: Math.max(2, (ann.strokeWidth || 4) - 1),
                              opacity: 0.22,
                              dashArray: '4 4',
                            }}
                            interactive={false}
                          />
                        )}

                        {roadPolylinesToRender.map((segPts, sIdx) => (
                          <Polyline
                            key={`${ann.id}-seg-${sIdx}`}
                            positions={segPts}
                            pathOptions={{
                              color: ann.color,
                              weight: ann.strokeWidth || 4,
                              opacity:
                                cardinalDirectionFilter !== 'all' ? 0.45 : 0.95,
                            }}
                            eventHandlers={{
                              click: (e) => {
                                L.DomEvent.stopPropagation(e);
                                if (activeTool === 'eraser') {
                                  deleteAnnotationById(ann.id);
                                } else if (activeTool === 'road-poi') {
                                  addPointOfInterestOnRoadStretch(
                                    e.latlng.lat,
                                    e.latlng.lng
                                  );
                                } else {
                                  setSelectedAnnotationId(ann.id);
                                }
                              },
                            }}
                          />
                        ))}

                        {chevrons.length > 0 && (
                          <Polyline
                            positions={chevrons}
                            pathOptions={{
                              color: ann.color,
                              weight: Math.max(
                                2.5,
                                (ann.strokeWidth || 4) * 0.85
                              ),
                              opacity:
                                cardinalDirectionFilter !== 'all' ? 0.45 : 0.95,
                            }}
                            interactive={false}
                          />
                        )}

                        {/* Attached Road Side Lines (only shown when zoomed in >= sideLineMinZoom or filtered) */}
                        {sidePolylines.map((sl) => (
                          <React.Fragment key={sl.id}>
                            {cardinalDirectionFilter !== 'all' && (
                              <Polyline
                                positions={sl.points}
                                pathOptions={{
                                  color: sl.color,
                                  weight: 10,
                                  opacity: 0.35,
                                }}
                                interactive={false}
                              />
                            )}
                            <Polyline
                              positions={sl.points}
                              pathOptions={{
                                color: sl.color,
                                weight:
                                  cardinalDirectionFilter !== 'all' ? 4.5 : 3,
                                opacity: 1,
                              }}
                              eventHandlers={{
                                click: (e) => {
                                  L.DomEvent.stopPropagation(e);
                                  if (activeTool === 'eraser') {
                                    const nextSideLines = (
                                      ann.sideLines || []
                                    ).filter(
                                      (item) => !sl.id.startsWith(item.id)
                                    );
                                    const nextAnns = annotations.map((a) =>
                                      a.id === ann.id
                                        ? { ...a, sideLines: nextSideLines }
                                        : a
                                    );
                                    commitAnnotations(nextAnns);
                                  } else {
                                    setSelectedAnnotationId(ann.id);
                                  }
                                },
                              }}
                            />
                          </React.Fragment>
                        ))}

                        {/* Points of Interest (POIs) along this Road Stretch — Clean Text (No Rectangle) */}
                        {(ann.roadPois || []).map((poi) => (
                          <React.Fragment key={poi.id}>
                            <CircleMarker
                              center={poi.position}
                              radius={5.5}
                              pathOptions={{
                                fillColor: poi.color || '#ffffff',
                                fillOpacity: 1,
                                color: '#0f172a',
                                weight: 2,
                              }}
                              eventHandlers={{
                                click: (e) => {
                                  L.DomEvent.stopPropagation(e);
                                  if (activeTool === 'eraser') {
                                    const nextPois = (
                                      ann.roadPois || []
                                    ).filter((p) => p.id !== poi.id);
                                    const nextAnns = annotations.map((a) =>
                                      a.id === ann.id
                                        ? { ...a, roadPois: nextPois }
                                        : a
                                    );
                                    commitAnnotations(nextAnns);
                                  } else {
                                    setSelectedAnnotationId(ann.id);
                                  }
                                },
                              }}
                            />
                            {poi.label && (
                              <Marker
                                position={poi.position}
                                icon={L.divIcon({
                                  className: 'coverage-clean-text-icon',
                                  html: `<div style="transform:translate(-50%,-135%);white-space:nowrap;font-weight:800;font-size:11px;color:${
                                    poi.color || '#0f172a'
                                  };text-shadow:0 0 4px #ffffff,0 0 4px #ffffff,0 0 3px #ffffff;">${
                                    poi.label
                                  }</div>`,
                                })}
                                interactive={false}
                              />
                            )}
                          </React.Fragment>
                        ))}

                        {ann.label && (
                          <Marker
                            position={midPt}
                            icon={L.divIcon({
                              className: 'coverage-clean-text-icon',
                              html: `<div style="transform:translate(-50%,-120%);white-space:nowrap;font-weight:800;font-size:12px;color:${ann.color};text-shadow:0 0 4px #ffffff,0 0 4px #ffffff,0 0 3px #ffffff;">${ann.label}</div>`,
                            })}
                            eventHandlers={{
                              click: (e) => {
                                L.DomEvent.stopPropagation(e);
                                if (activeTool === 'eraser') {
                                  deleteAnnotationById(ann.id);
                                } else {
                                  setSelectedAnnotationId(ann.id);
                                }
                              },
                            }}
                          />
                        )}
                      </React.Fragment>
                    );
                  }

                  if (ann.type === 'text' && ann.position) {
                    return (
                      <Marker
                        key={ann.id}
                        position={ann.position}
                        icon={L.divIcon({
                          className: 'coverage-clean-text-icon',
                          html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font-weight:800;font-size:13px;color:${
                            ann.color
                          };text-shadow:0 0 4px #ffffff,0 0 4px #ffffff,0 0 3px #ffffff;${
                            isSelected
                              ? 'outline:2px dashed #38bdf8;padding:1px 4px;border-radius:4px;'
                              : ''
                          }">${ann.label || 'Text'}</div>`,
                        })}
                        eventHandlers={{
                          click: (e) => {
                            L.DomEvent.stopPropagation(e);
                            if (activeTool === 'eraser') {
                              deleteAnnotationById(ann.id);
                            } else {
                              setSelectedAnnotationId(ann.id);
                            }
                          },
                        }}
                      />
                    );
                  }

                  if (ann.type === 'sphere' && ann.position) {
                    const heading =
                      ann.viewHeadingDeg ?? ann.carHeadingDeg ?? 0;
                    const conePolylines = buildChevronPolylines(
                      [
                        ann.position,
                        [
                          ann.position[0] +
                            0.0002 * Math.cos((heading * Math.PI) / 180),
                          ann.position[1] +
                            0.0002 * Math.sin((heading * Math.PI) / 180),
                        ],
                      ],
                      'forward',
                      mapZoom
                    );
                    return (
                      <React.Fragment key={ann.id}>
                        {conePolylines.length > 0 && (
                          <Polyline
                            positions={conePolylines}
                            pathOptions={{
                              color: ann.color || '#f59e0b',
                              weight: 3,
                              opacity: 0.9,
                            }}
                            interactive={false}
                          />
                        )}
                        <CircleMarker
                          center={ann.position}
                          radius={isSelected ? 8 : 6}
                          pathOptions={{
                            fillColor: ann.color || '#f59e0b',
                            fillOpacity: 0.95,
                            color: isSelected ? '#38bdf8' : '#ffffff',
                            weight: 2,
                          }}
                          eventHandlers={{
                            click: (e) => {
                              L.DomEvent.stopPropagation(e);
                              if (activeTool === 'eraser') {
                                deleteAnnotationById(ann.id);
                                return;
                              }
                              setSelectedAnnotationId(ann.id);
                              openStreetViewAt(
                                ann.position![0],
                                ann.position![1]
                              );
                            },
                          }}
                        />
                      </React.Fragment>
                    );
                  }

                  if (ann.type === 'pin' && ann.position) {
                    return (
                      <CircleMarker
                        key={ann.id}
                        center={ann.position}
                        radius={isSelected ? 9 : 7}
                        pathOptions={{
                          fillColor: ann.color || '#dc2626',
                          fillOpacity: 0.95,
                          color: isSelected ? '#38bdf8' : '#ffffff',
                          weight: 2,
                        }}
                        eventHandlers={{
                          click: (e) => {
                            L.DomEvent.stopPropagation(e);
                            if (activeTool === 'eraser') {
                              deleteAnnotationById(ann.id);
                            } else {
                              setSelectedAnnotationId(ann.id);
                            }
                          },
                        }}
                      />
                    );
                  }

                  return null;
                }
              )}

            {/* Point-to-point Draft Preview */}
            {draftPoints.length >= 1 && (
              <>
                {draftPoints.length >= 2 && (
                  <Polyline
                    positions={draftPoints}
                    pathOptions={{
                      color: activeColor,
                      weight: activeStrokeWidth,
                      dashArray: '6 4',
                    }}
                  />
                )}
                {draftPoints.map((pt, i) => (
                  <CircleMarker
                    key={i}
                    center={pt}
                    radius={4}
                    pathOptions={{
                      fillColor: '#ffffff',
                      fillOpacity: 1,
                      color: activeColor,
                      weight: 2,
                    }}
                  />
                ))}
              </>
            )}

            {/* Live Dragging Stroke Preview */}
            {liveDragPoints.length >= 2 && (
              <Polyline
                positions={liveDragPoints}
                pathOptions={{
                  color:
                    activeTool === 'side-line'
                      ? sideLineTagById.get(activeSideLineTagId)?.color ||
                        newSideLineTagColor
                      : activeColor,
                  weight: activeStrokeWidth,
                  dashArray:
                    activeTool === 'road-stretch' ? '6 4' : undefined,
                }}
              />
            )}

            {/* Active Coverage Sphere + Live Rotating Headlight Cone */}
            {svMeta && (
              <Marker
                position={[svMeta.lat, svMeta.lng]}
                icon={L.divIcon({
                  className: 'coverage-clean-text-icon',
                  html: `<div style="position:relative;width:64px;height:64px;transform:translate(-32px,-32px);pointer-events:none;">
                    <svg width="64" height="64" viewBox="-32 -32 64 64">
                      <g transform="rotate(${svViewHeading - 90})">
                        <polygon points="0,0 30,-14 30,14" fill="#f59e0b" fill-opacity="0.45" stroke="#f59e0b" stroke-width="1.5" />
                      </g>
                      <circle cx="0" cy="0" r="7" fill="#f59e0b" stroke="#ffffff" stroke-width="2.5" />
                    </svg>
                  </div>`,
                })}
              />
            )}
          </MapContainer>

          {/* Status Banner for Coverage Verification / Road Snapping */}
          {snapStatusMsg && (
            <div className="absolute bottom-3 left-3 z-[1000] px-3 py-1.5 rounded-lg bg-slate-900/95 border border-indigo-500/60 text-xs font-bold text-indigo-200 shadow-xl pointer-events-none">
              {snapStatusMsg}
            </div>
          )}
        </div>

        {/* Right Sidebar: Tags & Filters, Split-Screen Street View & Annotation Inspector */}
        {showRightSidebar && (
          <div
            className={`${sidebarWidthClass} border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900 flex flex-col max-h-[62dvh] lg:max-h-none z-30 overflow-y-auto transition-all`}
          >
            {/* Sidebar Width Toggle Header */}
            <div className="px-3 py-1.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
              <div className="flex items-center gap-1">
                <Maximize2 className="w-3 h-3 text-slate-500" />
                <span>Panel Width:</span>
                {(
                  [
                    { id: 'compact', label: 'Compact' },
                    { id: 'standard', label: 'Standard' },
                    { id: 'wide', label: 'Wide (58%)' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSidebarSize(s.id)}
                    className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                      sidebarSize === s.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {hasAnyActiveFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setBooleanQuery('');
                    setSelectedFilterTagIds([]);
                    setAutoSelectedFilterTagIds([]);
                    setFilterYear('all');
                    setFilterMonth('all');
                    setFilterSeason('all');
                    setFilterCameraGen('all');
                    setFilterCountry('all');
                    setFilterRegion('all');
                    setSelectedFilterSideLineTagId('all');
                    setCardinalDirectionFilter('all');
                  }}
                  className="text-amber-300 hover:underline font-bold cursor-pointer"
                >
                  Reset All Filters
                </button>
              )}
            </div>

            {/* Section A: Tags & Filters Manager */}
            {showTagManagerPanel && (
              <div className="p-3 border-b border-slate-800 bg-slate-900 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-indigo-400" />
                    TAGS, LOGICAL QUERY & AUTO-META FILTERS
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTagManagerPanel(false)}
                    className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 1. Technical Boolean Query Expression Bar */}
                <div className="space-y-1.5 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-200">
                      BOOLEAN FILTER EXPRESSION
                    </span>
                    <div className="flex items-center gap-1">
                      {(['(', ')', 'AND', 'OR', 'NOT'] as const).map((op) => (
                        <button
                          key={op}
                          type="button"
                          onClick={() => insertTokenIntoBooleanQuery(op)}
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-[10px] font-bold text-slate-200 hover:text-white cursor-pointer"
                        >
                          {op}
                        </button>
                      ))}
                      {booleanQuery && (
                        <button
                          type="button"
                          onClick={() => setBooleanQuery('')}
                          className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={booleanQuery}
                    onChange={(e) => setBooleanQuery(e.target.value)}
                    placeholder="e.g. (tag1 AND tag2) OR tag3, year:2012 AND NOT tag4..."
                    className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono outline-none focus:border-indigo-500"
                  />
                  <div className="text-[10px] text-slate-500 leading-relaxed">
                    Supports <code>AND</code>, <code>OR</code>, <code>NOT</code>, parentheses <code>(...)</code>, tag names, <code>sideline:name</code>, <code>year:YYYY</code>, <code>month:1..12</code>, <code>season:winter</code>, <code>gen:3</code>, <code>country:XX</code>, <code>region:name</code>. Click <code>+Expr</code> on any tag below to insert it.
                  </div>
                </div>

                {/* 2. Automatic Street View Metadata Filters (Sub-Segment Aware) */}
                <div className="space-y-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-200">
                      AUTOMATIC COVERAGE METADATA FILTERS
                    </span>
                    <span className="text-[10px] text-emerald-400">
                      Sub-segment aware
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">
                        Capture Year
                      </label>
                      <select
                        value={filterYear}
                        onChange={(e) => setFilterYear(e.target.value)}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      >
                        <option value="all">All Years</option>
                        {availableAutoMeta.years.map((y) => (
                          <option key={y} value={String(y)}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">
                        Month
                      </label>
                      <select
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      >
                        <option value="all">All Months</option>
                        {MONTH_LABELS.map((mName, idx) => (
                          <option key={mName} value={String(idx + 1)}>
                            {idx + 1} - {mName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">
                        Season
                      </label>
                      <select
                        value={filterSeason}
                        onChange={(e) => setFilterSeason(e.target.value)}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      >
                        <option value="all">All Seasons</option>
                        {(['Summer', 'Autumn', 'Winter', 'Spring'] as const).map(
                          (s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">
                        Camera Gen
                      </label>
                      <select
                        value={filterCameraGen}
                        onChange={(e) => setFilterCameraGen(e.target.value)}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      >
                        <option value="all">All Generations</option>
                        {(['Gen 1', 'Gen 2', 'Gen 3', 'Gen 4'] as const).map(
                          (g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">
                        Country
                      </label>
                      <select
                        value={filterCountry}
                        onChange={(e) => setFilterCountry(e.target.value)}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      >
                        <option value="all">All Countries</option>
                        {availableAutoMeta.countries.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">
                        Region
                      </label>
                      <select
                        value={filterRegion}
                        onChange={(e) => setFilterRegion(e.target.value)}
                        className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      >
                        <option value="all">All Regions</option>
                        {availableAutoMeta.regions.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 3. Hierarchical Road Tag Tree */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">
                      ROAD TAG TREE
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">Match:</span>
                      {(['AND', 'OR'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setFilterCombinationMode(m)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                            filterCombinationMode === m
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-950 text-slate-400'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                      {selectedFilterTagIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFilterTagIds([]);
                            setAutoSelectedFilterTagIds([]);
                          }}
                          className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {tagTree.length === 0 ? (
                    <div className="text-[11px] text-slate-500 bg-slate-950 p-2 rounded border border-slate-800">
                      No tags created yet. Add root tags and subtags below.
                    </div>
                  ) : (
                    <div className="bg-slate-950 p-2 rounded border border-slate-800 max-h-44 overflow-y-auto space-y-0.5">
                      {renderTagTreeNodes(null, 0, 'filter')}
                    </div>
                  )}

                  <form onSubmit={handleAddTagNode} className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="New tag name..."
                        className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white text-[11px] outline-none"
                      />
                      <input
                        type="color"
                        value={newTagColor}
                        onChange={(e) => setNewTagColor(e.target.value)}
                        className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <select
                        value={newTagParentId}
                        onChange={(e) => setNewTagParentId(e.target.value)}
                        className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 text-[11px]"
                      >
                        <option value="">Root Tag (No Parent)</option>
                        {tagTree.map((t) => (
                          <option key={t.id} value={t.id}>
                            Subtag of: {t.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] cursor-pointer"
                      >
                        +Add Tag
                      </button>
                    </div>
                  </form>
                </div>

                {/* 4. Hierarchical Side Line Tag Tree & Cardinal Filter */}
                <div className="border-t border-slate-800 pt-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">
                      SIDE LINE TAG TREE & CARDINAL FILTER
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span>Min Zoom: {sideLineMinZoom}</span>
                      <input
                        type="range"
                        min={5}
                        max={14}
                        step={1}
                        value={sideLineMinZoom}
                        onChange={(e) =>
                          setSideLineMinZoom(Number(e.target.value))
                        }
                        title="Minimum map zoom level to display side lines"
                        className="w-14 accent-indigo-500"
                      />
                    </div>
                  </div>

                  {sideLineTags.length === 0 ? (
                    <div className="text-[11px] text-slate-500 bg-slate-950 p-2 rounded border border-slate-800">
                      No side line tags created yet. Add root or nested side line tags below.
                    </div>
                  ) : (
                    <div className="bg-slate-950 p-2 rounded border border-slate-800 max-h-40 overflow-y-auto space-y-0.5">
                      {renderSideLineTagTreeNodes(null, 0)}
                    </div>
                  )}

                  <form
                    onSubmit={handleAddSideLineTag}
                    className="space-y-1.5 pt-1"
                  >
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newSideLineTagName}
                        onChange={(e) => setNewSideLineTagName(e.target.value)}
                        placeholder="New side line tag..."
                        className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white text-[11px] outline-none"
                      />
                      <input
                        type="color"
                        value={newSideLineTagColor}
                        onChange={(e) => setNewSideLineTagColor(e.target.value)}
                        className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <select
                        value={newSideLineTagParentId}
                        onChange={(e) =>
                          setNewSideLineTagParentId(e.target.value)
                        }
                        className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 text-[11px]"
                      >
                        <option value="">Root Side Line Tag (No Parent)</option>
                        {sideLineTags.map((t) => (
                          <option key={t.id} value={t.id}>
                            Subtag of: {formatSideLineHierarchicalLabel(t)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] cursor-pointer"
                      >
                        +Add
                      </button>
                    </div>
                  </form>

                  <div className="space-y-1 pt-1">
                    <label className="block text-[10px] text-slate-400">
                      Show where Side Line is on Cardinal Side of Road:
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          'all',
                          'N',
                          'S',
                          'E',
                          'W',
                          'NE',
                          'NW',
                          'SE',
                          'SW',
                        ] as const
                      ).map((dir) => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => setCardinalDirectionFilter(dir)}
                          className={`px-2 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                            cardinalDirectionFilter === dir
                              ? 'bg-emerald-600 border-emerald-400 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {dir === 'all' ? 'All Sides' : `${dir} of Road`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Section B: Official Street View Panorama Panel */}
            {showStreetViewPanel && (
              <div className="flex-1 flex flex-col min-h-[280px] border-b border-slate-800">
                <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                    <div className="truncate">
                      <div className="text-xs font-bold text-white truncate">
                        {svMeta
                          ? svMeta.description ||
                            `${svMeta.lat.toFixed(5)}, ${svMeta.lng.toFixed(5)}`
                          : 'Official Street View'}
                      </div>
                      {svMeta && (
                        <div className="text-[10px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {svMeta.captureDate && (
                            <span className="text-emerald-400 font-bold">
                              {svMeta.captureDate}
                              {svMeta.season ? ` (${svMeta.season})` : ''}
                            </span>
                          )}
                          {svMeta.cameraGen && svMeta.cameraGen !== 'Unknown' && (
                            <span className="text-indigo-300 font-bold">
                              {svMeta.cameraGen}
                            </span>
                          )}
                          {svMeta.regionName && (
                            <span className="text-slate-300">
                              {svMeta.regionName}
                              {svMeta.countryCode
                                ? ` [${svMeta.countryCode}]`
                                : ''}
                            </span>
                          )}
                          <span className="text-sky-300 font-bold">
                            Car: {formatCompassDirection(svMeta.carHeadingDeg)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {svMeta && (
                      <>
                        <button
                          type="button"
                          onClick={handleMarkOrUnmarkActiveSphere}
                          title={
                            markedSphereForActivePano
                              ? 'Delete Marked Coverage Sphere from Map'
                              : 'Mark (Keep) this Coverage Sphere on the Map'
                          }
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                            markedSphereForActivePano
                              ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                              : 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                          }`}
                        >
                          {markedSphereForActivePano ? (
                            <>
                              <Trash2 className="w-3 h-3" />
                              <span>Delete Sphere</span>
                            </>
                          ) : (
                            <>
                              <Bookmark className="w-3 h-3" />
                              <span>Mark Sphere</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setUseIframeFallback((v) => !v)}
                          title="Switch between Distortion-Free Live Viewer and Google Embed"
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold cursor-pointer"
                        >
                          {useIframeFallback ? 'Live 360°' : 'Embed'}
                        </button>

                        <a
                          href={`https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(
                            svMeta.panoId
                          )}&viewpoint=${svMeta.lat},${
                            svMeta.lng
                          }&heading=${Math.round(svViewHeading)}&pitch=${Math.round(
                            svViewPitch
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold"
                        >
                          <span>Maps</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={closeTemporaryStreetView}
                      title="Close Street View (unmarked sphere will disappear)"
                      className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 relative bg-slate-950 min-h-[260px]">
                  {svLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-10 text-xs text-slate-300">
                      Loading official Google Street View panorama...
                    </div>
                  )}
                  {!svLoading && svStatusMessage && (
                    <div className="p-4 text-xs text-amber-300">
                      {svStatusMessage}
                    </div>
                  )}
                  {svMeta && !useIframeFallback && (
                    <StreetViewSphericalViewer
                      panoId={svMeta.panoId}
                      carHeadingDeg={svMeta.carHeadingDeg}
                      panoNorthDeg={svMeta.panoNorthDeg}
                      viewHeadingDeg={svViewHeading}
                      viewPitchDeg={svViewPitch}
                      neighborLinks={svMeta.neighborLinks}
                      onChangeViewAngle={(h, p) => {
                        setSvViewHeading(h);
                        setSvViewPitch(p);
                        if (markedSphereForActivePano) {
                          const next = annotations.map((a) =>
                            a.id === markedSphereForActivePano.id
                              ? { ...a, viewHeadingDeg: h, viewPitchDeg: p }
                              : a
                          );
                          setAnnotations(next);
                          saveNotebookAnnotations(activeNotebookId, next);
                        }
                      }}
                      onNavigateNeighbor={async (n) => {
                        if (n.lat !== undefined && n.lng !== undefined) {
                          await openStreetViewAt(n.lat, n.lng);
                        }
                      }}
                    />
                  )}
                  {svMeta && useIframeFallback && (
                    <iframe
                      key={`${svMeta.panoId}-${Math.round(svViewHeading)}`}
                      title="Google Street View Panorama"
                      src={`https://www.google.com/maps/embed?pb=!4v1700000000000!6m8!1m7!1s${encodeURIComponent(
                        svMeta.panoId
                      )}!2m2!1d${svMeta.lat}!2d${svMeta.lng}!3f${Math.round(
                        svViewHeading
                      )}!4f0!5f0.7820865974627469`}
                      className="w-full h-full border-0"
                      allowFullScreen
                    />
                  )}
                </div>
              </div>
            )}

            {/* Section C: Selected Annotation Inspector */}
            {selectedAnnotation && (
              <div className="p-3 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="font-bold text-white uppercase">
                    {selectedAnnotation.type.replace('-', ' ')} INSPECTOR
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => deleteAnnotationById(selectedAnnotation.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedAnnotationId(null)}
                      className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Automatically Extracted Official Metadata Spans along Road Stretch */}
                {selectedAnnotation.autoMetaSpans &&
                  selectedAnnotation.autoMetaSpans.length > 0 && (
                    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">
                        Auto-Detected Official Coverage Spans (
                        {selectedAnnotation.autoMetaSpans.length})
                      </div>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {selectedAnnotation.autoMetaSpans.map((sp, i) => (
                          <div
                            key={`${sp.panoId}-${i}`}
                            className="flex flex-wrap items-center justify-between gap-1 text-[10px] bg-slate-900 px-2 py-1 rounded border border-slate-800"
                          >
                            <span className="font-bold text-slate-300">
                              {Math.round(sp.startFrac * 100)}%–
                              {Math.round(sp.endFrac * 100)}%
                            </span>
                            <span className="text-emerald-400 font-bold">
                              {sp.captureDate || 'Unknown Date'}
                              {sp.season ? ` · ${sp.season}` : ''}
                            </span>
                            <span className="text-indigo-300 font-bold">
                              {sp.cameraGen || ''}
                            </span>
                            <span className="text-slate-400 truncate max-w-[160px]">
                              {[sp.regionName, sp.countryCode]
                                .filter(Boolean)
                                .join(', ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Label Input */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-300">
                    Label
                  </label>
                  <input
                    type="text"
                    value={selectedAnnotation.label || ''}
                    onChange={(e) =>
                      updateSelectedAnnotation({ label: e.target.value })
                    }
                    placeholder="Label..."
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Driving Direction Arrows */}
                {(selectedAnnotation.type === 'road-stretch' ||
                  selectedAnnotation.type === 'freehand') && (
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-300">
                      Driving Direction Arrows
                    </label>
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
                          onClick={() =>
                            updateSelectedAnnotation({ direction: d.id })
                          }
                          className={`py-1 rounded font-bold text-[11px] border cursor-pointer ${
                            (selectedAnnotation.direction || 'none') === d.id
                              ? 'bg-indigo-600 border-indigo-400 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Points of Interest (POIs) Manager on Road Stretch */}
                {selectedAnnotation.type === 'road-stretch' &&
                  selectedAnnotation.points && (
                    <div className="space-y-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-300">
                          POINTS OF INTEREST (
                          {(selectedAnnotation.roadPois || []).length})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const existing = selectedAnnotation.roadPois || [];
                            const frac = 0.5;
                            const pos = interpolatePointOnPolylineByFraction(
                              selectedAnnotation.points!,
                              frac
                            );
                            const nextPoi: RoadPointOfInterest = {
                              id: `poi-${Date.now()}`,
                              label: `P${existing.length + 1}`,
                              frac,
                              position: pos,
                              color: activeColor,
                            };
                            updateSelectedAnnotation({
                              roadPois: [...existing, nextPoi].sort(
                                (a, b) => a.frac - b.frac
                              ),
                            });
                          }}
                          className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer"
                        >
                          +Add POI
                        </button>
                      </div>

                      {(selectedAnnotation.roadPois || []).length === 0 ? (
                        <div className="text-[10px] text-slate-500">
                          Use the "Road POI" tool to click on this road stretch,
                          or click "+Add POI" above.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {(selectedAnnotation.roadPois || []).map((poi) => (
                            <div
                              key={poi.id}
                              className="p-1.5 rounded bg-slate-900 border border-slate-800 space-y-1 text-[11px]"
                            >
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  value={poi.color || '#ffffff'}
                                  onChange={(e) => {
                                    const next = (
                                      selectedAnnotation.roadPois || []
                                    ).map((p) =>
                                      p.id === poi.id
                                        ? { ...p, color: e.target.value }
                                        : p
                                    );
                                    updateSelectedAnnotation({ roadPois: next });
                                  }}
                                  className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer"
                                />
                                <input
                                  type="text"
                                  value={poi.label}
                                  onChange={(e) => {
                                    const next = (
                                      selectedAnnotation.roadPois || []
                                    ).map((p) =>
                                      p.id === poi.id
                                        ? { ...p, label: e.target.value }
                                        : p
                                    );
                                    updateSelectedAnnotation({ roadPois: next });
                                  }}
                                  placeholder="POI label..."
                                  className="flex-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-white text-[11px] outline-none"
                                />
                                <span className="text-[10px] text-slate-400">
                                  {Math.round(poi.frac * 100)}%
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = (
                                      selectedAnnotation.roadPois || []
                                    ).filter((p) => p.id !== poi.id);
                                    updateSelectedAnnotation({ roadPois: next });
                                  }}
                                  className="text-slate-500 hover:text-rose-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={poi.frac}
                                onChange={(e) => {
                                  const f = Number(e.target.value);
                                  const pos =
                                    interpolatePointOnPolylineByFraction(
                                      selectedAnnotation.points!,
                                      f
                                    );
                                  const next = (
                                    selectedAnnotation.roadPois || []
                                  )
                                    .map((p) =>
                                      p.id === poi.id
                                        ? { ...p, frac: f, position: pos }
                                        : p
                                    )
                                    .sort((a, b) => a.frac - b.frac);
                                  updateSelectedAnnotation({ roadPois: next });
                                }}
                                className="w-full accent-indigo-500"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                {/* Road Stretch Side Lines Manager */}
                {selectedAnnotation.type === 'road-stretch' && (
                  <div className="space-y-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-300">
                        SIDE LINES ({(selectedAnnotation.sideLines || []).length})
                      </span>
                      {sideLineTags.length > 0 && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const tagId =
                                activeSideLineTagId || sideLineTags[0].id;
                              const nextSl: RoadSideLineAttachment = {
                                id: `sl-${Date.now()}`,
                                sideLineTagId: tagId,
                                side: 'left',
                                startFrac: 0,
                                endFrac: 1,
                              };
                              updateSelectedAnnotation({
                                sideLines: [
                                  ...(selectedAnnotation.sideLines || []),
                                  nextSl,
                                ],
                              });
                            }}
                            className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer"
                          >
                            +Left Side
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const tagId =
                                activeSideLineTagId || sideLineTags[0].id;
                              const nextSl: RoadSideLineAttachment = {
                                id: `sl-${Date.now()}`,
                                sideLineTagId: tagId,
                                side: 'right',
                                startFrac: 0,
                                endFrac: 1,
                              };
                              updateSelectedAnnotation({
                                sideLines: [
                                  ...(selectedAnnotation.sideLines || []),
                                  nextSl,
                                ],
                              });
                            }}
                            className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer"
                          >
                            +Right Side
                          </button>
                        </div>
                      )}
                    </div>

                    {(selectedAnnotation.sideLines || []).map((sl) => {
                      const def = sideLineTagById.get(sl.sideLineTagId);
                      const pois = selectedAnnotation.roadPois || [];
                      const [effStart, effEnd] = resolveSideLineFractions(
                        sl,
                        pois
                      );

                      return (
                        <div
                          key={sl.id}
                          className="p-2 rounded bg-slate-900 border border-slate-800 space-y-2 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <select
                              value={sl.sideLineTagId}
                              onChange={(e) => {
                                const next = (
                                  selectedAnnotation.sideLines || []
                                ).map((item) =>
                                  item.id === sl.id
                                    ? { ...item, sideLineTagId: e.target.value }
                                    : item
                                );
                                updateSelectedAnnotation({ sideLines: next });
                              }}
                              className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-white font-bold"
                              style={{
                                borderLeft: `4px solid ${def?.color || '#fff'}`,
                              }}
                            >
                              {sideLineTags.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {formatSideLineHierarchicalLabel(t)}
                                </option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (
                                    selectedAnnotation.sideLines || []
                                  ).map((item) =>
                                    item.id === sl.id
                                      ? {
                                          ...item,
                                          side:
                                            item.side === 'left'
                                              ? ('right' as const)
                                              : ('left' as const),
                                        }
                                      : item
                                  );
                                  updateSelectedAnnotation({ sideLines: next });
                                }}
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[10px] cursor-pointer"
                              >
                                Side: {sl.side.toUpperCase()}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (
                                    selectedAnnotation.sideLines || []
                                  ).filter((item) => item.id !== sl.id);
                                  updateSelectedAnnotation({ sideLines: next });
                                }}
                                className="text-slate-500 hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {pois.length > 0 && (
                            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                              <div>
                                <span className="text-slate-400 block mb-0.5">
                                  From Boundary:
                                </span>
                                <select
                                  value={
                                    sl.startPoiId
                                      ? `poi:${sl.startPoiId}`
                                      : sl.startFrac === 0
                                      ? 'start'
                                      : 'custom'
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const next = (
                                      selectedAnnotation.sideLines || []
                                    ).map((item) => {
                                      if (item.id !== sl.id) return item;
                                      if (val === 'start') {
                                        return {
                                          ...item,
                                          startPoiId: undefined,
                                          startFrac: 0,
                                        };
                                      }
                                      if (val.startsWith('poi:')) {
                                        const pid = val.slice(4);
                                        const found = pois.find(
                                          (p) => p.id === pid
                                        );
                                        return {
                                          ...item,
                                          startPoiId: pid,
                                          startFrac: found
                                            ? found.frac
                                            : item.startFrac,
                                        };
                                      }
                                      return { ...item, startPoiId: undefined };
                                    });
                                    updateSelectedAnnotation({ sideLines: next });
                                  }}
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-white"
                                >
                                  <option value="start">Road Start (0%)</option>
                                  {pois.map((p) => (
                                    <option key={p.id} value={`poi:${p.id}`}>
                                      POI: {p.label} ({Math.round(p.frac * 100)}%)
                                    </option>
                                  ))}
                                  <option value="custom">
                                    Custom % ({Math.round(effStart * 100)}%)
                                  </option>
                                </select>
                              </div>

                              <div>
                                <span className="text-slate-400 block mb-0.5">
                                  To Boundary:
                                </span>
                                <select
                                  value={
                                    sl.endPoiId
                                      ? `poi:${sl.endPoiId}`
                                      : sl.endFrac === 1
                                      ? 'end'
                                      : 'custom'
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const next = (
                                      selectedAnnotation.sideLines || []
                                    ).map((item) => {
                                      if (item.id !== sl.id) return item;
                                      if (val === 'end') {
                                        return {
                                          ...item,
                                          endPoiId: undefined,
                                          endFrac: 1,
                                        };
                                      }
                                      if (val.startsWith('poi:')) {
                                        const pid = val.slice(4);
                                        const found = pois.find(
                                          (p) => p.id === pid
                                        );
                                        return {
                                          ...item,
                                          endPoiId: pid,
                                          endFrac: found
                                            ? found.frac
                                            : item.endFrac,
                                        };
                                      }
                                      return { ...item, endPoiId: undefined };
                                    });
                                    updateSelectedAnnotation({ sideLines: next });
                                  }}
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-white"
                                >
                                  <option value="end">Road End (100%)</option>
                                  {pois.map((p) => (
                                    <option key={p.id} value={`poi:${p.id}`}>
                                      POI: {p.label} ({Math.round(p.frac * 100)}%)
                                    </option>
                                  ))}
                                  <option value="custom">
                                    Custom % ({Math.round(effEnd * 100)}%)
                                  </option>
                                </select>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <span>Start {Math.round(effStart * 100)}%</span>
                            <input
                              type="range"
                              min={0}
                              max={0.98}
                              step={0.01}
                              value={effStart}
                              onChange={(e) => {
                                const v = Math.min(
                                  Number(e.target.value),
                                  effEnd - 0.01
                                );
                                const next = (
                                  selectedAnnotation.sideLines || []
                                ).map((item) =>
                                  item.id === sl.id
                                    ? {
                                        ...item,
                                        startPoiId: undefined,
                                        startFrac: v,
                                      }
                                    : item
                                );
                                updateSelectedAnnotation({ sideLines: next });
                              }}
                              className="flex-1 accent-indigo-500"
                            />
                            <span>End {Math.round(effEnd * 100)}%</span>
                            <input
                              type="range"
                              min={0.02}
                              max={1}
                              step={0.01}
                              value={effEnd}
                              onChange={(e) => {
                                const v = Math.max(
                                  Number(e.target.value),
                                  effStart + 0.01
                                );
                                const next = (
                                  selectedAnnotation.sideLines || []
                                ).map((item) =>
                                  item.id === sl.id
                                    ? {
                                        ...item,
                                        endPoiId: undefined,
                                        endFrac: v,
                                      }
                                    : item
                                );
                                updateSelectedAnnotation({ sideLines: next });
                              }}
                              className="flex-1 accent-indigo-500"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Sketch Canvas for Pins */}
                {selectedAnnotation.type === 'pin' && (
                  <PinSketchCanvas
                    value={selectedAnnotation.sketchDataUrl}
                    onChange={(dataUrl) =>
                      updateSelectedAnnotation({ sketchDataUrl: dataUrl })
                    }
                  />
                )}

                {/* Assign Tags from Tag Tree (with Auto-Selected Ancestor Propagation) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-300">
                      Assigned Tags
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowTagManagerPanel(true)}
                      className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                    >
                      Open Tags & Filters
                    </button>
                  </div>
                  {tagTree.length === 0 ? (
                    <div className="text-[11px] text-slate-500">
                      Open "Tags & Filters" to create your Tag Tree.
                    </div>
                  ) : (
                    <div className="bg-slate-950 p-2 rounded border border-slate-800 max-h-36 overflow-y-auto">
                      {renderTagTreeNodes(null, 0, 'assign')}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-300">
                    Notes
                  </label>
                  <textarea
                    rows={3}
                    value={selectedAnnotation.notes || ''}
                    onChange={(e) =>
                      updateSelectedAnnotation({ notes: e.target.value })
                    }
                    placeholder="Notes..."
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500 resize-y"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

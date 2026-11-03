export type CoverageToolId =
  | 'select'
  | 'inspect'
  | 'road-stretch'
  | 'road-poi'
  | 'side-line'
  | 'freehand'
  | 'text'
  | 'pin'
  | 'eraser';

export type DrivingDirectionMode = 'forward' | 'reverse' | 'both' | 'none';

export type RoadSnapSubMode = 'freedraw-snap' | 'point-to-point' | 'single-section';

export type CardinalDirectionFilter =
  | 'all'
  | 'N'
  | 'E'
  | 'S'
  | 'W'
  | 'NE'
  | 'SE'
  | 'SW'
  | 'NW';

export type CoverageSeason = 'Summer' | 'Autumn' | 'Winter' | 'Spring';

export type CameraGeneration = 'Gen 1' | 'Gen 2' | 'Gen 3' | 'Gen 4' | 'Unknown';

export interface CoverageTagNode {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
}

export interface SideLineTagDefinition {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
}

export interface PoiTagDefinition {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
}

export interface RoadPointOfInterest {
  id: string;
  label: string;
  /** Normalized arc-length position along the parent road stretch [0..1] */
  frac: number;
  /** Snapped [lat, lng] coordinate on the parent road stretch */
  position: [number, number];
  color: string;
  /** Hierarchical POI tag IDs assigned to this POI */
  tagIds?: string[];
  /** POI tag IDs that were auto-selected because a child POI tag was selected */
  autoSelectedTagIds?: string[];
  notes?: string;
}

export interface RoadSideLineAttachment {
  id: string;
  sideLineTagId: string;
  /** Optional custom name/label for this specific road side line */
  label?: string;
  /** Optional custom color override for this specific road side line */
  customColor?: string;
  /** 'left' or 'right' looking along the road stretch from start (0) to end (1) */
  side: 'left' | 'right';
  /** Normalized arc-length start along the road stretch [0..1] */
  startFrac: number;
  /** Normalized arc-length end along the road stretch [0..1] */
  endFrac: number;
  /** Optional ID of a RoadPointOfInterest on this road stretch used as the start boundary */
  startPoiId?: string;
  /** Optional ID of a RoadPointOfInterest on this road stretch used as the end boundary */
  endPoiId?: string;
  notes?: string;
}

/**
 * Automatically extracted official Google Street View metadata for a contiguous sub-span
 * [startFrac, endFrac] of a marked road stretch.
 * Allows a single road stretch that crosses multiple capture dates, camera generations,
 * or administrative regions to be filtered and highlighted accurately by sub-section.
 */
export interface RoadAutoMetaSpan {
  startFrac: number;
  endFrac: number;
  panoId: string;
  year?: number;
  month?: number;
  captureDate?: string;
  season?: CoverageSeason;
  cameraGen?: CameraGeneration;
  countryCode?: string;
  regionName?: string;
  localityName?: string;
  roadName?: string;
  elevationMeters?: number;
  carHeadingDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  historicalYears?: number[];
}

export interface CoverageAnnotation {
  id: string;
  notebookId: string;
  type: 'road-stretch' | 'freehand' | 'text' | 'pin' | 'sphere';
  /** Polyline coordinates [[lat, lng], ...] for road-stretch and freehand */
  points?: Array<[number, number]>;
  /** Single point [lat, lng] for text, pin, and marked coverage sphere */
  position?: [number, number];
  /** Stroke / marker color */
  color: string;
  /** Stroke thickness in pixels */
  strokeWidth?: number;
  /** Driving direction chevron mode for road-stretch or freehand */
  direction?: DrivingDirectionMode;
  /** Short visible label rendered on the map */
  label?: string;
  /** Detailed notes */
  notes?: string;
  /** All assigned tag IDs (union of explicitTagIds and autoSelectedAncestorTagIds) */
  tagIds?: string[];
  /** Tag IDs that were auto-selected only because a lower-level descendant tag was selected */
  autoSelectedTagIds?: string[];
  /** Assigned POI tag IDs (when a Pin/POI is tagged directly) */
  poiTagIds?: string[];
  autoSelectedPoiTagIds?: string[];
  /** Points of interest along this road stretch */
  roadPois?: RoadPointOfInterest[];
  /** Attached side lines along segments of this road stretch */
  sideLines?: RoadSideLineAttachment[];
  /** Automatically extracted per-segment official Street View metadata spans along the road stretch */
  autoMetaSpans?: RoadAutoMetaSpan[];
  /** Optional mini-sketch data URL (PNG from embedded mini canvas) */
  sketchDataUrl?: string;
  /** Official Street View panorama metadata (for marked spheres or primary stretch info) */
  panoId?: string;
  carHeadingDeg?: number;
  viewHeadingDeg?: number;
  viewPitchDeg?: number;
  captureDate?: string;
  cameraGen?: CameraGeneration;
  countryCode?: string;
  regionName?: string;
  elevationMeters?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CoverageNotebook {
  id: string;
  name: string;
  countryOrRegion: string;
  defaultCenter: [number, number];
  defaultZoom: number;
  createdAt: number;
  updatedAt: number;
}

export interface OfficialStreetViewMetadata {
  panoId: string;
  lat: number;
  lng: number;
  carHeadingDeg: number;
  panoNorthDeg: number;
  pitchDeg?: number;
  rollDeg?: number;
  elevationMeters?: number;
  captureDate?: string;
  year?: number;
  month?: number;
  season?: CoverageSeason;
  cameraGen: CameraGeneration;
  worldSize?: [number, number];
  description?: string;
  roadName?: string;
  localityName?: string;
  regionName?: string;
  countryCode?: string;
  rpcCopyright?: string;
  historicalYears: number[];
  neighborLinks: Array<{
    panoId: string;
    headingDeg: number;
    lat?: number;
    lng?: number;
  }>;
  roadSequence: Array<{
    panoId: string;
    lat: number;
    lng: number;
    carHeadingDeg: number;
  }>;
}

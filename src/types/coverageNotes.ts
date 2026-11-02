export type CoverageToolId =
  | 'inspect'
  | 'road-stretch'
  | 'road-poi'
  | 'side-line'
  | 'freehand'
  | 'text'
  | 'pin'
  | 'select'
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

export interface CoverageTagNode {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
}

export interface SideLineTagDefinition {
  id: string;
  name: string;
  color: string;
  parentId?: string | null;
}

export interface RoadPointOfInterest {
  id: string;
  label: string;
  /** Normalized arc-length position along the parent road stretch [0..1] */
  frac: number;
  /** Snapped [lat, lng] coordinate on the parent road stretch */
  position: [number, number];
  color: string;
  notes?: string;
}

export interface RoadSideLineAttachment {
  id: string;
  sideLineTagId: string;
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
  /** Assigned tag IDs from the user's Tag Tree */
  tagIds?: string[];
  /** Points of interest (intersections, landmarks, boundaries) along this road stretch */
  roadPois?: RoadPointOfInterest[];
  /** Attached side lines along segments of this road stretch */
  sideLines?: RoadSideLineAttachment[];
  /** Optional mini-sketch data URL (PNG from embedded mini canvas) */
  sketchDataUrl?: string;
  /** Official Street View panorama metadata (for marked spheres or linked stretches) */
  panoId?: string;
  carHeadingDeg?: number;
  viewHeadingDeg?: number;
  viewPitchDeg?: number;
  captureDate?: string;
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
  elevationMeters?: number;
  captureDate?: string;
  description?: string;
  countryCode?: string;
  neighborLinks: Array<{
    panoId: string;
    headingDeg: number;
    lat?: number;
    lng?: number;
  }>;
  /** Nearby sequence of panoramas along the same road returned by SingleImageSearch */
  roadSequence: Array<{
    panoId: string;
    lat: number;
    lng: number;
    carHeadingDeg: number;
  }>;
}

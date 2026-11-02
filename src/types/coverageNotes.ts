export type CoverageToolId =
  | 'inspect'
  | 'select'
  | 'road-stretch'
  | 'driving-arrow'
  | 'freehand'
  | 'text'
  | 'pin'
  | 'eraser';

export type DrivingDirectionMode = 'forward' | 'reverse' | 'both' | 'none';

export type MetaPinCategory =
  | 'pole'
  | 'sign'
  | 'weather'
  | 'camera'
  | 'landscape'
  | 'intersection'
  | 'note';

export interface CoverageAnnotationBase {
  id: string;
  notebookId: string;
  createdAt: number;
  updatedAt: number;
  color: string;
  strokeWidth: number;
  label?: string;
  notes?: string;
  tags?: string[];
  /** Optional captured Street View reference attached to this annotation */
  svPanoId?: string;
  svLat?: number;
  svLng?: number;
  svHeading?: number;
  svDate?: string;
}

export interface RoadStretchAnnotation extends CoverageAnnotationBase {
  kind: 'road-stretch';
  points: Array<[number, number]>; // [lat, lng][]
  direction: DrivingDirectionMode;
  dashed?: boolean;
}

export interface DrivingArrowAnnotation extends CoverageAnnotationBase {
  kind: 'driving-arrow';
  points: Array<[number, number]>; // [lat, lng][] (2 or more points)
  direction: DrivingDirectionMode;
  autoDetectedHeading?: number;
}

export interface FreehandAnnotation extends CoverageAnnotationBase {
  kind: 'freehand';
  points: Array<[number, number]>; // [lat, lng][]
  arrowEnd?: boolean;
}

export interface TextLabelAnnotation extends CoverageAnnotationBase {
  kind: 'text';
  position: [number, number]; // [lat, lng]
  text: string;
  fontSize: number;
}

export interface MetaPinAnnotation extends CoverageAnnotationBase {
  kind: 'pin';
  position: [number, number]; // [lat, lng]
  category: MetaPinCategory;
  /** Optional data URL of a mini pole/sign sketch or pasted screenshot */
  imageDataUrl?: string;
}

export type CoverageAnnotation =
  | RoadStretchAnnotation
  | DrivingArrowAnnotation
  | FreehandAnnotation
  | TextLabelAnnotation
  | MetaPinAnnotation;

export interface CoverageNotebook {
  id: string;
  name: string;
  countryOrRegion: string;
  center: [number, number];
  zoom: number;
  createdAt: number;
  updatedAt: number;
}

export interface OfficialStreetViewMetadata {
  panoId: string;
  lat: number;
  lng: number;
  carHeadingDeg: number;
  pitchDeg: number;
  elevationMeters: number | null;
  captureDate: string | null; // e.g. "2012-06"
  description: string | null; // e.g. "Bobonong, Central District"
  countryCode: string | null;
  neighborLinks: Array<{
    panoId: string;
    lat: number;
    lng: number;
    headingDeg: number;
  }>;
}

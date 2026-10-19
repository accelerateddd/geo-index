export type QuizCategory =
  | 'subdivisions'
  | 'niche-subdivisions'
  | 'flags'
  | 'landscapes'
  | 'cities'
  | 'special'
  | 'leisure';

export type QuizMode = 'type-highlighted' | 'click-named' | 'list-all';

export type TypingMatchMode = 'enter-submit' | 'instant-match';

export type MapDisplayStyle =
  | 'all-outlines' // Standard: all subdivision outlines visible
  | 'minefield-no-outlines' // Click mode variant: only outer country/continent border visible, no internal outlines
  | 'centroid-dot' // Country outline visible, subdivision replaced by centroid dot (Type only)
  | 'isolated-outline-in-country' // Country outline visible, ONLY target subdivision outline visible (Type only)
  | 'isolated-shape' // No map, just a high-def picture/SVG of the target subdivision shape (Type only)
  | 'unit-vectors'; // No shape drawn; unit vectors from centroid to N closest centroids with labels (Type only)

export type FlagDisplayMode = 'standard' | 'filtered' | 'pie-chart';

export type FlagFilterId =
  | 'pixelate'
  | 'swirl'
  | 'grayscale'
  | 'colorblind-deuteranopia'
  | 'colorblind-tritanopia'
  | 'invert'
  | 'hue-shift'
  | 'wave'
  | 'kaleidoscope'
  | 'slice-shuffle'
  | 'edge-detect';

export interface QuizPlaySettings {
  mode: QuizMode;
  typingMatchMode: TypingMatchMode;
  mapDisplayStyle: MapDisplayStyle;
  vectorNeighborsCount: number; // Customisable N for unit-vectors mode (1 to totalItems - 1)
  randomRotation?: boolean; // Optional random rotation/alignment for isolated-shape mode
  flagDisplayMode?: FlagDisplayMode; // Display mode for flag type quizzes
  flagFilters?: FlagFilterId[]; // Active layered filters when flagDisplayMode === 'filtered'
  // Special Top-N Cities Relative Position Quiz settings:
  specialCitiesCount?: number; // N largest cities to plot (3 to 12)
  showCapitalStar?: boolean; // Show star for capital city
  scaleCitiesByPopulation?: boolean; // Scale dot radius by city population
  showScaleReference?: boolean; // Show corner non-country geographical reference silhouette at matching scale
}

export type QuizFormat =
  | 'map-polygon'
  | 'map-point'
  | 'flag'
  | 'special-country-cities';

export interface CityPointItem {
  name: string;
  lat: number;
  lng: number;
  stateOrRegion?: string;
  population?: number;
  aliases?: string[];
}

export interface FlagQuizItem {
  name: string;
  imageUrl: string;
  iconUrl?: string;
  code?: string;
  subtext?: string;
  aliases?: string[];
}

export interface SpecialCountryCitiesItem {
  iso3: string;
  iso2?: string;
  countryName: string;
  aliases?: string[];
  cities: Array<{
    name: string;
    lat: number;
    lng: number;
    population: number;
    isCapital: boolean;
  }>;
}

export interface QuizConfig {
  id: string;
  title: string;
  category: QuizCategory;
  format?: QuizFormat; // defaults to 'map-polygon'
  countryOrRegion: string;
  /** Path to GeoJSON in public/data or inline custom GeoJSON stored in IndexedDB/localStorage */
  geoJsonUrl?: string;
  /** Optional background boundary GeoJSON for point/city or river quizzes */
  backgroundGeoJsonUrl?: string;
  /** Optional URL for special quiz datasets */
  specialDataUrl?: string;
  /** Optional small flag icon path to display next to the quiz in lists/selectors */
  iconFlagUrl?: string;
  customGeoJson?: GeoJSON.FeatureCollection;
  /** Which property inside feature.properties holds the primary name */
  nameProperty?: string;
  /** Optional property filter to slice a single GeoJSON into sub-quizzes (e.g. adm1_name === 'Central') */
  filterProperty?: string;
  filterValue?: string;
  /** Items for city point quizzes */
  cityItems?: CityPointItem[];
  /** Items for flag quizzes */
  flagItems?: FlagQuizItem[];
  /** Optional map of Canonical Name -> accepted alternative spellings / aliases */
  aliases?: Record<string, string[]>;
  /** Initial map center and zoom */
  defaultCenter?: [number, number];
  defaultZoom?: number;
  totalItems: number;
  tags: string[];
  isCustom?: boolean;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  timestamp: number; // ms since epoch
  scorePercent: number; // 0 - 100
  correctCount: number;
  totalCount: number;
  durationSeconds: number;
  missedRegions: string[];
  mode: QuizMode;
  typingMatchMode?: TypingMatchMode;
  mapDisplayStyle?: MapDisplayStyle;
  flagDisplayMode?: FlagDisplayMode;
}

export interface QuizRevisionStats {
  quizId: string;
  attemptsCount: number;
  perfectCount: number; // Number of times scored 100%
  consecutivePerfectStreak: number; // Current streak of 100% scores
  lastPlayedAt: number | null; // ms timestamp
  lastScorePercent: number | null;
  bestScorePercent: number | null;
  fastestPerfectSeconds: number | null;
  /** Frequently missed regions/items across attempts: itemName -> missCount */
  missedFrequency: Record<string, number>;
}

export interface RevisionQueueItem {
  quiz: QuizConfig;
  stats: QuizRevisionStats;
  /** Continuous priority weight — higher means higher priority in the endless queue */
  priorityScore: number;
  daysSinceLastPlayed: number | null;
}

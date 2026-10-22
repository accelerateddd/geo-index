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
  | 'all-outlines' // Standard: subdivision outlines visible (or isolated target if isolateTargetInCountry is true)
  | 'minefield-no-outlines' // Click mode variant: only outer country/continent border visible, no internal outlines
  | 'centroid-dot' // Country outline visible, subdivisions replaced by centroid dots (or single dot if isolateTargetInCountry is true)
  | 'isolated-outline-in-country' // Legacy alias for all-outlines + isolateTargetInCountry=true
  | 'isolated-shape' // No map, just a high-def picture/SVG of the target subdivision shape (Type only)
  | 'unit-vectors'; // No shape drawn; unit vectors from centroid to N closest centroids with labels (Type only)

export type ListAllDisplayStyle =
  | 'map-outlines' // Standard map with all outlines visible; fills in as you list items
  | 'map-reveal-borders' // No internal borders shown until an item is named, then that region appears
  | 'no-map-list'; // No map at all; items are listed into an on-screen text table

export type ListAllOrderMode =
  | 'named-order' // Default: items appear in the order you name them (1..N)
  | 'alphabetical' // Easier: slots are ordered A-Z so blank slots between named items give alphabetical hints
  | 'blind'; // Hardest: no progress or named list is shown, and quiz only ends when you press Submit

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
  /** Sub-setting for 'all-outlines' and 'centroid-dot': only show the active target outline/centroid inside the country border */
  isolateTargetInCountry?: boolean;
  vectorNeighborsCount: number; // Customisable N for unit-vectors mode (1 to totalItems - 1)
  randomRotation?: boolean; // Optional random rotation/alignment for isolated-shape mode
  // List-All mode settings:
  listAllDisplayStyle?: ListAllDisplayStyle;
  listAllShowOuterBorder?: boolean; // For 'map-reveal-borders': whether to show outer country/continent outline
  listAllOrderMode?: ListAllOrderMode; // For 'no-map-list': 'named-order' | 'alphabetical' | 'blind'
  // Flag mode settings:
  flagDisplayMode?: FlagDisplayMode; // Display mode for flag type quizzes
  flagFilters?: FlagFilterId[]; // Active layered filters when flagDisplayMode === 'filtered'
  // Special Top-N Cities Relative Position Quiz settings:
  specialCitiesCount?: number; // N largest cities to plot (3 to 12)
  showCapitalStar?: boolean; // Show star for capital city
  showRelativePopulation?: boolean; // Scale dot radius by sqrt(pop) and display rank #1..#N
  showAbsolutePopulation?: boolean; // Display absolute population of each city (e.g. 5.3M, 420k)
  scaleCitiesByPopulation?: boolean; // Legacy compatibility flag
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
  /** Estimated memory stability S in days (time until recall probability drops to 90%) */
  stabilityDays?: number | null;
  /** Estimated difficulty / error burden D in [1.0, 10.0] from historical mistakes */
  difficultyScore?: number;
}

export interface RevisionQueueItem {
  quiz: QuizConfig;
  stats: QuizRevisionStats;
  /** Continuous priority weight — higher means higher priority in the endless queue */
  priorityScore: number;
  daysSinceLastPlayed: number | null;
  /** Estimated current probability of a 100% recall run, in [0, 1] */
  retrievability?: number | null;
  /** Days until R(t) drops to 0.90 (negative = overdue) */
  dueInDays?: number | null;
  /** Memory Stability S in days */
  stabilityDays?: number | null;
  /** Error-weighted Difficulty D in [1, 10] */
  difficultyScore?: number | null;
}

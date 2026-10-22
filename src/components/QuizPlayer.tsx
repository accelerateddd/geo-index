import React, { useEffect, useState, useRef, useMemo } from 'react';
import { MapContainer, GeoJSON, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  CheckCircle2,
  Clock,
  Compass,
  Droplets,
  Eye,
  FastForward,
  Focus,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Undo2,
  XCircle,
} from 'lucide-react';
import type {
  FlagDisplayMode,
  FlagFilterId,
  FlagQuizItem,
  ListAllDisplayStyle,
  ListAllOrderMode,
  MapDisplayStyle,
  QuizAttempt,
  QuizConfig,
  QuizPlaySettings,
  SpecialCountryCitiesItem,
} from '../types/quiz';
import {
  getTrackedPresetForQuiz,
  isAnswerMatch,
  isMatchingTrackedPreset,
  loadCustomGeoJson,
  saveTrackedPresetForQuiz,
} from '../utils/storage';
import {
  bboxesIntersect,
  clipSubdivisionsAgainstLakes,
  computeClosestUnitVectors,
  computeFeatureCollectionBBox,
  computeFeaturesBBox,
  computeSubdivisionCentroid,
  featuresToSvgPath,
  isLineGeometry,
  punchIslandHolesInLakes,
} from '../utils/geometry';
import {
  FLAG_FILTER_DEFINITIONS,
  getConflictingFilter,
} from '../utils/flagEffects';
import { getQuizFlagIconUrl } from '../utils/flagIcons';
import { resolveAssetUrl } from '../utils/assetUrl';
import { FlagVisualRenderer } from './FlagVisualRenderer';
import { SpecialCitiesCanvas } from './SpecialCitiesCanvas';

interface QuizPlayerProps {
  quiz: QuizConfig;
  practiceSubset?: string[] | null;
  onComplete: (attempt: QuizAttempt) => void;
  onExit: () => void;
  onNextInRevisionQueue?: () => void;
}

interface RegionStatus {
  name: string;
  state: 'pending' | 'correct' | 'missed';
  attempts: number;
}

let cachedLakes: GeoJSON.FeatureCollection | null = null;
let cachedWorldCountries: GeoJSON.FeatureCollection | null = null;

function MapBoundsController({
  geoJsonData,
  cityPoints,
  targetFeature,
  targetLatLng,
  autoZoomTarget,
  fitTrigger,
}: {
  geoJsonData: GeoJSON.FeatureCollection | null;
  cityPoints?: Array<{ lat: number; lng: number }>;
  targetFeature: GeoJSON.Feature | null;
  targetLatLng: [number, number] | null;
  autoZoomTarget: boolean;
  fitTrigger: number;
}) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0 && map.getZoom() <= map.getMinZoom() + 0.01) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    container.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [map]);

  useEffect(() => {
    try {
      if (geoJsonData && geoJsonData.features.length > 0) {
        const layer = L.geoJSON(geoJsonData);
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.setMinZoom(1);
          map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
          const fittedZoom = map.getBoundsZoom(bounds, false, L.point(24, 24));
          map.setMinZoom(Math.max(1, Math.min(fittedZoom, map.getZoom()) - 1));
          return;
        }
      }
      if (cityPoints && cityPoints.length > 0) {
        const bounds = L.latLngBounds(
          cityPoints.map((c) => [c.lat, c.lng] as [number, number])
        );
        if (bounds.isValid()) {
          map.setMinZoom(1);
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
          const fittedZoom = map.getBoundsZoom(bounds, false, L.point(40, 40));
          map.setMinZoom(Math.max(1, Math.min(fittedZoom, map.getZoom()) - 1));
        }
      }
    } catch (e) {
      console.warn('Could not fit bounds:', e);
    }
  }, [geoJsonData, cityPoints, fitTrigger, map]);

  useEffect(() => {
    if (!autoZoomTarget) return;
    try {
      if (targetFeature) {
        const layer = L.geoJSON(targetFeature);
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.flyToBounds(bounds, { padding: [90, 90], maxZoom: 9, duration: 0.4 });
        }
      } else if (targetLatLng) {
        map.flyTo(targetLatLng, Math.max(map.getZoom(), 6), { duration: 0.4 });
      }
    } catch {
      // ignore
    }
  }, [targetFeature, targetLatLng, autoZoomTarget, map]);

  return null;
}

const TYPE_GEOMETRY_MODES_INFO: Array<{
  id: MapDisplayStyle;
  label: string;
  shortDesc: string;
}> = [
  {
    id: 'all-outlines',
    label: 'ALL_OUTLINES',
    shortDesc:
      'Map outlines mode; shows all subdivision borders by default, or use the top toggle to isolate only the current target outline.',
  },
  {
    id: 'centroid-dot',
    label: 'CENTROID_DOT',
    shortDesc:
      'Country/continent border with geometric center dots; shows all centroids by default, or use the top toggle to isolate only the target centroid.',
  },
  {
    id: 'isolated-shape',
    label: 'SHAPE_ONLY',
    shortDesc: 'No map context; displays an isolated high-definition SVG of the target shape.',
  },
  {
    id: 'unit-vectors',
    label: 'UNIT_VECTORS',
    shortDesc: 'No shape drawn; shows unit vectors from center to the N closest items.',
  },
];

const CLICK_GEOMETRY_MODES_INFO: Array<{
  id: MapDisplayStyle;
  label: string;
  shortDesc: string;
}> = [
  {
    id: 'all-outlines',
    label: 'STANDARD_OUTLINES',
    shortDesc: 'All outlines are visible; click the named target.',
  },
  {
    id: 'minefield-no-outlines',
    label: 'MINEFIELD (NO SUBDIVISION OUTLINES)',
    shortDesc:
      'Only the outer country/continent border is shown; internal outlines stay hidden until found.',
  },
];

const LIST_ALL_DISPLAY_MODES_INFO: Array<{
  id: ListAllDisplayStyle;
  label: string;
  shortDesc: string;
}> = [
  {
    id: 'map-outlines',
    label: 'STANDARD_MAP_OUTLINES',
    shortDesc: 'Full map with all borders visible; regions fill in on the map as you name them.',
  },
  {
    id: 'map-reveal-borders',
    label: 'BORDERLESS_REVEAL_MAP',
    shortDesc:
      'No internal subdivision borders are shown until you name a region, at which point that region appears on the map.',
  },
  {
    id: 'no-map-list',
    label: 'NO_MAP_TEXT_LIST',
    shortDesc:
      'No map is shown; list items into a blank on-screen list (Named Order, Alphabetical Hints, or Blind Submit).',
  },
];

const LIST_ALL_ORDER_MODES_INFO: Array<{
  id: ListAllOrderMode;
  label: string;
  shortDesc: string;
}> = [
  {
    id: 'named-order',
    label: 'NAMED_ORDER (DEFAULT)',
    shortDesc: 'Items are placed into the list in the exact chronological order you name them.',
  },
  {
    id: 'alphabetical',
    label: 'ALPHABETICAL_SLOTS (EASIER)',
    shortDesc:
      'Items are placed in alphabetical order (A–Z), so blank slots between named items give alphabetical hints.',
  },
  {
    id: 'blind',
    label: 'BLIND_SUBMIT (HARDEST)',
    shortDesc:
      'No list of named items and no progress counter are shown. Does not auto-end — press SUBMIT when you think you have everything.',
  },
];

const FLAG_DISPLAY_MODES_INFO: Array<{
  id: FlagDisplayMode;
  label: string;
  shortDesc: string;
}> = [
  {
    id: 'standard',
    label: 'STANDARD_FLAG',
    shortDesc: 'Displays the unaltered high-detail flag image.',
  },
  {
    id: 'filtered',
    label: 'FILTERED_FLAG (MULTI-LAYER)',
    shortDesc:
      'Applies a customisable stack of visual filters (Pixelate, Swirl, B&W, Colour Blind, etc.).',
  },
  {
    id: 'pie-chart',
    label: 'COLOUR_PIE_CHART',
    shortDesc:
      'Displays a pie chart of the flag’s exact percentage colour makeup instead of the flag itself.',
  },
];

export const QuizPlayer: React.FC<QuizPlayerProps> = ({
  quiz,
  practiceSubset = null,
  onComplete,
  onExit,
  onNextInRevisionQueue,
}) => {
  const format = quiz.format || 'map-polygon';
  const isFlagQuiz = format === 'flag';
  const isSpecialCitiesQuiz = format === 'special-country-cities';

  const [trackedPreset, setTrackedPreset] = useState<QuizPlaySettings>(() =>
    getTrackedPresetForQuiz(quiz.id)
  );
  const [settings, setSettings] = useState<QuizPlaySettings>(() =>
    getTrackedPresetForQuiz(quiz.id)
  );

  const [hasStarted, setHasStarted] = useState<boolean>(false);
  const [showOptionsPanel, setShowOptionsPanel] = useState<boolean>(false);

  const [geoJsonData, setGeoJsonData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [backgroundGeoJson, setBackgroundGeoJson] = useState<GeoJSON.FeatureCollection | null>(
    null
  );
  const [specialCitiesItems, setSpecialCitiesItems] = useState<SpecialCountryCitiesItem[]>([]);
  const [specialRevealState, setSpecialRevealState] = useState<{
    outcome: 'correct' | 'missed';
    typedText: string;
  } | null>(null);

  const [waterLakes, setWaterLakes] = useState<GeoJSON.FeatureCollection | null>(cachedLakes);
  const [worldCountries, setWorldCountries] = useState<GeoJSON.FeatureCollection | null>(
    cachedWorldCountries
  );
  const [showHydroOverlay, setShowHydroOverlay] = useState(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [queue, setQueue] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [regionStatuses, setRegionStatuses] = useState<Record<string, RegionStatus>>({});
  const [namedOrderList, setNamedOrderList] = useState<string[]>([]);

  const [inputValue, setInputValue] = useState('');
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'correct' | 'missed' | 'skipped';
    text: string;
  } | null>(null);

  const [lastWrongSubmission, setLastWrongSubmission] = useState<{
    targetName: string;
    typedText: string;
    targetFlagItem?: FlagQuizItem | null;
    guessedFlagItem?: FlagQuizItem | null;
  } | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [autoZoomTarget, setAutoZoomTarget] = useState(false);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [sessionSeed, setSessionSeed] = useState<number>(() => Date.now());

  const inputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<number>(Date.now());
  const quizFlagIcon = useMemo(() => getQuizFlagIconUrl(quiz), [quiz]);

  useEffect(() => {
    const preset = getTrackedPresetForQuiz(quiz.id);
    setTrackedPreset(preset);
    setSettings(preset);
    setHasStarted(false);
    setShowOptionsPanel(false);
    setSpecialRevealState(null);
  }, [quiz.id]);

  // Load major lakes & reservoirs + world country outlines
  useEffect(() => {
    if (isFlagQuiz) return;
    if (!cachedLakes) {
      fetch(resolveAssetUrl('/data/world-lakes.geojson'))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) {
            cachedLakes = d;
            setWaterLakes(d);
          }
        })
        .catch(() => {});
    }
    if (!cachedWorldCountries) {
      fetch(resolveAssetUrl('/data/world-countries.geojson'))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) {
            cachedWorldCountries = d;
            setWorldCountries(d);
          }
        })
        .catch(() => {});
    }
  }, [isFlagQuiz]);

  const effectiveAliases = useMemo(() => {
    const map: Record<string, string[]> = { ...(quiz.aliases || {}) };
    if (quiz.cityItems) {
      for (const c of quiz.cityItems) {
        if (c.aliases && c.aliases.length > 0) {
          map[c.name] = [...(map[c.name] || []), ...c.aliases];
        }
      }
    }
    if (quiz.flagItems) {
      for (const f of quiz.flagItems) {
        if (f.aliases && f.aliases.length > 0) {
          map[f.name] = [...(map[f.name] || []), ...f.aliases];
        }
      }
    }
    if (specialCitiesItems.length > 0) {
      for (const item of specialCitiesItems) {
        if (item.aliases && item.aliases.length > 0) {
          map[item.countryName] = [...(map[item.countryName] || []), ...item.aliases];
        }
      }
    }
    return map;
  }, [quiz, specialCitiesItems]);

  // Load quiz data
  useEffect(() => {
    let cancelled = false;
    async function loadQuizResources() {
      setLoading(true);
      setError(null);
      try {
        if (format === 'flag') {
          const names = (quiz.flagItems || []).map((f) => f.name);
          if (!cancelled) {
            setGeoJsonData(null);
            setBackgroundGeoJson(null);
            initializeSessionFromNames(names, practiceSubset);
          }
          return;
        }

        if (format === 'special-country-cities') {
          const url = resolveAssetUrl(
            quiz.specialDataUrl || '/data/special/world-country-top-cities.json'
          );
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
          const data: SpecialCountryCitiesItem[] = await res.json();
          const validItems = data.filter((item) => item.cities && item.cities.length >= 3);
          if (!cancelled) {
            setSpecialCitiesItems(validItems);
            setGeoJsonData(null);
            initializeSessionFromNames(
              validItems.map((i) => i.countryName),
              practiceSubset
            );
          }
          return;
        }

        if (format === 'map-point') {
          let bgData: GeoJSON.FeatureCollection | null = null;
          const urlToLoad = quiz.backgroundGeoJsonUrl || quiz.geoJsonUrl;
          if (urlToLoad) {
            const res = await fetch(resolveAssetUrl(urlToLoad));
            if (res.ok) bgData = await res.json();
          }
          const names = (quiz.cityItems || []).map((c) => c.name);
          if (!cancelled) {
            setGeoJsonData(bgData);
            setBackgroundGeoJson(null);
            initializeSessionFromNames(names, practiceSubset);
          }
          return;
        }

        let data: GeoJSON.FeatureCollection | null = null;
        if (quiz.customGeoJson) {
          data = quiz.customGeoJson;
        } else if (quiz.isCustom) {
          data = await loadCustomGeoJson(quiz.id);
        } else if (quiz.geoJsonUrl) {
          const resolvedUrl = resolveAssetUrl(quiz.geoJsonUrl);
          const res = await fetch(resolvedUrl, {
            headers: { Accept: 'application/geo+json, application/json, text/plain, */*' },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status} loading ${quiz.geoJsonUrl}`);
          const text = await res.text();
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(`Invalid JSON response from ${quiz.geoJsonUrl}`);
          }
        }
        if (!data || !Array.isArray(data.features)) {
          throw new Error(
            `Invalid GeoJSON dataset for "${quiz.id}" (url: ${quiz.geoJsonUrl || 'none'})`
          );
        }

        let bgData: GeoJSON.FeatureCollection | null = null;
        if (quiz.backgroundGeoJsonUrl) {
          try {
            const bgRes = await fetch(resolveAssetUrl(quiz.backgroundGeoJsonUrl));
            if (bgRes.ok) bgData = await bgRes.json();
          } catch {
            // ignore
          }
        }

        let filteredFeatures = data.features;
        if (quiz.filterProperty && quiz.filterValue) {
          filteredFeatures = data.features.filter(
            (f) =>
              String(f.properties?.[quiz.filterProperty!] || '').trim().toLowerCase() ===
              quiz.filterValue!.trim().toLowerCase()
          );
        }

        const finalCollection: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: filteredFeatures,
        };

        if (!cancelled) {
          setGeoJsonData(finalCollection);
          setBackgroundGeoJson(bgData);
          const uniqueNames = Array.from(
            new Set(
              finalCollection.features
                .map((f) => getFeatureName(f))
                .filter((name) => name.length > 0)
            )
          );
          initializeSessionFromNames(uniqueNames, practiceSubset);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load quiz data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadQuizResources();
    return () => {
      cancelled = true;
    };
  }, [quiz.id, quiz.filterProperty, quiz.filterValue, practiceSubset, format]);

  function getFeatureName(feature: GeoJSON.Feature): string {
    const props = feature.properties || {};
    const propKey = quiz.nameProperty || 'name';
    const raw = props[propKey];
    return raw ? String(raw).trim() : '';
  }

  const isRiverOrLineQuiz = useMemo(() => {
    if (!geoJsonData || format !== 'map-polygon') return false;
    return isLineGeometry(geoJsonData.features) || quiz.category === 'landscapes';
  }, [geoJsonData, format, quiz.category]);

  const localWaterLakes = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!waterLakes || isRiverOrLineQuiz) return null;
    let quizBBox = null;
    if (geoJsonData && geoJsonData.features.length > 0) {
      quizBBox = computeFeatureCollectionBBox(geoJsonData);
    } else if (quiz.cityItems && quiz.cityItems.length > 0) {
      const lats = quiz.cityItems.map((c) => c.lat);
      const lngs = quiz.cityItems.map((c) => c.lng);
      quizBBox = {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lngs),
        maxLon: Math.max(...lngs),
      };
    }
    if (!quizBBox) return null;

    const matching = waterLakes.features.filter((f) => {
      const fb = computeFeaturesBBox([f]);
      return bboxesIntersect(quizBBox!, fb, 1.2);
    });
    if (matching.length === 0) return null;

    const matchedCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: matching,
    };

    return punchIslandHolesInLakes(matchedCollection, geoJsonData);
  }, [waterLakes, geoJsonData, quiz.cityItems, isRiverOrLineQuiz]);

  const effectiveGeoJsonData = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!geoJsonData) return null;
    if (!showHydroOverlay || !localWaterLakes || isRiverOrLineQuiz || format !== 'map-polygon') {
      return geoJsonData;
    }
    if (geoJsonData.features.length > 160) return geoJsonData;
    return clipSubdivisionsAgainstLakes(geoJsonData, localWaterLakes);
  }, [geoJsonData, showHydroOverlay, localWaterLakes, isRiverOrLineQuiz, format]);

  const featuresByName = useMemo(() => {
    const map: Record<string, GeoJSON.Feature[]> = {};
    if (!effectiveGeoJsonData || format !== 'map-polygon') return map;
    for (const f of effectiveGeoJsonData.features) {
      const n = getFeatureName(f);
      if (!n) continue;
      if (!map[n]) map[n] = [];
      map[n].push(f);
    }
    return map;
  }, [effectiveGeoJsonData, format, quiz.nameProperty]);

  const subdivisionCentroids = useMemo(() => {
    const map: Record<string, [number, number]> = {};
    if (format === 'map-point' && quiz.cityItems) {
      for (const c of quiz.cityItems) {
        map[c.name] = [c.lat, c.lng];
      }
      return map;
    }
    for (const [name, feats] of Object.entries(featuresByName)) {
      map[name] = computeSubdivisionCentroid(feats);
    }
    return map;
  }, [featuresByName, format, quiz.cityItems]);

  const countryOutlineGeoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (backgroundGeoJson && geoJsonData) {
      const bbox = computeFeatureCollectionBBox(geoJsonData);
      const clippedBg = backgroundGeoJson.features.filter((f) =>
        bboxesIntersect(bbox, computeFeaturesBBox([f]), 2.5)
      );
      if (clippedBg.length > 0) {
        return { type: 'FeatureCollection', features: clippedBg };
      }
    }
    if (!worldCountries) return null;
    const isoTag = quiz.tags.find((t) => /^[A-Z]{3}$/.test(t));
    const matches = worldCountries.features.filter((f) => {
      const p = f.properties || {};
      if (isoTag && (p.ADM0_A3 === isoTag || p.ISO_A3 === isoTag)) return true;
      if (
        p.NAME &&
        String(p.NAME).toLowerCase() === quiz.countryOrRegion.toLowerCase()
      ) {
        return true;
      }
      return false;
    });
    if (matches.length === 0) return null;
    return { type: 'FeatureCollection', features: matches };
  }, [worldCountries, backgroundGeoJson, geoJsonData, quiz.tags, quiz.countryOrRegion]);

  function initializeSessionFromNames(
    allNames: string[],
    subset: string[] | null = practiceSubset
  ) {
    const activeNames =
      subset && subset.length > 0
        ? allNames.filter((n) => subset.includes(n))
        : allNames;

    const shuffled = [...activeNames];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const statuses: Record<string, RegionStatus> = {};
    for (const name of activeNames) {
      statuses[name] = { name, state: 'pending', attempts: 0 };
    }

    setQueue(shuffled);
    setCurrentIndex(0);
    setRegionStatuses(statuses);
    setNamedOrderList([]);
    setInputValue('');
    setIsFinished(false);
    setFeedbackBanner(null);
    setLastWrongSubmission(null);
    setSpecialRevealState(null);
    setSessionSeed(Date.now());
    startTimeRef.current = Date.now();
    setElapsedSeconds(0);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  function startOrRestartQuiz(subset: string[] | null = practiceSubset) {
    setHasStarted(true);
    setShowOptionsPanel(false);
    if (format === 'flag') {
      initializeSessionFromNames((quiz.flagItems || []).map((f) => f.name), subset);
    } else if (format === 'special-country-cities') {
      initializeSessionFromNames(
        specialCitiesItems.map((i) => i.countryName),
        subset
      );
    } else if (format === 'map-point') {
      initializeSessionFromNames((quiz.cityItems || []).map((c) => c.name), subset);
    } else if (geoJsonData) {
      const uniqueNames = Array.from(
        new Set(
          geoJsonData.features
            .map((f) => getFeatureName(f))
            .filter((name) => name.length > 0)
        )
      );
      initializeSessionFromNames(uniqueNames, subset);
    }
  }

  useEffect(() => {
    if (!hasStarted || loading || isFinished || queue.length === 0) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [hasStarted, loading, isFinished, queue.length]);

  const currentTargetName = queue[currentIndex] || null;

  const activeListAllDisplayStyle: ListAllDisplayStyle = isFlagQuiz
    ? 'no-map-list'
    : settings.listAllDisplayStyle || 'map-outlines';
  const activeListAllOrderMode: ListAllOrderMode =
    settings.listAllOrderMode || 'named-order';
  const isBlindListAll =
    settings.mode === 'list-all' &&
    activeListAllDisplayStyle === 'no-map-list' &&
    activeListAllOrderMode === 'blind';

  const isSingleOutlineInCountry =
    settings.mode === 'type-highlighted' &&
    ((settings.mapDisplayStyle === 'all-outlines' && Boolean(settings.isolateTargetInCountry)) ||
      settings.mapDisplayStyle === 'isolated-outline-in-country');

  const isSingleCentroidOnly =
    settings.mode === 'type-highlighted' &&
    settings.mapDisplayStyle === 'centroid-dot' &&
    Boolean(settings.isolateTargetInCountry);

  const targetFeature = useMemo(() => {
    if (format !== 'map-polygon' || !effectiveGeoJsonData || !currentTargetName) return null;
    const matchingFeatures = featuresByName[currentTargetName] || [];
    if (matchingFeatures.length === 0) return null;
    return {
      type: 'FeatureCollection' as const,
      features: matchingFeatures,
    } as unknown as GeoJSON.Feature;
  }, [format, effectiveGeoJsonData, currentTargetName, featuresByName]);

  const targetLatLng = useMemo<[number, number] | null>(() => {
    if (!currentTargetName) return null;
    return subdivisionCentroids[currentTargetName] || null;
  }, [currentTargetName, subdivisionCentroids]);

  const currentFlagItem = useMemo(() => {
    if (format !== 'flag' || !currentTargetName || !quiz.flagItems) return null;
    return quiz.flagItems.find((f) => f.name === currentTargetName) || null;
  }, [format, currentTargetName, quiz.flagItems]);

  const currentSpecialCitiesItem = useMemo(() => {
    if (!isSpecialCitiesQuiz || !currentTargetName) return null;
    return specialCitiesItems.find((i) => i.countryName === currentTargetName) || null;
  }, [isSpecialCitiesQuiz, currentTargetName, specialCitiesItems]);

  const currentSpecialCountryFeature = useMemo(() => {
    if (!isSpecialCitiesQuiz || !currentSpecialCitiesItem || !worldCountries) return null;
    const iso3 = currentSpecialCitiesItem.iso3;
    const cName = currentSpecialCitiesItem.countryName.toLowerCase();
    return (
      worldCountries.features.find((f) => {
        const p = f.properties || {};
        return (
          p.ADM0_A3 === iso3 ||
          p.ISO_A3 === iso3 ||
          String(p.NAME || '').toLowerCase() === cName
        );
      }) || null
    );
  }, [isSpecialCitiesQuiz, currentSpecialCitiesItem, worldCountries]);

  const isTrackedRun = useMemo(
    () =>
      !practiceSubset &&
      isMatchingTrackedPreset(settings, trackedPreset, isFlagQuiz, isSpecialCitiesQuiz),
    [practiceSubset, settings, trackedPreset, isFlagQuiz, isSpecialCitiesQuiz]
  );

  function advanceOrFinish(
    nextQueue: string[],
    nextStatuses: Record<string, RegionStatus>,
    nextIdx: number,
    preventAutoFinish: boolean = false
  ) {
    setSpecialRevealState(null);
    if (nextQueue.length === 0 && !preventAutoFinish) {
      finishQuiz(nextStatuses);
    } else {
      const wrappedIndex =
        nextQueue.length === 0 ? 0 : nextIdx >= nextQueue.length ? 0 : nextIdx;
      setQueue(nextQueue);
      setCurrentIndex(wrappedIndex);
      setInputValue('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }

  function finishQuiz(finalStatuses: Record<string, RegionStatus>) {
    setIsFinished(true);
    setSpecialRevealState(null);
    const durationSeconds = Math.max(
      1,
      Math.floor((Date.now() - startTimeRef.current) / 1000)
    );
    const values = Object.values(finalStatuses);
    const totalCount = values.length;
    const correctCount = values.filter((s) => s.state === 'correct').length;
    const missedRegions = values.filter((s) => s.state === 'missed').map((s) => s.name);
    const scorePercent =
      totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 100;

    if (scorePercent === 100) {
      confetti({
        particleCount: 70,
        spread: 65,
        origin: { y: 0.6 },
      });
    }

    if (isTrackedRun) {
      const attempt: QuizAttempt = {
        id: `${quiz.id}-${Date.now()}`,
        quizId: quiz.id,
        timestamp: Date.now(),
        scorePercent,
        correctCount,
        totalCount,
        durationSeconds,
        missedRegions,
        mode: settings.mode,
        typingMatchMode: settings.typingMatchMode,
        mapDisplayStyle: settings.mapDisplayStyle,
        flagDisplayMode: settings.flagDisplayMode,
      };
      onComplete(attempt);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInputValue(val);

    if (isFinished) return;

    // LIST ALL Mode with Instant Match
    if (settings.mode === 'list-all' && settings.typingMatchMode === 'instant-match') {
      const matchedPending = queue.find((itemName) =>
        isAnswerMatch(val, itemName, effectiveAliases)
      );
      if (matchedPending) {
        setLastWrongSubmission(null);
        const updatedStatuses: Record<string, RegionStatus> = {
          ...regionStatuses,
          [matchedPending]: {
            ...regionStatuses[matchedPending],
            state: 'correct',
          },
        };
        setRegionStatuses(updatedStatuses);
        setNamedOrderList((prev) =>
          prev.includes(matchedPending) ? prev : [...prev, matchedPending]
        );
        if (!isBlindListAll) {
          setFeedbackBanner({ type: 'correct', text: `Found: ${matchedPending}` });
        } else {
          setFeedbackBanner(null);
        }
        const nextQueue = queue.filter((n) => n !== matchedPending);
        advanceOrFinish(nextQueue, updatedStatuses, 0, isBlindListAll);
      }
      return;
    }

    if (!currentTargetName || isSpecialCitiesQuiz) return;

    if (
      settings.typingMatchMode === 'instant-match' &&
      isAnswerMatch(val, currentTargetName, effectiveAliases)
    ) {
      setLastWrongSubmission(null);
      markCurrentAsCorrect();
    }
  }

  function findGuessedFlagItem(typed: string): FlagQuizItem | null {
    if (!isFlagQuiz || !quiz.flagItems) return null;
    for (const item of quiz.flagItems) {
      if (isAnswerMatch(typed, item.name, effectiveAliases)) {
        return item;
      }
    }
    return null;
  }

  function handleAdvanceFromSpecialReveal() {
    if (!currentTargetName || !specialRevealState) return;
    const nextQueue = queue.filter((_, idx) => idx !== currentIndex);
    advanceOrFinish(nextQueue, regionStatuses, currentIndex);
  }

  function handleEnterSubmit() {
    if (isFinished) return;

    if (isSpecialCitiesQuiz && specialRevealState) {
      handleAdvanceFromSpecialReveal();
      return;
    }

    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // LIST ALL Mode (Any Order)
    if (settings.mode === 'list-all') {
      const matchedPending = queue.find((itemName) =>
        isAnswerMatch(trimmed, itemName, effectiveAliases)
      );
      if (matchedPending) {
        setLastWrongSubmission(null);
        const updatedStatuses: Record<string, RegionStatus> = {
          ...regionStatuses,
          [matchedPending]: {
            ...regionStatuses[matchedPending],
            state: 'correct',
          },
        };
        setRegionStatuses(updatedStatuses);
        setNamedOrderList((prev) =>
          prev.includes(matchedPending) ? prev : [...prev, matchedPending]
        );
        if (!isBlindListAll) {
          setFeedbackBanner({ type: 'correct', text: `Found: ${matchedPending}` });
        } else {
          setFeedbackBanner({ type: 'correct', text: `Recorded submission` });
        }
        const nextQueue = queue.filter((n) => n !== matchedPending);
        advanceOrFinish(nextQueue, updatedStatuses, 0, isBlindListAll);
        return;
      }

      const matchedAlreadyAnswered = Object.keys(regionStatuses).find(
        (itemName) =>
          regionStatuses[itemName].state === 'correct' &&
          isAnswerMatch(trimmed, itemName, effectiveAliases)
      );
      if (matchedAlreadyAnswered) {
        if (!isBlindListAll) {
          setFeedbackBanner({
            type: 'skipped',
            text: `Already found: ${matchedAlreadyAnswered}`,
          });
        } else {
          setFeedbackBanner({
            type: 'skipped',
            text: `Recorded submission`,
          });
        }
        setInputValue('');
        return;
      }

      setFeedbackBanner({
        type: 'missed',
        text: `No match for "${trimmed}"`,
      });
      return;
    }

    if (!currentTargetName) return;

    // Special Cities Quiz: 2-step Enter flow (Step 1: Reveal Country Outline + City Labels; Step 2: Advance)
    if (isSpecialCitiesQuiz) {
      if (isAnswerMatch(trimmed, currentTargetName, effectiveAliases)) {
        const updatedStatuses: Record<string, RegionStatus> = {
          ...regionStatuses,
          [currentTargetName]: {
            ...regionStatuses[currentTargetName],
            state: 'correct',
          },
        };
        setRegionStatuses(updatedStatuses);
        setLastWrongSubmission(null);
        setSpecialRevealState({ outcome: 'correct', typedText: trimmed });
        setFeedbackBanner({
          type: 'correct',
          text: `Correct! (${currentTargetName}) — Press ENTER for next country`,
        });
      } else {
        const updatedStatuses: Record<string, RegionStatus> = {
          ...regionStatuses,
          [currentTargetName]: {
            ...regionStatuses[currentTargetName],
            state: 'missed',
          },
        };
        setRegionStatuses(updatedStatuses);
        setLastWrongSubmission({
          targetName: currentTargetName,
          typedText: trimmed,
        });
        setSpecialRevealState({ outcome: 'missed', typedText: trimmed });
        setFeedbackBanner({
          type: 'missed',
          text: `Incorrect ("${trimmed}") → Answer: ${currentTargetName} — Press ENTER for next`,
        });
      }
      return;
    }

    if (isAnswerMatch(trimmed, currentTargetName, effectiveAliases)) {
      setLastWrongSubmission(null);
      markCurrentAsCorrect();
    } else {
      const missedTarget = currentTargetName;
      const guessedFlag = findGuessedFlagItem(trimmed);
      const updatedStatuses: Record<string, RegionStatus> = {
        ...regionStatuses,
        [missedTarget]: {
          ...regionStatuses[missedTarget],
          state: 'missed',
        },
      };
      setRegionStatuses(updatedStatuses);
      setLastWrongSubmission({
        targetName: missedTarget,
        typedText: trimmed,
        targetFlagItem: currentFlagItem,
        guessedFlagItem: guessedFlag,
      });
      setFeedbackBanner({
        type: 'missed',
        text: `Incorrect ("${trimmed}") → Answer: ${missedTarget}`,
      });

      const nextQueue = queue.filter((_, idx) => idx !== currentIndex);
      advanceOrFinish(nextQueue, updatedStatuses, currentIndex);
    }
  }

  function handleOverrideTypoAsCorrect() {
    if (!lastWrongSubmission) return;
    const { targetName } = lastWrongSubmission;
    const updatedStatuses: Record<string, RegionStatus> = {
      ...regionStatuses,
      [targetName]: {
        ...regionStatuses[targetName],
        state: 'correct',
      },
    };
    setRegionStatuses(updatedStatuses);
    setLastWrongSubmission(null);
    if (specialRevealState) {
      setSpecialRevealState({ ...specialRevealState, outcome: 'correct' });
    }
    setFeedbackBanner({
      type: 'correct',
      text: `Marked ${targetName} as CORRECT`,
    });

    if (isFinished) {
      finishQuiz(updatedStatuses);
    } else {
      inputRef.current?.focus();
    }
  }

  function markCurrentAsCorrect() {
    if (!currentTargetName) return;
    const updatedStatuses: Record<string, RegionStatus> = {
      ...regionStatuses,
      [currentTargetName]: {
        ...regionStatuses[currentTargetName],
        state: 'correct',
      },
    };
    setRegionStatuses(updatedStatuses);
    setFeedbackBanner({ type: 'correct', text: currentTargetName });

    const nextQueue = queue.filter((_, idx) => idx !== currentIndex);
    advanceOrFinish(nextQueue, updatedStatuses, currentIndex);
  }

  function handleSkip() {
    if (!currentTargetName || queue.length <= 1) return;
    setSpecialRevealState(null);
    setCurrentIndex((prev) => (prev + 1) % queue.length);
    setInputValue('');
    inputRef.current?.focus();
  }

  function handleGiveUpCurrent() {
    if (settings.mode === 'list-all') {
      // In List-All mode, Give Up / Submit marks all remaining pending items as missed and finishes the run
      const updatedStatuses: Record<string, RegionStatus> = { ...regionStatuses };
      for (const remName of queue) {
        updatedStatuses[remName] = {
          ...updatedStatuses[remName],
          state: 'missed',
        };
      }
      setRegionStatuses(updatedStatuses);
      finishQuiz(updatedStatuses);
      return;
    }

    if (!currentTargetName) return;
    const updatedStatuses: Record<string, RegionStatus> = {
      ...regionStatuses,
      [currentTargetName]: {
        ...regionStatuses[currentTargetName],
        state: 'missed',
      },
    };
    setRegionStatuses(updatedStatuses);
    setLastWrongSubmission({
      targetName: currentTargetName,
      typedText: 'REVEALED',
      targetFlagItem: currentFlagItem,
      guessedFlagItem: null,
    });

    if (isSpecialCitiesQuiz) {
      setSpecialRevealState({ outcome: 'missed', typedText: 'REVEALED' });
      setFeedbackBanner({
        type: 'missed',
        text: `Revealed: ${currentTargetName} — Press ENTER for next country`,
      });
      return;
    }

    setFeedbackBanner({
      type: 'missed',
      text: `Missed: ${currentTargetName}`,
    });

    const nextQueue = queue.filter((_, idx) => idx !== currentIndex);
    advanceOrFinish(nextQueue, updatedStatuses, currentIndex);
  }

  function handleTargetClickSelection(clickedName: string) {
    if (!hasStarted || isFinished || settings.mode === 'list-all' || !currentTargetName) return;
    const currentStatus = regionStatuses[clickedName]?.state;

    if (settings.mode === 'type-highlighted') {
      if (currentStatus === 'pending' && clickedName !== currentTargetName) {
        const idxInQueue = queue.indexOf(clickedName);
        if (idxInQueue !== -1) {
          setCurrentIndex(idxInQueue);
          inputRef.current?.focus();
        }
      }
      return;
    }

    if (currentStatus === 'correct' || currentStatus === 'missed') return;

    if (clickedName === currentTargetName) {
      markCurrentAsCorrect();
    } else {
      const prevAttempts = regionStatuses[currentTargetName]?.attempts || 0;
      if (prevAttempts >= 1) {
        const updatedStatuses: Record<string, RegionStatus> = {
          ...regionStatuses,
          [currentTargetName]: {
            name: currentTargetName,
            state: 'missed',
            attempts: prevAttempts + 1,
          },
        };
        setRegionStatuses(updatedStatuses);
        setFeedbackBanner({
          type: 'missed',
          text: `Selected ${clickedName} (target: ${currentTargetName})`,
        });
        const nextQueue = queue.filter((_, idx) => idx !== currentIndex);
        advanceOrFinish(nextQueue, updatedStatuses, currentIndex);
      } else {
        setRegionStatuses({
          ...regionStatuses,
          [currentTargetName]: {
            name: currentTargetName,
            state: 'pending',
            attempts: prevAttempts + 1,
          },
        });
        setFeedbackBanner({
          type: 'missed',
          text: `Selected ${clickedName} — 1 attempt left for ${currentTargetName}`,
        });
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (settings.mode !== 'list-all') {
        handleSkip();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (
        isSpecialCitiesQuiz ||
        settings.typingMatchMode === 'enter-submit' ||
        settings.mode === 'list-all'
      ) {
        handleEnterSubmit();
      }
    }
  }

  function toggleFlagFilter(filterId: FlagFilterId) {
    const currentFilters = settings.flagFilters || [];
    const conflict = getConflictingFilter(filterId, currentFilters);
    if (conflict) return;

    const isSelected = currentFilters.includes(filterId);
    const nextFilters = isSelected
      ? currentFilters.filter((id) => id !== filterId)
      : [...currentFilters, filterId];

    setSettings((s) => ({
      ...s,
      flagFilters: nextFilters,
    }));
  }

  const totalCount = Object.keys(regionStatuses).length;
  const correctCount = Object.values(regionStatuses).filter(
    (s) => s.state === 'correct'
  ).length;
  const missedCount = Object.values(regionStatuses).filter(
    (s) => s.state === 'missed'
  ).length;
  const answeredCount = correctCount + missedCount;
  const currentAccuracy =
    answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 100;

  const alphabeticalAllNames = useMemo(
    () =>
      Object.keys(regionStatuses).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      ),
    [regionStatuses]
  );

  const formatClock = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
  };

  const targetRotationDeg = useMemo(() => {
    if (!settings.randomRotation || !currentTargetName) return 0;
    let hash = sessionSeed % 9973;
    for (let i = 0; i < currentTargetName.length; i++) {
      hash = (hash * 31 + currentTargetName.charCodeAt(i)) % 100000;
    }
    return 25 + (hash % 310);
  }, [settings.randomRotation, currentTargetName, sessionSeed]);

  const isolatedSvgPath = useMemo(() => {
    if (
      settings.mapDisplayStyle !== 'isolated-shape' ||
      !currentTargetName ||
      !featuresByName[currentTargetName]
    ) {
      return '';
    }
    return featuresToSvgPath(
      featuresByName[currentTargetName],
      600,
      420,
      36,
      targetRotationDeg
    );
  }, [settings.mapDisplayStyle, currentTargetName, featuresByName, targetRotationDeg]);

  const unitVectors = useMemo(() => {
    if (settings.mapDisplayStyle !== 'unit-vectors' || !currentTargetName) {
      return [];
    }
    return computeClosestUnitVectors(
      currentTargetName,
      subdivisionCentroids,
      settings.vectorNeighborsCount
    );
  }, [
    settings.mapDisplayStyle,
    currentTargetName,
    subdivisionCentroids,
    settings.vectorNeighborsCount,
  ]);

  const maxNeighbors = Math.max(1, totalCount - 1);
  const activeFlagDisplayMode: FlagDisplayMode = settings.flagDisplayMode || 'standard';
  const activeFlagFilters: FlagFilterId[] = settings.flagFilters || ['pixelate'];

  const showInteractiveMap =
    !isFlagQuiz &&
    !isSpecialCitiesQuiz &&
    !loading &&
    (settings.mode === 'click-named' ||
      (settings.mode === 'list-all' && activeListAllDisplayStyle !== 'no-map-list') ||
      (settings.mode === 'type-highlighted' &&
        settings.mapDisplayStyle !== 'isolated-shape' &&
        settings.mapDisplayStyle !== 'unit-vectors'));

  const mapLayerSyncKey = `${quiz.id}-${quiz.filterValue || 'all'}-${currentIndex}-${answeredCount}-${settings.mode}-${settings.mapDisplayStyle}-${Boolean(settings.isolateTargetInCountry)}-${activeListAllDisplayStyle}-${Boolean(settings.listAllShowOuterBorder ?? true)}-${hasStarted}-${showHydroOverlay}`;

  return (
    <div className="flex flex-col h-[calc(100dvh-56px)] bg-slate-950 text-slate-100 overflow-hidden font-mono">
      {/* Compact Technical HUD Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-2.5 py-1.5 sm:px-5 sm:py-2 flex flex-wrap items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onExit}
            className="inline-flex items-center gap-1 px-2 py-1 sm:px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">ESC</span>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            {quizFlagIcon && (
              <img
                src={quizFlagIcon}
                alt=""
                className="w-5 h-3.5 object-cover rounded-[2px] border border-slate-700 shrink-0"
              />
            )}
            <h2 className="text-xs sm:text-sm font-bold text-white truncate max-w-[165px] sm:max-w-none">
              {quiz.title}
            </h2>
            <span
              className={`hidden md:inline-block px-1.5 py-0.5 text-[10px] rounded border shrink-0 ${
                isTrackedRun
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              {isTrackedRun ? 'REVISION_TRACKED' : 'UNTRACKED_VARIANT'}
            </span>
          </div>
        </div>

        {/* PLAY + OPTIONS + Map Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => startOrRestartQuiz(practiceSubset)}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{hasStarted ? 'RESTART' : 'PLAY'}</span>
          </button>

          <button
            onClick={() => setShowOptionsPanel((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded text-xs font-bold border transition cursor-pointer ${
              showOptionsPanel
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">OPTIONS</span>
          </button>

          {showInteractiveMap && (
            <>
              {!isRiverOrLineQuiz && (
                <button
                  onClick={() => setShowHydroOverlay((v) => !v)}
                  title="Toggle Local Major Water Bodies"
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition cursor-pointer ${
                    showHydroOverlay
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                      : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Droplets className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">HYDRO</span>
                </button>
              )}

              {settings.mode !== 'list-all' && (
                <button
                  onClick={() => setAutoZoomTarget((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition cursor-pointer ${
                    autoZoomTarget
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Focus className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">AUTO-ZOOM</span>
                </button>
              )}

              <button
                onClick={() => setFitTrigger((t) => t + 1)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-slate-800/80 border border-slate-700 text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden md:inline">FIT</span>
              </button>
            </>
          )}
        </div>

        {/* Score & Clock */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs">
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-slate-950 border border-slate-800">
            {isBlindListAll && !isFinished ? (
              <span className="text-amber-300 font-bold">BLIND (? / ?)</span>
            ) : (
              <>
                <span className="text-emerald-400 font-bold">{correctCount}</span>
                <span className="text-slate-600">/</span>
                <span className="text-slate-300">{totalCount}</span>
                <span className="text-slate-400 hidden sm:inline ml-0.5">
                  ({currentAccuracy}%)
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            {formatClock(elapsedSeconds)}
          </div>
        </div>
      </div>

      {/* Input / Prompt Strip — Feedback Banner placed on its own row underneath so the input box always keeps full width on PC */}
      {hasStarted && !isFinished && !loading && (
        <div className="bg-slate-900 border-b border-slate-800 px-2.5 py-1.5 sm:px-5 sm:py-2 z-10 space-y-1.5">
          {/* Row 1: Full-width Input Bar & Action Buttons */}
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2">
            {isSpecialCitiesQuiz ||
            settings.mode === 'type-highlighted' ||
            settings.mode === 'list-all' ? (
              <>
                <div className="relative flex-1 flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputValue}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      enterKeyHint="send"
                      placeholder={
                        isSpecialCitiesQuiz
                          ? specialRevealState
                            ? 'Press ENTER for next country...'
                            : 'Guess country from city pattern...'
                          : isBlindListAll
                          ? 'BLIND LIST MODE: Type items, then press SUBMIT when done...'
                          : settings.mode === 'list-all'
                          ? 'LIST MODE: Type any item in any order...'
                          : settings.typingMatchMode === 'enter-submit'
                          ? 'Type answer & press ENTER...'
                          : 'Type answer (auto-match)...'
                      }
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="w-full pl-3 pr-16 py-1.5 rounded-lg bg-slate-950 border border-indigo-500/50 focus:border-indigo-400 text-white placeholder-slate-500 text-base sm:text-sm outline-none"
                    />
                    {!isBlindListAll && (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 pointer-events-none">
                        rem: {queue.length}
                      </span>
                    )}
                  </div>

                  {isSpecialCitiesQuiz && specialRevealState ? (
                    <button
                      type="button"
                      onClick={handleAdvanceFromSpecialReveal}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <span>NEXT [ENTER]</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    (isSpecialCitiesQuiz ||
                      settings.typingMatchMode === 'enter-submit' ||
                      settings.mode === 'list-all') && (
                      <button
                        type="button"
                        onClick={handleEnterSubmit}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shrink-0"
                      >
                        ENTER ↵
                      </button>
                    )
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {settings.mode !== 'list-all' && (
                    <button
                      type="button"
                      onClick={handleSkip}
                      disabled={queue.length <= 1}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs transition cursor-pointer"
                    >
                      <FastForward className="w-3.5 h-3.5 text-amber-400" />
                      SKIP [TAB]
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleGiveUpCurrent}
                    className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      isBlindListAll
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : 'bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {isBlindListAll ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        SUBMIT & FINISH RUN
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        {settings.mode === 'list-all' ? `GIVE UP (${queue.length})` : 'REVEAL'}
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <div className="w-full flex items-center justify-between gap-3 bg-slate-950 border border-indigo-500/40 rounded-lg px-3.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">TARGET:</span>
                  <span className="text-sm sm:text-base font-bold text-amber-300">
                    {currentTargetName}
                  </span>
                  <span className="text-xs text-slate-500">(rem: {queue.length})</span>
                  {settings.mapDisplayStyle === 'minefield-no-outlines' && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-[10px] text-rose-300 font-bold">
                      MINEFIELD
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSkip}
                    disabled={queue.length <= 1}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
                  >
                    SKIP
                  </button>
                  <button
                    type="button"
                    onClick={handleGiveUpCurrent}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-xs text-rose-300 cursor-pointer"
                  >
                    REVEAL
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Row 2: Dedicated Feedback & Mark-as-Correct Banner Row (Never crowds the input bar) */}
          {feedbackBanner && (
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
              <div
                className={`w-full px-3 py-1 rounded-lg text-xs flex flex-wrap items-center justify-between gap-2 ${
                  feedbackBanner.type === 'correct'
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : feedbackBanner.type === 'skipped'
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {feedbackBanner.type === 'correct' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="truncate">{feedbackBanner.text}</span>
                </div>

                {lastWrongSubmission && feedbackBanner.type === 'missed' && (
                  <button
                    type="button"
                    onClick={handleOverrideTypoAsCorrect}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/50 text-amber-200 text-[11px] font-bold cursor-pointer shrink-0"
                    title="Mark previous answer as correct (identical visual / trivial typo)"
                  >
                    <Undo2 className="w-3 h-3" />
                    {isFlagQuiz && activeFlagDisplayMode !== 'standard'
                      ? 'MARK AS CORRECT (IDENTICAL / TYPO)'
                      : 'MARK AS CORRECT (TYPO)'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Side-by-Side Guessed Flag / Pie Chart Comparison Banner */}
          {isFlagQuiz &&
            lastWrongSubmission &&
            feedbackBanner?.type === 'missed' &&
            lastWrongSubmission.targetFlagItem && (
              <div className="max-w-4xl mx-auto bg-slate-950 border border-amber-500/40 rounded-lg p-3 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-6">
                  {lastWrongSubmission.guessedFlagItem ? (
                    <div className="flex items-center gap-3">
                      <div className="text-xs">
                        <div className="text-[10px] text-amber-300 font-bold">
                          YOUR GUESS ({activeFlagDisplayMode.toUpperCase()})
                        </div>
                        <div className="font-bold text-white">
                          {lastWrongSubmission.guessedFlagItem.name}
                        </div>
                      </div>
                      <FlagVisualRenderer
                        item={lastWrongSubmission.guessedFlagItem}
                        displayMode={activeFlagDisplayMode}
                        activeFilters={activeFlagFilters}
                        size="small"
                      />
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">
                      Guessed:{' '}
                      <strong className="text-white">"{lastWrongSubmission.typedText}"</strong>{' '}
                      (not matched to another flag in this quiz)
                    </div>
                  )}

                  <div className="flex items-center gap-3 border-l border-slate-800 pl-4">
                    <div className="text-xs">
                      <div className="text-[10px] text-emerald-400 font-bold">
                        TARGET ({activeFlagDisplayMode.toUpperCase()})
                      </div>
                      <div className="font-bold text-white">
                        {lastWrongSubmission.targetFlagItem.name}
                      </div>
                    </div>
                    <FlagVisualRenderer
                      item={lastWrongSubmission.targetFlagItem}
                      displayMode={activeFlagDisplayMode}
                      activeFilters={activeFlagFilters}
                      size="small"
                    />
                    {activeFlagDisplayMode !== 'standard' && (
                      <img
                        src={resolveAssetUrl(lastWrongSubmission.targetFlagItem.imageUrl)}
                        alt={lastWrongSubmission.targetFlagItem.name}
                        className="h-12 w-auto object-contain rounded border border-slate-700"
                        title="Unaltered Target Flag"
                      />
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleOverrideTypoAsCorrect}
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  MARK AS CORRECT (IDENTICAL)
                </button>
              </div>
            )}
        </div>
      )}

      {/* Main Content Area */}
      <div className="relative flex-1 w-full h-full overflow-y-auto">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-30 text-xs text-slate-400">
            Loading dataset...
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950 z-30 p-6">
            <div className="max-w-md bg-slate-900 border border-rose-500/40 rounded-xl p-5 text-center">
              <p className="text-rose-400 font-bold text-sm mb-2">ERR_LOAD_DATA</p>
              <p className="text-xs text-slate-400 mb-4">{error}</p>
              <button
                onClick={onExit}
                className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs"
              >
                EXIT
              </button>
            </div>
          </div>
        )}

        {/* PRE-GAME LAUNCH & OPTIONS MODAL */}
        {(!hasStarted || showOptionsPanel) && !loading && !error && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 z-30 overflow-y-auto">
            <div className="max-w-2xl w-full bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 shadow-2xl space-y-5 my-auto max-h-[90dvh] overflow-y-auto">
              <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-3.5">
                <div>
                  <div className="text-[11px] text-indigo-400 font-bold">
                    QUIZ_LAUNCH_CONFIGURATION
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {quizFlagIcon && (
                      <img
                        src={quizFlagIcon}
                        alt=""
                        className="w-6 h-4 object-cover rounded-[2px] border border-slate-700 shrink-0"
                      />
                    )}
                    <h3 className="text-lg font-bold text-white">{quiz.title}</h3>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {totalCount} items •{' '}
                    {isTrackedRun ? (
                      <span className="text-emerald-400 font-bold">
                        Matches Revision Tracked Preset
                      </span>
                    ) : (
                      <span className="text-amber-300">
                        Custom Variant (Untracked unless saved as Revision Preset below)
                      </span>
                    )}
                  </div>
                </div>

                {hasStarted && (
                  <button
                    onClick={() => setShowOptionsPanel(false)}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                  >
                    RESUME
                  </button>
                )}
              </div>

              {/* Primary Launch Button + Toggle Options */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <button
                  onClick={() => startOrRestartQuiz(practiceSubset)}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/25 transition cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {hasStarted ? 'RESTART WITH SELECTED MODE' : 'PLAY QUIZ'}
                  </span>
                </button>

                <button
                  onClick={() => setShowOptionsPanel((v) => !v)}
                  className={`inline-flex items-center justify-center gap-1.5 py-3 px-4 rounded-lg border text-xs font-bold transition cursor-pointer ${
                    showOptionsPanel
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <span>{showOptionsPanel ? 'HIDE OPTIONS' : 'CUSTOMISE MODE / OPTIONS'}</span>
                </button>
              </div>

              {/* Current Active Mode Summary Pill */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-slate-500">SELECTED_MODE: </span>
                  {isSpecialCitiesQuiz ? (
                    <>
                      <strong className="text-white">
                        TOP_{settings.specialCitiesCount || 5}_CITIES
                      </strong>
                      <span className="text-slate-600"> • </span>
                      <strong className="text-amber-300">
                        {(settings.showCapitalStar ?? true) ? 'CAPITAL_STAR_ON' : 'NO_STAR'}
                      </strong>
                      <span className="text-slate-600"> • </span>
                      <strong className="text-sky-300">
                        {(settings.showRelativePopulation ?? true)
                          ? 'REL_POP_RANK_ON'
                          : 'REL_POP_OFF'}
                      </strong>
                      <span className="text-slate-600"> • </span>
                      <strong className="text-indigo-300">
                        {(settings.showAbsolutePopulation ?? false)
                          ? 'ABS_POP_ON'
                          : 'ABS_POP_OFF'}
                      </strong>
                      <span className="text-slate-600"> • </span>
                      <strong className="text-emerald-300">
                        {(settings.showScaleReference ?? true)
                          ? 'SCALE_REF_ON'
                          : 'SCALE_REF_OFF'}
                      </strong>
                    </>
                  ) : (
                    <>
                      <strong className="text-white">
                        {settings.mode === 'type-highlighted'
                          ? 'TYPE_QUIZ'
                          : settings.mode === 'list-all'
                          ? 'LIST_ALL_QUIZ'
                          : 'CLICK_QUIZ'}
                      </strong>
                      {(settings.mode === 'type-highlighted' ||
                        settings.mode === 'list-all') && (
                        <>
                          <span className="text-slate-600"> • </span>
                          <strong className="text-indigo-300">
                            {settings.typingMatchMode === 'enter-submit'
                              ? 'ENTER_SUBMIT'
                              : 'INSTANT_AUTO_MATCH'}
                          </strong>
                        </>
                      )}
                      {settings.mode === 'list-all' && (
                        <>
                          <span className="text-slate-600"> • </span>
                          <strong className="text-emerald-300">
                            {activeListAllDisplayStyle.toUpperCase()}
                          </strong>
                          {activeListAllDisplayStyle === 'no-map-list' && (
                            <span className="ml-1.5 text-amber-300 font-bold">
                              [{activeListAllOrderMode.toUpperCase()}]
                            </span>
                          )}
                        </>
                      )}
                      {!isFlagQuiz && settings.mode !== 'list-all' && (
                        <>
                          <span className="text-slate-600"> • </span>
                          <strong className="text-emerald-300">
                            {settings.mapDisplayStyle.toUpperCase()}
                          </strong>
                          {settings.mode === 'type-highlighted' &&
                            (settings.mapDisplayStyle === 'all-outlines' ||
                              settings.mapDisplayStyle === 'centroid-dot') &&
                            settings.isolateTargetInCountry && (
                              <span className="ml-1.5 text-amber-300 font-bold">
                                [SINGLE_TARGET_ONLY]
                              </span>
                            )}
                          {settings.mode === 'type-highlighted' &&
                            settings.mapDisplayStyle === 'isolated-shape' &&
                            settings.randomRotation && (
                              <span className="ml-1.5 text-amber-300 font-bold">
                                [RANDOM_ROTATION]
                              </span>
                            )}
                        </>
                      )}
                      {isFlagQuiz && settings.mode === 'type-highlighted' && (
                        <>
                          <span className="text-slate-600"> • </span>
                          <strong className="text-emerald-300">
                            {activeFlagDisplayMode.toUpperCase()}
                          </strong>
                          {activeFlagDisplayMode === 'filtered' && (
                            <span className="ml-1.5 text-amber-300">
                              [{activeFlagFilters.join(' + ')}]
                            </span>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Expanded Options Customization Section */}
              {showOptionsPanel && (
                <div className="space-y-4 pt-2 border-t border-slate-800 text-xs">
                  {isSpecialCitiesQuiz ? (
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4">
                      <div className="text-[11px] text-slate-400 font-bold">
                        SPECIAL_CITIES_QUIZ_PARAMETERS
                      </div>

                      <div className="flex items-center justify-between gap-4 bg-slate-900 p-3 rounded-lg border border-slate-800">
                        <div>
                          <div className="font-bold text-white">
                            1. TOP N LARGEST CITIES (N = {settings.specialCitiesCount || 5})
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Number of largest cities plotted per country (3 to 12).
                          </div>
                        </div>
                        <input
                          type="range"
                          min={3}
                          max={12}
                          value={settings.specialCitiesCount || 5}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              specialCitiesCount: Number(e.target.value),
                            }))
                          }
                          className="w-32 accent-indigo-500 cursor-pointer"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setSettings((s) => ({
                              ...s,
                              showCapitalStar: !(s.showCapitalStar ?? true),
                            }))
                          }
                          className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                            settings.showCapitalStar ?? true
                              ? 'bg-amber-500/20 border-amber-400 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <div className="font-bold text-xs">
                            ★ CAPITAL STAR: {(settings.showCapitalStar ?? true) ? 'ON' : 'OFF'}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            Marks the national capital with a star.
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setSettings((s) => ({
                              ...s,
                              showRelativePopulation: !(s.showRelativePopulation ?? true),
                            }))
                          }
                          className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                            settings.showRelativePopulation ?? true
                              ? 'bg-sky-500/20 border-sky-400 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <div className="font-bold text-xs">
                            RELATIVE POPULATION:{' '}
                            {(settings.showRelativePopulation ?? true) ? 'ON' : 'OFF'}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            Scales city dots by √population and displays each city’s rank (#1..#N).
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setSettings((s) => ({
                              ...s,
                              showAbsolutePopulation: !(s.showAbsolutePopulation ?? false),
                            }))
                          }
                          className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                            settings.showAbsolutePopulation ?? false
                              ? 'bg-indigo-500/20 border-indigo-400 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <div className="font-bold text-xs">
                            ABSOLUTE POPULATION:{' '}
                            {(settings.showAbsolutePopulation ?? false) ? 'ON' : 'OFF'}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            Displays the absolute population (e.g. 5.31M, 460k) next to each city.
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setSettings((s) => ({
                              ...s,
                              showScaleReference: !(s.showScaleReference ?? true),
                            }))
                          }
                          className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                            settings.showScaleReference ?? true
                              ? 'bg-emerald-500/20 border-emerald-400 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <div className="font-bold text-xs">
                            CORNER SCALE REF:{' '}
                            {(settings.showScaleReference ?? true) ? 'ON' : 'OFF'}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            Shows Hispaniola / Sicily / Corsica in corner at same scale.
                          </div>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* 1. Structure: Type vs Click vs List All */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                          <div className="text-[11px] text-slate-400 font-bold">
                            1. QUIZ_STRUCTURE
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() =>
                                setSettings((s) => ({
                                  ...s,
                                  mode: 'type-highlighted',
                                  mapDisplayStyle:
                                    s.mapDisplayStyle === 'minefield-no-outlines' ||
                                    s.mapDisplayStyle === 'isolated-outline-in-country'
                                      ? 'all-outlines'
                                      : s.mapDisplayStyle,
                                }))
                              }
                              className={`flex-1 py-2 px-1.5 rounded font-bold cursor-pointer ${
                                settings.mode === 'type-highlighted'
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-900 text-slate-400 border border-slate-800'
                              }`}
                            >
                              TYPE
                            </button>
                            <button
                              onClick={() =>
                                setSettings((s) => ({
                                  ...s,
                                  mode: 'click-named',
                                  mapDisplayStyle:
                                    s.mapDisplayStyle === 'minefield-no-outlines'
                                      ? 'minefield-no-outlines'
                                      : 'all-outlines',
                                }))
                              }
                              className={`flex-1 py-2 px-1.5 rounded font-bold cursor-pointer ${
                                settings.mode === 'click-named'
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-900 text-slate-400 border border-slate-800'
                              }`}
                            >
                              CLICK
                            </button>
                            <button
                              onClick={() =>
                                setSettings((s) => ({
                                  ...s,
                                  mode: 'list-all',
                                  listAllDisplayStyle: isFlagQuiz
                                    ? 'no-map-list'
                                    : s.listAllDisplayStyle || 'map-outlines',
                                  listAllOrderMode: s.listAllOrderMode || 'named-order',
                                }))
                              }
                              className={`flex-1 py-2 px-1.5 rounded font-bold cursor-pointer ${
                                settings.mode === 'list-all'
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-900 text-slate-400 border border-slate-800'
                              }`}
                            >
                              LIST ALL
                            </button>
                          </div>
                        </div>

                        {/* 2. Typing Match Mode */}
                        {(settings.mode === 'type-highlighted' ||
                          settings.mode === 'list-all') && (
                          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                            <div className="text-[11px] text-slate-400 font-bold">
                              2. TYPING_EVALUATION
                            </div>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    typingMatchMode: 'enter-submit',
                                  }))
                                }
                                className={`flex-1 py-2 px-2 rounded font-bold cursor-pointer ${
                                  settings.typingMatchMode === 'enter-submit'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                                }`}
                              >
                                ENTER TO SUBMIT
                              </button>
                              <button
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    typingMatchMode: 'instant-match',
                                  }))
                                }
                                className={`flex-1 py-2 px-2 rounded font-bold cursor-pointer ${
                                  settings.typingMatchMode === 'instant-match'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                                }`}
                              >
                                INSTANT AUTO
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 2B. Click Quiz Variants (Standard vs Minefield) */}
                      {!isFlagQuiz && settings.mode === 'click-named' && (
                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2.5">
                          <div className="text-[11px] text-slate-400 font-bold">
                            2. CLICK_QUIZ_VARIANT
                          </div>
                          <div className="space-y-1.5">
                            {CLICK_GEOMETRY_MODES_INFO.map((opt) => (
                              <button
                                key={opt.id}
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    mode: 'click-named',
                                    mapDisplayStyle: opt.id,
                                  }))
                                }
                                className={`w-full p-2.5 rounded-lg text-left border transition flex items-center justify-between gap-3 cursor-pointer ${
                                  settings.mapDisplayStyle === opt.id
                                    ? 'bg-indigo-600/20 border-indigo-400 text-white'
                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <div>
                                  <div className="font-bold text-xs text-white">{opt.label}</div>
                                  <div className="text-[11px] text-slate-400 mt-0.5">
                                    {opt.shortDesc}
                                  </div>
                                </div>
                                <span
                                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                    settings.mapDisplayStyle === opt.id
                                      ? 'border-indigo-400 bg-indigo-500'
                                      : 'border-slate-600'
                                  }`}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 2C. LIST ALL Display Variants & Sub-Options */}
                      {settings.mode === 'list-all' && (
                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="text-[11px] text-slate-400 font-bold">
                              3. LIST_ALL_DISPLAY_MODE
                            </span>

                            {!isFlagQuiz &&
                              activeListAllDisplayStyle === 'map-reveal-borders' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSettings((s) => ({
                                      ...s,
                                      listAllShowOuterBorder: !(s.listAllShowOuterBorder ?? true),
                                    }))
                                  }
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-bold transition cursor-pointer ${
                                    settings.listAllShowOuterBorder ?? true
                                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                                  }`}
                                >
                                  <span>
                                    COUNTRY / CONTINENT OUTER BOUNDARY:{' '}
                                    {(settings.listAllShowOuterBorder ?? true) ? 'ON' : 'OFF'}
                                  </span>
                                </button>
                              )}
                          </div>

                          {!isFlagQuiz && (
                            <div className="space-y-1.5">
                              {LIST_ALL_DISPLAY_MODES_INFO.map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() =>
                                    setSettings((s) => ({
                                      ...s,
                                      listAllDisplayStyle: opt.id,
                                    }))
                                  }
                                  className={`w-full p-2.5 rounded-lg text-left border transition flex items-center justify-between gap-3 cursor-pointer ${
                                    activeListAllDisplayStyle === opt.id
                                      ? 'bg-indigo-600/20 border-indigo-400 text-white'
                                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  <div>
                                    <div className="font-bold text-xs text-white">{opt.label}</div>
                                    <div className="text-[11px] text-slate-400 mt-0.5">
                                      {opt.shortDesc}
                                    </div>
                                  </div>
                                  <span
                                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                      activeListAllDisplayStyle === opt.id
                                        ? 'border-indigo-400 bg-indigo-500'
                                        : 'border-slate-600'
                                    }`}
                                  />
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Sub-options when NO_MAP_TEXT_LIST is selected */}
                          {activeListAllDisplayStyle === 'no-map-list' && (
                            <div className="pt-2.5 border-t border-slate-800 space-y-2">
                              <div className="text-[11px] text-amber-300 font-bold">
                                LIST_ORDER_&_VISIBILITY_SUB_OPTION
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                {LIST_ALL_ORDER_MODES_INFO.map((subOpt) => (
                                  <button
                                    key={subOpt.id}
                                    type="button"
                                    onClick={() =>
                                      setSettings((s) => ({
                                        ...s,
                                        listAllOrderMode: subOpt.id,
                                      }))
                                    }
                                    className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between gap-1 cursor-pointer ${
                                      activeListAllOrderMode === subOpt.id
                                        ? 'bg-amber-500/20 border-amber-400 text-white'
                                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    <div className="font-bold text-[11px]">{subOpt.label}</div>
                                    <div className="text-[10px] text-slate-400 leading-tight">
                                      {subOpt.shortDesc}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 3A. Map Geometry Modes (For Type Map Quizzes) */}
                      {!isFlagQuiz && settings.mode === 'type-highlighted' && (
                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2.5">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="text-[11px] text-slate-400 font-bold">
                              3. MAP_GEOMETRY_DISPLAY_MODE
                            </span>

                            {(settings.mapDisplayStyle === 'all-outlines' ||
                              settings.mapDisplayStyle === 'centroid-dot') && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    isolateTargetInCountry: !s.isolateTargetInCountry,
                                  }))
                                }
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-bold transition cursor-pointer ${
                                  settings.isolateTargetInCountry
                                    ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                                }`}
                              >
                                <span>
                                  {settings.mapDisplayStyle === 'all-outlines'
                                    ? `SINGLE OUTLINE IN COUNTRY: ${
                                        settings.isolateTargetInCountry ? 'ON' : 'OFF'
                                      }`
                                    : `SINGLE CENTROID ONLY: ${
                                        settings.isolateTargetInCountry ? 'ON' : 'OFF'
                                      }`}
                                </span>
                              </button>
                            )}

                            {settings.mapDisplayStyle === 'isolated-shape' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    randomRotation: !s.randomRotation,
                                  }))
                                }
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-bold transition cursor-pointer ${
                                  settings.randomRotation
                                    ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                                }`}
                              >
                                <Compass className="w-3.5 h-3.5" />
                                <span>
                                  RANDOM ROTATION / ALIGNMENT:{' '}
                                  {settings.randomRotation ? 'ON' : 'OFF'}
                                </span>
                              </button>
                            )}

                            {settings.mapDisplayStyle === 'unit-vectors' && (
                              <div className="flex items-center gap-2 bg-slate-900 px-2.5 py-1 rounded border border-indigo-500/40">
                                <span className="text-[11px] text-indigo-300 font-bold">
                                  CLOSEST NEIGHBORS (N = {settings.vectorNeighborsCount} /{' '}
                                  {maxNeighbors}):
                                </span>
                                <input
                                  type="range"
                                  min={1}
                                  max={maxNeighbors}
                                  value={Math.min(settings.vectorNeighborsCount, maxNeighbors)}
                                  onChange={(e) =>
                                    setSettings((s) => ({
                                      ...s,
                                      vectorNeighborsCount: Number(e.target.value),
                                    }))
                                  }
                                  className="w-28 accent-indigo-500 cursor-pointer"
                                />
                              </div>
                            )}
                          </div>

                          <div className="space-y-1.5">
                            {TYPE_GEOMETRY_MODES_INFO.map((opt) => (
                              <button
                                key={opt.id}
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    mode: 'type-highlighted',
                                    mapDisplayStyle: opt.id,
                                  }))
                                }
                                className={`w-full p-2.5 rounded-lg text-left border transition flex items-center justify-between gap-3 cursor-pointer ${
                                  settings.mapDisplayStyle === opt.id
                                    ? 'bg-indigo-600/20 border-indigo-400 text-white'
                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <div>
                                  <div className="font-bold text-xs text-white">{opt.label}</div>
                                  <div className="text-[11px] text-slate-400 mt-0.5">
                                    {opt.shortDesc}
                                  </div>
                                </div>
                                <span
                                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                    settings.mapDisplayStyle === opt.id
                                      ? 'border-indigo-400 bg-indigo-500'
                                      : 'border-slate-600'
                                  }`}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 3B. Flag Display Modes & Multi-Select Layered Filters */}
                      {isFlagQuiz && settings.mode === 'type-highlighted' && (
                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-3">
                          <div className="text-[11px] text-slate-400 font-bold">
                            3. FLAG_DISPLAY_MODE
                          </div>

                          <div className="space-y-1.5">
                            {FLAG_DISPLAY_MODES_INFO.map((opt) => (
                              <button
                                key={opt.id}
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    flagDisplayMode: opt.id,
                                    flagFilters:
                                      s.flagFilters && s.flagFilters.length > 0
                                        ? s.flagFilters
                                        : ['pixelate'],
                                  }))
                                }
                                className={`w-full p-2.5 rounded-lg text-left border transition flex items-center justify-between gap-3 cursor-pointer ${
                                  activeFlagDisplayMode === opt.id
                                    ? 'bg-indigo-600/20 border-indigo-400 text-white'
                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <div>
                                  <div className="font-bold text-xs text-white">{opt.label}</div>
                                  <div className="text-[11px] text-slate-400 mt-0.5">
                                    {opt.shortDesc}
                                  </div>
                                </div>
                                <span
                                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                    activeFlagDisplayMode === opt.id
                                      ? 'border-indigo-400 bg-indigo-500'
                                      : 'border-slate-600'
                                  }`}
                                />
                              </button>
                            ))}
                          </div>

                          {activeFlagDisplayMode === 'filtered' && (
                            <div className="pt-2.5 border-t border-slate-800 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-amber-300 font-bold">
                                  LAYERED_FILTERS (MULTI-SELECT — MUTUALLY EXCLUSIVE FILTERS AUTO-LOCK)
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {activeFlagFilters.length} active
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                {FLAG_FILTER_DEFINITIONS.map((fMeta) => {
                                  const isSelected = activeFlagFilters.includes(fMeta.id);
                                  const conflictId = getConflictingFilter(
                                    fMeta.id,
                                    activeFlagFilters
                                  );
                                  const conflictMeta = conflictId
                                    ? FLAG_FILTER_DEFINITIONS.find((d) => d.id === conflictId)
                                    : null;

                                  return (
                                    <button
                                      key={fMeta.id}
                                      type="button"
                                      disabled={Boolean(conflictId)}
                                      onClick={() => toggleFlagFilter(fMeta.id)}
                                      className={`p-2 rounded border text-left transition flex flex-col justify-between gap-1 ${
                                        isSelected
                                          ? 'bg-amber-500/20 border-amber-400 text-white cursor-pointer'
                                          : conflictId
                                          ? 'bg-slate-950 border-slate-900 text-slate-600 opacity-50 cursor-not-allowed'
                                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600 cursor-pointer'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="font-bold text-[11px]">
                                          {fMeta.label}
                                        </span>
                                        {isSelected ? (
                                          <span className="px-1.5 py-0.2 rounded bg-amber-400 text-slate-950 font-bold text-[9px]">
                                            ACTIVE
                                          </span>
                                        ) : conflictMeta ? (
                                          <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-rose-400 text-[9px]">
                                            EXCLUDED BY {conflictMeta.label}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="text-[10px] text-slate-400 leading-tight">
                                        {fMeta.shortDesc}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Revision Tracked Preset Control */}
                  <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-400">
                      REVISION_TRACKED_PRESET:{' '}
                      <strong className="text-slate-200">
                        {isSpecialCitiesQuiz
                          ? `Top ${trackedPreset.specialCitiesCount || 5} Cities`
                          : `${trackedPreset.mode} / ${trackedPreset.typingMatchMode} / ${
                              isFlagQuiz
                                ? trackedPreset.flagDisplayMode || 'standard'
                                : trackedPreset.mode === 'list-all'
                                ? trackedPreset.listAllDisplayStyle || 'map-outlines'
                                : trackedPreset.mapDisplayStyle
                            }`}
                      </strong>
                    </div>

                    {!isMatchingTrackedPreset(
                      settings,
                      trackedPreset,
                      isFlagQuiz,
                      isSpecialCitiesQuiz
                    ) && (
                      <button
                        onClick={() => {
                          saveTrackedPresetForQuiz(quiz.id, settings);
                          setTrackedPreset(settings);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer"
                      >
                        <BookmarkCheck className="w-3.5 h-3.5" />
                        SET CURRENT MODE AS REVISION TRACKED PRESET
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 0. SPECIAL TOP-N CITIES RELATIVE POSITION QUIZ VIEW */}
        {isSpecialCitiesQuiz && !loading && currentSpecialCitiesItem && !isFinished && (
          <SpecialCitiesCanvas
            item={currentSpecialCitiesItem}
            countryFeature={currentSpecialCountryFeature}
            topN={settings.specialCitiesCount || 5}
            showCapitalStar={settings.showCapitalStar ?? true}
            showRelativePopulation={settings.showRelativePopulation ?? true}
            showAbsolutePopulation={settings.showAbsolutePopulation ?? false}
            showScaleReference={settings.showScaleReference ?? true}
            isRevealed={specialRevealState !== null}
          />
        )}

        {/* 0B. NO-MAP LIST ALL VIEW (Named Order, Alphabetical Slots, or Blind Submit) */}
        {!loading &&
          !isSpecialCitiesQuiz &&
          settings.mode === 'list-all' &&
          activeListAllDisplayStyle === 'no-map-list' && (
            <div className="max-w-5xl mx-auto p-4 sm:p-6">
              {activeListAllOrderMode === 'blind' && !isFinished ? (
                <div className="max-w-xl mx-auto my-12 bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-4 shadow-2xl">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
                    BLIND_LIST_ALL_MODE
                  </div>
                  <h3 className="text-base font-bold text-white">
                    No Progress or Named List Shown
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Type as many items as you can recall into the input bar above. Neither your
                    named items nor your remaining count are shown, and the quiz will not
                    automatically end when all items are named.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleGiveUpCurrent}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg transition cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      SUBMIT & FINISH RUN
                    </button>
                  </div>
                </div>
              ) : activeListAllOrderMode === 'alphabetical' ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                    <span>ALPHABETICAL_LIST_SLOTS (A–Z)</span>
                    <span>
                      NAMED: <strong className="text-emerald-400">{correctCount}</strong> /{' '}
                      {totalCount}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {alphabeticalAllNames.map((name, idx) => {
                      const st = regionStatuses[name]?.state;
                      const isRevealedSlot = st === 'correct' || st === 'missed' || isFinished;
                      return (
                        <div
                          key={name}
                          className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-2 ${
                            st === 'correct'
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 font-bold'
                              : st === 'missed'
                              ? 'bg-rose-500/15 border-rose-500/40 text-rose-200 font-bold'
                              : 'bg-slate-950 border-slate-800/80 text-slate-600'
                          }`}
                        >
                          <span className="text-[10px] text-slate-500 w-6 shrink-0">
                            #{idx + 1}
                          </span>
                          <span className="truncate">
                            {isRevealedSlot ? name : '— — — — —'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Default: Named Order (1..N) */
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                    <span>NAMED_ORDER_LIST (1..{totalCount})</span>
                    <span>
                      NAMED: <strong className="text-emerald-400">{correctCount}</strong> /{' '}
                      {totalCount}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {Array.from({ length: totalCount }).map((_, idx) => {
                      const namedItem = namedOrderList[idx];
                      return (
                        <div
                          key={idx}
                          className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-2 ${
                            namedItem
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 font-bold'
                              : 'bg-slate-950 border-slate-800/80 text-slate-600'
                          }`}
                        >
                          <span className="text-[10px] text-slate-500 w-6 shrink-0">
                            #{idx + 1}
                          </span>
                          <span className="truncate">{namedItem || '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

        {/* 1. FLAG QUIZ VIEW (Type or Click) */}
        {isFlagQuiz &&
          !loading &&
          quiz.flagItems &&
          settings.mode !== 'list-all' && (
            <div className="max-w-5xl mx-auto p-6 flex flex-col items-center justify-center min-h-full">
              {settings.mode === 'type-highlighted' ? (
                currentFlagItem && !isFinished ? (
                  <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl p-8 flex flex-col items-center justify-center shadow-2xl gap-3">
                    <FlagVisualRenderer
                      item={currentFlagItem}
                      displayMode={activeFlagDisplayMode}
                      activeFilters={activeFlagFilters}
                      size="large"
                    />
                    {activeFlagDisplayMode === 'filtered' && activeFlagFilters.length > 0 && (
                      <div className="text-[11px] text-slate-500">
                        ACTIVE_FILTERS: {activeFlagFilters.join(' + ').toUpperCase()}
                      </div>
                    )}
                  </div>
                ) : null
              ) : (
                <div className="w-full grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {quiz.flagItems
                    .filter((item) => regionStatuses[item.name] !== undefined)
                    .map((item) => {
                      const status = regionStatuses[item.name]?.state;
                      return (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => handleTargetClickSelection(item.name)}
                          className={`p-2 rounded-lg border flex flex-col items-center justify-between gap-2 transition cursor-pointer ${
                            status === 'correct'
                              ? 'bg-emerald-500/15 border-emerald-500/40 opacity-50'
                              : status === 'missed'
                              ? 'bg-rose-500/15 border-rose-500/40'
                              : 'bg-slate-900 border-slate-800 hover:border-slate-600'
                          }`}
                        >
                          <div className="h-14 w-full flex items-center justify-center">
                            <img
                              src={resolveAssetUrl(item.imageUrl)}
                              alt="Flag"
                              className="max-h-14 max-w-full object-contain rounded-sm"
                              loading="lazy"
                            />
                          </div>
                          {(status === 'correct' || status === 'missed' || isFinished) && (
                            <div className="text-[10px] truncate w-full text-center font-bold text-slate-300">
                              {item.name}
                            </div>
                          )}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

        {/* 2. ISOLATED SHAPE ONLY MODE (High-Def SVG Polygon or River Path without Map) */}
        {!isFlagQuiz &&
          !isSpecialCitiesQuiz &&
          !loading &&
          settings.mode === 'type-highlighted' &&
          settings.mapDisplayStyle === 'isolated-shape' && (
            <div className="w-full h-full flex items-center justify-center p-6 bg-slate-950">
              <div className="max-w-2xl w-full bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center shadow-2xl relative">
                {settings.randomRotation && (
                  <div className="absolute top-3 right-3 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-300 font-bold flex items-center gap-1">
                    <Compass className="w-3 h-3" />
                    RANDOM_ROTATION_ON
                  </div>
                )}
                <svg
                  viewBox="0 0 600 420"
                  className="w-full h-auto max-h-[65dvh] overflow-visible"
                >
                  <path
                    d={isolatedSvgPath}
                    fill={isRiverOrLineQuiz ? 'none' : '#facc15'}
                    fillOpacity={isRiverOrLineQuiz ? 0 : 0.85}
                    stroke={isRiverOrLineQuiz ? '#38bdf8' : '#ffffff'}
                    strokeWidth={isRiverOrLineQuiz ? 4.5 : 2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          )}

        {/* 3. UNIT VECTORS TO N CLOSEST NEIGHBORS MODE */}
        {!isFlagQuiz &&
          !isSpecialCitiesQuiz &&
          !loading &&
          settings.mode === 'type-highlighted' &&
          settings.mapDisplayStyle === 'unit-vectors' && (
            <div className="w-full h-full flex items-center justify-center p-4 bg-slate-950">
              <div className="max-w-3xl w-full bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center shadow-2xl">
                <svg
                  viewBox="-340 -250 680 500"
                  className="w-full h-auto max-h-[72dvh] overflow-visible"
                >
                  <defs>
                    <marker
                      id="unit-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
                    </marker>
                  </defs>

                  <circle
                    cx={0}
                    cy={0}
                    r={145}
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />

                  <line x1={-165} y1={0} x2={165} y2={0} stroke="#1e293b" strokeWidth={1} />
                  <line x1={0} y1={-165} x2={0} y2={165} stroke="#1e293b" strokeWidth={1} />
                  <text x={0} y={-172} textAnchor="middle" fill="#475569" fontSize={10}>
                    N
                  </text>

                  {unitVectors.map((vec, idx) => {
                    const R = 145;
                    const x2 = vec.ux * R;
                    const y2 = vec.uy * R;
                    const labelR = 168 + (idx % 2) * 16;
                    const lx = vec.ux * labelR;
                    const ly = vec.uy * labelR;
                    const anchor =
                      vec.ux > 0.25 ? 'start' : vec.ux < -0.25 ? 'end' : 'middle';

                    return (
                      <g key={vec.name}>
                        <line
                          x1={0}
                          y1={0}
                          x2={x2}
                          y2={y2}
                          stroke="#38bdf8"
                          strokeWidth={2.2}
                          markerEnd="url(#unit-arrow)"
                        />
                        <text
                          x={lx}
                          y={ly}
                          dy="0.35em"
                          textAnchor={anchor}
                          fill="#e2e8f0"
                          fontSize={11.5}
                          fontWeight="bold"
                        >
                          {vec.name}
                        </text>
                      </g>
                    );
                  })}

                  <circle
                    cx={0}
                    cy={0}
                    r={6}
                    fill="#facc15"
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                </svg>
              </div>
            </div>
          )}

        {/* 4. INTERACTIVE MAP VIEW */}
        {showInteractiveMap && (
          <MapContainer
            center={quiz.defaultCenter || [20, 0]}
            zoom={quiz.defaultZoom || 4}
            minZoom={1}
            className="w-full h-full z-0"
            zoomControl={true}
            attributionControl={false}
            preferCanvas={false}
          >
            <MapBoundsController
              geoJsonData={effectiveGeoJsonData}
              cityPoints={quiz.cityItems}
              targetFeature={targetFeature}
              targetLatLng={targetLatLng}
              autoZoomTarget={autoZoomTarget}
              fitTrigger={fitTrigger}
            />

            {/* Background Country/Continent Border for River Quizzes, Centroid-Dot, Single-Outline-In-Country, Minefield Click Mode, and Borderless Reveal List Mode */}
            {(isRiverOrLineQuiz ||
              settings.mapDisplayStyle === 'centroid-dot' ||
              isSingleOutlineInCountry ||
              (settings.mode === 'click-named' &&
                settings.mapDisplayStyle === 'minefield-no-outlines') ||
              (settings.mode === 'list-all' &&
                activeListAllDisplayStyle === 'map-reveal-borders' &&
                (settings.listAllShowOuterBorder ?? true))) &&
              (countryOutlineGeoJson || worldCountries) && (
                <GeoJSON
                  key={`outer-border-${mapLayerSyncKey}`}
                  data={(countryOutlineGeoJson || worldCountries)!}
                  interactive={false}
                  style={() => ({
                    fillColor: '#1e293b',
                    fillOpacity: 0.55,
                    color: '#475569',
                    weight: isRiverOrLineQuiz ? 1.2 : 2,
                  })}
                />
              )}

            {/* Base Water Body Layer */}
            {showHydroOverlay && localWaterLakes && (
              <GeoJSON
                key={`hydro-lakes-${mapLayerSyncKey}`}
                data={localWaterLakes}
                interactive={false}
                style={() => ({
                  fillColor: '#071426',
                  fillOpacity: 0.96,
                  color: '#0ea5e9',
                  weight: 1.4,
                  fillRule: 'evenodd',
                })}
              />
            )}

            {effectiveGeoJsonData && (
              <GeoJSON
                key={`subdivisions-${mapLayerSyncKey}`}
                data={effectiveGeoJsonData}
                style={(feature) => {
                  if (format === 'map-point') {
                    if (
                      (settings.mode === 'click-named' &&
                        settings.mapDisplayStyle === 'minefield-no-outlines') ||
                      (settings.mode === 'list-all' &&
                        activeListAllDisplayStyle === 'map-reveal-borders')
                    ) {
                      const showOuter =
                        settings.mode === 'list-all'
                          ? (settings.listAllShowOuterBorder ?? true)
                          : true;
                      return {
                        fillColor: '#1e293b',
                        fillOpacity: countryOutlineGeoJson || !showOuter ? 0 : 0.45,
                        color: '#334155',
                        weight: countryOutlineGeoJson || !showOuter ? 0 : 1,
                      };
                    }
                    return {
                      fillColor: '#1e293b',
                      fillOpacity: 0.45,
                      color: '#334155',
                      weight: 1,
                    };
                  }

                  if (!feature) return {};
                  const regionName = getFeatureName(feature);
                  const status = regionStatuses[regionName]?.state;
                  const isTarget =
                    hasStarted &&
                    settings.mode === 'type-highlighted' &&
                    !isFinished &&
                    regionName === currentTargetName;

                  // River / LineString / Ribbon Styling
                  if (isRiverOrLineQuiz) {
                    const hidePendingLines =
                      (settings.mode === 'type-highlighted' &&
                        (settings.mapDisplayStyle === 'centroid-dot' ||
                          isSingleOutlineInCountry)) ||
                      (settings.mode === 'click-named' &&
                        settings.mapDisplayStyle === 'minefield-no-outlines') ||
                      (settings.mode === 'list-all' &&
                        activeListAllDisplayStyle === 'map-reveal-borders');

                    if (hidePendingLines) {
                      if (isTarget) {
                        return {
                          color: '#facc15',
                          fillColor: '#facc15',
                          fillOpacity: 0.9,
                          weight: 4,
                          opacity: 1,
                        };
                      }
                      if (status === 'correct') {
                        return {
                          color: '#10b981',
                          fillColor: '#10b981',
                          fillOpacity: 0.85,
                          weight: 3,
                          opacity: 0.95,
                        };
                      }
                      if (status === 'missed') {
                        return {
                          color: '#f43f5e',
                          fillColor: '#f43f5e',
                          fillOpacity: 0.85,
                          weight: 3.2,
                          opacity: 0.95,
                        };
                      }
                      return {
                        color: '#38bdf8',
                        fillColor: '#38bdf8',
                        fillOpacity: settings.mode === 'click-named' ? 0.02 : 0,
                        weight: settings.mode === 'click-named' ? 8 : 0,
                        opacity: settings.mode === 'click-named' ? 0.02 : 0,
                      };
                    }

                    if (isTarget) {
                      return {
                        color: '#facc15',
                        fillColor: '#facc15',
                        fillOpacity: 0.92,
                        weight: 4,
                        opacity: 1,
                      };
                    }
                    if (status === 'correct') {
                      return {
                        color: '#10b981',
                        fillColor: '#10b981',
                        fillOpacity: 0.85,
                        weight: 3,
                        opacity: 0.95,
                      };
                    }
                    if (status === 'missed') {
                      return {
                        color: '#f43f5e',
                        fillColor: '#f43f5e',
                        fillOpacity: 0.85,
                        weight: 3.2,
                        opacity: 0.95,
                      };
                    }
                    return {
                      color: '#38bdf8',
                      fillColor: '#38bdf8',
                      fillOpacity: 0.75,
                      weight: 2.2,
                      opacity: 0.88,
                    };
                  }

                  // LIST ALL — Borderless Reveal Map Mode (no internal borders until region is named)
                  if (
                    settings.mode === 'list-all' &&
                    activeListAllDisplayStyle === 'map-reveal-borders'
                  ) {
                    if (status === 'correct') {
                      return {
                        fillColor: '#10b981',
                        fillOpacity: 0.6,
                        color: '#059669',
                        weight: 1.2,
                        opacity: 1,
                      };
                    }
                    if (status === 'missed') {
                      return {
                        fillColor: '#f43f5e',
                        fillOpacity: 0.6,
                        color: '#fda4af',
                        weight: 1.4,
                        opacity: 1,
                      };
                    }
                    return {
                      fillColor: '#1e293b',
                      fillOpacity: 0,
                      color: '#1e293b',
                      weight: 0,
                      opacity: 0,
                    };
                  }

                  // Minefield Click Mode
                  if (
                    settings.mode === 'click-named' &&
                    settings.mapDisplayStyle === 'minefield-no-outlines'
                  ) {
                    if (status === 'correct') {
                      return {
                        fillColor: '#10b981',
                        fillOpacity: 0.55,
                        color: '#059669',
                        weight: 1.1,
                      };
                    }
                    if (status === 'missed') {
                      return {
                        fillColor: '#f43f5e',
                        fillOpacity: 0.6,
                        color: '#fda4af',
                        weight: 1.4,
                      };
                    }
                    return {
                      fillColor: '#1e293b',
                      fillOpacity: countryOutlineGeoJson ? 0.01 : 0.55,
                      color: '#1e293b',
                      weight: countryOutlineGeoJson ? 0 : 0.8,
                      opacity: countryOutlineGeoJson ? 0 : 1,
                    };
                  }

                  if (
                    settings.mode === 'type-highlighted' &&
                    settings.mapDisplayStyle === 'centroid-dot'
                  ) {
                    return {
                      fillColor: '#1e293b',
                      fillOpacity: countryOutlineGeoJson ? 0 : 0.55,
                      color: '#1e293b',
                      weight: countryOutlineGeoJson ? 0 : 1,
                      opacity: countryOutlineGeoJson ? 0 : 1,
                    };
                  }

                  if (isSingleOutlineInCountry) {
                    if (isTarget) {
                      return {
                        fillColor: '#facc15',
                        fillOpacity: 0.88,
                        color: '#ffffff',
                        weight: 2.2,
                      };
                    }
                    return {
                      fillColor: '#1e293b',
                      fillOpacity: countryOutlineGeoJson ? 0 : 0.45,
                      color: '#1e293b',
                      weight: 0,
                      opacity: 0,
                    };
                  }

                  if (isTarget) {
                    return {
                      fillColor: '#facc15',
                      fillOpacity: 0.88,
                      color: '#ffffff',
                      weight: 2.2,
                    };
                  }

                  if (status === 'correct') {
                    return {
                      fillColor: '#10b981',
                      fillOpacity: 0.55,
                      color: '#059669',
                      weight: 1.1,
                    };
                  }

                  if (status === 'missed') {
                    return {
                      fillColor: '#f43f5e',
                      fillOpacity: 0.6,
                      color: '#fda4af',
                      weight: 1.4,
                    };
                  }

                  return {
                    fillColor: '#1e293b',
                    fillOpacity: 0.65,
                    color: '#475569',
                    weight: 1,
                  };
                }}
                onEachFeature={(feature, layer) => {
                  if (format !== 'map-polygon') return;
                  const regionName = getFeatureName(feature);
                  const status = regionStatuses[regionName]?.state;

                  if (
                    ((settings.mapDisplayStyle === 'all-outlines' &&
                      !isSingleOutlineInCountry) ||
                      settings.mapDisplayStyle === 'minefield-no-outlines' ||
                      settings.mode === 'list-all') &&
                    (status === 'correct' || status === 'missed' || isFinished)
                  ) {
                    layer.bindTooltip(regionName, {
                      sticky: true,
                      direction: 'top',
                      className: 'region-tooltip',
                    });
                  }

                  layer.on({
                    click: () => handleTargetClickSelection(regionName),
                  });
                }}
              />
            )}

            {/* Polygon Centroid Dots (Default: All Centroids Visible; Sub-Setting: Single Target Centroid Only) */}
            {format === 'map-polygon' &&
              hasStarted &&
              settings.mode === 'type-highlighted' &&
              settings.mapDisplayStyle === 'centroid-dot' &&
              !isFinished &&
              Object.entries(subdivisionCentroids)
                .filter(([name]) => regionStatuses[name] !== undefined)
                .map(([name, latLng]) => {
                  const status = regionStatuses[name]?.state;
                  const isTarget = name === currentTargetName;
                  if (isSingleCentroidOnly && !isTarget) return null;

                  const fillColor = isTarget
                    ? '#facc15'
                    : status === 'correct'
                    ? '#10b981'
                    : status === 'missed'
                    ? '#f43f5e'
                    : '#38bdf8';

                  return (
                    <CircleMarker
                      key={`poly-centroid-${name}`}
                      center={latLng}
                      radius={isTarget ? 8.5 : 5.5}
                      pathOptions={{
                        fillColor,
                        fillOpacity: 0.95,
                        color: isTarget ? '#ffffff' : '#0f172a',
                        weight: isTarget ? 2.5 : 1.5,
                      }}
                      eventHandlers={{
                        click: () => handleTargetClickSelection(name),
                      }}
                    >
                      {!isSingleCentroidOnly &&
                        (status === 'correct' || status === 'missed') && (
                          <Tooltip direction="top" className="region-tooltip">
                            {name}
                          </Tooltip>
                        )}
                    </CircleMarker>
                  );
                })}

            {/* Map-Point City Markers */}
            {format === 'map-point' &&
              quiz.cityItems &&
              quiz.cityItems
                .filter((city) => regionStatuses[city.name] !== undefined)
                .map((city) => {
                  const status = regionStatuses[city.name]?.state;
                  const isTarget =
                    hasStarted &&
                    settings.mode === 'type-highlighted' &&
                    !isFinished &&
                    city.name === currentTargetName;

                  if (
                    (isSingleOutlineInCountry || isSingleCentroidOnly) &&
                    !isTarget
                  ) {
                    return null;
                  }

                  if (
                    settings.mode === 'list-all' &&
                    activeListAllDisplayStyle === 'map-reveal-borders' &&
                    status === 'pending' &&
                    !isFinished
                  ) {
                    return null;
                  }

                  const fillColor = isTarget
                    ? '#facc15'
                    : status === 'correct'
                    ? '#10b981'
                    : status === 'missed'
                    ? '#f43f5e'
                    : '#38bdf8';

                  return (
                    <CircleMarker
                      key={city.name}
                      center={[city.lat, city.lng]}
                      radius={isTarget ? 9 : 6.5}
                      pathOptions={{
                        fillColor,
                        fillOpacity: 0.95,
                        color: isTarget ? '#ffffff' : '#0f172a',
                        weight: isTarget ? 2.5 : 1.5,
                      }}
                      eventHandlers={{
                        click: () => handleTargetClickSelection(city.name),
                      }}
                    >
                      {(status === 'correct' || status === 'missed' || isFinished) && (
                        <Tooltip direction="top" className="region-tooltip">
                          {city.name}
                        </Tooltip>
                      )}
                    </CircleMarker>
                  );
                })}
          </MapContainer>
        )}

        {/* Technical Run Summary Overlay */}
        {isFinished && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-30">
            <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <div className="text-xs text-slate-400">
                    {isTrackedRun ? 'RUN_COMPLETE [LOGGED]' : 'PRACTICE_COMPLETE [UNTRACKED]'}
                  </div>
                  <h3 className="text-base font-bold text-white">{quiz.title}</h3>
                </div>
                <span
                  className={`px-2.5 py-1 rounded text-sm font-bold ${
                    currentAccuracy === 100
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {currentAccuracy}%
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-500">ACCURACY</div>
                  <div className="text-lg font-bold text-white">{currentAccuracy}%</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-500">COUNT</div>
                  <div className="text-lg font-bold text-white">
                    {correctCount}/{totalCount}
                  </div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-500">TIME</div>
                  <div className="text-lg font-bold text-indigo-400">
                    {formatClock(elapsedSeconds)}
                  </div>
                </div>
              </div>

              {lastWrongSubmission && (
                <div className="flex flex-col gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-amber-200">
                      Last miss: <strong>{lastWrongSubmission.targetName}</strong> (typed "
                      {lastWrongSubmission.typedText}")
                    </span>
                    <button
                      onClick={handleOverrideTypoAsCorrect}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 font-bold cursor-pointer shrink-0"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      {isFlagQuiz && activeFlagDisplayMode !== 'standard'
                        ? 'MARK AS CORRECT (IDENTICAL)'
                        : 'MARK AS CORRECT (TYPO)'}
                    </button>
                  </div>

                  {isFlagQuiz &&
                    lastWrongSubmission.guessedFlagItem &&
                    lastWrongSubmission.targetFlagItem && (
                      <div className="flex items-center gap-4 pt-2 border-t border-amber-500/20">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-amber-300">
                            Guessed ({lastWrongSubmission.guessedFlagItem.name}):
                          </span>
                          <FlagVisualRenderer
                            item={lastWrongSubmission.guessedFlagItem}
                            displayMode={activeFlagDisplayMode}
                            activeFilters={activeFlagFilters}
                            size="small"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-emerald-300">
                            Target ({lastWrongSubmission.targetFlagItem.name}):
                          </span>
                          <FlagVisualRenderer
                            item={lastWrongSubmission.targetFlagItem}
                            displayMode={activeFlagDisplayMode}
                            activeFilters={activeFlagFilters}
                            size="small"
                          />
                        </div>
                      </div>
                    )}
                </div>
              )}

              {missedCount > 0 && (
                <div className="bg-slate-950 border border-rose-500/30 rounded-lg p-3">
                  <div className="text-[11px] text-rose-400 mb-1.5">
                    MISSED [{missedCount}]:
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                    {Object.values(regionStatuses)
                      .filter((s) => s.state === 'missed')
                      .map((s) => (
                        <span
                          key={s.name}
                          className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 text-xs"
                        >
                          {s.name}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {onNextInRevisionQueue && (
                  <button
                    onClick={onNextInRevisionQueue}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer"
                  >
                    NEXT IN REVISION QUEUE →
                  </button>
                )}

                <button
                  onClick={() => startOrRestartQuiz(null)}
                  className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                >
                  REPEAT FULL
                </button>

                <button
                  onClick={() => {
                    setIsFinished(false);
                    setShowOptionsPanel(true);
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold transition cursor-pointer"
                >
                  CHANGE MODE
                </button>

                {missedCount > 0 && (
                  <button
                    onClick={() => {
                      const missedNames = Object.values(regionStatuses)
                        .filter((s) => s.state === 'missed')
                        .map((s) => s.name);
                      startOrRestartQuiz(missedNames);
                    }}
                    className="flex-1 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-xs font-semibold transition cursor-pointer"
                  >
                    DRILL MISSED [{missedCount}]
                  </button>
                )}

                <button
                  onClick={onExit}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs transition cursor-pointer"
                >
                  RETURN
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, GeoJSON, CircleMarker, Tooltip, useMapEvents } from 'react-leaflet';
import { Check, Play, Plus, X } from 'lucide-react';
import type { QuizAttempt, QuizConfig } from '../types/quiz';
import { computeQuizStats } from '../utils/revisionAlgorithm';
import { computeFeaturesBBox } from '../utils/geometry';
import { getCountryFlagIconByName, getQuizFlagIconUrl } from '../utils/flagIcons';
import {
  categoryLabel,
  cleanQuizTitle,
  itemCountLabel,
} from '../utils/quizDisplay';

interface IndexMapViewProps {
  quizzes: QuizConfig[];
  attempts: QuizAttempt[];
  enrolledIds: string[];
  onStartQuiz: (quiz: QuizConfig) => void;
  onToggleEnroll: (quizId: string) => void;
}

let cachedCountries: GeoJSON.FeatureCollection | null = null;

function ZoomTracker({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: (e) => {
      onZoomChange(e.target.getZoom());
    },
  });

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

  return null;
}

function getCountryKey(feature: GeoJSON.Feature): string {
  const properties = feature.properties || {};
  return String(properties.ADM0_A3 || properties.ISO_A3 || properties.NAME || '');
}

function getQuizzesForCountryFeature(
  feature: GeoJSON.Feature,
  quizzesByIso: Record<string, QuizConfig[]>
): QuizConfig[] {
  const properties = feature.properties || {};
  const adm0 = String(properties.ADM0_A3 || '').toUpperCase();
  const iso3 = String(properties.ISO_A3 || '').toUpperCase();
  const name = String(properties.NAME || '').toLowerCase();

  return (
    (adm0 && quizzesByIso[adm0]) ||
    (iso3 && quizzesByIso[iso3]) ||
    (name && quizzesByIso[name]) ||
    []
  );
}

export function IndexMapView({
  quizzes,
  attempts,
  enrolledIds,
  onStartQuiz,
  onToggleEnroll,
}: IndexMapViewProps) {
  const [worldGeoJson, setWorldGeoJson] = useState<GeoJSON.FeatureCollection | null>(
    cachedCountries
  );
  const [selectedCountryKey, setSelectedCountryKey] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(2);

  useEffect(() => {
    if (!cachedCountries) {
      fetch('/data/world-countries.geojson')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) {
            cachedCountries = d;
            setWorldGeoJson(d);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Group quizzes by ISO-3 code (from tags) and by countryOrRegion name
  const quizzesByIso = useMemo(() => {
    const map: Record<string, QuizConfig[]> = {};
    for (const quiz of quizzes) {
      const isoTag = quiz.tags.find((tag) => /^[A-Z]{3}$/.test(tag));
      if (isoTag) {
        if (!map[isoTag]) map[isoTag] = [];
        map[isoTag].push(quiz);
      }
      const nameKey = quiz.countryOrRegion.toLowerCase();
      if (!map[nameKey]) map[nameKey] = [];
      if (!map[nameKey].includes(quiz)) map[nameKey].push(quiz);
    }
    return map;
  }, [quizzes]);

  // Compute small-country dot markers so microstates/islands are easy to click when zoomed out
  const smallCountryDots = useMemo(() => {
    if (!worldGeoJson) return [];
    const dots: Array<{
      key: string;
      name: string;
      lat: number;
      lng: number;
      quizCount: number;
    }> = [];

    for (const feature of worldGeoJson.features) {
      const countryQuizzes = getQuizzesForCountryFeature(feature, quizzesByIso);
      if (countryQuizzes.length === 0) continue;

      const bbox = computeFeaturesBBox([feature]);
      const span = Math.max(bbox.maxLon - bbox.minLon, bbox.maxLat - bbox.minLat);
      const properties = feature.properties || {};
      const lat =
        typeof properties.LABEL_Y === 'number'
          ? properties.LABEL_Y
          : (bbox.minLat + bbox.maxLat) / 2;
      const lng =
        typeof properties.LABEL_X === 'number'
          ? properties.LABEL_X
          : (bbox.minLon + bbox.maxLon) / 2;

      if (span < 4.5) {
        dots.push({
          key: getCountryKey(feature),
          name: String(properties.NAME || getCountryKey(feature)),
          lat,
          lng,
          quizCount: countryQuizzes.length,
        });
      }
    }
    return dots;
  }, [worldGeoJson, quizzesByIso]);

  const selectedFeature = useMemo(() => {
    if (!worldGeoJson || !selectedCountryKey) return null;
    return (
      worldGeoJson.features.find(
        (feature) => getCountryKey(feature) === selectedCountryKey
      ) || null
    );
  }, [worldGeoJson, selectedCountryKey]);

  const selectedCountryQuizzes = useMemo(() => {
    if (!selectedFeature) return [];
    return getQuizzesForCountryFeature(selectedFeature, quizzesByIso);
  }, [selectedFeature, quizzesByIso]);

  const selectedCountryName = useMemo(() => {
    if (!selectedFeature) return '';
    return String(selectedFeature.properties?.NAME || selectedCountryKey);
  }, [selectedFeature, selectedCountryKey]);

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl overflow-hidden flex flex-col lg:flex-row h-[72dvh] font-mono">
      {/* Interactive world map */}
      <div className="relative flex-1 h-full">
        {!worldGeoJson ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-ink-400">
            Loading world map index...
          </div>
        ) : (
          <MapContainer
            center={[20, 10]}
            zoom={2}
            minZoom={2}
            maxZoom={10}
            className="w-full h-full z-0"
            attributionControl={false}
          >
            <ZoomTracker onZoomChange={setZoomLevel} />

            <GeoJSON
              key={`world-index-${selectedCountryKey || 'none'}-${quizzes.length}`}
              data={worldGeoJson}
              style={(feature) => {
                if (!feature) return {};
                const key = getCountryKey(feature);
                const associated = getQuizzesForCountryFeature(feature, quizzesByIso);
                const isSelected = key === selectedCountryKey;
                const hasQuizzes = associated.length > 0;

                if (isSelected) {
                  return {
                    fillColor: '#facc15',
                    fillOpacity: 0.85,
                    color: '#ffffff',
                    weight: 2,
                  };
                }

                if (hasQuizzes) {
                  return {
                    fillColor: '#4f46e5',
                    fillOpacity: 0.45,
                    color: '#6366f1',
                    weight: 1,
                  };
                }

                return {
                  fillColor: '#0f172a',
                  fillOpacity: 0.5,
                  color: '#1e293b',
                  weight: 0.8,
                };
              }}
              onEachFeature={(feature, layer) => {
                const key = getCountryKey(feature);
                const name = String(feature.properties?.NAME || key);
                const associated = getQuizzesForCountryFeature(feature, quizzesByIso);

                if (associated.length > 0) {
                  layer.bindTooltip(
                    `${name} (${associated.length} ${
                      associated.length === 1 ? 'quiz' : 'quizzes'
                    })`,
                    {
                      sticky: true,
                      direction: 'top',
                      className: 'region-tooltip',
                    }
                  );
                }

                layer.on({
                  click: () => {
                    if (associated.length > 0) {
                      setSelectedCountryKey(key);
                    }
                  },
                });
              }}
            />

            {/* Clickable dots for small countries and islands when zoomed out */}
            {zoomLevel <= 5 &&
              smallCountryDots.map((dot) => {
                const isSelected = dot.key === selectedCountryKey;
                return (
                  <CircleMarker
                    key={dot.key}
                    center={[dot.lat, dot.lng]}
                    radius={isSelected ? 7 : 5}
                    pathOptions={{
                      fillColor: isSelected ? '#facc15' : '#818cf8',
                      fillOpacity: 0.9,
                      color: '#0f172a',
                      weight: 1.5,
                    }}
                    eventHandlers={{
                      click: () => setSelectedCountryKey(dot.key),
                    }}
                  >
                    <Tooltip direction="top" className="region-tooltip">
                      {dot.name} ({dot.quizCount})
                    </Tooltip>
                  </CircleMarker>
                );
              })}
          </MapContainer>
        )}

        <div className="absolute bottom-3 left-3 bg-ink-950/90 border border-ink-800 rounded px-2.5 py-1.5 text-[11px] text-ink-400 pointer-events-none z-10">
          Click any highlighted country or dot to view its quizzes
        </div>
      </div>

      {/* Side panel: quizzes for the selected country */}
      <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-ink-800 bg-ink-950 flex flex-col h-64 lg:h-full">
        <div className="px-4 py-3 border-b border-ink-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-ink-500">SELECTED COUNTRY</div>
            <div className="text-sm font-bold text-white flex items-center gap-2 mt-0.5">
              {selectedCountryKey && getCountryFlagIconByName(selectedCountryName) && (
                <img
                  src={getCountryFlagIconByName(selectedCountryName)!}
                  alt=""
                  className="w-5 h-3.5 object-cover rounded-[2px] border border-ink-700 shrink-0"
                />
              )}
              <span>{selectedCountryKey ? selectedCountryName : 'NONE SELECTED'}</span>
            </div>
          </div>
          {selectedCountryKey && (
            <button
              type="button"
              onClick={() => setSelectedCountryKey(null)}
              className="p-1 rounded bg-ink-900 hover:bg-ink-800 text-ink-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-ink-800/80">
          {!selectedCountryKey ? (
            <div className="p-6 text-xs text-ink-500 text-center">
              Select a country on the map to inspect and launch its associated quizzes.
            </div>
          ) : selectedCountryQuizzes.length === 0 ? (
            <div className="p-6 text-xs text-ink-500 text-center">
              No quizzes matching current filter for {selectedCountryName}.
            </div>
          ) : (
            selectedCountryQuizzes.map((quiz) => {
              const stats = computeQuizStats(quiz.id, attempts);
              const isEnrolled = enrolledIds.includes(quiz.id);
              const flagIconUrl = getQuizFlagIconUrl(quiz);

              return (
                <div
                  key={quiz.id}
                  className="p-3.5 space-y-2 hover:bg-ink-900/60 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        {flagIconUrl && (
                          <img
                            src={flagIconUrl}
                            alt=""
                            className="w-4 h-3 object-cover rounded-[2px] border border-ink-700 shrink-0"
                            loading="lazy"
                          />
                        )}
                        <span>{cleanQuizTitle(quiz.title)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <span className="text-[10px] text-ink-500">
                          [{itemCountLabel(quiz)}]
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-ink-900 border border-ink-800 text-[10px] text-ink-400">
                          {categoryLabel(quiz.category)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="text-[11px] text-ink-500">
                      LAST:{' '}
                      <strong className="text-ink-300">
                        {stats.lastScorePercent !== null
                          ? `${stats.lastScorePercent}%`
                          : '—'}
                      </strong>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onToggleEnroll(quiz.id)}
                        aria-label={
                          isEnrolled
                            ? `Remove ${cleanQuizTitle(quiz.title)} from revision queue`
                            : `Add ${cleanQuizTitle(quiz.title)} to revision queue`
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border transition cursor-pointer ${
                          isEnrolled
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                            : 'bg-ink-900 border-ink-800 text-ink-400 hover:text-white'
                        }`}
                      >
                        {isEnrolled ? (
                          <>
                            <Check className="w-3 h-3" />
                            QUEUE
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" />
                            +QUEUE
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onStartQuiz(quiz)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-accent-600 hover:bg-accent-500 text-white text-[11px] font-bold transition cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        PLAY
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

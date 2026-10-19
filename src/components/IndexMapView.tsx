import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, GeoJSON, CircleMarker, Tooltip, useMapEvents } from 'react-leaflet';
import { MinusCircle, Play, PlusCircle, X } from 'lucide-react';
import type { QuizAttempt, QuizConfig } from '../types/quiz';
import { computeQuizStats } from '../utils/revisionAlgorithm';
import { computeFeaturesBBox } from '../utils/geometry';
import { getCountryFlagIconByName, getQuizFlagIconUrl } from '../utils/flagIcons';

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

export const IndexMapView: React.FC<IndexMapViewProps> = ({
  quizzes,
  attempts,
  enrolledIds,
  onStartQuiz,
  onToggleEnroll,
}) => {
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

  // Group quizzes by ISO-3 code (from tags) AND by countryOrRegion name
  const quizzesByIso = useMemo(() => {
    const map: Record<string, QuizConfig[]> = {};
    for (const q of quizzes) {
      const isoTag = q.tags.find((t) => /^[A-Z]{3}$/.test(t));
      if (isoTag) {
        if (!map[isoTag]) map[isoTag] = [];
        map[isoTag].push(q);
      }
      const nameKey = q.countryOrRegion.toLowerCase();
      if (!map[nameKey]) map[nameKey] = [];
      if (!map[nameKey].includes(q)) map[nameKey].push(q);
    }
    return map;
  }, [quizzes]);

  function getQuizzesForCountryFeature(feature: GeoJSON.Feature): QuizConfig[] {
    const p = feature.properties || {};
    const adm0 = String(p.ADM0_A3 || '').toUpperCase();
    const iso3 = String(p.ISO_A3 || '').toUpperCase();
    const name = String(p.NAME || '').toLowerCase();

    const list =
      (adm0 && quizzesByIso[adm0]) ||
      (iso3 && quizzesByIso[iso3]) ||
      (name && quizzesByIso[name]) ||
      [];
    return list;
  }

  function getCountryKey(feature: GeoJSON.Feature): string {
    const p = feature.properties || {};
    return String(p.ADM0_A3 || p.ISO_A3 || p.NAME || '');
  }

  // Compute small-country dot markers so microstates/islands are easy to click when zoomed out
  const smallCountryDots = useMemo(() => {
    if (!worldGeoJson) return [];
    const dots: Array<{
      key: string;
      name: string;
      lat: number;
      lng: number;
      quizCount: number;
      span: number;
    }> = [];

    for (const f of worldGeoJson.features) {
      const countryQuizzes = getQuizzesForCountryFeature(f);
      if (countryQuizzes.length === 0) continue;

      const bbox = computeFeaturesBBox([f]);
      const span = Math.max(bbox.maxLon - bbox.minLon, bbox.maxLat - bbox.minLat);
      const p = f.properties || {};
      const lat =
        typeof p.LABEL_Y === 'number'
          ? p.LABEL_Y
          : (bbox.minLat + bbox.maxLat) / 2;
      const lng =
        typeof p.LABEL_X === 'number'
          ? p.LABEL_X
          : (bbox.minLon + bbox.maxLon) / 2;

      // Countries with small angular span get a clickable dot when zoomed out
      if (span < 4.5) {
        dots.push({
          key: getCountryKey(f),
          name: String(p.NAME || getCountryKey(f)),
          lat,
          lng,
          quizCount: countryQuizzes.length,
          span,
        });
      }
    }
    return dots;
  }, [worldGeoJson, quizzesByIso]);

  const selectedFeature = useMemo(() => {
    if (!worldGeoJson || !selectedCountryKey) return null;
    return (
      worldGeoJson.features.find((f) => getCountryKey(f) === selectedCountryKey) ||
      null
    );
  }, [worldGeoJson, selectedCountryKey]);

  const selectedCountryQuizzes = useMemo(() => {
    if (!selectedFeature) return [];
    return getQuizzesForCountryFeature(selectedFeature);
  }, [selectedFeature, quizzesByIso]);

  const selectedCountryName = useMemo(() => {
    if (!selectedFeature) return '';
    return String(selectedFeature.properties?.NAME || selectedCountryKey);
  }, [selectedFeature, selectedCountryKey]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col lg:flex-row h-[72dvh] font-mono">
      {/* Interactive World Map */}
      <div className="relative flex-1 h-full">
        {!worldGeoJson ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
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
                const associated = getQuizzesForCountryFeature(feature);
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
                const associated = getQuizzesForCountryFeature(feature);

                layer.bindTooltip(
                  `${name} (${associated.length} quiz${associated.length === 1 ? '' : 'zes'})`,
                  {
                    sticky: true,
                    direction: 'top',
                    className: 'region-tooltip',
                  }
                );

                layer.on({
                  click: () => {
                    if (associated.length > 0) {
                      setSelectedCountryKey(key);
                    }
                  },
                });
              }}
            />

            {/* Clickable Dots for Small Countries & Islands when zoomed out */}
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

        <div className="absolute bottom-3 left-3 bg-slate-950/90 border border-slate-800 rounded px-2.5 py-1.5 text-[11px] text-slate-400 pointer-events-none z-10">
          Click any highlighted country or dot to view its quizzes
        </div>
      </div>

      {/* Side Panel: Quizzes for Selected Country */}
      <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950 flex flex-col h-64 lg:h-full">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500">SELECTED_COUNTRY</div>
            <div className="text-sm font-bold text-white flex items-center gap-2 mt-0.5">
              {selectedCountryKey && getCountryFlagIconByName(selectedCountryName) && (
                <img
                  src={getCountryFlagIconByName(selectedCountryName)!}
                  alt=""
                  className="w-5 h-3.5 object-cover rounded-[2px] border border-slate-700 shrink-0"
                />
              )}
              <span>{selectedCountryKey ? selectedCountryName : 'NONE SELECTED'}</span>
            </div>
          </div>
          {selectedCountryKey && (
            <button
              onClick={() => setSelectedCountryKey(null)}
              className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
          {!selectedCountryKey ? (
            <div className="p-6 text-xs text-slate-500 text-center">
              Select a country on the map to inspect and launch its associated quizzes.
            </div>
          ) : selectedCountryQuizzes.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 text-center">
              No quizzes matching current filter for {selectedCountryName}.
            </div>
          ) : (
            selectedCountryQuizzes.map((quiz) => {
              const stats = computeQuizStats(quiz.id, attempts);
              const isEnrolled = enrolledIds.includes(quiz.id);
              const flagIconUrl = getQuizFlagIconUrl(quiz);

              return (
                <div key={quiz.id} className="p-3.5 space-y-2 hover:bg-slate-900/60 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        {flagIconUrl && (
                          <img
                            src={flagIconUrl}
                            alt=""
                            className="w-4 h-3 object-cover rounded-[2px] border border-slate-700 shrink-0"
                            loading="lazy"
                          />
                        )}
                        <span>{quiz.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <span className="text-[10px] text-slate-500">
                          [{quiz.totalItems} items]
                        </span>
                        {quiz.tags.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="text-[11px] text-slate-500 space-x-2">
                      <span>
                        100%×: <strong className="text-emerald-400">{stats.perfectCount}</strong>
                      </span>
                      <span>
                        LAST:{' '}
                        <strong className="text-slate-300">
                          {stats.lastScorePercent !== null ? `${stats.lastScorePercent}%` : '—'}
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onToggleEnroll(quiz.id)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border transition cursor-pointer ${
                          isEnrolled
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {isEnrolled ? (
                          <>
                            <MinusCircle className="w-3 h-3" />
                            QUEUE
                          </>
                        ) : (
                          <>
                            <PlusCircle className="w-3 h-3" />
                            +QUEUE
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => onStartQuiz(quiz)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition cursor-pointer"
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
};

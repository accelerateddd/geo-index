import type { QuizAttempt, QuizConfig, QuizPlaySettings } from '../types/quiz';

const ATTEMPTS_STORAGE_KEY = 'geoquiz_attempts_v1';
const CUSTOM_QUIZZES_META_KEY = 'geoquiz_custom_quizzes_meta_v1';
const ENROLLED_REVISION_IDS_KEY = 'geoquiz_enrolled_revision_ids_v1';
const TRACKED_PRESETS_KEY = 'geoquiz_tracked_presets_v1';
const IDB_NAME = 'geoquiz_db';
const IDB_STORE = 'geojson_store';

export const DEFAULT_PLAY_SETTINGS: QuizPlaySettings = {
  mode: 'type-highlighted',
  typingMatchMode: 'enter-submit',
  mapDisplayStyle: 'all-outlines',
  isolateTargetInCountry: false,
  vectorNeighborsCount: 5,
  randomRotation: false,
  listAllDisplayStyle: 'map-outlines',
  listAllShowOuterBorder: true,
  listAllOrderMode: 'named-order',
  flagDisplayMode: 'standard',
  flagFilters: ['pixelate'],
  specialCitiesCount: 5,
  showCapitalStar: true,
  showRelativePopulation: true,
  showAbsolutePopulation: false,
  scaleCitiesByPopulation: true,
  showScaleReference: true,
};

export function normalizePlaySettings(raw: Partial<QuizPlaySettings>): QuizPlaySettings {
  const merged: QuizPlaySettings = {
    ...DEFAULT_PLAY_SETTINGS,
    ...raw,
    flagFilters: raw.flagFilters?.length ? raw.flagFilters : ['pixelate'],
  };

  // Migrate legacy 'isolated-outline-in-country' into 'all-outlines' + isolateTargetInCountry: true
  if (merged.mapDisplayStyle === 'isolated-outline-in-country') {
    merged.mapDisplayStyle = 'all-outlines';
    merged.isolateTargetInCountry = true;
  }

  // Migrate legacy scaleCitiesByPopulation if showRelativePopulation was not explicitly set
  if (raw.showRelativePopulation === undefined && raw.scaleCitiesByPopulation !== undefined) {
    merged.showRelativePopulation = Boolean(raw.scaleCitiesByPopulation);
  }

  return merged;
}

export function loadTrackedPresets(): Record<string, QuizPlaySettings> {
  try {
    const raw = localStorage.getItem(TRACKED_PRESETS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, QuizPlaySettings>;
  } catch {
    return {};
  }
}

export function getTrackedPresetForQuiz(quizId: string): QuizPlaySettings {
  const all = loadTrackedPresets();
  const saved = all[quizId];
  if (!saved) return { ...DEFAULT_PLAY_SETTINGS };
  return normalizePlaySettings(saved);
}

export function saveTrackedPresetForQuiz(
  quizId: string,
  settings: QuizPlaySettings
): Record<string, QuizPlaySettings> {
  const all = loadTrackedPresets();
  const updated = { ...all, [quizId]: normalizePlaySettings(settings) };
  localStorage.setItem(TRACKED_PRESETS_KEY, JSON.stringify(updated));
  return updated;
}

export function isMatchingTrackedPreset(
  current: QuizPlaySettings,
  tracked: QuizPlaySettings,
  isFlagQuiz: boolean,
  isSpecialQuiz: boolean = false
): boolean {
  const cur = normalizePlaySettings(current);
  const trk = normalizePlaySettings(tracked);

  if (isSpecialQuiz) {
    return (
      (cur.specialCitiesCount || 5) === (trk.specialCitiesCount || 5) &&
      Boolean(cur.showCapitalStar ?? true) === Boolean(trk.showCapitalStar ?? true) &&
      Boolean(cur.showRelativePopulation ?? true) ===
        Boolean(trk.showRelativePopulation ?? true) &&
      Boolean(cur.showAbsolutePopulation ?? false) ===
        Boolean(trk.showAbsolutePopulation ?? false) &&
      Boolean(cur.showScaleReference ?? true) === Boolean(trk.showScaleReference ?? true)
    );
  }

  if (cur.mode !== trk.mode) return false;
  if (
    (cur.mode === 'type-highlighted' || cur.mode === 'list-all') &&
    cur.typingMatchMode !== trk.typingMatchMode
  ) {
    return false;
  }

  if (cur.mode === 'list-all') {
    const curListStyle = cur.listAllDisplayStyle || 'map-outlines';
    const trkListStyle = trk.listAllDisplayStyle || 'map-outlines';
    if (curListStyle !== trkListStyle) return false;
    if (
      curListStyle === 'map-reveal-borders' &&
      Boolean(cur.listAllShowOuterBorder ?? true) !==
        Boolean(trk.listAllShowOuterBorder ?? true)
    ) {
      return false;
    }
    if (
      curListStyle === 'no-map-list' &&
      (cur.listAllOrderMode || 'named-order') !== (trk.listAllOrderMode || 'named-order')
    ) {
      return false;
    }
    return true;
  }

  if (isFlagQuiz) {
    if (cur.mode === 'type-highlighted') {
      const curFlagMode = cur.flagDisplayMode || 'standard';
      const trkFlagMode = trk.flagDisplayMode || 'standard';
      if (curFlagMode !== trkFlagMode) return false;
      if (curFlagMode === 'filtered') {
        const a = [...(cur.flagFilters || [])].sort().join(',');
        const b = [...(trk.flagFilters || [])].sort().join(',');
        if (a !== b) return false;
      }
    }
    return true;
  }

  if (cur.mapDisplayStyle !== trk.mapDisplayStyle) {
    return false;
  }
  if (
    cur.mode === 'type-highlighted' &&
    (cur.mapDisplayStyle === 'all-outlines' || cur.mapDisplayStyle === 'centroid-dot') &&
    Boolean(cur.isolateTargetInCountry) !== Boolean(trk.isolateTargetInCountry)
  ) {
    return false;
  }
  if (
    cur.mode === 'type-highlighted' &&
    cur.mapDisplayStyle === 'isolated-shape' &&
    Boolean(cur.randomRotation) !== Boolean(trk.randomRotation)
  ) {
    return false;
  }

  return true;
}

export function loadEnrolledQuizIds(defaultIds: string[] = []): string[] {
  try {
    const raw = localStorage.getItem(ENROLLED_REVISION_IDS_KEY);
    if (!raw) {
      return defaultIds;
    }
    return JSON.parse(raw) as string[];
  } catch (err) {
    console.error('Failed to load enrolled revision quiz IDs:', err);
    return defaultIds;
  }
}

export function saveEnrolledQuizIds(ids: string[]): string[] {
  const unique = Array.from(new Set(ids));
  localStorage.setItem(ENROLLED_REVISION_IDS_KEY, JSON.stringify(unique));
  return unique;
}

export function toggleQuizEnrollment(quizId: string, currentIds: string[]): string[] {
  const exists = currentIds.includes(quizId);
  const next = exists ? currentIds.filter((id) => id !== quizId) : [...currentIds, quizId];
  return saveEnrolledQuizIds(next);
}

export function loadAttempts(): QuizAttempt[] {
  try {
    const raw = localStorage.getItem(ATTEMPTS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QuizAttempt[];
  } catch (err) {
    console.error('Failed to load attempts from localStorage:', err);
    return [];
  }
}

export function saveAttempt(attempt: QuizAttempt): QuizAttempt[] {
  const existing = loadAttempts();
  const updated = [...existing, attempt];
  localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function overwriteAttempts(attempts: QuizAttempt[]): void {
  localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(attempts));
}

export function clearAttemptsForQuiz(quizId: string): QuizAttempt[] {
  const existing = loadAttempts().filter((a) => a.quizId !== quizId);
  localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(existing));
  return existing;
}

function openGeoJsonDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCustomGeoJson(
  quizId: string,
  geojson: GeoJSON.FeatureCollection
): Promise<void> {
  const db = await openGeoJsonDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(geojson, quizId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCustomGeoJson(
  quizId: string
): Promise<GeoJSON.FeatureCollection | null> {
  const db = await openGeoJsonDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(quizId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCustomGeoJson(quizId: string): Promise<void> {
  const db = await openGeoJsonDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(quizId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function loadCustomQuizzesMeta(): QuizConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_QUIZZES_META_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QuizConfig[];
  } catch (err) {
    console.error('Failed to load custom quizzes meta:', err);
    return [];
  }
}

export function saveCustomQuizMeta(quiz: QuizConfig): QuizConfig[] {
  const existing = loadCustomQuizzesMeta().filter((q) => q.id !== quiz.id);
  const { customGeoJson: _, ...metaOnly } = quiz;
  const updated = [...existing, { ...metaOnly, isCustom: true }];
  localStorage.setItem(CUSTOM_QUIZZES_META_KEY, JSON.stringify(updated));
  return updated;
}

export async function deleteCustomQuiz(quizId: string): Promise<QuizConfig[]> {
  const existing = loadCustomQuizzesMeta().filter((q) => q.id !== quizId);
  localStorage.setItem(CUSTOM_QUIZZES_META_KEY, JSON.stringify(existing));
  await deleteCustomGeoJson(quizId);
  return existing;
}

export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`.-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAnswerMatch(
  userInput: string,
  targetName: string,
  aliases?: Record<string, string[]>
): boolean {
  const normInput = normalizeAnswer(userInput);
  if (!normInput) return false;

  const candidates = new Set<string>();
  const normTarget = normalizeAnswer(targetName);
  candidates.add(normTarget);

  const strippedTarget = normTarget
    .replace(
      /\b(district|county|parish|borough|census area|municipality|suburb|state|territory|region|city|province|river|oblast|republic|krai)$/,
      ''
    )
    .trim();
  if (strippedTarget.length >= 2) {
    candidates.add(strippedTarget);
    candidates.add(`${strippedTarget} city`);
    candidates.add(`${strippedTarget} district`);
    candidates.add(`${strippedTarget} county`);
  }

  const targetAliases = aliases?.[targetName] || [];
  for (const alias of targetAliases) {
    candidates.add(normalizeAnswer(alias));
  }

  return candidates.has(normInput);
}

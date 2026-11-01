import type {
  MegaQuizProgressSnapshot,
  QuizAttempt,
  QuizConfig,
  QuizPlaySettings,
} from '../types/quiz';
import { resolveAssetUrl } from './assetUrl';

const ATTEMPTS_STORAGE_KEY = 'geoquiz_attempts_v1';
const CUSTOM_QUIZZES_META_KEY = 'geoquiz_custom_quizzes_meta_v1';
const ENROLLED_REVISION_IDS_KEY = 'geoquiz_enrolled_revision_ids_v1';
const TRACKED_PRESETS_KEY = 'geoquiz_tracked_presets_v1';
const GLOBAL_CONFIG_CACHE_KEY = 'geoquiz_global_config_cache_v1';
const OWNER_UNLOCKED_KEY = 'geoquiz_owner_unlocked_v1';
const OWNER_GITHUB_TOKEN_KEY = 'geoquiz_owner_gh_token_v1';
const USER_MEGA_OVERRIDES_KEY = 'geoquiz_user_mega_overrides_v1';
const MEGA_PROGRESS_PREFIX = 'geoquiz_mega_progress_v1_';

const IDB_NAME = 'geoquiz_db';
const IDB_STORE = 'geojson_store';

export interface GlobalSiteConfig {
  verifiedQuizIds: string[];
  megaQuizDefaultOverrides: Record<string, Record<string, string>>;
}

const DEFAULT_GLOBAL_CONFIG: GlobalSiteConfig = {
  verifiedQuizIds: [
    'aus-adm1',
    'aus-state-flags',
    'usa-adm1',
    'svn-adm2-names',
    'svn-adm1-regions',
  ],
  megaQuizDefaultOverrides: {
    'mega-world-subdivisions': {},
    'mega-usa-counties': {},
    'mega-sydney-suburbs': {},
  },
};

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
  learnClusterCount: 1,
  megaDisambiguationMode: 'prompt-wider-region',
  flagDisplayMode: 'standard',
  flagFilters: ['pixelate'],
  specialCitiesCount: 5,
  showCapitalStar: true,
  showRelativePopulation: true,
  showAbsolutePopulation: false,
  cityPopulationBasis: 'metro',
  scaleCitiesByPopulation: true,
  showScaleReference: true,
  showBroaderRegionBorders: true,
};

export function normalizePlaySettings(
  raw: Partial<QuizPlaySettings>,
  isMegaQuiz: boolean = false
): QuizPlaySettings {
  const merged: QuizPlaySettings = {
    ...DEFAULT_PLAY_SETTINGS,
    ...(isMegaQuiz ? { mode: 'list-all' as const } : {}),
    ...raw,
    flagFilters: raw.flagFilters?.length ? raw.flagFilters : ['pixelate'],
  };

  if (merged.mapDisplayStyle === 'isolated-outline-in-country') {
    merged.mapDisplayStyle = 'all-outlines';
    merged.isolateTargetInCountry = true;
  }

  if (raw.showRelativePopulation === undefined && raw.scaleCitiesByPopulation !== undefined) {
    merged.showRelativePopulation = Boolean(raw.scaleCitiesByPopulation);
  }

  if (!merged.cityPopulationBasis) {
    merged.cityPopulationBasis = 'metro';
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

export function getTrackedPresetForQuiz(
  quizId: string,
  isMegaQuiz: boolean = false
): QuizPlaySettings {
  const all = loadTrackedPresets();
  const saved = all[quizId];
  if (!saved) {
    return normalizePlaySettings({}, isMegaQuiz);
  }
  return normalizePlaySettings(saved, isMegaQuiz);
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

  if (cur.mode === 'learn') return false; // Learn mode is always untracked practice

  if (isSpecialQuiz) {
    return (
      (cur.specialCitiesCount || 5) === (trk.specialCitiesCount || 5) &&
      Boolean(cur.showCapitalStar ?? true) === Boolean(trk.showCapitalStar ?? true) &&
      Boolean(cur.showRelativePopulation ?? true) ===
        Boolean(trk.showRelativePopulation ?? true) &&
      Boolean(cur.showAbsolutePopulation ?? false) ===
        Boolean(trk.showAbsolutePopulation ?? false) &&
      (cur.cityPopulationBasis || 'metro') === (trk.cityPopulationBasis || 'metro') &&
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

// ============================================================================
// Global Config (Verified Quizzes & Default Mega Quiz Recipes for Everyone)
// ============================================================================

export function loadCachedGlobalConfig(): GlobalSiteConfig {
  try {
    const raw = localStorage.getItem(GLOBAL_CONFIG_CACHE_KEY);
    if (!raw) return DEFAULT_GLOBAL_CONFIG;
    const parsed = JSON.parse(raw) as Partial<GlobalSiteConfig>;
    return {
      verifiedQuizIds: Array.isArray(parsed.verifiedQuizIds)
        ? parsed.verifiedQuizIds
        : DEFAULT_GLOBAL_CONFIG.verifiedQuizIds,
      megaQuizDefaultOverrides:
        parsed.megaQuizDefaultOverrides || DEFAULT_GLOBAL_CONFIG.megaQuizDefaultOverrides,
    };
  } catch {
    return DEFAULT_GLOBAL_CONFIG;
  }
}

export function saveCachedGlobalConfig(cfg: GlobalSiteConfig): void {
  localStorage.setItem(GLOBAL_CONFIG_CACHE_KEY, JSON.stringify(cfg));
}

export async function fetchLiveGlobalConfig(): Promise<GlobalSiteConfig> {
  try {
    const res = await fetch(resolveAssetUrl('/data/global-config.json'), {
      cache: 'no-cache',
    });
    if (res.ok) {
      const remote = (await res.json()) as Partial<GlobalSiteConfig>;
      const local = loadCachedGlobalConfig();
      // If owner has unlocked mode locally, merge verified sets so unsynced local owner changes aren't lost
      const isOwner = loadOwnerUnlocked();
      const verifiedSet = new Set<string>([
        ...(remote.verifiedQuizIds || []),
        ...(isOwner ? local.verifiedQuizIds : []),
      ]);
      const merged: GlobalSiteConfig = {
        verifiedQuizIds: Array.from(verifiedSet),
        megaQuizDefaultOverrides: {
          ...(remote.megaQuizDefaultOverrides || {}),
          ...(isOwner ? local.megaQuizDefaultOverrides : {}),
        },
      };
      saveCachedGlobalConfig(merged);
      return merged;
    }
  } catch {
    // ignore offline error
  }
  return loadCachedGlobalConfig();
}

export function loadOwnerUnlocked(): boolean {
  return localStorage.getItem(OWNER_UNLOCKED_KEY) === 'true';
}

export function saveOwnerUnlocked(unlocked: boolean): void {
  localStorage.setItem(OWNER_UNLOCKED_KEY, unlocked ? 'true' : 'false');
}

export function loadOwnerGithubToken(): string {
  return localStorage.getItem(OWNER_GITHUB_TOKEN_KEY) || '';
}

export function saveOwnerGithubToken(token: string): void {
  localStorage.setItem(OWNER_GITHUB_TOKEN_KEY, token.trim());
}

/**
 * Commits the updated GlobalSiteConfig directly to `public/data/global-config.json` in
 * `accelerateddd/geo-index` via the GitHub Contents API if the owner has configured a GitHub PAT,
 * so that verification and default mega-quiz changes automatically publish for all visitors.
 */
export async function syncGlobalConfigToGitHub(
  config: GlobalSiteConfig
): Promise<{ ok: boolean; message: string }> {
  saveCachedGlobalConfig(config);
  const token = loadOwnerGithubToken();
  if (!token) {
    return {
      ok: false,
      message: 'Saved locally in Owner Cache (Add GitHub PAT in Owner Panel to auto-publish to all users).',
    };
  }

  const apiUrl =
    'https://api.github.com/repos/accelerateddd/geo-index/contents/public/data/global-config.json';
  try {
    const getRes = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    let sha: string | undefined;
    if (getRes.ok) {
      const meta = await getRes.json();
      sha = meta.sha;
    }

    const contentStr = JSON.stringify(config, null, 2) + '\n';
    const base64Content = btoa(unescape(encodeURIComponent(contentStr)));

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Update verified quizzes & mega quiz defaults via Owner UI',
        content: base64Content,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      return { ok: false, message: `GitHub API error (${putRes.status}): ${errText}` };
    }
    return { ok: true, message: 'Published to GitHub repository for all users!' };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Failed to sync with GitHub API' };
  }
}

// ============================================================================
// Mega Quiz Personal Substitutions & Pausable Progress Snapshots
// ============================================================================

export function loadUserMegaSlotOverrides(
  megaQuizId: string
): Record<string, string> {
  try {
    const raw = localStorage.getItem(USER_MEGA_OVERRIDES_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, Record<string, string>>;
    return all[megaQuizId] || {};
  } catch {
    return {};
  }
}

export function saveUserMegaSlotOverrides(
  megaQuizId: string,
  overrides: Record<string, string>
): void {
  try {
    const raw = localStorage.getItem(USER_MEGA_OVERRIDES_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, string>>) : {};
    all[megaQuizId] = overrides;
    localStorage.setItem(USER_MEGA_OVERRIDES_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function loadMegaProgressSnapshot(
  megaQuizId: string
): MegaQuizProgressSnapshot | null {
  try {
    const raw = localStorage.getItem(`${MEGA_PROGRESS_PREFIX}${megaQuizId}`);
    if (!raw) return null;
    return JSON.parse(raw) as MegaQuizProgressSnapshot;
  } catch {
    return null;
  }
}

export function saveMegaProgressSnapshot(
  snapshot: MegaQuizProgressSnapshot
): void {
  try {
    localStorage.setItem(
      `${MEGA_PROGRESS_PREFIX}${snapshot.quizId}`,
      JSON.stringify(snapshot)
    );
  } catch (err) {
    console.warn('Could not save mega quiz progress snapshot:', err);
  }
}

export function clearMegaProgressSnapshot(megaQuizId: string): void {
  localStorage.removeItem(`${MEGA_PROGRESS_PREFIX}${megaQuizId}`);
}

// ============================================================================
// Standard Revision Queue & Attempts Storage
// ============================================================================

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
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/ð/g, 'd')
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ß/g, 'ss')
    .replace(/þ/g, 'th')
    .replace(/ı/g, 'i')
    .replace(/ħ/g, 'h')
    .replace(/ŧ/g, 't')
    .replace(/ŋ/g, 'ng')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  Compass,
  Globe,
  KeyRound,
  List,
  Lock,
  Map as MapIcon,
  MinusCircle,
  Play,
  PlusCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { BUILT_IN_QUIZZES } from './data/quizzes';
import type { QuizAttempt, QuizCategory, QuizConfig } from './types/quiz';
import { buildRevisionQueue, computeQuizStats } from './utils/revisionAlgorithm';
import {
  clearAttemptsForQuiz,
  fetchLiveGlobalConfig,
  loadAttempts,
  loadCachedGlobalConfig,
  loadCustomQuizzesMeta,
  loadEnrolledQuizIds,
  loadOwnerGithubToken,
  loadOwnerUnlocked,
  saveAttempt,
  saveCachedGlobalConfig,
  saveOwnerGithubToken,
  saveOwnerUnlocked,
  syncGlobalConfigToGitHub,
  toggleQuizEnrollment,
  type GlobalSiteConfig,
} from './utils/storage';
import { getQuizFlagIconUrl } from './utils/flagIcons';
import { QuizPlayer } from './components/QuizPlayer';
import { RevisionTab } from './components/RevisionTab';
import { IndexMapView } from './components/IndexMapView';

type ActiveTab = 'revision' | 'explore';

const PRIMARY_TYPE_TAGS = [
  '1st-level-divisions',
  '2nd-level-divisions',
  '3rd-level-divisions',
  'usa-counties',
  'aus-lga',
  'sydney-suburbs',
  '1st-level-flags',
  'country-flags',
  'cities',
  'world-capitals',
  'rivers',
  'special',
  'mega-quiz',
];

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('explore');
  const [indexViewFormat, setIndexViewFormat] = useState<'list' | 'map'>('list');

  const [attempts, setAttempts] = useState<QuizAttempt[]>(() => loadAttempts());
  const [customQuizzes] = useState<QuizConfig[]>(() => loadCustomQuizzesMeta());
  const [enrolledIds, setEnrolledIds] = useState<string[]>(() =>
    loadEnrolledQuizIds([])
  );
  const [selectedQueueTags, setSelectedQueueTags] = useState<string[]>([]);
  const [simulatedDaysOffset, setSimulatedDaysOffset] = useState(0);

  // Global Verified Data & Mega Quiz Default Overrides (visible to everyone, editable by Owner)
  const [globalConfig, setGlobalConfig] = useState<GlobalSiteConfig>(() =>
    loadCachedGlobalConfig()
  );
  const [isOwnerMode, setIsOwnerMode] = useState<boolean>(() => loadOwnerUnlocked());
  const [showOwnerModal, setShowOwnerModal] = useState<boolean>(false);
  const [ownerTokenInput, setOwnerTokenInput] = useState<string>(() =>
    loadOwnerGithubToken()
  );
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchLiveGlobalConfig().then((cfg) => {
      setGlobalConfig(cfg);
    });
  }, []);

  const [activeQuizSession, setActiveQuizSession] = useState<{
    quiz: QuizConfig;
    subset?: string[] | null;
    fromQueue?: boolean;
  } | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<QuizCategory | 'all'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [indexSearch, setIndexSearch] = useState('');

  const verifiedIds = globalConfig.verifiedQuizIds;

  const allQuizzes = useMemo(() => {
    const verSet = new Set(verifiedIds);
    return [...BUILT_IN_QUIZZES, ...customQuizzes].map((q) => ({
      ...q,
      verified: Boolean(q.verified || verSet.has(q.id)),
    }));
  }, [customQuizzes, verifiedIds]);

  const simulatedNow = useMemo(
    () => Date.now() + simulatedDaysOffset * 1000 * 60 * 60 * 24,
    [simulatedDaysOffset, attempts]
  );

  const revisionQueue = useMemo(
    () => buildRevisionQueue(allQuizzes, enrolledIds, attempts, simulatedNow),
    [allQuizzes, enrolledIds, attempts, simulatedNow]
  );

  const scopedRevisionQueue = useMemo(() => {
    if (selectedQueueTags.length === 0) return revisionQueue;
    const tagSet = new Set(selectedQueueTags);
    return revisionQueue.filter((item) => item.quiz.tags.some((t) => tagSet.has(t)));
  }, [revisionQueue, selectedQueueTags]);

  const unenrolledQuizzes = useMemo(() => {
    const enrolledSet = new Set(enrolledIds);
    return allQuizzes.filter((q) => !enrolledSet.has(q.id));
  }, [allQuizzes, enrolledIds]);

  function handleToggleQueueTag(tag: string) {
    setSelectedQueueTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function handleStartQuiz(
    quiz: QuizConfig,
    subset: string[] | null = null,
    fromQueue: boolean = false
  ) {
    setActiveQuizSession({ quiz, subset, fromQueue });
  }

  function handleQuizComplete(attempt: QuizAttempt) {
    const updated = saveAttempt(attempt);
    setAttempts(updated);
  }

  function handleToggleEnroll(quizId: string) {
    setEnrolledIds((prev) => toggleQuizEnrollment(quizId, prev));
  }

  function handleResetQuizStats(quizId: string) {
    const updated = clearAttemptsForQuiz(quizId);
    setAttempts(updated);
  }

  async function publishOrSaveGlobalConfig(nextConfig: GlobalSiteConfig) {
    setGlobalConfig(nextConfig);
    saveCachedGlobalConfig(nextConfig);
    if (loadOwnerGithubToken()) {
      const res = await syncGlobalConfigToGitHub(nextConfig);
      if (res.ok) {
        setSyncStatusMsg('Synced to GitHub (live for all visitors)');
      } else {
        setSyncStatusMsg(`Saved locally (${res.message})`);
      }
      setTimeout(() => setSyncStatusMsg(null), 3500);
    }
  }

  function handleToggleVerified(quizId: string) {
    if (!isOwnerMode) return;
    const exists = globalConfig.verifiedQuizIds.includes(quizId);
    const nextVerified = exists
      ? globalConfig.verifiedQuizIds.filter((id) => id !== quizId)
      : [...globalConfig.verifiedQuizIds, quizId];
    const nextConfig: GlobalSiteConfig = {
      ...globalConfig,
      verifiedQuizIds: nextVerified,
    };
    publishOrSaveGlobalConfig(nextConfig);
  }

  function handleSaveGlobalMegaDefaultOverrides(
    megaQuizId: string,
    overrides: Record<string, string>
  ) {
    if (!isOwnerMode) return;
    const nextConfig: GlobalSiteConfig = {
      ...globalConfig,
      megaQuizDefaultOverrides: {
        ...globalConfig.megaQuizDefaultOverrides,
        [megaQuizId]: overrides,
      },
    };
    publishOrSaveGlobalConfig(nextConfig);
  }

  const filteredExploreQuizzes = useMemo(() => {
    const q = indexSearch.trim().toLowerCase();
    return allQuizzes.filter((quiz) => {
      if (selectedCategory !== 'all' && quiz.category !== selectedCategory) return false;
      if (selectedTag && !quiz.tags.includes(selectedTag)) return false;
      if (verifiedFilter === 'verified' && !quiz.verified) return false;
      if (verifiedFilter === 'unverified' && quiz.verified) return false;
      if (q) {
        const matchesTitle = quiz.title.toLowerCase().includes(q);
        const matchesCountry = quiz.countryOrRegion.toLowerCase().includes(q);
        const matchesTag = quiz.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchesTitle && !matchesCountry && !matchesTag) return false;
      }
      return true;
    });
  }, [allQuizzes, selectedCategory, selectedTag, verifiedFilter, indexSearch]);

  return (
    <div className="min-h-dvh flex flex-col bg-slate-950 text-slate-100 font-mono">
      {/* Compact Header */}
      <header className="h-14 border-b border-slate-800 bg-slate-900 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-40">
        <div
          onClick={() => setActiveQuizSession(null)}
          className="flex items-center gap-2 cursor-pointer shrink-0"
        >
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Globe className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-xs sm:text-base tracking-tight text-white">
            GEO_INDEX
          </span>
          {syncStatusMsg && (
            <span className="hidden md:inline-block px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300">
              {syncStatusMsg}
            </span>
          )}
        </div>

        <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto">
          <button
            onClick={() => {
              setActiveQuizSession(null);
              setActiveTab('explore');
            }}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer shrink-0 ${
              !activeQuizSession && activeTab === 'explore'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Compass className="w-3.5 h-3.5 shrink-0" />
            <span>INDEX [{allQuizzes.length}]</span>
          </button>

          <button
            onClick={() => {
              setActiveQuizSession(null);
              setActiveTab('revision');
            }}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer shrink-0 ${
              !activeQuizSession && activeTab === 'revision'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Brain className="w-3.5 h-3.5 shrink-0" />
            <span>
              <span className="hidden xs:inline">REVISION </span>
              <span className="xs:hidden">REV </span>[
              {scopedRevisionQueue.length}
              {selectedQueueTags.length > 0 ? `/${revisionQueue.length}` : ''}]
            </span>
          </button>

          <button
            onClick={() => setShowOwnerModal((v) => !v)}
            title="Owner Data Verification & Global Defaults Control"
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer shrink-0 ${
              isOwnerMode
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {isOwnerMode ? (
              <>
                <Unlock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">OWNER</span>
              </>
            ) : (
              <Lock className="w-3.5 h-3.5" />
            )}
          </button>
        </nav>
      </header>

      {/* Owner Verification & Global Sync Modal */}
      {showOwnerModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 font-bold text-white text-sm">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                OWNER VERIFICATION CONTROLS
              </div>
              <button
                onClick={() => setShowOwnerModal(false)}
                className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                CLOSE
              </button>
            </div>

            <p className="text-slate-400 leading-relaxed">
              When <strong>Owner Mode</strong> is enabled on your browser, you can click any{' '}
              <span className="text-amber-300 font-bold">UNVERIFIED DATA</span> badge to mark a
              quiz as <span className="text-emerald-300 font-bold">VERIFIED DATA</span>, or set
              global default sub-quizzes on Mega Quizzes.
            </p>

            <div className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div>
                <div className="font-bold text-white">OWNER EDITING MODE</div>
                <div className="text-[11px] text-slate-500">
                  Allows toggling Verified Data badges across the site
                </div>
              </div>
              <button
                onClick={() => {
                  const next = !isOwnerMode;
                  setIsOwnerMode(next);
                  saveOwnerUnlocked(next);
                }}
                className={`px-3 py-1.5 rounded font-bold cursor-pointer ${
                  isOwnerMode
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {isOwnerMode ? 'ENABLED' : 'ENABLE OWNER MODE'}
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-300">
                GitHub Personal Access Token (Optional — for instant live publishing to all users)
              </label>
              <input
                type="password"
                value={ownerTokenInput}
                onChange={(e) => {
                  setOwnerTokenInput(e.target.value);
                  saveOwnerGithubToken(e.target.value);
                }}
                placeholder="ghp_... or github_pat_..."
                className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-white outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-500">
                If provided, clicking Verify automatically commits{' '}
                <code>public/data/global-config.json</code> to your GitHub repo so every visitor
                sees your verification immediately.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">
        {activeQuizSession ? (
          <QuizPlayer
            key={`${activeQuizSession.quiz.id}-${
              activeQuizSession.subset ? activeQuizSession.subset.join(',') : 'all'
            }`}
            quiz={
              allQuizzes.find((q) => q.id === activeQuizSession.quiz.id) ||
              activeQuizSession.quiz
            }
            allQuizzes={allQuizzes}
            practiceSubset={activeQuizSession.subset}
            verifiedIds={verifiedIds}
            isOwnerMode={isOwnerMode}
            onToggleVerified={handleToggleVerified}
            globalMegaDefaultOverrides={
              globalConfig.megaQuizDefaultOverrides[activeQuizSession.quiz.id] || {}
            }
            onSaveGlobalMegaDefaultOverrides={handleSaveGlobalMegaDefaultOverrides}
            onComplete={handleQuizComplete}
            onExit={() => setActiveQuizSession(null)}
            onNextInRevisionQueue={
              activeQuizSession.fromQueue && scopedRevisionQueue.length > 0
                ? () => {
                    const nextTop = scopedRevisionQueue[0];
                    if (nextTop) {
                      setActiveQuizSession({
                        quiz: nextTop.quiz,
                        subset: null,
                        fromQueue: true,
                      });
                    }
                  }
                : undefined
            }
          />
        ) : activeTab === 'revision' ? (
          <RevisionTab
            queue={revisionQueue}
            unenrolledQuizzes={unenrolledQuizzes}
            selectedQueueTags={selectedQueueTags}
            verifiedIds={verifiedIds}
            isOwnerMode={isOwnerMode}
            onToggleVerified={handleToggleVerified}
            onToggleQueueTag={handleToggleQueueTag}
            onClearQueueTags={() => setSelectedQueueTags([])}
            onStartQuiz={handleStartQuiz}
            onToggleEnroll={handleToggleEnroll}
            onSimulateDaysOffset={setSimulatedDaysOffset}
            simulatedDaysOffset={simulatedDaysOffset}
            onResetQuizStats={handleResetQuizStats}
            nowTimestamp={simulatedNow}
          />
        ) : (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
            {/* Technical Category, LIST/MAP Toggle, Search, Verification Filter & Tag Filter Bar */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(
                    [
                      { id: 'all', label: `All (${allQuizzes.length})` },
                      { id: 'subdivisions', label: '1st-Level Divisions' },
                      { id: 'niche-subdivisions', label: '2nd & 3rd Level' },
                      { id: 'cities', label: 'Cities' },
                      { id: 'flags', label: 'Flags' },
                      { id: 'landscapes', label: 'Landscapes & Rivers' },
                      { id: 'special', label: 'Special' },
                      { id: 'mega', label: 'Mega Quizzes' },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                        selectedCategory === cat.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Verified / Unverified Filter */}
                  <div className="inline-flex rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px] shrink-0">
                    {(
                      [
                        { id: 'all', label: 'All Data' },
                        { id: 'verified', label: 'Verified' },
                        { id: 'unverified', label: 'Unverified' },
                      ] as const
                    ).map((vf) => (
                      <button
                        key={vf.id}
                        onClick={() => setVerifiedFilter(vf.id)}
                        className={`px-2 py-1 rounded font-bold transition cursor-pointer ${
                          verifiedFilter === vf.id
                            ? vf.id === 'verified'
                              ? 'bg-emerald-600 text-white'
                              : vf.id === 'unverified'
                              ? 'bg-amber-600 text-white'
                              : 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {vf.label}
                      </button>
                    ))}
                  </div>

                  {/* List vs Map View Toggle */}
                  <div className="inline-flex rounded bg-slate-950 p-0.5 border border-slate-800 text-xs shrink-0">
                    <button
                      onClick={() => setIndexViewFormat('list')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-bold transition cursor-pointer ${
                        indexViewFormat === 'list'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <List className="w-3.5 h-3.5" />
                      List
                    </button>
                    <button
                      onClick={() => setIndexViewFormat('map')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-bold transition cursor-pointer ${
                        indexViewFormat === 'map'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <MapIcon className="w-3.5 h-3.5" />
                      Map
                    </button>
                  </div>

                  <div className="relative w-full md:w-60">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={indexSearch}
                      onChange={(e) => setIndexSearch(e.target.value)}
                      placeholder="Filter country, state, LGA, tag..."
                      className="w-full pl-8 pr-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-base sm:text-xs text-white outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Structural Tag Pills */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/80">
                <span className="text-[11px] text-slate-500">Tag Filter:</span>
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                    selectedTag === null
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-950 text-slate-400 border border-slate-800'
                  }`}
                >
                  All
                </button>
                {PRIMARY_TYPE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                      selectedTag === tag
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {indexViewFormat === 'map' ? (
              <IndexMapView
                quizzes={filteredExploreQuizzes}
                attempts={attempts}
                enrolledIds={enrolledIds}
                verifiedIds={verifiedIds}
                isOwnerMode={isOwnerMode}
                onToggleVerified={handleToggleVerified}
                onStartQuiz={(q) => handleStartQuiz(q, null, false)}
                onToggleEnroll={handleToggleEnroll}
              />
            ) : (
              /* Compact Technical Index Table */
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800">
                <div className="px-4 py-2 bg-slate-950/60 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>MATCHING QUIZZES: {filteredExploreQuizzes.length}</span>
                  <span>CLICK TAG TO FILTER</span>
                </div>

                {filteredExploreQuizzes.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    0 quizzes match current filter.
                  </div>
                ) : (
                  filteredExploreQuizzes.map((quiz) => {
                    const stats = computeQuizStats(quiz.id, attempts);
                    const isEnrolled = enrolledIds.includes(quiz.id);
                    const flagIconUrl = getQuizFlagIconUrl(quiz);
                    const isVerified = Boolean(quiz.verified);

                    return (
                      <div
                        key={quiz.id}
                        className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/30 transition"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {flagIconUrl && (
                              <img
                                src={flagIconUrl}
                                alt=""
                                className="w-5 h-3.5 object-cover rounded-[2px] border border-slate-700 shrink-0"
                                loading="lazy"
                              />
                            )}
                            <span className="text-sm font-bold text-white">{quiz.title}</span>
                            <span className="text-xs text-slate-400">[{quiz.totalItems}]</span>
                            <span
                              onClick={
                                isOwnerMode ? () => handleToggleVerified(quiz.id) : undefined
                              }
                              title={
                                isOwnerMode
                                  ? 'Click to toggle Verified Data status'
                                  : isVerified
                                  ? 'Human-verified dataset'
                                  : 'Unverified automated dataset'
                              }
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${
                                isOwnerMode ? 'cursor-pointer hover:opacity-80' : ''
                              } ${
                                isVerified
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold'
                                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                              }`}
                            >
                              {isVerified ? (
                                <>
                                  <ShieldCheck className="w-3 h-3" />
                                  Verified Data
                                </>
                              ) : (
                                <>
                                  <ShieldAlert className="w-3 h-3" />
                                  Unverified Data
                                </>
                              )}
                            </span>
                            {quiz.tags.map((t) => (
                              <button
                                key={t}
                                onClick={() => setSelectedTag(selectedTag === t ? null : t)}
                                className={`px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${
                                  selectedTag === t
                                    ? 'bg-indigo-600 border-indigo-400 text-white'
                                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span>
                              100%×:{' '}
                              <strong className="text-emerald-400">{stats.perfectCount}</strong>
                            </span>
                            <span>
                              BEST:{' '}
                              <strong className="text-indigo-300">
                                {stats.bestScorePercent !== null
                                  ? `${stats.bestScorePercent}%`
                                  : '—'}
                              </strong>
                            </span>
                            <span>
                              LAST:{' '}
                              <strong className="text-slate-300">
                                {stats.lastScorePercent !== null
                                  ? `${stats.lastScorePercent}%`
                                  : '—'}
                              </strong>
                            </span>
                            <span>
                              RUNS: <strong className="text-slate-300">{stats.attemptsCount}</strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleToggleEnroll(quiz.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold border transition cursor-pointer ${
                              isEnrolled
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-rose-500/15 hover:border-rose-500/30 hover:text-rose-300'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {isEnrolled ? (
                              <>
                                <MinusCircle className="w-3.5 h-3.5" />
                                IN QUEUE
                              </>
                            ) : (
                              <>
                                <PlusCircle className="w-3.5 h-3.5" />
                                + QUEUE
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleStartQuiz(quiz, null, false)}
                            className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            PLAY
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

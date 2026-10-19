import { useMemo, useState } from 'react';
import {
  Brain,
  Compass,
  FolderPlus,
  Globe,
  List,
  Map as MapIcon,
  MinusCircle,
  Play,
  PlusCircle,
  Search,
} from 'lucide-react';
import { BUILT_IN_QUIZZES } from './data/quizzes';
import type { QuizAttempt, QuizCategory, QuizConfig } from './types/quiz';
import { buildRevisionQueue, computeQuizStats } from './utils/revisionAlgorithm';
import {
  clearAttemptsForQuiz,
  deleteCustomQuiz,
  loadAttempts,
  loadCustomQuizzesMeta,
  loadEnrolledQuizIds,
  overwriteAttempts,
  saveAttempt,
  saveEnrolledQuizIds,
  toggleQuizEnrollment,
} from './utils/storage';
import { getQuizFlagIconUrl } from './utils/flagIcons';
import { QuizPlayer } from './components/QuizPlayer';
import { RevisionTab } from './components/RevisionTab';
import { QuizBuilderTab } from './components/QuizBuilderTab';
import { IndexMapView } from './components/IndexMapView';

type ActiveTab = 'revision' | 'explore' | 'builder';

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
  'RIVERS',
  'special',
];

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('revision');
  const [indexViewFormat, setIndexViewFormat] = useState<'list' | 'map'>('list');

  const [attempts, setAttempts] = useState<QuizAttempt[]>(() => loadAttempts());
  const [customQuizzes, setCustomQuizzes] = useState<QuizConfig[]>(() =>
    loadCustomQuizzesMeta()
  );
  const [enrolledIds, setEnrolledIds] = useState<string[]>(() =>
    loadEnrolledQuizIds(['uga-adm2-central', 'aus-adm1', 'aus-cities-100k', 'aus-state-flags'])
  );
  const [selectedQueueTags, setSelectedQueueTags] = useState<string[]>([]);
  const [simulatedDaysOffset, setSimulatedDaysOffset] = useState(0);

  const [activeQuizSession, setActiveQuizSession] = useState<{
    quiz: QuizConfig;
    subset?: string[] | null;
    fromQueue?: boolean;
  } | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<QuizCategory | 'all'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [indexSearch, setIndexSearch] = useState('');

  const allQuizzes = useMemo(
    () => [...BUILT_IN_QUIZZES, ...customQuizzes],
    [customQuizzes]
  );

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

  async function handleDeleteCustomQuiz(quizId: string) {
    const updatedCustom = await deleteCustomQuiz(quizId);
    setCustomQuizzes(updatedCustom);
    const updatedAttempts = clearAttemptsForQuiz(quizId);
    setAttempts(updatedAttempts);
    setEnrolledIds((prev) => saveEnrolledQuizIds(prev.filter((id) => id !== quizId)));
  }

  function handleImportBackup(
    importedAttempts: QuizAttempt[],
    importedCustom: QuizConfig[],
    importedEnrolledIds?: string[]
  ) {
    overwriteAttempts(importedAttempts);
    setAttempts(importedAttempts);
    if (importedCustom.length > 0) {
      setCustomQuizzes(importedCustom);
    }
    if (Array.isArray(importedEnrolledIds)) {
      setEnrolledIds(saveEnrolledQuizIds(importedEnrolledIds));
    }
  }

  const filteredExploreQuizzes = useMemo(() => {
    const q = indexSearch.trim().toLowerCase();
    return allQuizzes.filter((quiz) => {
      if (selectedCategory !== 'all' && quiz.category !== selectedCategory) return false;
      if (selectedTag && !quiz.tags.includes(selectedTag)) return false;
      if (q) {
        const matchesTitle = quiz.title.toLowerCase().includes(q);
        const matchesCountry = quiz.countryOrRegion.toLowerCase().includes(q);
        const matchesTag = quiz.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchesTitle && !matchesCountry && !matchesTag) return false;
      }
      return true;
    });
  }, [allQuizzes, selectedCategory, selectedTag, indexSearch]);

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
        </div>

        <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto">
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
              setActiveTab('builder');
            }}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer shrink-0 ${
              !activeQuizSession && activeTab === 'builder'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">IMPORT / IO</span>
            <span className="sm:hidden">IO</span>
          </button>
        </nav>
      </header>

      <main className="flex-1">
        {activeQuizSession ? (
          <QuizPlayer
            key={`${activeQuizSession.quiz.id}-${
              activeQuizSession.subset ? activeQuizSession.subset.join(',') : 'all'
            }`}
            quiz={activeQuizSession.quiz}
            practiceSubset={activeQuizSession.subset}
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
            onToggleQueueTag={handleToggleQueueTag}
            onClearQueueTags={() => setSelectedQueueTags([])}
            onStartQuiz={handleStartQuiz}
            onToggleEnroll={handleToggleEnroll}
            onSimulateDaysOffset={setSimulatedDaysOffset}
            simulatedDaysOffset={simulatedDaysOffset}
            onResetQuizStats={handleResetQuizStats}
            nowTimestamp={simulatedNow}
          />
        ) : activeTab === 'explore' ? (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
            {/* Technical Category, LIST/MAP Toggle, Search & Tag Filter Bar */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(
                    [
                      { id: 'all', label: `ALL (${allQuizzes.length})` },
                      { id: 'subdivisions', label: '1ST-LEVEL DIVISIONS' },
                      { id: 'niche-subdivisions', label: '2ND / 3RD-LEVEL NICHE' },
                      { id: 'cities', label: 'CITIES' },
                      { id: 'flags', label: 'FLAGS' },
                      { id: 'landscapes', label: 'LANDSCAPES / RIVERS' },
                      { id: 'special', label: 'SPECIAL' },
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

                <div className="flex items-center gap-2">
                  {/* LIST vs MAP View Toggle */}
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
                      LIST
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
                      MAP
                    </button>
                  </div>

                  <div className="relative w-full md:w-64">
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
                <span className="text-[11px] text-slate-500">TYPE_TAG:</span>
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                    selectedTag === null
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-950 text-slate-400 border border-slate-800'
                  }`}
                >
                  ALL
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
        ) : (
          <QuizBuilderTab
            customQuizzes={customQuizzes}
            attempts={attempts}
            enrolledIds={enrolledIds}
            onQuizCreated={(updated, newId, enrollImmediately) => {
              setCustomQuizzes(updated);
              if (enrollImmediately) {
                setEnrolledIds((prev) => saveEnrolledQuizIds([...prev, newId]));
              }
            }}
            onDeleteCustomQuiz={handleDeleteCustomQuiz}
            onImportBackup={handleImportBackup}
          />
        )}
      </main>
    </div>
  );
}

export default App;

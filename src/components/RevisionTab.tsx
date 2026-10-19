import { useMemo, useState } from 'react';
import {
  Filter,
  MinusCircle,
  Play,
  PlusCircle,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import type {
  QuizCategory,
  QuizConfig,
  QuizRevisionStats,
  RevisionQueueItem,
} from '../types/quiz';
import { formatTimeAgo } from '../utils/revisionAlgorithm';
import { getQuizFlagIconUrl } from '../utils/flagIcons';
import {
  CATEGORY_ORDER,
  categoryLabel,
  cleanQuizTitle,
  quizMeta,
} from '../utils/quizDisplay';

interface RevisionTabProps {
  queue: RevisionQueueItem[];
  unenrolledQuizzes: QuizConfig[];
  onStartQuiz: (
    quiz: QuizConfig,
    subset?: string[] | null,
    fromQueue?: boolean
  ) => void;
  onToggleEnroll: (quizId: string) => void;
  onResetQuizStats: (quizId: string) => void;
  onGoToLibrary: () => void;
  nowTimestamp: number;
}

function missedItems(stats: QuizRevisionStats): string[] {
  return Object.entries(stats.missedFrequency)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function lastPlayedLabel(stats: QuizRevisionStats, nowTimestamp: number): string {
  if (stats.lastPlayedAt === null) return 'NEVER';
  return formatTimeAgo(Math.max(0, nowTimestamp - stats.lastPlayedAt));
}

const scopeChipClass = (active: boolean) =>
  `px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
    active
      ? 'bg-accent-600 text-white border border-accent-400'
      : 'bg-ink-950 border border-ink-800 text-ink-400 hover:text-ink-200'
  }`;

export function RevisionTab({
  queue,
  unenrolledQuizzes,
  onStartQuiz,
  onToggleEnroll,
  onResetQuizStats,
  onGoToLibrary,
  nowTimestamp,
}: RevisionTabProps) {
  const [poolSearch, setPoolSearch] = useState('');
  const [category, setCategory] = useState<QuizCategory | 'all'>('all');

  const queueCategories = useMemo(() => {
    const present = new Set(queue.map((item) => item.quiz.category));
    return CATEGORY_ORDER.filter((option) => present.has(option));
  }, [queue]);

  const filteredQueue = useMemo(() => {
    if (category === 'all') return queue;
    return queue.filter((item) => item.quiz.category === category);
  }, [queue, category]);

  const topItem = filteredQueue[0] ?? null;
  const topMissed = topItem ? missedItems(topItem.stats) : [];

  const poolResults = useMemo(() => {
    const query = poolSearch.trim().toLowerCase();
    const matches = query
      ? unenrolledQuizzes.filter(
          (quiz) =>
            cleanQuizTitle(quiz.title).toLowerCase().includes(query) ||
            quiz.countryOrRegion.toLowerCase().includes(query) ||
            categoryLabel(quiz.category).toLowerCase().includes(query)
        )
      : unenrolledQuizzes;

    return [...matches]
      .sort((a, b) =>
        cleanQuizTitle(a.title).localeCompare(cleanQuizTitle(b.title), undefined, {
          sensitivity: 'base',
        })
      )
      .slice(0, 30);
  }, [unenrolledQuizzes, poolSearch]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-5 font-mono">
      {/* Queue scope selector */}
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs text-ink-400 mr-1">
            <Filter className="w-3.5 h-3.5 text-accent-400" />
            QUEUE SCOPE:
          </span>

          <button
            type="button"
            onClick={() => setCategory('all')}
            aria-pressed={category === 'all'}
            className={scopeChipClass(category === 'all')}
          >
            ALL ENROLLED [{queue.length}]
          </button>

          {queueCategories.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              aria-pressed={category === option}
              className={scopeChipClass(category === option)}
            >
              {categoryLabel(option).toUpperCase()} (
              {queue.filter((item) => item.quiz.category === option).length})
            </button>
          ))}
        </div>

        <p className="text-[11px] text-ink-500 shrink-0">
          {filteredQueue.length} OF {queue.length} ENROLLED
        </p>
      </div>

      {/* Top #1 next revision banner */}
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {topItem ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-1">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-ink-400 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-accent-500/20 text-accent-300 border border-accent-500/30 font-bold">
                  QUEUE #1
                </span>
                <span>
                  LAST:{' '}
                  {topItem.stats.lastScorePercent !== null
                    ? `${topItem.stats.lastScorePercent}% (${lastPlayedLabel(
                        topItem.stats,
                        nowTimestamp
                      )})`
                    : 'NEVER'}
                </span>
                <span>•</span>
                <span>PERFECT RUNS: {topItem.stats.perfectCount}</span>
                {category !== 'all' ? (
                  <span className="text-accent-400">
                    [FILTER: {categoryLabel(category).toUpperCase()}]
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2.5">
                {getQuizFlagIconUrl(topItem.quiz) ? (
                  <img
                    src={getQuizFlagIconUrl(topItem.quiz)!}
                    alt=""
                    className="w-6 h-4 object-cover rounded-[2px] border border-ink-700 shrink-0"
                  />
                ) : null}
                <h2 className="text-lg sm:text-xl font-bold text-white">
                  {cleanQuizTitle(topItem.quiz.title)}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {topMissed.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onStartQuiz(topItem.quiz, topMissed, false)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-bold transition cursor-pointer"
                >
                  MISSED ({topMissed.length})
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onStartQuiz(topItem.quiz, null, true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-500 text-white font-bold text-xs transition cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                PLAY #1
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-ink-400">
            {queue.length === 0 ? (
              <>
                No quizzes enrolled in the revision queue. Add quizzes from the pool
                below or the{' '}
                <button
                  type="button"
                  onClick={onGoToLibrary}
                  className="text-accent-400 underline hover:text-accent-300"
                >
                  LIBRARY
                </button>
                .
              </>
            ) : (
              'No enrolled quizzes match the currently selected filter.'
            )}
          </div>
        )}
      </div>

      {/* Active revision queue */}
      <div className="bg-ink-900 border border-ink-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-ink-800 flex items-center justify-between text-xs text-ink-400">
          <span>
            ACTIVE REVISION QUEUE ({filteredQueue.length}
            {category !== 'all' ? ` / ${queue.length} enrolled` : ''})
          </span>
          <span className="text-[11px] text-ink-500">
            Ordered by what to practise next
          </span>
        </div>

        {filteredQueue.length === 0 ? (
          <div className="p-6 text-center text-xs text-ink-500">
            0 quizzes in current queue scope.
          </div>
        ) : (
          <div className="divide-y divide-ink-800/80">
            {filteredQueue.map((item, index) => {
              const { quiz, stats } = item;
              const flagIconUrl = getQuizFlagIconUrl(quiz);
              const missed = missedItems(stats);

              return (
                <div
                  key={quiz.id}
                  className="px-4 py-3 hover:bg-ink-800/30 transition flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-ink-400 w-6">
                        #{index + 1}
                      </span>
                      {flagIconUrl ? (
                        <img
                          src={flagIconUrl}
                          alt=""
                          className="w-5 h-3.5 object-cover rounded-[2px] border border-ink-700 shrink-0"
                          loading="lazy"
                        />
                      ) : null}
                      <span className="text-sm font-bold text-white">
                        {cleanQuizTitle(quiz.title)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCategory(quiz.category)}
                        className={`px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${
                          category === quiz.category
                            ? 'bg-accent-600/30 border-accent-400 text-accent-200'
                            : 'bg-ink-950 border-ink-800 text-ink-400 hover:text-ink-200'
                        }`}
                      >
                        {categoryLabel(quiz.category).toUpperCase()}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-400 pl-8">
                      <span>
                        LAST:{' '}
                        <strong
                          className={
                            stats.lastScorePercent === 100
                              ? 'text-emerald-400'
                              : stats.lastScorePercent !== null
                              ? 'text-amber-400'
                              : 'text-ink-500'
                          }
                        >
                          {stats.lastScorePercent !== null
                            ? `${stats.lastScorePercent}%`
                            : '—'}
                        </strong>
                      </span>
                      <span>
                        ELAPSED:{' '}
                        <strong className="text-ink-200">
                          {lastPlayedLabel(stats, nowTimestamp)}
                        </strong>
                      </span>
                      <span>
                        PERFECT RUNS:{' '}
                        <strong className="text-accent-400">
                          {stats.perfectCount}
                        </strong>{' '}
                        <span className="text-ink-500">
                          / {stats.attemptsCount} RUNS
                        </span>
                      </span>
                    </div>

                    {missed.length > 0 ? (
                      <div className="flex items-center gap-1.5 flex-wrap pl-8 pt-0.5">
                        <span className="text-[11px] text-rose-400">
                          TROUBLE SPOTS:
                        </span>
                        {missed.slice(0, 4).map((name) => (
                          <span
                            key={name}
                            className="px-1.5 py-0.2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5 pl-8 lg:pl-0 shrink-0">
                    {missed.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => onStartQuiz(quiz, missed, false)}
                        className="px-2.5 py-1.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs transition cursor-pointer"
                        title="Drill missed items only"
                      >
                        MISSED [{missed.length}]
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onStartQuiz(quiz, null, true)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-accent-600 hover:bg-accent-500 text-white text-xs font-bold transition cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      PLAY
                    </button>
                    {stats.attemptsCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => onResetQuizStats(quiz.id)}
                        title="Reset stats for this quiz"
                        className="p-1.5 rounded bg-ink-800/60 hover:bg-ink-800 text-ink-400 hover:text-rose-400 transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onToggleEnroll(quiz.id)}
                      title="Remove from Revision Queue"
                      className="p-1.5 rounded bg-ink-800/60 hover:bg-ink-800 text-ink-400 hover:text-amber-400 transition cursor-pointer"
                    >
                      <MinusCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Unenrolled quizzes pool with search */}
      <div className="bg-ink-900/60 border border-ink-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-ink-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-ink-400">
          <span>ADD TO REVISION QUEUE ({unenrolledQuizzes.length} available)</span>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-ink-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={poolSearch}
              onChange={(event) => setPoolSearch(event.target.value)}
              placeholder="Search country, title, region..."
              aria-label="Search unqueued quizzes"
              className="w-full pl-8 pr-8 py-1 rounded bg-ink-950 border border-ink-800 text-xs text-white outline-none focus:border-accent-500"
            />
            {poolSearch ? (
              <button
                type="button"
                onClick={() => setPoolSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            ) : null}
          </div>
        </div>

        {poolResults.length === 0 ? (
          <div className="p-4 text-xs text-ink-500 text-center">
            {unenrolledQuizzes.length === 0
              ? 'Everything in the library is already in your queue.'
              : 'No matching unenrolled quizzes.'}
          </div>
        ) : (
          <div className="divide-y divide-ink-800/60 max-h-96 overflow-y-auto">
            {poolResults.map((quiz) => {
              const flagIconUrl = getQuizFlagIconUrl(quiz);

              return (
                <div
                  key={quiz.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-ink-900/80 transition"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {flagIconUrl ? (
                      <img
                        src={flagIconUrl}
                        alt=""
                        className="w-5 h-3.5 object-cover rounded-[2px] border border-ink-700 shrink-0"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="text-xs font-bold text-ink-200">
                      {cleanQuizTitle(quiz.title)}
                    </span>
                    <span className="text-[11px] text-ink-500">
                      {quizMeta(quiz)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartQuiz(quiz, null, false)}
                      className="px-2.5 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-300 text-xs cursor-pointer"
                    >
                      PLAY
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleEnroll(quiz.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      QUEUE
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import {
  Clock,
  Filter,
  MinusCircle,
  Play,
  PlusCircle,
  RotateCcw,
  Search,
} from 'lucide-react';
import type { QuizConfig, RevisionQueueItem } from '../types/quiz';
import { formatTimeAgo } from '../utils/revisionAlgorithm';
import { getQuizFlagIconUrl } from '../utils/flagIcons';

interface RevisionTabProps {
  queue: RevisionQueueItem[];
  unenrolledQuizzes: QuizConfig[];
  selectedQueueTags: string[];
  onToggleQueueTag: (tag: string) => void;
  onClearQueueTags: () => void;
  onStartQuiz: (
    quiz: QuizConfig,
    subset?: string[] | null,
    fromQueue?: boolean
  ) => void;
  onToggleEnroll: (quizId: string) => void;
  onSimulateDaysOffset: (daysOffset: number) => void;
  simulatedDaysOffset: number;
  onResetQuizStats: (quizId: string) => void;
  nowTimestamp: number;
}

export const RevisionTab: React.FC<RevisionTabProps> = ({
  queue,
  unenrolledQuizzes,
  selectedQueueTags,
  onToggleQueueTag,
  onClearQueueTags,
  onStartQuiz,
  onToggleEnroll,
  onSimulateDaysOffset,
  simulatedDaysOffset,
  onResetQuizStats,
  nowTimestamp,
}) => {
  const [poolSearch, setPoolSearch] = useState('');

  const enrolledAvailableTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of queue) {
      for (const t of item.quiz.tags) {
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [queue]);

  const activeFilteredQueue = useMemo(() => {
    if (selectedQueueTags.length === 0) return queue;
    const tagSet = new Set(selectedQueueTags);
    return queue.filter((item) => item.quiz.tags.some((t) => tagSet.has(t)));
  }, [queue, selectedQueueTags]);

  const topQuiz = activeFilteredQueue[0] || null;
  const topQuizFlagUrl = topQuiz ? getQuizFlagIconUrl(topQuiz.quiz) : null;

  const filteredUnenrolledPool = useMemo(() => {
    const q = poolSearch.trim().toLowerCase();
    if (!q) return unenrolledQuizzes.slice(0, 30);
    return unenrolledQuizzes
      .filter(
        (quiz) =>
          quiz.title.toLowerCase().includes(q) ||
          quiz.countryOrRegion.toLowerCase().includes(q) ||
          quiz.tags.some((t) => t.toLowerCase().includes(q))
      )
      .slice(0, 40);
  }, [unenrolledQuizzes, poolSearch]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-5 font-mono">
      {/* Queue Tag Scope Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs text-slate-400 mr-1">
            <Filter className="w-3.5 h-3.5 text-indigo-400" />
            QUEUE_TAG_SCOPE:
          </span>

          <button
            onClick={onClearQueueTags}
            className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
              selectedQueueTags.length === 0
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            ALL ENROLLED [{queue.length}]
          </button>

          {enrolledAvailableTags.map(([tag, count]) => {
            const active = selectedQueueTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => onToggleQueueTag(tag)}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white border border-indigo-400'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {tag} ({count})
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1 text-xs shrink-0">
          <Clock className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-slate-400">OFFSET:</span>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={simulatedDaysOffset}
            onChange={(e) => onSimulateDaysOffset(Number(e.target.value))}
            className="w-20 accent-indigo-500 cursor-pointer"
          />
          <span className="font-bold text-indigo-300 min-w-[38px]">+{simulatedDaysOffset}d</span>
          {simulatedDaysOffset > 0 && (
            <button
              onClick={() => onSimulateDaysOffset(0)}
              className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              0d
            </button>
          )}
        </div>
      </div>

      {/* Top #1 Next Revision Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {topQuiz ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-1">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold">
                  QUEUE #1
                </span>
                <span>WEIGHT: {topQuiz.priorityScore.toFixed(2)}</span>
                <span>•</span>
                <span>
                  LAST:{' '}
                  {topQuiz.stats.lastScorePercent !== null
                    ? `${topQuiz.stats.lastScorePercent}% (${formatTimeAgo(
                        Math.max(0, nowTimestamp - (topQuiz.stats.lastPlayedAt || nowTimestamp))
                      )})`
                    : 'NEVER'}
                </span>
                <span>•</span>
                <span>100% RUNS: {topQuiz.stats.perfectCount}</span>
                {selectedQueueTags.length > 0 && (
                  <span className="text-indigo-400">
                    [FILTER: {selectedQueueTags.join(', ')}]
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5">
                {topQuizFlagUrl && (
                  <img
                    src={topQuizFlagUrl}
                    alt=""
                    className="w-6 h-4 object-cover rounded-[2px] border border-slate-700 shrink-0"
                  />
                )}
                <h2 className="text-lg sm:text-xl font-bold text-white">{topQuiz.quiz.title}</h2>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onStartQuiz(topQuiz.quiz, null, true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                PLAY #1
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400">
            {queue.length === 0
              ? 'No quizzes enrolled in revision queue. Add quizzes from the pool below or the INDEX tab.'
              : 'No enrolled quizzes match the currently selected tag filter.'}
          </div>
        )}
      </div>

      {/* Active Revision Queue Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            ACTIVE REVISION QUEUE ({activeFilteredQueue.length}
            {selectedQueueTags.length > 0 ? ` / ${queue.length} enrolled` : ''})
          </span>
          <span className="text-[11px] text-slate-500">
            Ordered by priority(Δt, last_score, 100%_count)
          </span>
        </div>

        {activeFilteredQueue.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            0 quizzes in current queue scope.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {activeFilteredQueue.map((item, idx) => {
              const { quiz, stats } = item;
              const flagIconUrl = getQuizFlagIconUrl(quiz);
              const elapsedMs =
                stats.lastPlayedAt !== null ? Math.max(0, nowTimestamp - stats.lastPlayedAt) : null;
              const missedList = Object.entries(stats.missedFrequency)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

              return (
                <div
                  key={quiz.id}
                  className="px-4 py-3 hover:bg-slate-800/30 transition flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-400 w-6">#{idx + 1}</span>
                      {flagIconUrl && (
                        <img
                          src={flagIconUrl}
                          alt=""
                          className="w-5 h-3.5 object-cover rounded-[2px] border border-slate-700 shrink-0"
                          loading="lazy"
                        />
                      )}
                      <span className="text-sm font-bold text-white">{quiz.title}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-indigo-300">
                        W: {item.priorityScore.toFixed(2)}
                      </span>
                      {quiz.tags.map((t) => (
                        <button
                          key={t}
                          onClick={() => onToggleQueueTag(t)}
                          className={`px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${
                            selectedQueueTags.includes(t)
                              ? 'bg-indigo-600/30 border-indigo-400 text-indigo-200'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pl-8">
                      <span>
                        LAST:{' '}
                        <strong
                          className={
                            stats.lastScorePercent === 100
                              ? 'text-emerald-400'
                              : stats.lastScorePercent !== null
                              ? 'text-amber-400'
                              : 'text-slate-500'
                          }
                        >
                          {stats.lastScorePercent !== null ? `${stats.lastScorePercent}%` : '—'}
                        </strong>
                      </span>
                      <span>
                        ELAPSED:{' '}
                        <strong className="text-slate-200">
                          {elapsedMs !== null ? formatTimeAgo(elapsedMs) : 'NEVER'}
                        </strong>
                      </span>
                      <span>
                        100%×:{' '}
                        <strong className="text-indigo-400">{stats.perfectCount}</strong>{' '}
                        <span className="text-slate-500">
                          (strk:{stats.consecutivePerfectStreak} / runs:{stats.attemptsCount})
                        </span>
                      </span>
                      {stats.fastestPerfectSeconds !== null && (
                        <span>
                          BEST_100%_T:{' '}
                          <strong className="text-emerald-400">
                            {Math.floor(stats.fastestPerfectSeconds / 60)}m
                            {stats.fastestPerfectSeconds % 60}s
                          </strong>
                        </span>
                      )}
                    </div>

                    {missedList.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pl-8 pt-0.5">
                        <span className="text-[11px] text-rose-400">ERR_FREQ:</span>
                        {missedList.map(([reg, cnt]) => (
                          <span
                            key={reg}
                            className="px-1.5 py-0.2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]"
                          >
                            {reg}:{cnt}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 pl-8 lg:pl-0 shrink-0">
                    <button
                      onClick={() => onStartQuiz(quiz, null, true)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      PLAY
                    </button>
                    {Object.keys(stats.missedFrequency).length > 0 && (
                      <button
                        onClick={() =>
                          onStartQuiz(quiz, Object.keys(stats.missedFrequency), false)
                        }
                        className="px-2.5 py-1.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs transition cursor-pointer"
                        title="Drill missed items only"
                      >
                        DRILL [{Object.keys(stats.missedFrequency).length}]
                      </button>
                    )}
                    {stats.attemptsCount > 0 && (
                      <button
                        onClick={() => onResetQuizStats(quiz.id)}
                        title="Reset stats for this quiz"
                        className="p-1.5 rounded bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onToggleEnroll(quiz.id)}
                      title="Remove from Revision Queue"
                      className="p-1.5 rounded bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition cursor-pointer"
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

      {/* Unenrolled Quizzes Pool with Search */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
          <span>ADD TO REVISION QUEUE ({unenrolledQuizzes.length} available)</span>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={poolSearch}
              onChange={(e) => setPoolSearch(e.target.value)}
              placeholder="Search country, title, tag..."
              className="w-full pl-8 pr-3 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-white outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {filteredUnenrolledPool.length === 0 ? (
          <div className="p-4 text-xs text-slate-500 text-center">
            No matching unenrolled quizzes.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60 max-h-96 overflow-y-auto">
            {filteredUnenrolledPool.map((q) => {
              const flagIconUrl = getQuizFlagIconUrl(q);
              return (
                <div
                  key={q.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-900/80 transition"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {flagIconUrl && (
                      <img
                        src={flagIconUrl}
                        alt=""
                        className="w-5 h-3.5 object-cover rounded-[2px] border border-slate-700 shrink-0"
                        loading="lazy"
                      />
                    )}
                    <span className="text-xs font-bold text-slate-200">{q.title}</span>
                    <span className="text-[11px] text-slate-500">[{q.totalItems}]</span>
                    {q.tags.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-500"
                      >
                        {t}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onStartQuiz(q, null, false)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                    >
                      PLAY
                    </button>
                    <button
                      onClick={() => onToggleEnroll(q.id)}
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
};

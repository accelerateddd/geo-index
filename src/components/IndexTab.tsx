import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Globe2,
  List,
  Map as MapIcon,
  Play,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type {
  QuizAttempt,
  QuizCategory,
  QuizConfig,
  QuizRevisionStats,
} from '../types/quiz';
import { computeQuizStats, formatTimeAgo } from '../utils/revisionAlgorithm';
import { getQuizFlagIconUrl } from '../utils/flagIcons';
import {
  CATEGORY_ORDER,
  categoryLabel,
  cleanQuizTitle,
  quizMeta,
} from '../utils/quizDisplay';
import { Pagination } from './Pagination';
import { IndexMapView } from './IndexMapView';

const PAGE_SIZE = 50;

type SortMode = 'title' | 'recent' | 'size';

interface IndexTabProps {
  quizzes: QuizConfig[];
  attempts: QuizAttempt[];
  enrolledIds: string[];
  nowTimestamp: number;
  onStartQuiz: (quiz: QuizConfig) => void;
  onToggleEnroll: (quizId: string) => void;
}

const selectClass =
  'cursor-pointer max-w-[190px] rounded bg-ink-950 border border-ink-800 px-2 py-1 text-xs text-ink-200 outline-none focus:border-accent-500';

const chipClass = (active: boolean) =>
  `px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
    active
      ? 'bg-accent-600 text-white'
      : 'bg-ink-950 border border-ink-800 text-ink-400 hover:text-ink-200'
  }`;

export function IndexTab({
  quizzes,
  attempts,
  enrolledIds,
  nowTimestamp,
  onStartQuiz,
  onToggleEnroll,
}: IndexTabProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<QuizCategory | 'all'>('all');
  const [region, setRegion] = useState('');
  const [sort, setSort] = useState<SortMode>('title');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);

  const statsById = useMemo(() => {
    const map = new Map<string, QuizRevisionStats>();
    for (const quiz of quizzes) {
      map.set(quiz.id, computeQuizStats(quiz.id, attempts));
    }
    return map;
  }, [quizzes, attempts]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<QuizCategory, number>();
    for (const quiz of quizzes) {
      counts.set(quiz.category, (counts.get(quiz.category) ?? 0) + 1);
    }
    return counts;
  }, [quizzes]);

  const regions = useMemo(
    () =>
      Array.from(new Set(quizzes.map((quiz) => quiz.countryOrRegion))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [quizzes]
  );

  const filteredQuizzes = useMemo(() => {
    const query = search.trim().toLowerCase();

    const result = quizzes.filter((quiz) => {
      if (category !== 'all' && quiz.category !== category) return false;
      if (region && quiz.countryOrRegion !== region) return false;
      if (!query) return true;

      return (
        cleanQuizTitle(quiz.title).toLowerCase().includes(query) ||
        quiz.countryOrRegion.toLowerCase().includes(query) ||
        categoryLabel(quiz.category).toLowerCase().includes(query) ||
        quiz.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });

    const byTitle = (a: QuizConfig, b: QuizConfig) =>
      cleanQuizTitle(a.title).localeCompare(cleanQuizTitle(b.title), undefined, {
        sensitivity: 'base',
      });

    result.sort((a, b) => {
      if (sort === 'size') return b.totalItems - a.totalItems || byTitle(a, b);
      if (sort === 'recent') {
        const aLast = statsById.get(a.id)?.lastPlayedAt ?? 0;
        const bLast = statsById.get(b.id)?.lastPlayedAt ?? 0;
        return bLast - aLast || byTitle(a, b);
      }
      return byTitle(a, b);
    });

    return result;
  }, [quizzes, category, region, search, sort, statsById]);

  const totalPages = Math.max(1, Math.ceil(filteredQuizzes.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageQuizzes = filteredQuizzes.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const hasFilters = search.trim() !== '' || category !== 'all' || region !== '';

  function updateFilter(update: () => void) {
    update();
    setPage(1);
  }

  function clearFilters() {
    setSearch('');
    setCategory('all');
    setRegion('');
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    setPage(nextPage);
    listRef.current?.scrollIntoView({ block: 'start' });
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4 font-mono">
      {/* Filter bar */}
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => updateFilter(() => setCategory('all'))}
              aria-pressed={category === 'all'}
              className={chipClass(category === 'all')}
            >
              ALL ({quizzes.length})
            </button>

            {CATEGORY_ORDER.filter((option) => categoryCounts.has(option)).map(
              (option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => updateFilter(() => setCategory(option))}
                  aria-pressed={category === option}
                  className={chipClass(category === option)}
                >
                  {categoryLabel(option).toUpperCase()} ({categoryCounts.get(option)})
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded bg-ink-950 p-0.5 border border-ink-800 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-bold transition cursor-pointer ${
                  view === 'list'
                    ? 'bg-accent-600 text-white'
                    : 'text-ink-400 hover:text-ink-200'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                LIST
              </button>
              <button
                type="button"
                onClick={() => setView('map')}
                aria-pressed={view === 'map'}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-bold transition cursor-pointer ${
                  view === 'map'
                    ? 'bg-accent-600 text-white'
                    : 'text-ink-400 hover:text-ink-200'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                MAP
              </button>
            </div>

            <div className="relative w-full md:w-64">
              <Search className="w-3.5 h-3.5 text-ink-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(event) =>
                  updateFilter(() => setSearch(event.target.value))
                }
                placeholder="Filter country, region, quiz..."
                aria-label="Search quizzes"
                className="w-full pl-8 pr-8 py-1.5 rounded bg-ink-950 border border-ink-800 text-base sm:text-xs text-white outline-none focus:border-accent-500"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => updateFilter(() => setSearch(''))}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-ink-800/80">
          <span className="text-[11px] text-ink-500">REGION:</span>
          <select
            value={region}
            onChange={(event) => updateFilter(() => setRegion(event.target.value))}
            aria-label="Filter by region"
            className={selectClass}
          >
            <option value="">ALL</option>
            {regions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <span className="text-[11px] text-ink-500 ml-2">SORT:</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as SortMode);
              setPage(1);
            }}
            aria-label="Sort quizzes"
            className={selectClass}
          >
            <option value="title">A–Z</option>
            <option value="recent">RECENTLY PLAYED</option>
            <option value="size">MOST ITEMS</option>
          </select>
        </div>
      </div>

      {view === 'map' ? (
        <IndexMapView
          quizzes={filteredQuizzes}
          attempts={attempts}
          enrolledIds={enrolledIds}
          onStartQuiz={onStartQuiz}
          onToggleEnroll={onToggleEnroll}
        />
      ) : (
        /* Compact index table */
        <div
          ref={listRef}
          className="scroll-mt-20 bg-ink-900 border border-ink-800 rounded-xl overflow-hidden divide-y divide-ink-800"
        >
          <div className="px-4 py-2 bg-ink-950/60 text-[11px] text-ink-500 flex items-center justify-between">
            <span>QUIZZES: {filteredQuizzes.length}</span>
            <span>
              PAGE {currentPage} / {totalPages}
            </span>
          </div>

          {filteredQuizzes.length === 0 ? (
            <div className="p-6 text-center text-xs text-ink-500">
              <p>0 quizzes match current filter.</p>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-2 text-[11px] text-ink-300 underline hover:text-white"
                >
                  CLEAR FILTERS
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <ul>
                {pageQuizzes.map((quiz) => {
                  const stats = statsById.get(quiz.id);
                  const flagIconUrl = getQuizFlagIconUrl(quiz);
                  const isEnrolled = enrolledIds.includes(quiz.id);

                  return (
                    <li
                      key={quiz.id}
                      className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-ink-800/30 transition"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {flagIconUrl ? (
                            <img
                              src={flagIconUrl}
                              alt=""
                              className="w-5 h-3.5 object-cover rounded-[2px] border border-ink-700 shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <span className="flex w-5 h-3.5 shrink-0 items-center justify-center text-ink-600">
                              <Globe2 className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <span className="text-sm font-bold text-white">
                            {cleanQuizTitle(quiz.title)}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-ink-500">
                          <span>{quizMeta(quiz)}</span>
                          {stats && stats.attemptsCount > 0 ? (
                            <span>
                              LAST:{' '}
                              <strong className="text-ink-300">
                                {stats.lastScorePercent}%
                              </strong>
                              {stats.lastPlayedAt !== null
                                ? ` · ${formatTimeAgo(
                                    Math.max(0, nowTimestamp - stats.lastPlayedAt)
                                  )}`
                                : ''}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleEnroll(quiz.id)}
                          aria-label={
                            isEnrolled
                              ? `Remove ${cleanQuizTitle(quiz.title)} from revision queue`
                              : `Add ${cleanQuizTitle(quiz.title)} to revision queue`
                          }
                          title={
                            isEnrolled
                              ? 'Remove from revision queue'
                              : 'Add to revision queue'
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold border transition cursor-pointer ${
                            isEnrolled
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-rose-500/15 hover:border-rose-500/30 hover:text-rose-300'
                              : 'bg-ink-950 border-ink-800 text-ink-400 hover:text-white'
                          }`}
                        >
                          {isEnrolled ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              IN QUEUE
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              + QUEUE
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onStartQuiz(quiz)}
                          className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded bg-accent-600 hover:bg-accent-500 text-white text-xs font-bold transition cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          PLAY
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <Pagination
                page={currentPage}
                pageSize={PAGE_SIZE}
                totalItems={filteredQuizzes.length}
                onPageChange={handlePageChange}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Brain, Compass, FolderPlus, Globe } from 'lucide-react';
import { BUILT_IN_QUIZZES } from './data/quizzes';
import type { QuizAttempt, QuizConfig } from './types/quiz';
import { buildRevisionQueue } from './utils/revisionAlgorithm';
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
import { QuizPlayer } from './components/QuizPlayer';
import { RevisionTab } from './components/RevisionTab';
import { IndexTab } from './components/IndexTab';
import { QuizBuilderTab } from './components/QuizBuilderTab';

type ActiveTab = 'revision' | 'library' | 'create';

const getNow = () => Date.now();

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('revision');

  const [attempts, setAttempts] = useState<QuizAttempt[]>(() => loadAttempts());
  const [customQuizzes, setCustomQuizzes] = useState<QuizConfig[]>(() =>
    loadCustomQuizzesMeta()
  );
  const [enrolledIds, setEnrolledIds] = useState<string[]>(() =>
    loadEnrolledQuizIds([
      'uga-adm2-central',
      'aus-adm1',
      'aus-cities-100k',
      'aus-state-flags',
    ])
  );

  const [nowTimestamp, setNowTimestamp] = useState<number>(getNow);

  const [activeQuizSession, setActiveQuizSession] = useState<{
    quiz: QuizConfig;
    subset?: string[] | null;
    fromQueue?: boolean;
  } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTimestamp(getNow()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const allQuizzes = useMemo(
    () => [...BUILT_IN_QUIZZES, ...customQuizzes],
    [customQuizzes]
  );

  const revisionQueue = useMemo(
    () => buildRevisionQueue(allQuizzes, enrolledIds, attempts, nowTimestamp),
    [allQuizzes, enrolledIds, attempts, nowTimestamp]
  );

  const unenrolledQuizzes = useMemo(() => {
    const enrolledSet = new Set(enrolledIds);
    return allQuizzes.filter((quiz) => !enrolledSet.has(quiz.id));
  }, [allQuizzes, enrolledIds]);

  function openTab(tab: ActiveTab) {
    setActiveQuizSession(null);
    setActiveTab(tab);
    window.scrollTo({ top: 0 });
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
    setNowTimestamp(getNow());
  }

  function handleToggleEnroll(quizId: string) {
    setEnrolledIds((prev) => toggleQuizEnrollment(quizId, prev));
  }

  function handleResetQuizStats(quizId: string) {
    const updated = clearAttemptsForQuiz(quizId);
    setAttempts(updated);
    setNowTimestamp(getNow());
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
    setNowTimestamp(getNow());
  }

  return (
    <div className="min-h-dvh flex flex-col bg-ink-950 text-ink-100 font-mono">
      <header className="h-14 border-b border-ink-800 bg-ink-900 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-40">
        <div
          onClick={() => openTab('revision')}
          className="flex items-center gap-2 cursor-pointer shrink-0"
        >
          <div className="w-7 h-7 rounded-lg bg-accent-600 flex items-center justify-center">
            <Globe className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-xs sm:text-base tracking-tight text-white">
            GEO_INDEX
          </span>
        </div>

        <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto">
          <button
            onClick={() => openTab('revision')}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer shrink-0 ${
              !activeQuizSession && activeTab === 'revision'
                ? 'bg-accent-600 text-white'
                : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800/60'
            }`}
          >
            <Brain className="w-3.5 h-3.5 shrink-0" />
            <span>
              <span className="hidden sm:inline">REVISION</span>
              <span className="sm:hidden">REV</span> [{revisionQueue.length}]
            </span>
          </button>

          <button
            onClick={() => openTab('library')}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer shrink-0 ${
              !activeQuizSession && activeTab === 'library'
                ? 'bg-accent-600 text-white'
                : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800/60'
            }`}
          >
            <Compass className="w-3.5 h-3.5 shrink-0" />
            <span>
              <span className="hidden sm:inline">LIBRARY</span>
              <span className="sm:hidden">LIB</span> [{allQuizzes.length}]
            </span>
          </button>

          <button
            onClick={() => openTab('create')}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer shrink-0 ${
              !activeQuizSession && activeTab === 'create'
                ? 'bg-accent-600 text-white'
                : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800/60'
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">CREATE</span>
            <span className="sm:hidden">NEW</span>
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
              activeQuizSession.fromQueue && revisionQueue.length > 0
                ? () => {
                    const next = revisionQueue[0];
                    if (next) {
                      setActiveQuizSession({
                        quiz: next.quiz,
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
            onStartQuiz={handleStartQuiz}
            onToggleEnroll={handleToggleEnroll}
            onResetQuizStats={handleResetQuizStats}
            onGoToLibrary={() => openTab('library')}
            nowTimestamp={nowTimestamp}
          />
        ) : activeTab === 'library' ? (
          <IndexTab
            quizzes={allQuizzes}
            attempts={attempts}
            enrolledIds={enrolledIds}
            nowTimestamp={nowTimestamp}
            onStartQuiz={(quiz) => handleStartQuiz(quiz, null, false)}
            onToggleEnroll={handleToggleEnroll}
          />
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

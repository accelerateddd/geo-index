import type { QuizAttempt, QuizConfig, QuizRevisionStats, RevisionQueueItem } from '../types/quiz';

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Aggregates raw attempts for a given quiz into `QuizRevisionStats`.
 */
export function computeQuizStats(quizId: string, attempts: QuizAttempt[]): QuizRevisionStats {
  const quizAttempts = attempts
    .filter((a) => a.quizId === quizId)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (quizAttempts.length === 0) {
    return {
      quizId,
      attemptsCount: 0,
      perfectCount: 0,
      consecutivePerfectStreak: 0,
      lastPlayedAt: null,
      lastScorePercent: null,
      bestScorePercent: null,
      fastestPerfectSeconds: null,
      missedFrequency: {},
    };
  }

  let perfectCount = 0;
  let consecutivePerfectStreak = 0;
  let bestScorePercent = 0;
  let fastestPerfectSeconds: number | null = null;
  const missedFrequency: Record<string, number> = {};

  for (const attempt of quizAttempts) {
    if (attempt.scorePercent > bestScorePercent) {
      bestScorePercent = attempt.scorePercent;
    }
    if (attempt.scorePercent === 100) {
      perfectCount += 1;
      consecutivePerfectStreak += 1;
      if (fastestPerfectSeconds === null || attempt.durationSeconds < fastestPerfectSeconds) {
        fastestPerfectSeconds = attempt.durationSeconds;
      }
    } else {
      consecutivePerfectStreak = 0;
    }

    for (const region of attempt.missedRegions) {
      missedFrequency[region] = (missedFrequency[region] || 0) + 1;
    }
  }

  const lastAttempt = quizAttempts[quizAttempts.length - 1];

  return {
    quizId,
    attemptsCount: quizAttempts.length,
    perfectCount,
    consecutivePerfectStreak,
    lastPlayedAt: lastAttempt.timestamp,
    lastScorePercent: lastAttempt.scorePercent,
    bestScorePercent,
    fastestPerfectSeconds,
    missedFrequency,
  };
}

/**
 * Computes a continuous, endless priority score for a quiz in the revision queue.
 *
 * The revision queue is never "finished":
 * - Every enrolled quiz always has a positive `priorityScore`.
 * - Completing a quiz updates `lastPlayedAt = now`, which drops its `priorityScore` to the bottom
 *   of the queue so the next quiz immediately rotates to #1.
 * - Factors:
 *   1. Time since last played (`daysSinceLastPlayed`): priority grows continuously with elapsed time.
 *   2. Score when last played (`lastScorePercent`): any score < 100% adds a strong deficit boost
 *      (`(100 - lastScore) * 2.5`) and accelerates time growth so imperfect runs cycle back faster.
 *   3. Number of times scored 100% (`perfectCount` & `consecutivePerfectStreak`):
 *      acts as a familiarity divisor (`1 + perfectCount * 0.65 + streak * 0.35`).
 *      Quizzes with fewer 100% runs climb the queue much faster than quizzes you've scored 100% on many times.
 */
export function evaluateRevisionItem(
  quiz: QuizConfig,
  stats: QuizRevisionStats,
  now: number = Date.now()
): RevisionQueueItem {
  // Enrolled but not yet played: high initial priority so it gets an initial baseline run
  if (stats.attemptsCount === 0 || stats.lastPlayedAt === null || stats.lastScorePercent === null) {
    return {
      quiz,
      stats,
      priorityScore: 100,
      daysSinceLastPlayed: null,
    };
  }

  const elapsedMs = Math.max(0, now - stats.lastPlayedAt);
  const daysSinceLastPlayed = elapsedMs / DAY_MS;

  // Familiarity damper: more 100% runs = slower priority growth
  const familiarityDivisor =
    1 + stats.perfectCount * 0.65 + stats.consecutivePerfectStreak * 0.35;

  // Deficit penalty if last run was < 100%
  const deficit = Math.max(0, 100 - stats.lastScorePercent);
  const deficitMultiplier = deficit > 0 ? 1 + deficit / 25 : 1;

  // Base time score grows continuously per hour/day elapsed, scaled down by familiarity
  // Even at 0 minutes ago, there is a small non-zero floor so the queue is strictly ordered
  const timeComponent = ((daysSinceLastPlayed + 0.02) * 25 * deficitMultiplier) / familiarityDivisor;

  // Immediate boost if last score < 100% (scaled by time so if you *just* played it 10s ago with 95%,
  // other urgent items can still interleave if you want, or it stays high)
  const recencyRamp = Math.min(1, elapsedMs / (1000 * 60 * 10)); // ramps 0 -> 1 over 10 minutes
  const imperfectBoost = deficit > 0 ? (20 + deficit * 1.5) * (0.25 + 0.75 * recencyRamp) : 0;

  const priorityScore = Number((timeComponent + imperfectBoost).toFixed(2));

  return {
    quiz,
    stats,
    priorityScore,
    daysSinceLastPlayed,
  };
}

export function buildRevisionQueue(
  quizzes: QuizConfig[],
  enrolledIds: string[],
  attempts: QuizAttempt[],
  now: number = Date.now()
): RevisionQueueItem[] {
  const enrolledSet = new Set(enrolledIds);
  return quizzes
    .filter((q) => enrolledSet.has(q.id))
    .map((quiz) => {
      const stats = computeQuizStats(quiz.id, attempts);
      return evaluateRevisionItem(quiz, stats, now);
    })
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      // Tie-breaker: older lastPlayedAt first
      return (a.stats.lastPlayedAt || 0) - (b.stats.lastPlayedAt || 0);
    });
}

export function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 45) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;

  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

import type { QuizAttempt, QuizConfig, QuizRevisionStats, RevisionQueueItem } from '../types/quiz';

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Two-Component Spaced Repetition + Error-Consolidation Model (FSRS-inspired)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Each enrolled quiz maintains two latent memory state variables replayed
 *  chronologically across all tracked attempts:
 *
 *  1. Difficulty / Error Burden  D ∈ [1.0, 10.0]
 *     Starts at D₀ = 1.0.
 *     - On any run with mistakes (score q = score%/100 < 1, missed count m > 0):
 *         errorSeverity = (1 − q)·4.0 + min(3.0, m · 0.65)
 *         D ← clamp(D + 0.55 · errorSeverity, 1.0, 10.0)
 *     - On a 100% run:
 *         • If spaced (Δt ≥ 4 hours since previous attempt): D decays by 0.82×
 *           toward 1.0 (true long-term error recovery).
 *         • If same-session retry (Δt < 4 hours): D decays by only 0.94×
 *           (short-term correction in working memory does NOT erase the fact
 *           that you struggled with those items today).
 *
 *  2. Memory Stability  S (in days) — time until recall probability R(t) = 90%
 *     - First attempt:
 *         S₁ = (S_INIT / D) · λ(q, m)
 *       where S_INIT = 2.0 days for a clean first-try 100% (D = 1, λ = 1),
 *       and λ(q, m) = max(0.12, q⁴ · 0.85^m) is the lapse penalty on mistakes.
 *     - Subsequent attempts after elapsed time Δt (days):
 *         R_prev = (1 + Δt / (9·S))⁻¹
 *         • On a 100% run:
 *             spacingFactor = 1 - exp(-Δt / 0.18)   // ~0 for immediate same-session retries!
 *             G = 1 + (G_BASE + G_SPACING · (1 - R_prev)) · (0.12 + 0.88 · spacingFactor) / (D ^ 0.55)
 *             S' = S · min(G_MAX, G)
 *         • On an imperfect run (< 100%):
 *             S' = S · λ(q, m)
 *
 *  3. Continuous Priority Weight  W(t)
 *     Given elapsed days t since the last run:
 *       Forgetting Curve:      R(t) = (1 + t / (9·S))⁻¹
 *       Overdue Urgency:       U(t) = 100 · (1 − R(t)) = 100 · t / (t + 9·S)
 *       Post-Session Cooldown: C(t) = t / (t + τ_cool)   (τ_cool = 15 minutes)
 *         Assumes that immediately after making mistakes on a quiz, you review/drill
 *         those mistakes on the spot, so the quiz cools down for ~15 minutes before
 *         demanding a full re-test in a large queue.
 *       Error Consolidation:   E(t) = C(t) · [ 22 · (D − 1) + 45 · (1 − q_last) ]
 *       Baseline Comparison:   B(t) = 2.5 · (D − 1) / (1 + t)
 *         Ensures that even within the first few minutes in a short queue, a quiz
 *         with historical mistakes (D > 1) strictly outranks a quiz aced with 0 mistakes.
 *
 *       Priority Score:        W(t) = U(t) + E(t) + B(t)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MEMORY_PARAMS = {
  S_INIT: 2.0, // days of stability for a clean first-try 100% run
  S_MIN: 0.08, // ~2 hours minimum stability floor on a failed run
  S_MAX: 365, // 1 year cap
  G_BASE: 0.85, // base stability growth on a spaced 100% review
  G_SPACING: 8.5, // additional stability gain when reviewing near/past due date
  G_MAX: 4.0, // max single-review stability multiplier
  LAMBDA_MIN: 0.12, // minimum lapse multiplier on a heavy fail
  COOLDOWN_DAYS: 15 / (24 * 60), // 15-minute post-session cooldown constant τ_cool
  NEW_QUIZ_PRIORITY: 50.0, // unplayed enrolled quizzes sit above routine reviews until given a baseline run
};

export function retrievability(elapsedDays: number, stability: number): number {
  return 1 / (1 + Math.max(0, elapsedDays) / (9 * Math.max(MEMORY_PARAMS.S_MIN, stability)));
}

function lapseFactor(scorePercent: number, missedCount: number): number {
  if (scorePercent >= 100 && missedCount === 0) return 1;
  const q = Math.max(0, Math.min(1, scorePercent / 100));
  return Math.max(MEMORY_PARAMS.LAMBDA_MIN, Math.pow(q, 4) * Math.pow(0.85, missedCount));
}

function clampS(s: number): number {
  return Math.min(MEMORY_PARAMS.S_MAX, Math.max(MEMORY_PARAMS.S_MIN, s));
}

function clampD(d: number): number {
  return Math.min(10.0, Math.max(1.0, d));
}

/**
 * Replays chronological attempt history to compute current Stability S (days)
 * and Difficulty / Error Burden D ∈ [1, 10].
 */
export function computeMemoryState(sortedAttempts: QuizAttempt[]): {
  stabilityDays: number | null;
  difficultyScore: number;
} {
  if (sortedAttempts.length === 0) {
    return { stabilityDays: null, difficultyScore: 1.0 };
  }

  let S: number | null = null;
  let D = 1.0;
  let lastTs = 0;

  for (const a of sortedAttempts) {
    const missedCount = a.missedRegions.length;
    const isPerfect = a.scorePercent >= 100 && missedCount === 0;
    const q = Math.max(0, Math.min(1, a.scorePercent / 100));
    const lambda = lapseFactor(a.scorePercent, missedCount);
    const deltaDays = lastTs > 0 ? Math.max(0, (a.timestamp - lastTs) / DAY_MS) : 0;

    // 1. Update Difficulty / Error Burden D
    if (!isPerfect) {
      const errorSeverity = (1 - q) * 4.0 + Math.min(3.0, missedCount * 0.65);
      D = clampD(D + 0.55 * errorSeverity);
    } else if (lastTs > 0) {
      // Spaced 100% run (>= 4 hours later) significantly reduces error burden;
      // immediate same-session retry (< 4 hours) only slightly reduces D.
      const recoveryRate = deltaDays >= 4 / 24 ? 0.82 : 0.94;
      D = clampD(1.0 + (D - 1.0) * recoveryRate);
    }

    // 2. Update Memory Stability S
    if (S === null) {
      S = clampS((MEMORY_PARAMS.S_INIT / D) * lambda);
    } else if (isPerfect) {
      const R = retrievability(deltaDays, S);
      // Immediate retry in the same sitting (deltaDays ~ 0) yields minimal long-term stability boost
      const spacingFactor = 1 - Math.exp(-deltaDays / 0.18);
      const rawGain =
        1 +
        ((MEMORY_PARAMS.G_BASE + MEMORY_PARAMS.G_SPACING * (1 - R)) *
          (0.12 + 0.88 * spacingFactor)) /
          Math.pow(D, 0.55);
      const G = Math.min(MEMORY_PARAMS.G_MAX, rawGain);
      S = clampS(S * G);
    } else {
      S = clampS(S * lambda);
    }

    lastTs = a.timestamp;
  }

  return {
    stabilityDays: S,
    difficultyScore: Number(D.toFixed(2)),
  };
}

/**
 * Aggregates raw attempts for a given quiz into `QuizRevisionStats`.
 */
export function computeQuizStats(quizId: string, attempts: QuizAttempt[]): QuizRevisionStats {
  const quizAttempts = attempts
    .filter((a) => a.quizId === quizId)
    .sort((a) => a.timestamp)
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
      stabilityDays: null,
      difficultyScore: 1.0,
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
    if (attempt.scorePercent === 100 && attempt.missedRegions.length === 0) {
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
  const { stabilityDays, difficultyScore } = computeMemoryState(quizAttempts);

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
    stabilityDays,
    difficultyScore,
  };
}

/**
 * Computes continuous priority score W(t) for a quiz in the revision queue.
 */
export function evaluateRevisionItem(
  quiz: QuizConfig,
  stats: QuizRevisionStats,
  now: number = Date.now()
): RevisionQueueItem {
  if (
    stats.attemptsCount === 0 ||
    stats.lastPlayedAt === null ||
    stats.lastScorePercent === null ||
    stats.stabilityDays === null ||
    stats.stabilityDays === undefined
  ) {
    return {
      quiz,
      stats,
      priorityScore: MEMORY_PARAMS.NEW_QUIZ_PRIORITY,
      daysSinceLastPlayed: null,
      retrievability: null,
      dueInDays: null,
    };
  }

  const daysSinceLastPlayed = Math.max(0, now - stats.lastPlayedAt) / DAY_MS;
  const S = stats.stabilityDays;
  const D = stats.difficultyScore ?? 1.0;
  const R = retrievability(daysSinceLastPlayed, S);

  // 1. Overdue forgetting urgency U(t) on a 0..100 scale (equals 10.0 when R = 90%, i.e. t = S)
  const urgencyScore = 100 * (1 - R);

  // 2. Post-session cooldown factor C(t) = t / (t + τ_cool), τ_cool = 15 mins
  const cooldownFactor =
    daysSinceLastPlayed / (daysSinceLastPlayed + MEMORY_PARAMS.COOLDOWN_DAYS);

  // 3. Error consolidation boost E(t): prioritizes quizzes with recent mistakes or unresolved error burden D > 1
  const lastDeficitFraction = Math.max(0, (100 - stats.lastScorePercent) / 100);
  const errorConsolidationBoost =
    cooldownFactor * (22 * (D - 1.0) + 45 * lastDeficitFraction);

  // 4. Short-queue tie-breaker B(t): even during the 15-min cooldown in a tiny queue,
  // a quiz with mistakes (D > 1 or lastDeficit > 0) ranks above a clean 100% quiz.
  const immediateErrorRank =
    (2.5 * (D - 1.0) + 4.0 * lastDeficitFraction) / (1 + daysSinceLastPlayed);

  const priorityScore = Number(
    (urgencyScore + errorConsolidationBoost + immediateErrorRank).toFixed(2)
  );

  return {
    quiz,
    stats,
    priorityScore,
    daysSinceLastPlayed,
    retrievability: R,
    dueInDays: S - daysSinceLastPlayed,
    stabilityDays: S,
    difficultyScore: D,
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
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = (hours / 24).toFixed(1);
  return `${days}d ago`;
}

export function formatDuration(days: number): string {
  const mins = Math.round(Math.abs(days) * 24 * 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  return `${Math.abs(days).toFixed(1)}d`;
}

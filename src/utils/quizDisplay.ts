import type { QuizCategory, QuizConfig } from '../types/quiz';

export const CATEGORY_LABELS: Record<QuizCategory, string> = {
  subdivisions: 'Countries & regions',
  'niche-subdivisions': 'Counties & districts',
  cities: 'Cities',
  flags: 'Flags',
  landscapes: 'Rivers',
  special: 'Special',
  leisure: 'Leisure',
};

export const CATEGORY_ORDER: QuizCategory[] = [
  'subdivisions',
  'niche-subdivisions',
  'cities',
  'flags',
  'landscapes',
  'special',
  'leisure',
];

export function categoryLabel(category: QuizCategory): string {
  return CATEGORY_LABELS[category] ?? 'Other';
}

/** Data titles carry a trailing count; the UI shows the count separately. */
export function cleanQuizTitle(title: string): string {
  return title.replace(/\s*\(\d+\)\s*$/, '').trim();
}

function titleSegment(title: string): string {
  return cleanQuizTitle(title).split(':').pop()?.trim().toLowerCase() ?? '';
}

export function itemNoun(quiz: QuizConfig): string {
  const tags = new Set(quiz.tags);

  if (tags.has('sydney-suburbs')) return 'suburbs';
  if (tags.has('aus-lga')) return 'LGAs';
  if (tags.has('usa-counties')) {
    const segment = titleSegment(quiz.title);
    if (segment && segment.split(/\s+/).length <= 5) return segment;
    return 'counties';
  }
  if (tags.has('world-capitals') || tags.has('capital-cities')) return 'capitals';
  if (tags.has('RIVERS') || quiz.category === 'landscapes') return 'rivers';
  if (
    tags.has('country-flags') ||
    tags.has('1st-level-flags') ||
    quiz.category === 'flags'
  ) {
    return 'flags';
  }
  if (quiz.category === 'cities') return 'cities';
  if (quiz.category === 'special') return 'countries';
  if (quiz.isCustom) return 'places';

  const segment = titleSegment(quiz.title);
  if (segment && !segment.includes('(') && segment.split(/\s+/).length <= 4) {
    return segment;
  }
  return 'items';
}

export function itemCountLabel(quiz: QuizConfig): string {
  const count = quiz.totalItems;
  const noun = itemNoun(quiz);
  if (count === 1) {
    if (noun.endsWith('ies')) return `1 ${noun.slice(0, -3)}y`;
    if (noun.endsWith('s')) return `1 ${noun.slice(0, -1)}`;
    return `1 ${noun}`;
  }
  return `${count} ${noun}`;
}

export function quizMeta(quiz: QuizConfig): string {
  return `${quiz.countryOrRegion} · ${categoryLabel(quiz.category)} · ${itemCountLabel(quiz)}`;
}

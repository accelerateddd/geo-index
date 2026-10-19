import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

function pageItems(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);

  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
  }

  const sorted = Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  const items: Array<number | 'gap'> = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index];
    if (index > 0 && page - sorted[index - 1] > 1) {
      items.push('gap');
    }
    items.push(page);
  }
  return items;
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  itemLabel = 'QUIZZES',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);
  const items = pageItems(page, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-2 border-t border-ink-800 bg-ink-950/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-[11px] text-ink-500">
        SHOWING {firstItem}–{lastItem} OF {totalItems} {itemLabel}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-ink-800 bg-ink-950 text-ink-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-ink-400"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {items.map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden="true"
              className="inline-flex h-7 w-5 items-center justify-center text-xs text-ink-600"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              className={`inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-bold transition ${
                item === page
                  ? 'bg-accent-600 text-white'
                  : 'bg-ink-950 border border-ink-800 text-ink-400 hover:text-white'
              }`}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-ink-800 bg-ink-950 text-ink-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-ink-400"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </nav>
  );
}

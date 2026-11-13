import Link from 'next/link';

/**
 * Page numbers to show: a window of `size` pages around `current`, plus the
 * first and last page, with '…' where pages are skipped.
 * e.g. pageWindow(64, 128) → [1, '…', 62, 63, 64, 65, 66, '…', 128]
 */
export function pageWindow(current: number, total: number, size = 5): (number | '…')[] {
  if (total < 1) return [];
  const page = Math.min(Math.max(1, current), total);
  let start = Math.max(1, page - Math.floor(size / 2));
  const end = Math.min(total, start + size - 1);
  start = Math.max(1, end - size + 1);

  const pages: (number | '…')[] = [];
  if (start > 1) pages.push(1);
  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('…');
  if (end < total) pages.push(total);
  return pages;
}

/** Clamp a requested page into [1, max(totalPages, 1)]. */
export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), Math.max(totalPages, 1));
}

// Coarse pointers (phones/tablets) get >= 44 px hit areas.
const touchClass = 'items-center justify-center pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]';

const linkClass =
  `inline-flex ${touchClass} px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`;
const disabledClass = 'inline-flex items-center px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-300';

export function Pagination({
  currentPage: requestedPage,
  totalPages,
  basePath,
  searchParams,
  pageSize = 20,
  totalItems,
}: {
  currentPage: number;
  totalPages: number;
  basePath: string;
  searchParams?: Record<string, string>;
  pageSize?: number;
  /** When given, shows "{from}–{to} of {totalItems}" next to the controls. */
  totalItems?: number;
}) {
  if (totalPages <= 1) return null;
  const currentPage = clampPage(requestedPage, totalPages);

  function buildUrl(page: number) {
    const params = new URLSearchParams(searchParams ?? {});
    params.set('page', String(page));
    if (pageSize !== 20) params.set('pageSize', String(pageSize));
    return `${basePath}?${params.toString()}`;
  }

  const isFirst = currentPage <= 1;
  const isLast = currentPage >= totalPages;

  function edgeLink(label: string, page: number, disabled: boolean) {
    return disabled ? (
      <span className={disabledClass} aria-hidden="true">
        {label}
      </span>
    ) : (
      <Link href={buildUrl(page)} className={linkClass}>
        {label}
      </Link>
    );
  }

  const from = (currentPage - 1) * pageSize + 1;
  const to = totalItems === undefined ? 0 : Math.min(currentPage * pageSize, totalItems);
  const showRange = totalItems !== undefined && totalItems > 0;

  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-6"
      aria-label="Pagination"
    >
      <div className="flex flex-wrap items-center justify-center gap-1">
        {edgeLink('First', 1, isFirst)}
        {edgeLink('Previous', currentPage - 1, isFirst)}

        {pageWindow(currentPage, totalPages).map((page, i) =>
          page === '…' ? (
            <span key={`gap-${i}`} className="hidden sm:inline px-1 text-sm text-gray-500" aria-hidden="true">
              …
            </span>
          ) : (
            <Link
              key={page}
              href={buildUrl(page)}
              className={`${touchClass} px-3 py-1.5 text-sm rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                page === currentPage
                  ? 'inline-flex bg-blue-600 text-white border-blue-600'
                  : 'hidden sm:inline-flex border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              aria-current={page === currentPage ? 'page' : undefined}
            >
              {page}
            </Link>
          ),
        )}

        {edgeLink('Next', currentPage + 1, isLast)}
        {edgeLink('Last', totalPages, isLast)}
      </div>

      {showRange && (
        <p className="text-sm text-gray-600 whitespace-nowrap">
          {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {totalItems.toLocaleString('en-US')}
        </p>
      )}
    </nav>
  );
}

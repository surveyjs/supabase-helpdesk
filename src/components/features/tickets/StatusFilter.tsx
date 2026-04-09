import Link from 'next/link';

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'closed', label: 'Closed' },
];

export function StatusFilter({
  current,
  basePath,
  searchParams,
}: {
  current: string;
  basePath: string;
  searchParams?: Record<string, string>;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Filter by status">
      {STATUS_FILTERS.map(({ key, label }) => {
        const params = new URLSearchParams(searchParams ?? {});
        if (key === 'all') {
          params.delete('status');
        } else {
          params.set('status', key);
        }
        params.delete('page');
        const href = params.toString()
          ? `${basePath}?${params.toString()}`
          : basePath;

        const isActive = current === key;

        return (
          <Link
            key={key}
            href={href}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

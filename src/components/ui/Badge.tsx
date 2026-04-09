type BadgeVariant = 'status' | 'priority';

const statusColors: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-gray-100 text-gray-700',
};

const priorityColors: Record<string, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-teal-100 text-teal-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export function Badge({
  variant,
  value,
  label,
}: {
  variant: BadgeVariant;
  value: string;
  label?: string;
}) {
  const colors = variant === 'status' ? statusColors : priorityColors;
  const colorClass = colors[value] ?? 'bg-gray-100 text-gray-700';
  const displayLabel = label ?? value.charAt(0).toUpperCase() + value.slice(1);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      {displayLabel}
    </span>
  );
}

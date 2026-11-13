type BadgeVariant = 'status' | 'priority';

// Status and priority use separate hue families so a pill's color alone says
// which kind it is: status = green/yellow/outlined, priority = slate→amber→red.
const statusColors: Record<string, string> = {
  open: 'bg-green-50 text-green-800 ring-green-300',
  pending: 'bg-yellow-50 text-yellow-800 ring-yellow-300',
  closed: 'bg-white text-gray-600 ring-gray-300',
};

const priorityColors: Record<string, string> = {
  low: 'bg-slate-50 text-slate-600 ring-slate-200',
  medium: 'bg-slate-100 text-slate-700 ring-slate-300',
  high: 'bg-amber-50 text-amber-800 ring-amber-300',
  critical: 'bg-red-50 text-red-700 ring-red-300',
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
  const colorClass = colors[value] ?? 'bg-gray-50 text-gray-700 ring-gray-300';
  const displayLabel = label ?? value.charAt(0).toUpperCase() + value.slice(1);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ring-1 ring-inset ${colorClass}`}
    >
      {displayLabel}
    </span>
  );
}

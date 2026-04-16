const COLOR_MAP: Record<string, string> = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  orange: 'bg-orange-100 text-orange-700',
  pink: 'bg-pink-100 text-pink-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  teal: 'bg-teal-100 text-teal-700',
};

export function TierBadge({
  displayName,
  color,
  icon,
}: {
  tierKey: string;
  displayName: string;
  color: string;
  icon?: string | null;
}) {
  const classes = COLOR_MAP[color] ?? COLOR_MAP.gray;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}
      data-testid="tier-badge"
    >
      {icon && <span className="mr-0.5">{icon}</span>}
      {displayName}
    </span>
  );
}

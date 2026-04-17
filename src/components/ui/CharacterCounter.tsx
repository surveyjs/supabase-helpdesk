'use client';

export function CharacterCounter({ current, max }: { current: number; max: number }) {
  const remaining = max - current;
  const percentage = (current / max) * 100;

  return (
    <span
      className={`text-xs ${
        percentage >= 100
          ? 'text-red-600 font-medium'
          : percentage >= 90
            ? 'text-orange-600'
            : 'text-gray-500'
      }`}
      aria-live="polite"
    >
      {current.toLocaleString()} / {max.toLocaleString()}
      {remaining < 0 && (
        <span className="ml-1">({Math.abs(remaining).toLocaleString()} over limit)</span>
      )}
    </span>
  );
}

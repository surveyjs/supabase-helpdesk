import { formatRelativeTime } from '@/lib/utils/time';
import { CopyButton } from './CopyButton';

/**
 * One entry in the ticket **Logs** (history) tab.
 *
 * Two render modes:
 *  - Structured comparison: when `field` is provided, renders
 *    "{actor} changed {field}: <old> → <new>" with the old value muted/struck
 *    and the new value emphasized (issue #74).
 *  - Prose: when only `message` is provided (events without a before/after,
 *    e.g. merges, file uploads), renders "{actor} {message}".
 *
 * When a displayed value is a truncated snippet of a longer body, the matching
 * `*CopyText` prop carries the full text and a copy button is shown beside it.
 */
export type ActivityLogItemProps = {
  id: string;
  actorName: string;
  createdAt: string;
  /** Human-readable field name, e.g. "status", "assignee". Enables comparison mode. */
  field?: string;
  /** Previous value (comparison mode). `null` renders as an em dash. */
  oldValue?: string | null;
  /** New value (comparison mode). `null` renders as an em dash. */
  newValue?: string | null;
  /** Predicate-only sentence for prose mode (no leading actor name). */
  message?: string;
  /** Optional trailing note, e.g. a reassignment reason. */
  note?: string | null;
  /** Full text behind `oldValue` when it was truncated; enables a copy button. */
  oldCopyText?: string;
  /** Full text behind `newValue` when it was truncated; enables a copy button. */
  newCopyText?: string;
  /** Full text behind a snippet embedded in `message`; enables a copy button. */
  messageCopyText?: string;
};

function ValueChip({
  value,
  variant,
  copyText,
}: {
  value?: string | null;
  variant: 'old' | 'new';
  copyText?: string;
}) {
  const text = value == null || value === '' ? '—' : value;
  const className =
    variant === 'old'
      ? 'rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 line-through'
      : 'rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-800';
  return (
    <span className="inline-flex items-center gap-1">
      <span className={className}>{text}</span>
      {copyText ? <CopyButton value={copyText} label="Copy full text" /> : null}
    </span>
  );
}

export function ActivityLogItem({
  id,
  actorName,
  createdAt,
  field,
  oldValue,
  newValue,
  message,
  note,
  oldCopyText,
  newCopyText,
  messageCopyText,
}: ActivityLogItemProps) {
  const exactTime = new Date(createdAt).toLocaleString();
  const isComparison = field !== undefined;

  return (
    <div
      data-testid={`activity-${id}`}
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 py-1.5 px-4 text-xs text-gray-600"
    >
      <span className="font-medium text-gray-800">{actorName}</span>

      {isComparison ? (
        <>
          <span>changed</span>
          <span className="text-gray-500">{field}</span>
          <span className="inline-flex items-center gap-1.5">
            <ValueChip value={oldValue} variant="old" copyText={oldCopyText} />
            <span aria-hidden="true" className="text-gray-400">
              →
            </span>
            <ValueChip value={newValue} variant="new" copyText={newCopyText} />
          </span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1">
          <span>{message}</span>
          {messageCopyText ? <CopyButton value={messageCopyText} label="Copy full text" /> : null}
        </span>
      )}

      {note ? <span className="italic text-gray-500">({note})</span> : null}

      <time dateTime={createdAt} title={exactTime} className="ml-auto text-gray-400">
        {formatRelativeTime(createdAt)}
      </time>
    </div>
  );
}

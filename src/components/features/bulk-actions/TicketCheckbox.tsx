'use client';

import { useBulkSelect } from './BulkSelectProvider';

// The label is the hit area: >= 44 px square on coarse pointers (phones/tablets).
const hitAreaClass = 'inline-flex items-center justify-center pointer-coarse:h-11 pointer-coarse:w-11';

export function TicketCheckbox({ ticketId }: { ticketId: number }) {
  const { isSelected, toggleId } = useBulkSelect();

  return (
    <label className={hitAreaClass} data-testid={`ticket-checkbox-hit-${ticketId}`}>
      <input
        type="checkbox"
        checked={isSelected(ticketId)}
        onChange={() => toggleId(ticketId)}
        className="form-checkbox"
        aria-label={`Select ticket #${ticketId}`}
        data-testid={`ticket-checkbox-${ticketId}`}
      />
    </label>
  );
}

export function SelectAllCheckbox({ ticketIds }: { ticketIds: number[] }) {
  const { selectedIds, selectAll } = useBulkSelect();

  const allSelected = ticketIds.length > 0 && ticketIds.every((id) => selectedIds.has(id));

  return (
    <label className={hitAreaClass}>
      <input
        type="checkbox"
        checked={allSelected}
        onChange={() => selectAll(ticketIds)}
        className="form-checkbox"
        aria-label="Select all tickets on this page"
        data-testid="select-all-checkbox"
      />
    </label>
  );
}

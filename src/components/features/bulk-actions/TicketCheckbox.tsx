'use client';

import { useBulkSelect } from './BulkSelectProvider';

export function TicketCheckbox({ ticketId }: { ticketId: number }) {
  const { isSelected, toggleId } = useBulkSelect();

  return (
    <input
      type="checkbox"
      checked={isSelected(ticketId)}
      onChange={() => toggleId(ticketId)}
      className="form-checkbox"
      aria-label={`Select ticket #${ticketId}`}
      data-testid={`ticket-checkbox-${ticketId}`}
    />
  );
}

export function SelectAllCheckbox({ ticketIds }: { ticketIds: number[] }) {
  const { selectedIds, selectAll } = useBulkSelect();

  const allSelected = ticketIds.length > 0 && ticketIds.every((id) => selectedIds.has(id));

  return (
    <input
      type="checkbox"
      checked={allSelected}
      onChange={() => selectAll(ticketIds)}
      className="form-checkbox"
      aria-label="Select all tickets on this page"
      data-testid="select-all-checkbox"
    />
  );
}

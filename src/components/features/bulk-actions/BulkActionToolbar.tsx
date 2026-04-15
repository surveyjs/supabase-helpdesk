'use client';

import { useState, useTransition } from 'react';
import { useBulkSelect } from './BulkSelectProvider';
import {
  bulkChangeStatus,
  bulkAssign,
  bulkUnassign,
  bulkAddTags,
  bulkRemoveTags,
  bulkSetSeverity,
  bulkDelete,
} from '@/lib/actions/bulk';

interface Agent {
  id: string;
  display_name: string | null;
  email: string;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

export function BulkActionToolbar({
  agents,
  tags,
  isAdmin,
}: {
  agents: Agent[];
  tags: Tag[];
  isAdmin: boolean;
}) {
  const { selectedIds, clearSelection } = useBulkSelect();
  const [isPending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const count = selectedIds.size;
  if (count === 0) return null;

  const ticketIdsJson = JSON.stringify(Array.from(selectedIds));

  function handleAction(action: (formData: FormData) => Promise<void>, formData: FormData) {
    startTransition(async () => {
      await action(formData);
      clearSelection();
      setActiveAction(null);
    });
  }

  return (
    <div
      className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex flex-wrap items-center gap-2"
      data-testid="bulk-action-toolbar"
    >
      <span className="text-sm font-medium text-blue-800">
        {count} ticket{count !== 1 ? 's' : ''} selected
      </span>

      {/* Close */}
      <form
        action={(fd) => {
          fd.append('ticket_ids', ticketIdsJson);
          fd.append('new_status', 'closed');
          handleAction(bulkChangeStatus, fd);
        }}
      >
        <button
          type="submit"
          disabled={isPending}
          className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          data-testid="bulk-close-btn"
        >
          Close
        </button>
      </form>

      {/* Change Status */}
      {activeAction === 'status' ? (
        <form
          action={(fd) => {
            fd.append('ticket_ids', ticketIdsJson);
            handleAction(bulkChangeStatus, fd);
          }}
          className="flex gap-1"
        >
          <select
            name="new_status"
            className="rounded border border-gray-300 px-2 py-1 text-xs"
            data-testid="bulk-status-select"
          >
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </select>
          <button
            type="submit"
            disabled={isPending}
            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setActiveAction(null)}
            className="text-xs text-gray-500"
          >
            ×
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setActiveAction('status')}
          className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          data-testid="bulk-change-status-btn"
        >
          Change Status
        </button>
      )}

      {/* Assign */}
      {activeAction === 'assign' ? (
        <form
          action={(fd) => {
            fd.append('ticket_ids', ticketIdsJson);
            handleAction(bulkAssign, fd);
          }}
          className="flex gap-1"
        >
          <select
            name="agent_id"
            className="rounded border border-gray-300 px-2 py-1 text-xs"
            data-testid="bulk-assign-select"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name ?? 'Agent'} ({a.email})
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending}
            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Assign
          </button>
          <button
            type="button"
            onClick={() => setActiveAction(null)}
            className="text-xs text-gray-500"
          >
            ×
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setActiveAction('assign')}
          className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          data-testid="bulk-assign-btn"
        >
          Assign
        </button>
      )}

      {/* Unassign */}
      <form
        action={(fd) => {
          fd.append('ticket_ids', ticketIdsJson);
          handleAction(bulkUnassign, fd);
        }}
      >
        <button
          type="submit"
          disabled={isPending}
          className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          data-testid="bulk-unassign-btn"
        >
          Unassign
        </button>
      </form>

      {/* Add Tags */}
      {tags.length > 0 && (
        activeAction === 'addTags' ? (
          <form
            action={(fd) => {
              fd.append('ticket_ids', ticketIdsJson);
              const selected = Array.from(
                document.querySelectorAll<HTMLInputElement>('[data-testid="bulk-add-tag-checkbox"]:checked'),
              ).map((el) => el.value);
              fd.append('tag_ids', JSON.stringify(selected));
              handleAction(bulkAddTags, fd);
            }}
            className="flex gap-1 flex-wrap items-center"
          >
            {tags.map((tag) => (
              <label key={tag.id} className="inline-flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  value={tag.id}
                  data-testid="bulk-add-tag-checkbox"
                  className="h-3 w-3"
                />
                {tag.name}
              </label>
            ))}
            <button
              type="submit"
              disabled={isPending}
              className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setActiveAction(null)}
              className="text-xs text-gray-500"
            >
              ×
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setActiveAction('addTags')}
            className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
            data-testid="bulk-add-tags-btn"
          >
            Add Tags
          </button>
        )
      )}

      {/* Remove Tags */}
      {tags.length > 0 && (
        activeAction === 'removeTags' ? (
          <form
            action={(fd) => {
              fd.append('ticket_ids', ticketIdsJson);
              const selected = Array.from(
                document.querySelectorAll<HTMLInputElement>('[data-testid="bulk-remove-tag-checkbox"]:checked'),
              ).map((el) => el.value);
              fd.append('tag_ids', JSON.stringify(selected));
              handleAction(bulkRemoveTags, fd);
            }}
            className="flex gap-1 flex-wrap items-center"
          >
            {tags.map((tag) => (
              <label key={tag.id} className="inline-flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  value={tag.id}
                  data-testid="bulk-remove-tag-checkbox"
                  className="h-3 w-3"
                />
                {tag.name}
              </label>
            ))}
            <button
              type="submit"
              disabled={isPending}
              className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setActiveAction(null)}
              className="text-xs text-gray-500"
            >
              ×
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setActiveAction('removeTags')}
            className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
            data-testid="bulk-remove-tags-btn"
          >
            Remove Tags
          </button>
        )
      )}

      {/* Set Severity */}
      {activeAction === 'severity' ? (
        <form
          action={(fd) => {
            fd.append('ticket_ids', ticketIdsJson);
            handleAction(bulkSetSeverity, fd);
          }}
          className="flex gap-1"
        >
          <select
            name="new_severity"
            className="rounded border border-gray-300 px-2 py-1 text-xs"
            data-testid="bulk-severity-select"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <button
            type="submit"
            disabled={isPending}
            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Set
          </button>
          <button
            type="button"
            onClick={() => setActiveAction(null)}
            className="text-xs text-gray-500"
          >
            ×
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setActiveAction('severity')}
          className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          data-testid="bulk-set-severity-btn"
        >
          Set Severity
        </button>
      )}

      {/* Delete (admin only) */}
      {isAdmin && (
        activeAction === 'delete' ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600">Delete {count} ticket(s)?</span>
            <form
              action={(fd) => {
                fd.append('ticket_ids', ticketIdsJson);
                handleAction(bulkDelete, fd);
              }}
            >
              <button
                type="submit"
                disabled={isPending}
                className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                data-testid="bulk-delete-confirm-btn"
              >
                Confirm Delete
              </button>
            </form>
            <button
              type="button"
              onClick={() => setActiveAction(null)}
              className="text-xs text-gray-500"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setActiveAction('delete')}
            className="px-3 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200"
            data-testid="bulk-delete-btn"
          >
            Delete
          </button>
        )
      )}

      {/* Clear selection */}
      <button
        type="button"
        onClick={clearSelection}
        className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 ml-auto"
        data-testid="bulk-clear-selection"
      >
        Clear selection
      </button>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  changeTicketOwner,
  searchTicketOwnerCandidates,
  type OwnerCandidate,
} from '@/lib/actions/agent';

/**
 * Agent control next to the ticket owner (#108): "Change" opens a search box;
 * picking a person makes them the ticket's owner.
 */
export function ChangeOwnerControl({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OwnerCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    const mine = ++seq.current;
    if (q.length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const found = await searchTicketOwnerCandidates(q);
      if (mine === seq.current) setResults(found);
    }, 250);
  }

  function close() {
    seq.current++;
    setOpen(false);
    setQuery('');
    setResults([]);
    setError(null);
  }

  function pick(candidate: OwnerCandidate) {
    setError(null);
    startTransition(async () => {
      const res = await changeTicketOwner(ticketId, candidate.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-2 text-xs text-blue-600 hover:text-blue-800 underline"
        data-testid="change-owner-btn"
      >
        Change
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1" data-testid="change-owner-panel">
      <div className="flex items-center gap-2">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
          placeholder="Name or email…"
          aria-label="New owner: name or email"
          className="form-input block w-full text-sm"
          data-testid="change-owner-input"
          disabled={pending}
        />
        <button
          type="button"
          onClick={close}
          className="text-xs text-gray-500 hover:text-gray-800"
          disabled={pending}
        >
          Cancel
        </button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded border border-gray-200 bg-white" role="listbox" aria-label="Matching people">
          {results.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => pick(c)}
                disabled={pending}
                className="block w-full px-2 py-1.5 text-left text-sm hover:bg-gray-100"
                data-testid="change-owner-option"
              >
                <span className="text-gray-900">{c.display_name ?? c.email}</span>
                {c.display_name && <span className="block text-xs text-gray-500">{c.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && results.length === 0 && (
        <p className="text-xs text-gray-500">No matching people.</p>
      )}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

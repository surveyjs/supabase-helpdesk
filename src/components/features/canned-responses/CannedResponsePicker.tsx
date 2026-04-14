'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import { searchCannedResponses } from '@/lib/actions/canned-responses';

type CannedResponse = {
  id: string;
  title: string;
  body: string;
  visibility: string;
};

export function CannedResponsePicker({
  onInsert,
}: {
  onInsert: (body: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function doFetch(q: string) {
    startTransition(async () => {
      try {
        const data = await searchCannedResponses(q || undefined);
        setResponses(data);
      } catch {
        setResponses([]);
      }
    });
  }

  function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      doFetch(query);
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(value), 300);
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleOpen}
        className="text-xs text-blue-600 hover:text-blue-800 font-medium mb-1"
        data-testid="canned-response-picker-btn"
      >
        Insert canned response
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-96 bg-white border border-gray-200 rounded-lg shadow-lg" data-testid="canned-response-picker-dropdown">
          <div className="p-2 border-b border-gray-200">
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search responses…"
              className="block w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {isPending && (
              <p className="text-xs text-gray-400 p-3 text-center">Loading…</p>
            )}
            {!isPending && responses.length === 0 && (
              <p className="text-xs text-gray-400 p-3 text-center">No responses found.</p>
            )}
            {!isPending && responses.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onInsert(r.body);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-900">{r.title}</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                    r.visibility === 'public' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {r.visibility === 'public' ? 'Public' : 'Private'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{r.body}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

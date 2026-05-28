'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setAgentActiveView } from '@/lib/actions/saved-views';
import { notifyPopupOpened, subscribeToOtherPopups } from '@/lib/utils/popup-coordinator';

const POPUP_ID = 'view-switcher';

type Props = {
  savedViews: Array<{ id: string; name: string }>;
  activeViewId: string | null;
  activeViewName: string;
};

export function ViewSwitcherDropdown({ savedViews, activeViewId, activeViewName }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  useEffect(() => {
    return subscribeToOtherPopups(POPUP_ID, () => setOpen(false));
  }, []);

  function handleSelect(viewId: string | null) {
    setOpen(false);
    void setAgentActiveView(viewId)
      .catch((err) => { console.error('setAgentActiveView failed', err); })
      .finally(() => {
        router.push(viewId ? `/agent?view=${viewId}` : '/agent');
      });
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        data-testid="view-switcher-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => {
            const next = !o;
            if (next) notifyPopupOpened(POPUP_ID);
            return next;
          });
        }}
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-blue-600 px-1 py-0.5 rounded hover:bg-blue-50 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch view"
      >
        {activeViewName}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Switch view"
          className="absolute top-full left-0 z-50 mt-1 min-w-[160px] bg-white rounded-lg border border-gray-200 shadow-lg py-1"
        >
          <li role="presentation">
            <button
              role="option"
              aria-selected={activeViewId === null}
              type="button"
              onClick={() => handleSelect(null)}
              className={`w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 ${
                activeViewId === null ? 'font-medium text-blue-600' : 'text-gray-700'
              }`}
            >
              Default
            </button>
          </li>
          {savedViews.map((view) => (
            <li key={view.id} role="presentation">
              <button
                role="option"
                aria-selected={view.id === activeViewId}
                type="button"
                onClick={() => handleSelect(view.id)}
                className={`w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 ${
                  view.id === activeViewId ? 'font-medium text-blue-600' : 'text-gray-700'
                }`}
              >
                {view.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

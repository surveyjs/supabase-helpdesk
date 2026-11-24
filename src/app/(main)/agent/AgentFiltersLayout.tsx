'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { setAgentActiveView } from '@/lib/actions/saved-views';
import { ViewsFiltersCollapsible } from './ViewsFiltersCollapsible';
import { AGENT_FILTERS_HIDDEN_COOKIE } from './agent-filters-cookie';

type FilterProps = Omit<ComponentProps<typeof ViewsFiltersCollapsible>, 'className' | 'hiddenAtXl' | 'onHide'>;

/**
 * The dashboard's two-column layout (#105). From `xl` the Views & Filters
 * panel is a left column that can be hidden; the ticket list then takes the
 * full width and a bar above it offers "Filters" (show the column again) and
 * one button per saved view. Below `xl` the panel sits on top as before.
 * The choice is kept in a cookie, read on the server, so there is no flash.
 */
export function AgentFiltersLayout({
  initialHidden,
  filterProps,
  children,
}: {
  initialHidden: boolean;
  filterProps: FilterProps;
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState(initialHidden);
  const router = useRouter();

  function setHiddenAndRemember(next: boolean) {
    setHidden(next);
    document.cookie = `${AGENT_FILTERS_HIDDEN_COOKIE}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
  }

  function selectView(viewId: string | null) {
    void setAgentActiveView(viewId)
      .catch((err) => { console.error('setAgentActiveView failed', err); })
      .finally(() => {
        router.push(viewId ? `/agent?view=${viewId}` : '/agent');
      });
  }

  const views = [{ id: null as string | null, name: 'Default' }, ...filterProps.savedViews];

  return (
    <div className="xl:flex xl:items-start xl:gap-6">
      <ViewsFiltersCollapsible
        {...filterProps}
        className={`xl:w-72 xl:shrink-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto ${hidden ? 'xl:hidden' : ''}`}
        hiddenAtXl={hidden}
        onHide={() => setHiddenAndRemember(true)}
      />

      <div className="min-w-0 xl:flex-1">
        {hidden && (
          <div
            className="hidden xl:flex flex-wrap items-center gap-2 mb-4"
            role="toolbar"
            aria-label="Saved views"
            data-testid="quick-views-bar"
          >
            <button
              type="button"
              onClick={() => setHiddenAndRemember(false)}
              className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-expanded={false}
              data-testid="show-filters-btn"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
              </svg>
              Filters
            </button>
            <span aria-hidden="true" className="h-6 w-px bg-gray-200" />
            {views.map((v) => {
              const active = v.id === filterProps.activeViewId;
              return (
                <button
                  key={v.id ?? 'default'}
                  type="button"
                  onClick={() => selectView(v.id)}
                  aria-pressed={active}
                  className={`rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                  data-testid="quick-view-btn"
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

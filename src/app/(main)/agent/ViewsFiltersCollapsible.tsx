'use client';

import { useState, useSyncExternalStore } from 'react';
import { ViewSwitcherDropdown } from './ViewSwitcherDropdown';
import { ViewsAndFiltersPanel } from './ViewsAndFiltersPanel';
import type { FilterOptions } from '@/lib/filters/ticket-filter-survey';
import type { SurveyJsonDefinition } from '@/lib/constants/survey-ui-config';
import type { TicketFilterData, TicketFilterDefinition } from '@/lib/filters/ticket-filter';

// Tailwind's `xl` breakpoint: from here the panel is a left column, expanded by default.
const XL_QUERY = '(min-width: 80rem)';

function subscribeXl(onChange: () => void) {
  const mql = window.matchMedia(XL_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

type Props = {
  filterOptions: FilterOptions;
  template: SurveyJsonDefinition;
  savedViews: Array<{ id: string; name: string }>;
  activeViewId: string | null;
  activeViewName: string;
  initialData: TicketFilterData;
  activeDefinition: TicketFilterDefinition;
  aiFilterEnabled: boolean;
  className?: string;
};

export function ViewsFiltersCollapsible({
  filterOptions,
  template,
  savedViews,
  activeViewId,
  activeViewName,
  initialData,
  activeDefinition,
  aiFilterEnabled,
  className = '',
}: Props) {
  // null = not toggled yet: CSS decides (expanded at xl, collapsed below), so
  // the server render already matches the viewport and nothing jumps on hydration.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const isXl = useSyncExternalStore(
    subscribeXl,
    () => window.matchMedia(XL_QUERY).matches,
    () => false,
  );
  const open = toggled ?? isXl;
  const toggle = () => setToggled(!open);

  return (
    <section
      className={`bg-white rounded-lg border border-gray-200 mb-4 ${className}`}
      data-testid="views-filters-section"
    >
      <div className="px-4 py-3 text-sm font-medium text-gray-700 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 hover:text-gray-900"
          aria-expanded={open}
          aria-controls="views-filters-panel-content"
          onClick={toggle}
        >
          <span>Views &amp; Filters:</span>
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <ViewSwitcherDropdown
            savedViews={savedViews}
            activeViewId={activeViewId}
            activeViewName={activeViewName}
          />
          <button
            type="button"
            className="inline-flex rounded p-1 hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={open ? 'Collapse filters' : 'Expand filters'}
            aria-expanded={open}
            aria-controls="views-filters-panel-content"
            onClick={toggle}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 transition-transform ${
                toggled === null ? 'xl:rotate-180' : open ? 'rotate-180' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
      {toggled !== false && (
        <div
          id="views-filters-panel-content"
          className={`px-4 pt-4 pb-4 border-t border-gray-200 ${toggled === null ? 'hidden xl:block' : ''}`}
        >
          {/* Mounted only while open, so SurveyJS never loads for a collapsed panel below xl. */}
          {open && (
            <ViewsAndFiltersPanel
              filterOptions={filterOptions}
              template={template}
              savedViews={savedViews}
              activeViewId={activeViewId}
              activeViewName={activeViewName}
              initialData={initialData}
              activeDefinition={activeDefinition}
              aiFilterEnabled={aiFilterEnabled}
            />
          )}
        </div>
      )}
    </section>
  );
}

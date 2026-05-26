'use client';

import { useState } from 'react';
import { ViewSwitcherDropdown } from './ViewSwitcherDropdown';
import { ViewsAndFiltersPanel } from './ViewsAndFiltersPanel';
import type { FilterOptions } from '@/lib/filters/ticket-filter-survey';
import type { SurveyJsonDefinition } from '@/lib/constants/survey-ui-config';
import type { TicketFilterData, TicketFilterDefinition } from '@/lib/filters/ticket-filter';

type Props = {
  filterOptions: FilterOptions;
  template: SurveyJsonDefinition;
  savedViews: Array<{ id: string; name: string }>;
  activeViewId: string | null;
  activeViewName: string;
  initialData: TicketFilterData;
  activeDefinition: TicketFilterDefinition;
  aiFilterEnabled: boolean;
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
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-4">
      <div className="px-4 py-3 text-sm font-medium text-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="views-filters-panel-content"
            className="text-sm font-medium text-gray-700 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded"
          >
            Views &amp; Filters:
          </button>
          <ViewSwitcherDropdown
            savedViews={savedViews}
            activeViewId={activeViewId}
            activeViewName={activeViewName}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-hidden="true"
          tabIndex={-1}
          className="text-gray-700 hover:text-gray-900"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      {open && (
        <div id="views-filters-panel-content" className="px-4 pt-4 pb-4 border-t border-gray-200">
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
        </div>
      )}
    </div>
  );
}

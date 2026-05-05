'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Model } from 'survey-core';
import surveyTheme from '@/components/features/survey/theme.json';
import 'survey-core/survey-core.min.css';
import '@/components/features/survey/survey-overrides.css';
import {
  createSavedViewReturnId,
  deleteSavedView,
  updateSavedViewDefinition,
} from '@/lib/actions/saved-views';
import {
  generateSqlFromJson,
  normalizeFilterData,
  type TicketFilterData,
} from '@/lib/filters/ticket-filter';
import {
  buildTicketFilterSurveyJson,
  dataToSurveyData,
  type FilterOptions,
} from '@/lib/filters/ticket-filter-survey';
import type { AgentDashboardSurveyConfig } from '@/lib/constants/survey-ui-config';

const Survey = dynamic(() => import('survey-react-ui').then((mod) => mod.Survey), { ssr: false });

type ViewsAndFiltersPanelProps = {
  filterOptions: FilterOptions;
  config: AgentDashboardSurveyConfig;
  savedViews: Array<{ id: string; name: string }>;
  activeViewId: string | null;
  activeViewName: string;
  initialData: TicketFilterData;
};

export function ViewsAndFiltersPanel(props: ViewsAndFiltersPanelProps) {
  const {
    filterOptions,
    config,
    savedViews,
    activeViewId,
    activeViewName,
    initialData,
  } = props;

  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [busy, setBusy] = useState(false);
  const dataRef = useRef<TicketFilterData>(initialData);

  const schema = useMemo(
    () => buildTicketFilterSurveyJson(filterOptions, config),
    [filterOptions, config],
  );

  const surveyData = useMemo(
    () => dataToSurveyData(initialData, config.defaultSort),
    [initialData, config.defaultSort],
  );

  const model = useMemo(() => {
    const m = new Model(schema);
    m.applyTheme(surveyTheme as Parameters<Model['applyTheme']>[0]);
    m.showCompletedPage = false;
    m.completeText = 'Apply Filters';
    m.data = surveyData;

    // Custom navigation button per spec.
    m.addNavigationItem({
      id: 'sv-nav-clear-filtering',
      title: 'Clear All',
      // "Clear All" means "no filters" — for the status checkbox that
      // translates to all-selected (the only legal "no filter" state now
      // that minSelectedChoices: 1 forbids an empty selection).
      action: () => {
        m.data = { status: ['open', 'pending', 'closed'] };
      },
    });

    return m;
  }, [schema, surveyData]);

  useEffect(() => {
    const handler = () => {
      const current = (model.data ?? {}) as Record<string, unknown>;
      dataRef.current = normalizeFilterData(current);
    };
    model.onValueChanged.add(handler);
    handler();
    return () => { model.onValueChanged.remove(handler); };
  }, [model]);

  useEffect(() => {
    const handler = () => {
      const data = normalizeFilterData(model.data ?? {});
      const sql = generateSqlFromJson(data);
      applyFilters(data, sql);
    };
    model.onComplete.add(handler);
    return () => { model.onComplete.remove(handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, activeViewId]);

  function buildUrlForData(data: TicketFilterData, viewId: string | null): string {
    const params = new URLSearchParams();
    if (viewId) params.set('view', viewId);
    else {
      // Encode for Default view
      if (data.q) params.set('q', data.q);
      if (data.email) params.set('email', data.email);
      if (data.urgency) params.set('urgency', data.urgency);
      if (data.severity) params.set('severity', data.severity);
      if (data.category) params.set('category', data.category);
      if (data.type) params.set('type', data.type);
      if (data.agent) params.set('agent', data.agent);
      if (data.team) params.set('team', data.team);
      if (data.tier) params.set('tier', data.tier);
      if (data.sort) params.set('sort', data.sort);
      if (data.tags && data.tags.length > 0) params.set('tags', data.tags.join(','));
      if (data.status && data.status.length > 0 && data.status.length < 3) {
        params.set('status', data.status.join(','));
      }
    }
    const qs = params.toString();
    return qs ? `/agent?${qs}` : '/agent';
  }

  function applyFilters(data: TicketFilterData, sql: string) {
    if (activeViewId) {
      setBusy(true);
      void updateSavedViewDefinition({ viewId: activeViewId, type: 'json', data })
        .catch((err) => { console.error('updateSavedViewDefinition failed', err); })
        .finally(() => {
          setBusy(false);
          // URL is unchanged when re-applying to the same view, so a plain
          // router.push is a no-op. router.refresh() forces the server
          // component to re-run with the freshly persisted definition.
          router.push(buildUrlForData(data, activeViewId));
          router.refresh();
        });
    } else {
      // sql is intentionally regenerated server-side; ignore client copy.
      void sql;
      router.push(buildUrlForData(data, null));
    }
  }

  function handleSelectView(viewId: string | null) {
    if (viewId === null) {
      router.push('/agent');
    } else {
      router.push(`/agent?view=${viewId}`);
    }
  }

  function handleDelete(viewId: string) {
    const fd = new FormData();
    fd.set('view_id', viewId);
    setBusy(true);
    void deleteSavedView(fd).finally(() => {
      setBusy(false);
      if (activeViewId === viewId) {
        router.push('/agent');
      } else {
        router.refresh();
      }
    });
  }

  function handleAddOk() {
    const trimmed = newViewName.trim();
    if (!trimmed) return;
    const data = dataRef.current;
    setBusy(true);
    void createSavedViewReturnId({ name: trimmed, type: 'json', data })
      .then(({ id }) => {
        setIsAdding(false);
        setNewViewName('');
        setBusy(false);
        if (id) router.push(`/agent?view=${id}`);
        else router.refresh();
      })
      .catch((err) => {
        console.error('createSavedViewReturnId failed', err);
        setBusy(false);
      });
  }

  function handleAddCancel() {
    setIsAdding(false);
    setNewViewName('');
  }

  return (
    <div data-testid="views-and-filters-panel">
      {/* Saved Views Section */}
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Saved Views:</span>

          {/* Default view (always present, non-removable) */}
          <button
            type="button"
            onClick={() => handleSelectView(null)}
            className={`text-sm px-2 py-0.5 rounded ${
              activeViewName === 'Default'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Default
          </button>

          {savedViews.map((view) => {
            const isActive = view.id === activeViewId;
            return (
              <span key={view.id} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleSelectView(view.id)}
                  className={`text-sm px-2 py-0.5 rounded ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(view.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                  title={`Delete ${view.name}`}
                  aria-label={`Delete saved view ${view.name}`}
                >
                  ×
                </button>
              </span>
            );
          })}

          {/* Add new view affordance — link OR inline editor */}
          {isAdding ? (
            <span className="inline-flex items-center gap-1">
              <input
                type="text"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleAddOk(); }
                  if (e.key === 'Escape') { e.preventDefault(); handleAddCancel(); }
                }}
                placeholder="View name"
                maxLength={100}
                autoFocus
                className="text-sm rounded border border-gray-300 px-2 py-0.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                aria-label="New saved view name"
              />
              <button
                type="button"
                onClick={handleAddOk}
                disabled={!newViewName.trim() || busy}
                className="text-sm px-2 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                aria-label="Confirm new view"
                title="Save"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={handleAddCancel}
                className="text-sm px-2 py-0.5 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                aria-label="Cancel new view"
                title="Cancel"
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              + Add new view
            </button>
          )}
        </div>
      </div>

      {/* Filter Controls Section */}
      <div className="pt-4 border-t border-gray-200" data-testid="agent-filter-survey">
        <Survey model={model} />
      </div>
    </div>
  );
}

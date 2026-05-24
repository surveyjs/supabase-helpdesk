'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Model } from 'survey-core';
import {
  createSavedViewReturnId,
  deleteSavedView,
  updateSavedViewDefinition,
} from '@/lib/actions/saved-views';
import { translateAiFilterPrompt } from '@/lib/actions/ai';
import {
  generateSqlFromJson,
  normalizeFilterData,
  dataToUrlParams,
  type TicketFilterData,
  type TicketFilterDefinition,
} from '@/lib/filters/ticket-filter';
import {
  buildTicketFilterSurveyJson,
  dataToSurveyData,
  type FilterOptions,
} from '@/lib/filters/ticket-filter-survey';
import type { SurveyJsonDefinition } from '@/lib/constants/survey-ui-config';

const Survey = dynamic(() => import('survey-react-ui').then((mod) => mod.Survey), { ssr: false });

type ViewsAndFiltersPanelProps = {
  filterOptions: FilterOptions;
  template: SurveyJsonDefinition;
  savedViews: Array<{ id: string; name: string }>;
  activeViewId: string | null;
  activeViewName: string;
  initialData: TicketFilterData;
  activeDefinition: TicketFilterDefinition;
  aiFilterEnabled: boolean;
};

export function ViewsAndFiltersPanel(props: ViewsAndFiltersPanelProps) {
  const {
    filterOptions,
    template,
    savedViews,
    activeViewId,
    activeViewName,
    initialData,
    activeDefinition,
    aiFilterEnabled,
  } = props;

  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [busy, setBusy] = useState(false);
  const dataRef = useRef<TicketFilterData>(initialData);

  // AI mode state — respect the feature flag even for pre-existing AI saved views.
  const startsInAiMode = aiFilterEnabled && activeDefinition.type === 'ai';
  const [filterMode, setFilterMode] = useState<'standard' | 'ai'>(
    startsInAiMode ? 'ai' : 'standard',
  );
  const [aiPrompt, setAiPrompt] = useState(
    startsInAiMode ? (activeDefinition.prompt ?? '') : '',
  );
  const [aiChips, setAiChips] = useState<TicketFilterData | null>(
    startsInAiMode ? activeDefinition.data : null,
  );
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPending, startAiTransition] = useTransition();

  const schema = useMemo(
    () => buildTicketFilterSurveyJson(filterOptions, template),
    [filterOptions, template],
  );

  const surveyData = useMemo(
    () => dataToSurveyData(initialData),
    [initialData],
  );

  const model = useMemo(() => {
    const m = new Model(schema);
    m.showCompletedPage = false;
    m.completeText = 'Apply Filters';
    m.data = surveyData;

    m.addNavigationItem({
      id: 'sv-nav-clear-filtering',
      title: 'Clear All',
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
      applyStandardFilters(data, sql);
    };
    model.onComplete.add(handler);
    return () => { model.onComplete.remove(handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, activeViewId]);

  function buildUrlForData(data: TicketFilterData, viewId: string | null): string {
    if (viewId) return `/agent?view=${viewId}`;
    const params = dataToUrlParams(data);
    const qs = params.toString();
    return qs ? `/agent?${qs}` : '/agent';
  }

  function applyStandardFilters(data: TicketFilterData, sql: string) {
    if (activeViewId) {
      setBusy(true);
      void updateSavedViewDefinition({ viewId: activeViewId, type: 'json', data })
        .catch((err) => { console.error('updateSavedViewDefinition failed', err); })
        .finally(() => {
          setBusy(false);
          router.push(buildUrlForData(data, activeViewId));
          router.refresh();
        });
    } else {
      void sql;
      router.push(buildUrlForData(data, null));
    }
  }

  function applyAiFilters() {
    const data = aiChips ?? {};
    if (activeViewId) {
      setBusy(true);
      void updateSavedViewDefinition({ viewId: activeViewId, type: 'ai', data, prompt: aiPrompt })
        .catch((err) => { console.error('updateSavedViewDefinition failed', err); })
        .finally(() => {
          setBusy(false);
          router.push(buildUrlForData(data, activeViewId));
          router.refresh();
        });
    } else {
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

    setBusy(true);
    const isAi = filterMode === 'ai' && aiChips !== null;
    const args = isAi
      ? { name: trimmed, type: 'ai' as const, data: aiChips!, prompt: aiPrompt }
      : { name: trimmed, type: 'json' as const, data: dataRef.current };

    void createSavedViewReturnId(args)
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

  function handleAskAi() {
    setAiError(null);
    const fd = new FormData();
    fd.set('prompt', aiPrompt);
    startAiTransition(async () => {
      const result = await translateAiFilterPrompt(fd);
      if (result.error) {
        setAiError(result.error);
      } else {
        setAiChips(result.data);
      }
    });
  }

  function handleAiClear() {
    setAiChips(null);
    setAiPrompt('');
    setAiError(null);
  }

  const chipEntries = aiChips
    ? Object.entries(aiChips).filter(([, v]) => {
        if (v === undefined || v === null) return false;
        if (Array.isArray(v)) return v.length > 0;
        return String(v).length > 0;
      })
    : [];

  return (
    <div data-testid="views-and-filters-panel">
      {/* Saved Views Section */}
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Saved Views:</span>

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
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleAddCancel}
                className="text-sm px-2 py-0.5 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                aria-label="Cancel new view"
              >
                Cancel
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

      {/* Filter Mode Toggle (only when AI filter is enabled) */}
      {aiFilterEnabled && (
        <div className="flex gap-1 mb-4" role="group" aria-label="Filter mode">
          <button
            type="button"
            aria-pressed={filterMode === 'standard'}
            onClick={() => setFilterMode('standard')}
            className={`text-sm px-3 py-1 rounded-l border ${
              filterMode === 'standard'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Standard
          </button>
          <button
            type="button"
            aria-pressed={filterMode === 'ai'}
            onClick={() => setFilterMode('ai')}
            className={`text-sm px-3 py-1 rounded-r border-t border-b border-r ${
              filterMode === 'ai'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            ✨ AI
          </button>
        </div>
      )}

      {/* AI Filter Panel */}
      {filterMode === 'ai' && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2">
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Describe what you're looking for…"
              rows={3}
              className="w-full text-sm rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAskAi}
                disabled={aiPending || !aiPrompt.trim()}
                className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {aiPending ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Thinking…
                  </>
                ) : 'Ask AI ▶'}
              </button>
              <button
                type="button"
                onClick={handleAiClear}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Clear
              </button>
              {aiChips && (
                <button
                  type="button"
                  onClick={applyAiFilters}
                  disabled={busy}
                  className="text-sm px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Apply
                </button>
              )}
            </div>
          </div>

          {aiError && (
            <p role="alert" className="text-sm text-red-600">
              {aiError}
            </p>
          )}

          {chipEntries.length > 0 && (
            <div aria-label="Generated filters" className="flex flex-wrap gap-1.5">
              {chipEntries.map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5"
                >
                  {k}: {Array.isArray(v) ? v.join(', ') : String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Standard filter survey (hidden in AI mode) */}
      <div
        className={`pt-4 border-t border-gray-200 ${filterMode === 'ai' ? 'hidden' : ''}`}
        data-testid="filter-survey"
      >
        <Survey model={model} />
      </div>
    </div>
  );
}

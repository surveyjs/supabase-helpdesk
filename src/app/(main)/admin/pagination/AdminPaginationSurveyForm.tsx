'use client';

import { useMemo } from 'react';
import { updatePaginationSettings } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import paginationSchema from '@/components/features/survey/form-json/admin/pagination.json';

type PaginationValues = {
  user_page_size: number;
  agent_dashboard_page_size: number;
  other_lists_page_size: number;
  visible_posts_threshold: number;
  visible_comments_threshold: number;
};

export function AdminPaginationSurveyForm({ values }: { values: PaginationValues }) {
  const data = useMemo(
    () => ({
      user_page_size: values.user_page_size,
      agent_dashboard_page_size: values.agent_dashboard_page_size,
      other_lists_page_size: values.other_lists_page_size,
      visible_posts_threshold: values.visible_posts_threshold,
      visible_comments_threshold: values.visible_comments_threshold,
    }),
    [values],
  );

  const toFormData = useMemo(
    () => (surveyData: Record<string, unknown>) => {
      const fd = new FormData();
      const keys = [
        'user_page_size',
        'agent_dashboard_page_size',
        'other_lists_page_size',
        'visible_posts_threshold',
        'visible_comments_threshold',
      ] as const;

      for (const key of keys) {
        const raw = String(surveyData[key] ?? '').trim();
        fd.set(key, raw);
      }
      return fd;
    },
    [],
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="pagination-survey-form">
      <AdminSurveyForm
        schema={paginationSchema as Record<string, unknown>}
        data={data}
        mode="autosave"
        debounceMs={700}
        saveAction={updatePaginationSettings}
        toFormData={toFormData}
        successMessage="Settings saved."
      />
    </div>
  );
}

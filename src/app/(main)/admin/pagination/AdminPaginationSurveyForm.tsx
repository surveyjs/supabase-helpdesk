'use client';

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
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="pagination-survey-form">
      <AdminSurveyForm
        schema={paginationSchema as Record<string, unknown>}
        data={values}
        mode="autosave"
        debounceMs={700}
        saveAction={updatePaginationSettings}
        successMessage="Settings saved."
      />
    </div>
  );
}

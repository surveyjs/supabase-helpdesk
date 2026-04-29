'use client';

import { useMemo, useState, useTransition } from 'react';
import { updateEmailConfig, sendTestEmail, updateCoalescingDelay } from '@/lib/actions/admin';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import smtpSchema from '@/components/features/survey/form-json/admin/email-smtp.json';
import delaySchema from '@/components/features/survey/form-json/admin/email-delay.json';

type EmailConfig = {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  sender_email: string;
  sender_name: string;
  is_verified: boolean;
};

export function EmailConfigForm({
  config,
  coalescingDelay,
}: {
  config: EmailConfig | null;
  coalescingDelay: number;
}) {
  const [testMessage, setTestMessage] = useState('');
  const [testSuccess, setTestSuccess] = useState(false);
  const [testPending, startTestTransition] = useTransition();

  const smtpData = useMemo(
    () => ({
      smtp_host: config?.smtp_host ?? '',
      smtp_port: config?.smtp_port ?? 587,
      smtp_username: config?.smtp_username ?? '',
      smtp_password: '',
      sender_email: config?.sender_email ?? '',
      sender_name: config?.sender_name ?? 'HelpDesk',
    }),
    [config],
  );

  const delayData = useMemo(
    () => ({
      delay_minutes: coalescingDelay,
    }),
    [coalescingDelay],
  );

  const handleTestEmail = () => {
    setTestMessage('');
    setTestSuccess(false);
    startTestTransition(async () => {
      const result = await sendTestEmail();
      setTestMessage(result?.message ?? 'Test email sent.');
      setTestSuccess(result?.success ?? false);
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4" data-testid="email-smtp-survey-form">
        <h2 className="text-lg font-medium text-gray-900">SMTP Settings</h2>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-gray-500">Status:</span>
          {config?.is_verified ? (
            <span className="text-green-600 text-sm font-medium">Verified</span>
          ) : (
            <span className="text-red-600 text-sm font-medium">Not verified</span>
          )}
        </div>

        <AdminSurveyForm
          schema={smtpSchema as Record<string, unknown>}
          data={smtpData}
          mode="autosave"
          debounceMs={700}
          saveAction={updateEmailConfig}
          successMessage="Email configuration saved."
        />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="email-test-button">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Test Email</h2>
        <p className="text-sm text-gray-500 mb-3">
          Send a test email to your admin email address to verify the SMTP configuration.
        </p>

        {testMessage && (
          <p className={`text-sm mb-3 ${testSuccess ? 'text-green-600' : 'text-red-600'}`}>
            {testMessage}
          </p>
        )}

        <button
          type="button"
          onClick={handleTestEmail}
          disabled={testPending}
          className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 font-medium disabled:opacity-50"
        >
          {testPending ? 'Sending...' : 'Send Test Email'}
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4" data-testid="email-delay-survey-form">
        <h2 className="text-lg font-medium text-gray-900">Notification Coalescing</h2>
        <p className="text-sm text-gray-500">
          How long to wait after an agent action before sending email notifications.
          Additional agent actions during this window are consolidated into a single email.
        </p>

        <AdminSurveyForm
          schema={delaySchema as Record<string, unknown>}
          data={delayData}
          mode="autosave"
          debounceMs={700}
          saveAction={updateCoalescingDelay}
          successMessage="Coalescing delay saved."
        />

        <p className="text-xs text-gray-500">0 = disabled (notifications sent immediately). Max: 15.</p>
      </div>
    </div>
  );
}

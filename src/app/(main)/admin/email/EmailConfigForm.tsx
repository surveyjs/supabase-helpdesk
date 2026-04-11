'use client';

import { useActionState } from 'react';
import { updateEmailConfig, sendTestEmail, updateCoalescingDelay } from '@/lib/actions/admin';

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
  const [configState, configAction, configPending] = useActionState(
    async (_prev: { message?: string }, formData: FormData) => {
      const result = await updateEmailConfig(formData);
      return result;
    },
    {},
  );

  const [testState, testAction, testPending] = useActionState(
    async (_prev: { message?: string; success?: boolean }) => {
      const result = await sendTestEmail();
      return result;
    },
    {},
  );

  const [delayState, delayAction, delayPending] = useActionState(
    async (_prev: { message?: string }, formData: FormData) => {
      const result = await updateCoalescingDelay(formData);
      return result;
    },
    {},
  );

  return (
    <div className="space-y-6">
      {/* SMTP Configuration */}
      <form action={configAction} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">SMTP Settings</h2>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-gray-500">Status:</span>
          {config?.is_verified ? (
            <span className="text-green-600 text-sm font-medium">&#10003; Verified</span>
          ) : (
            <span className="text-red-600 text-sm font-medium">&#10007; Not verified</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="smtp_host" className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
            <input
              type="text"
              name="smtp_host"
              id="smtp_host"
              defaultValue={config?.smtp_host ?? ''}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="smtp_port" className="block text-sm font-medium text-gray-700 mb-1">SMTP Port</label>
            <input
              type="number"
              name="smtp_port"
              id="smtp_port"
              defaultValue={config?.smtp_port ?? 587}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="smtp_username" className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              name="smtp_username"
              id="smtp_username"
              defaultValue={config?.smtp_username ?? ''}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="smtp_password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              name="smtp_password"
              id="smtp_password"
              placeholder={config?.smtp_password ? '••••••••' : ''}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="sender_email" className="block text-sm font-medium text-gray-700 mb-1">Sender Email</label>
            <input
              type="email"
              name="sender_email"
              id="sender_email"
              defaultValue={config?.sender_email ?? ''}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="sender_name" className="block text-sm font-medium text-gray-700 mb-1">Sender Name</label>
            <input
              type="text"
              name="sender_name"
              id="sender_name"
              defaultValue={config?.sender_name ?? 'HelpDesk'}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        {configState?.message && (
          <p className={`text-sm ${configState.message.includes('error') || configState.message.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
            {configState.message}
          </p>
        )}

        <button
          type="submit"
          disabled={configPending}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
        >
          {configPending ? 'Saving...' : 'Save'}
        </button>
      </form>

      {/* Send Test Email */}
      <form action={testAction} className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Test Email</h2>
        <p className="text-sm text-gray-500 mb-3">
          Send a test email to your admin email address to verify the SMTP configuration.
        </p>

        {testState?.message && (
          <p className={`text-sm mb-3 ${testState.success ? 'text-green-600' : 'text-red-600'}`}>
            {testState.message}
          </p>
        )}

        <button
          type="submit"
          disabled={testPending}
          className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 font-medium disabled:opacity-50"
        >
          {testPending ? 'Sending...' : 'Send Test Email'}
        </button>
      </form>

      {/* Coalescing Delay */}
      <form action={delayAction} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Notification Coalescing</h2>
        <p className="text-sm text-gray-500">
          How long to wait after an agent action before sending email notifications.
          Additional agent actions during this window are consolidated into a single email.
        </p>

        <div>
          <label htmlFor="delay_minutes" className="block text-sm font-medium text-gray-700 mb-1">
            Delay (minutes)
          </label>
          <input
            type="number"
            name="delay_minutes"
            id="delay_minutes"
            min={0}
            max={15}
            defaultValue={coalescingDelay}
            className="w-32 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">0 = disabled (notifications sent immediately). Max: 15.</p>
        </div>

        {delayState?.message && (
          <p className={`text-sm ${delayState.message.includes('error') || delayState.message.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
            {delayState.message}
          </p>
        )}

        <button
          type="submit"
          disabled={delayPending}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
        >
          {delayPending ? 'Saving...' : 'Save'}
        </button>
      </form>
    </div>
  );
}

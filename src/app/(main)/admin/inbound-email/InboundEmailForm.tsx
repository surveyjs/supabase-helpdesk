'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { updateInboundEmailSettings } from '@/lib/actions/admin';

type AutoReplyTemplate = {
  event_type: string;
  subject: string;
};

export function InboundEmailForm({
  enabled,
  replyToAddress,
  autoReplyTemplates,
}: {
  enabled: boolean;
  replyToAddress: string;
  autoReplyTemplates: AutoReplyTemplate[];
}) {
  const [state, formAction, isPending] = useActionState(
    async (_prev: { message?: string }, formData: FormData) => {
      const result = await updateInboundEmailSettings(formData);
      return result;
    },
    {},
  );

  const templateLabels: Record<string, string> = {
    auto_reply_unknown_sender: 'Unknown Sender',
    auto_reply_blocked_user: 'Blocked User',
    auto_reply_duplicate_ticket: 'Duplicate Ticket',
    auto_reply_rate_limit: 'Rate Limit',
  };

  return (
    <div className="space-y-6">
      {/* Inbound Email Configuration */}
      <form action={formAction} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Configuration</h2>
        <p className="text-sm text-gray-500">
          Enable inbound email processing to allow users to create tickets and reply to existing tickets by email.
        </p>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            name="inbound_email_enabled"
            id="inbound_email_enabled"
            defaultChecked={enabled}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="inbound_email_enabled" className="text-sm font-medium text-gray-700">
            Enable inbound email processing
          </label>
        </div>

        <div>
          <label htmlFor="reply_to_address" className="block text-sm font-medium text-gray-700 mb-1">
            Reply-To Address
          </label>
          <input
            type="email"
            name="reply_to_address"
            id="reply_to_address"
            defaultValue={replyToAddress}
            placeholder="support@example.com"
            className="w-full max-w-md rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            This address is used as the Reply-To header in outbound notification emails so replies are routed back to the system.
          </p>
        </div>

        {state?.message && (
          <p className={`text-sm ${state.message.includes('error') || state.message.includes('Error') || state.message.includes('required') ? 'text-red-600' : 'text-green-600'}`}>
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save'}
        </button>
      </form>

      {/* Auto-Reply Templates */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Auto-Reply Templates</h2>
        <p className="text-sm text-gray-500 mb-4">
          Auto-reply emails are sent when inbound emails cannot be processed.
          Edit these templates in the{' '}
          <Link href="/admin/templates" className="text-blue-600 hover:text-blue-800 underline">
            Notification Templates
          </Link>{' '}
          section.
        </p>

        <div className="divide-y divide-gray-100">
          {autoReplyTemplates.map((tpl) => (
            <div key={tpl.event_type} className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm font-medium text-gray-700">
                  {templateLabels[tpl.event_type] ?? tpl.event_type}
                </span>
                <span className="ml-2 text-xs text-gray-500">
                  {tpl.subject}
                </span>
              </div>
              <Link
                href="/admin/templates"
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Edit
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Webhook Configuration Info */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Webhook Endpoint</h2>
        <p className="text-sm text-gray-500 mb-3">
          Configure your email service provider to forward inbound emails to the following endpoint:
        </p>
        <code className="block bg-gray-50 px-3 py-2 rounded text-sm text-gray-800 font-mono">
          POST /api/inbound-email
        </code>
        <p className="text-xs text-gray-500 mt-2">
          Set the <code className="text-gray-600">INBOUND_EMAIL_WEBHOOK_SECRET</code> environment variable and
          include it as a Bearer token in the Authorization header.
        </p>
      </div>
    </div>
  );
}

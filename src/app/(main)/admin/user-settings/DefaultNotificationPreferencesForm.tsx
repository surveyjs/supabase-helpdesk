'use client';

import { useState, useTransition } from 'react';
import { updateDefaultNotificationPreferences } from '@/lib/actions/admin';

type Prefs = Record<string, { email?: boolean; in_app?: boolean }>;

const EVENT_TYPES = [
  { key: 'new_post', label: 'New Reply' },
  { key: 'status_changed', label: 'Status Changed' },
  { key: 'agent_assigned', label: 'Agent Assigned' },
  { key: 'agent_assigned_to_agent', label: 'Assigned to Agent' },
  { key: 'user_reply_to_agent', label: 'User Reply (agent)' },
  { key: 'auto_reopen', label: 'Auto Re-open' },
  { key: 'urgency_changed', label: 'Urgency Changed' },
  { key: 'severity_changed', label: 'Severity Changed' },
  { key: 'privacy_changed', label: 'Privacy Changed' },
];

export function DefaultNotificationPreferencesForm({
  preferences,
}: {
  preferences: Prefs;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const initial: Prefs = {};
    for (const et of EVENT_TYPES) {
      initial[et.key] = preferences[et.key] ?? { email: true, in_app: true };
    }
    return initial;
  });
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState('');

  function toggle(key: string, channel: 'email' | 'in_app') {
    setPrefs((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [channel]: !prev[key]?.[channel],
      },
    }));
  }

  function handleSave() {
    setMessage('');
    startTransition(async () => {
      const formData = new FormData();
      formData.set('preferences', JSON.stringify(prefs));
      await updateDefaultNotificationPreferences(formData);
      setMessage('Default preferences saved.');
    });
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-2">Default Notification Preferences</h3>
      <p className="text-sm text-gray-500 mb-4">
        Set the system-wide defaults for new user accounts. Existing users are not affected.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 font-medium text-gray-700">Event Type</th>
            <th className="text-center py-2 font-medium text-gray-700 w-24">Email</th>
            <th className="text-center py-2 font-medium text-gray-700 w-24">In-App</th>
          </tr>
        </thead>
        <tbody>
          {EVENT_TYPES.map((et) => (
            <tr key={et.key} className="border-b border-gray-100">
              <td className="py-2 text-gray-700">{et.label}</td>
              <td className="py-2 text-center">
                <input
                  type="checkbox"
                  checked={prefs[et.key]?.email !== false}
                  onChange={() => toggle(et.key, 'email')}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
              </td>
              <td className="py-2 text-center">
                <input
                  type="checkbox"
                  checked={prefs[et.key]?.in_app !== false}
                  onChange={() => toggle(et.key, 'in_app')}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save Defaults'}
        </button>
        {message && <span className="text-sm text-green-600">{message}</span>}
      </div>
    </div>
  );
}

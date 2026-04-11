'use client';

import { useState, useTransition } from 'react';
import { updateNotificationPreferences } from '@/lib/actions/notifications';

type EventType = { key: string; label: string };
type Prefs = Record<string, { email?: boolean; in_app?: boolean }>;

export function NotificationPreferencesForm({
  eventTypes,
  preferences,
}: {
  eventTypes: EventType[];
  preferences: Prefs;
}) {
  const [prefs, setPrefs] = useState<Prefs>(preferences);
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
      const result = await updateNotificationPreferences(prefs);
      if (result.error) {
        setMessage(result.error);
      } else {
        setMessage('Preferences saved.');
      }
    });
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 font-medium text-gray-700">Event Type</th>
            <th className="text-center py-2 font-medium text-gray-700 w-24">Email</th>
            <th className="text-center py-2 font-medium text-gray-700 w-24">In-App</th>
          </tr>
        </thead>
        <tbody>
          {eventTypes.map((et) => (
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
                  title="In-app notifications coming soon"
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
          {isPending ? 'Saving...' : 'Save'}
        </button>
        {message && (
          <span className={`text-sm ${message.includes('error') || message.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
            {message}
          </span>
        )}
      </div>
    </div>
  );
}

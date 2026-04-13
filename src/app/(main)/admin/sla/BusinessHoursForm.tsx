'use client';

import { useRef } from 'react';

type DaySchedule = { start: string; end: string } | null;

type BusinessHoursConfig = {
  timezone: string;
  schedule: Record<string, DaySchedule>;
};

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function BusinessHoursForm({
  config,
  updateAction,
}: {
  config: BusinessHoursConfig;
  updateAction: (formData: FormData) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    const timezone = formData.get('timezone') as string;
    const schedule: Record<string, DaySchedule> = {};

    for (const day of DAYS) {
      const enabled = formData.get(`${day}_enabled`) === 'on';
      if (enabled) {
        schedule[day] = {
          start: (formData.get(`${day}_start`) as string) || '09:00',
          end: (formData.get(`${day}_end`) as string) || '17:00',
        };
      } else {
        schedule[day] = null;
      }
    }

    const newConfig: BusinessHoursConfig = { timezone, schedule };
    const fd = new FormData();
    fd.set('business_hours_config', JSON.stringify(newConfig));
    return updateAction(fd);
  }

  return (
    <form action={handleSubmit} ref={formRef} data-testid="business-hours-form">
      <div className="mb-4">
        <label className="block text-sm text-gray-700 mb-1">Timezone</label>
        <select
          name="timezone"
          defaultValue={config.timezone}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm w-64"
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </div>

      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-2 text-gray-600">Day</th>
            <th className="text-left py-2 px-2 text-gray-600">Enabled</th>
            <th className="text-left py-2 px-2 text-gray-600">Start</th>
            <th className="text-left py-2 px-2 text-gray-600">End</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => {
            const dayConfig = config.schedule[day];
            return (
              <tr key={day} className="border-b border-gray-100">
                <td className="py-2 px-2 font-medium capitalize">{day}</td>
                <td className="py-2 px-2">
                  <input
                    type="checkbox"
                    name={`${day}_enabled`}
                    defaultChecked={dayConfig !== null}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="time"
                    name={`${day}_start`}
                    defaultValue={dayConfig?.start ?? '09:00'}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="time"
                    name={`${day}_end`}
                    defaultValue={dayConfig?.end ?? '17:00'}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button
        type="submit"
        className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
      >
        Save Business Hours
      </button>
    </form>
  );
}

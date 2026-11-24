'use client';

import { useActionState } from 'react';
import { saveUserFieldValues } from '@/lib/actions/agent';
import type { UserFieldWithValue } from '@/lib/users/user-fields';

/** Staff editor for a person's user custom fields (#103). */
export function UserFieldsForm({ userId, fields }: { userId: string; fields: UserFieldWithValue[] }) {
  const [state, action, pending] = useActionState(saveUserFieldValues, {});

  return (
    <form action={action} className="space-y-4" data-testid="user-fields-form">
      <input type="hidden" name="user_id" value={userId} />
      {fields.map((f) => {
        const id = `user-field-${f.id}`;
        const name = `field_${f.id}`;
        const label = (
          <span className="flex items-center gap-2">
            {f.name}
            {f.agent_only && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-600">Staff only</span>
            )}
          </span>
        );
        if (f.field_type === 'checkbox') {
          return (
            <label key={f.id} htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input id={id} type="checkbox" name={name} defaultChecked={f.value === true} className="h-4 w-4" />
              {label}
            </label>
          );
        }
        return (
          <div key={f.id}>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            {f.field_type === 'dropdown' ? (
              <select id={id} name={name} defaultValue={typeof f.value === 'string' ? f.value : ''} className="form-input block w-full">
                <option value="">—</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                id={id}
                name={name}
                type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
                defaultValue={f.value === null || f.value === undefined ? '' : String(f.value)}
                maxLength={f.field_type === 'text' ? 1000 : undefined}
                className="form-input block w-full"
              />
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
          data-testid="save-user-fields-btn"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        {state.message && !pending && <p role="status" className="text-sm text-green-700">{state.message}</p>}
      </div>
    </form>
  );
}

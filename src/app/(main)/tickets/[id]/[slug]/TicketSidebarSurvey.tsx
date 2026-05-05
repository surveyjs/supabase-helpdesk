'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SurveyJsonForm } from '@/components/features/survey/SurveyJsonForm';
import {
  changeTicketStatus,
  changeUrgency,
  changeSeverity,
  changeType,
  changeCategory,
  toggleTicketPrivacy,
  assignAgent,
  reassignAgent,
  unassignAgent,
  addTagToTicket,
  removeTagFromTicket,
} from '@/lib/actions/agent';
import { followTicket, unfollowTicket } from '@/lib/actions/tickets';

export type SidebarLookupOption = { id: string; name: string };
export type SidebarAgentOption = { id: string; display_name: string | null; email: string };
export type SidebarTagOption = { id: string; name: string };

export type SidebarFieldFlags = {
  status: boolean;
  urgency: boolean;
  severity: boolean;
  type: boolean;
  category: boolean;
  assigned: boolean;
  visibility: boolean;
  tags: boolean;
  follow: boolean;
};

export type TicketSidebarSurveyProps = {
  ticketId: string;
  isAgent: boolean;
  fields: SidebarFieldFlags;
  initial: {
    status: string;
    urgency: string;
    severity: string;
    type_id: string;
    category_id: string;
    assigned_agent_id: string;
    is_private: boolean;
    is_following: boolean;
    tag_ids: string[];
  };
  options: {
    types: SidebarLookupOption[];
    categories: SidebarLookupOption[];
    agents: SidebarAgentOption[];
    tags: SidebarTagOption[];
  };
};

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function TicketSidebarSurvey({
  ticketId,
  isAgent,
  fields,
  initial,
  options,
}: TicketSidebarSurveyProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const previousRef = useRef(initial);

  type FieldEntry = {
    flag: boolean;
    schema: Record<string, unknown>;
    dispatch: (
      prev: TicketSidebarSurveyProps['initial'],
      data: Record<string, unknown>,
    ) => Array<Promise<unknown>>;
  };

  const fieldEntries = useMemo<Array<FieldEntry & { key: string }>>(() => {
    const entries: Array<FieldEntry & { key: string }> = [
      {
        key: 'status',
        flag: fields.status,
        schema: {
          type: 'dropdown',
          name: 'status',
          title: 'Status',
          // `tickets.status` is NOT NULL DEFAULT 'open' in Supabase, so the
          // SurveyJS question mirrors that default and disallows clearing.
          defaultValue: 'open',
          allowClear: false,
          choices: [
            { value: 'pending', text: 'Pending' },
            { value: 'open', text: 'Open' },
            { value: 'closed', text: 'Closed' },
          ],
        },
        dispatch: (prev, data) => {
          const v = asString(data.status);
          if (v && v !== prev.status) {
            return [changeTicketStatus(makeFormData({ ticket_id: ticketId, new_status: v }))];
          }
          return [];
        },
      },
      {
        key: 'urgency',
        flag: fields.urgency,
        schema: {
          type: 'dropdown',
          name: 'urgency',
          title: 'Urgency',
          // `tickets.urgency` is NOT NULL DEFAULT 'medium' in Supabase.
          defaultValue: 'medium',
          allowClear: false,
          choices: [
            { value: 'low', text: 'Low' },
            { value: 'medium', text: 'Medium' },
            { value: 'high', text: 'High' },
            { value: 'critical', text: 'Critical' },
          ],
        },
        dispatch: (prev, data) => {
          const v = asString(data.urgency);
          if (v && v !== prev.urgency) {
            return [changeUrgency(makeFormData({ ticket_id: ticketId, new_urgency: v }))];
          }
          return [];
        },
      },
      {
        key: 'severity',
        flag: fields.severity,
        schema: {
          type: 'dropdown',
          name: 'severity',
          title: 'Severity',
          // `tickets.severity` is NOT NULL DEFAULT 'medium' in Supabase, so
          // the SurveyJS question mirrors that default and disallows clearing.
          defaultValue: 'medium',
          allowClear: false,
          choices: [
            { value: 'low', text: 'Low' },
            { value: 'medium', text: 'Medium' },
            { value: 'high', text: 'High' },
            { value: 'critical', text: 'Critical' },
          ],
        },
        dispatch: (prev, data) => {
          const v = asString(data.severity);
          if (v && v !== prev.severity) {
            return [changeSeverity(makeFormData({ ticket_id: ticketId, new_severity: v }))];
          }
          return [];
        },
      },
      {
        key: 'type',
        flag: fields.type && options.types.length > 0,
        schema: {
          type: 'dropdown',
          name: 'type_id',
          title: 'Type',
          choices: options.types.map((t) => ({ value: t.id, text: t.name })),
        },
        dispatch: (prev, data) => {
          const v = asString(data.type_id);
          if (v && v !== prev.type_id) {
            return [changeType(makeFormData({ ticket_id: ticketId, new_type_id: v }))];
          }
          return [];
        },
      },
      {
        key: 'category',
        flag: fields.category,
        schema: {
          type: 'dropdown',
          name: 'category_id',
          title: 'Category',
          choices: [{ value: '', text: 'None' }, ...options.categories.map((c) => ({ value: c.id, text: c.name }))],
        },
        dispatch: (prev, data) => {
          const v = asString(data.category_id);
          if (v !== prev.category_id) {
            return [changeCategory(makeFormData({ ticket_id: ticketId, new_category_id: v }))];
          }
          return [];
        },
      },
      {
        key: 'assigned',
        flag: fields.assigned && isAgent,
        schema: {
          type: 'dropdown',
          name: 'assigned_agent_id',
          title: 'Assigned Agent',
          choices: [
            { value: '', text: 'Unassigned' },
            ...options.agents.map((a) => ({
              value: a.id,
              text: `${a.display_name ?? 'Agent'} (${a.email})`,
            })),
          ],
        },
        dispatch: (prev, data) => {
          const v = asString(data.assigned_agent_id);
          if (v === prev.assigned_agent_id) return [];
          if (v === '') {
            return [unassignAgent(makeFormData({ ticket_id: ticketId }))];
          }
          if (prev.assigned_agent_id === '') {
            return [assignAgent(makeFormData({ ticket_id: ticketId, agent_id: v }))];
          }
          return [reassignAgent(makeFormData({ ticket_id: ticketId, agent_id: v, reason: '' }))];
        },
      },
      {
        key: 'tags',
        flag: fields.tags && options.tags.length > 0,
        schema: {
          type: 'tagbox',
          name: 'tag_ids',
          title: 'Tags',
          choices: options.tags.map((t) => ({ value: t.id, text: t.name })),
          showSelectAllItem: false,
        },
        dispatch: (prev, data) => {
          const next = asStringArray(data.tag_ids);
          const removed = prev.tag_ids.filter((id) => !next.includes(id));
          const added = next.filter((id) => !prev.tag_ids.includes(id));
          const tasks: Array<Promise<unknown>> = [];
          for (const tagId of removed) {
            tasks.push(removeTagFromTicket(makeFormData({ ticket_id: ticketId, tag_id: tagId })));
          }
          for (const tagId of added) {
            tasks.push(addTagToTicket(makeFormData({ ticket_id: ticketId, tag_id: tagId })));
          }
          return tasks;
        },
      },
      {
        key: 'visibility',
        flag: fields.visibility,
        schema: {
          type: 'boolean',
          name: 'is_private',
          title: 'Private ticket',
          renderAs: 'checkbox',
          // `tickets.is_private` is NOT NULL DEFAULT true in Supabase.
          defaultValue: true,
        },
        dispatch: (prev, data) => {
          const v = asBool(data.is_private);
          if (v !== prev.is_private) {
            return [toggleTicketPrivacy(makeFormData({ ticket_id: ticketId }))];
          }
          return [];
        },
      },
      {
        key: 'follow',
        flag: fields.follow,
        schema: {
          type: 'boolean',
          name: 'is_following',
          title: 'Follow this ticket',
          renderAs: 'checkbox',
        },
        dispatch: (prev, data) => {
          const v = asBool(data.is_following);
          if (v === prev.is_following) return [];
          return [
            v
              ? followTicket(makeFormData({ ticket_id: ticketId }))
              : unfollowTicket(makeFormData({ ticket_id: ticketId })),
          ];
        },
      },
    ];
    return entries;
  }, [fields, isAgent, options, ticketId]);

  const schema = useMemo(() => {
    // Logical row groups. First active item in a group keeps its default
    // newline; subsequent items get startWithNewLine:false to sit beside it.
    const groups: string[][] = [
      ['status', 'urgency'],
      ['severity', 'type'],
      ['category'],
      ['assigned'],
      ['tags'],
      ['visibility', 'follow'],
    ];
    const byKey = new Map(fieldEntries.map((e) => [e.key, e]));
    const elements: Array<Record<string, unknown>> = [];
    for (const group of groups) {
      const active = group
        .map((k) => byKey.get(k))
        .filter((e): e is (typeof fieldEntries)[number] => Boolean(e?.flag));
      active.forEach((entry, idx) => {
        elements.push(idx === 0 ? entry.schema : { ...entry.schema, startWithNewLine: false });
      });
    }

    return {
      showQuestionNumbers: 'off',
      pages: [{ name: 'sidebar', elements }],
    };
  }, [fieldEntries]);

  const onValueChanged = (data: Record<string, unknown>) => {
    const prev = previousRef.current;
    const tasks: Array<Promise<unknown>> = [];
    for (const entry of fieldEntries) {
      if (!entry.flag) continue;
      tasks.push(...entry.dispatch(prev, data));
    }

    if (tasks.length === 0) return;

    previousRef.current = {
      status: asString(data.status) || prev.status,
      urgency: asString(data.urgency) || prev.urgency,
      severity: asString(data.severity) || prev.severity,
      type_id: asString(data.type_id) || prev.type_id,
      category_id: asString(data.category_id),
      assigned_agent_id: asString(data.assigned_agent_id),
      is_private: asBool(data.is_private),
      is_following: asBool(data.is_following),
      tag_ids: asStringArray(data.tag_ids),
    };

    startTransition(async () => {
      try {
        await Promise.all(tasks);
        setMessage('Saved');
        router.refresh();
      } catch {
        setMessage('Failed to save changes');
      }
    });
  };

  return (
    <div data-testid="ticket-sidebar-survey">
      <SurveyJsonForm schema={schema} data={initial} onValueChanged={onValueChanged} mode="autosave" />
      <p
        aria-live="polite"
        className="mt-2 min-h-[1rem] text-xs text-gray-500"
        data-testid="ticket-sidebar-survey-status"
      >
        {isPending ? 'Saving…' : message ?? ''}
      </p>
    </div>
  );
}

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

  const schema = useMemo(() => {
    const elements: Array<Record<string, unknown>> = [];

    if (fields.status) {
      elements.push({
        type: 'dropdown',
        name: 'status',
        title: 'Status',
        choices: [
          { value: 'pending', text: 'Pending' },
          { value: 'open', text: 'Open' },
          { value: 'closed', text: 'Closed' },
        ],
      });
    }
    if (fields.urgency) {
      elements.push({
        type: 'dropdown',
        name: 'urgency',
        title: 'Urgency',
        choices: [
          { value: 'low', text: 'Low' },
          { value: 'medium', text: 'Medium' },
          { value: 'high', text: 'High' },
          { value: 'critical', text: 'Critical' },
        ],
        startWithNewLine: fields.status ? false : true,
      });
    }
    if (fields.severity) {
      elements.push({
        type: 'dropdown',
        name: 'severity',
        title: 'Severity',
        choices: [
          { value: 'low', text: 'Low' },
          { value: 'medium', text: 'Medium' },
          { value: 'high', text: 'High' },
          { value: 'critical', text: 'Critical' },
        ],
      });
    }
    if (fields.type && options.types.length > 0) {
      elements.push({
        type: 'dropdown',
        name: 'type_id',
        title: 'Type',
        choices: options.types.map((t) => ({ value: t.id, text: t.name })),
        startWithNewLine: fields.severity ? false : true,
      });
    }
    if (fields.category) {
      elements.push({
        type: 'dropdown',
        name: 'category_id',
        title: 'Category',
        choices: [{ value: '', text: 'None' }, ...options.categories.map((c) => ({ value: c.id, text: c.name }))],
      });
    }
    if (fields.assigned && isAgent) {
      elements.push({
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
      });
    }
    if (fields.tags && options.tags.length > 0) {
      elements.push({
        type: 'tagbox',
        name: 'tag_ids',
        title: 'Tags',
        choices: options.tags.map((t) => ({ value: t.id, text: t.name })),
        showSelectAllItem: false,
      });
    }
    if (fields.visibility) {
      elements.push({
        type: 'boolean',
        name: 'is_private',
        title: 'Private ticket',
        renderAs: 'checkbox',
      });
    }
    if (fields.follow) {
      elements.push({
        type: 'boolean',
        name: 'is_following',
        title: 'Follow this ticket',
        renderAs: 'checkbox',
        startWithNewLine: fields.visibility ? false : true,
      });
    }

    return {
      showQuestionNumbers: 'off',
      pages: [{ name: 'sidebar', elements }],
    };
  }, [fields, isAgent, options]);

  const onValueChanged = (data: Record<string, unknown>) => {
    const prev = previousRef.current;
    const tasks: Array<Promise<unknown>> = [];

    if (fields.status) {
      const v = asString(data.status);
      if (v && v !== prev.status) {
        tasks.push(changeTicketStatus(makeFormData({ ticket_id: ticketId, new_status: v })));
      }
    }
    if (fields.urgency) {
      const v = asString(data.urgency);
      if (v && v !== prev.urgency) {
        tasks.push(changeUrgency(makeFormData({ ticket_id: ticketId, new_urgency: v })));
      }
    }
    if (fields.severity) {
      const v = asString(data.severity);
      if (v && v !== prev.severity) {
        tasks.push(changeSeverity(makeFormData({ ticket_id: ticketId, new_severity: v })));
      }
    }
    if (fields.type) {
      const v = asString(data.type_id);
      if (v && v !== prev.type_id) {
        tasks.push(changeType(makeFormData({ ticket_id: ticketId, new_type_id: v })));
      }
    }
    if (fields.category) {
      const v = asString(data.category_id);
      if (v !== prev.category_id) {
        tasks.push(changeCategory(makeFormData({ ticket_id: ticketId, new_category_id: v })));
      }
    }
    if (fields.assigned && isAgent) {
      const v = asString(data.assigned_agent_id);
      if (v !== prev.assigned_agent_id) {
        if (v === '') {
          tasks.push(unassignAgent(makeFormData({ ticket_id: ticketId })));
        } else if (prev.assigned_agent_id === '') {
          tasks.push(assignAgent(makeFormData({ ticket_id: ticketId, agent_id: v })));
        } else {
          tasks.push(reassignAgent(makeFormData({ ticket_id: ticketId, agent_id: v, reason: '' })));
        }
      }
    }
    if (fields.tags) {
      const next = asStringArray(data.tag_ids);
      const removed = prev.tag_ids.filter((id) => !next.includes(id));
      const added = next.filter((id) => !prev.tag_ids.includes(id));
      for (const tagId of removed) {
        tasks.push(removeTagFromTicket(makeFormData({ ticket_id: ticketId, tag_id: tagId })));
      }
      for (const tagId of added) {
        tasks.push(addTagToTicket(makeFormData({ ticket_id: ticketId, tag_id: tagId })));
      }
    }
    if (fields.visibility) {
      const v = asBool(data.is_private);
      if (v !== prev.is_private) {
        tasks.push(toggleTicketPrivacy(makeFormData({ ticket_id: ticketId })));
      }
    }
    if (fields.follow) {
      const v = asBool(data.is_following);
      if (v !== prev.is_following) {
        if (v) {
          tasks.push(followTicket(makeFormData({ ticket_id: ticketId })));
        } else {
          tasks.push(unfollowTicket(makeFormData({ ticket_id: ticketId })));
        }
      }
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

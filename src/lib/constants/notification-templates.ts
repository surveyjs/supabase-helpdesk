/**
 * Default notification templates.
 * Used at seed time and for "Reset to Default" functionality.
 */
export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string }> = {
  new_post: {
    subject: 'New reply on your ticket',
    body: 'There is a new reply on your ticket "{{ticketTitle}}".',
  },
  status_changed: {
    subject: 'Ticket status updated',
    body: 'The status of your ticket "{{ticketTitle}}" has been changed to {{newStatus}}.',
  },
  agent_assigned: {
    subject: 'Agent assigned to your ticket',
    body: 'An agent has been assigned to your ticket "{{ticketTitle}}".',
  },
  agent_assigned_to_agent: {
    subject: "You've been assigned a ticket",
    body: 'You have been assigned to ticket "{{ticketTitle}}".',
  },
  user_reply_to_agent: {
    subject: 'New reply on your assigned ticket',
    body: 'There is a new reply on your assigned ticket "{{ticketTitle}}" from {{authorName}}.',
  },
  auto_reopen: {
    subject: 'Ticket re-opened by user reply',
    body: 'Ticket "{{ticketTitle}}" has been re-opened by a new reply from {{authorName}}.',
  },
  duplicate_post: {
    subject: 'Ticket marked as duplicate',
    body: 'This ticket has been closed as a duplicate of [#{{ticketId}}](/tickets/{{ticketId}}/redirect).',
  },
  merge_post: {
    subject: 'Ticket merged',
    body: 'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}/redirect).',
  },
  merge_banner: {
    subject: 'Merge stub banner',
    body: 'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}/redirect). All posts have been moved.',
  },
  urgency_changed: {
    subject: 'Ticket urgency updated',
    body: 'The urgency of your ticket "{{ticketTitle}}" has been changed to {{newUrgency}}.',
  },
  severity_changed: {
    subject: 'Ticket severity updated',
    body: 'The severity of your ticket "{{ticketTitle}}" has been changed to {{newSeverity}}.',
  },
  privacy_changed: {
    subject: 'Ticket privacy updated',
    body: 'The privacy setting of your ticket "{{ticketTitle}}" has been updated.',
  },
  consolidated_update: {
    subject: 'Updates on your ticket',
    body: 'There have been updates to your ticket "{{ticketTitle}}":\n\n{{changeList}}',
  },
  bulk_action_summary: {
    subject: '{{actionType}} applied to {{ticketCount}} tickets',
    body: 'Agent {{actorName}} performed a bulk action: {{actionType}} on {{ticketCount}} ticket(s).\n\nAffected tickets:\n{{ticketList}}',
  },
};

/** Available placeholders per event type */
export const TEMPLATE_PLACEHOLDERS: Record<string, string[]> = {
  new_post: ['ticketTitle', 'ticketId', 'authorName'],
  status_changed: ['ticketTitle', 'ticketId', 'newStatus', 'oldStatus'],
  agent_assigned: ['ticketTitle', 'ticketId', 'agentName'],
  agent_assigned_to_agent: ['ticketTitle', 'ticketId', 'agentName'],
  user_reply_to_agent: ['ticketTitle', 'ticketId', 'authorName'],
  auto_reopen: ['ticketTitle', 'ticketId', 'authorName'],
  duplicate_post: ['ticketId'],
  merge_post: ['ticketId'],
  merge_banner: ['ticketId'],
  urgency_changed: ['ticketTitle', 'ticketId', 'oldUrgency', 'newUrgency'],
  severity_changed: ['ticketTitle', 'ticketId', 'oldSeverity', 'newSeverity'],
  privacy_changed: ['ticketTitle', 'ticketId'],
  consolidated_update: ['ticketTitle', 'ticketId', 'ticketUrl', 'changeList', 'agentName', 'ownerName'],
  bulk_action_summary: ['actionType', 'ticketCount', 'actorName', 'ticketList'],
};

/** Human-readable label for event types */
export const TEMPLATE_LABELS: Record<string, string> = {
  new_post: 'New Reply',
  status_changed: 'Status Changed',
  agent_assigned: 'Agent Assigned (to user)',
  agent_assigned_to_agent: 'Agent Assigned (to agent)',
  user_reply_to_agent: 'User Reply (to agent)',
  auto_reopen: 'Auto Re-open',
  duplicate_post: 'Duplicate Post',
  merge_post: 'Merge Post',
  merge_banner: 'Merge Banner',
  urgency_changed: 'Urgency Changed',
  severity_changed: 'Severity Changed',
  privacy_changed: 'Privacy Changed',
  consolidated_update: 'Consolidated Update',
  bulk_action_summary: 'Bulk Action Summary',
};

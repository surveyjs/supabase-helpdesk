/** Single source of truth for notification event labels (user and admin pages). */
export const NOTIFICATION_EVENT_LABELS: Record<string, string> = {
  new_post: 'New Reply',
  status_changed: 'Status Changed',
  agent_assigned: 'Agent Assigned',
  agent_assigned_to_agent: 'Assigned to You (agents)',
  user_reply_to_agent: 'User Reply (agents)',
  auto_reopen: 'Auto Re-open',
  urgency_changed: 'Urgency Changed',
  severity_changed: 'Severity Changed',
  privacy_changed: 'Privacy Changed',
};

export const NOTIFICATION_EVENT_TYPES = Object.entries(NOTIFICATION_EVENT_LABELS).map(
  ([key, label]) => ({ key, label }),
);

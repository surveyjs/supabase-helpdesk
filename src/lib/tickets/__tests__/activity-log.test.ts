import { describe, it, expect } from 'vitest';
import {
  buildActivityDescriptor,
  isActivityVisibleToNonAgent,
  titleCaseValue,
  snippet,
  type ActivityLabelLookups,
} from '../activity-log';

const lookups: ActivityLabelLookups = {
  typeName: (id) => ({ t1: 'Question', t2: 'Issue' })[id],
  categoryName: (id) => ({ c1: 'Billing', c2: 'Technical' })[id],
  agentName: (id) => ({ a1: 'Alice', a2: 'Bob' })[id],
  tagName: (id) => ({ g1: 'urgent', g2: 'vip' })[id],
};

function build(action: string, details: Record<string, unknown> | null) {
  return buildActivityDescriptor(action, details, 'Carol', lookups);
}

describe('titleCaseValue', () => {
  it('title-cases snake_case enum tokens', () => {
    expect(titleCaseValue('in_progress')).toBe('In progress');
    expect(titleCaseValue('high')).toBe('High');
  });

  it('returns an em dash for empty/nullish values', () => {
    expect(titleCaseValue(null)).toBe('—');
    expect(titleCaseValue('')).toBe('—');
  });
});

describe('buildActivityDescriptor — comparison entries', () => {
  it('status change shows title-cased old -> new', () => {
    expect(build('status_changed', { from: 'open', to: 'closed' })).toEqual({
      actorName: 'Carol',
      field: 'status',
      oldValue: 'Open',
      newValue: 'Closed',
    });
  });

  it('type change resolves ids to names', () => {
    expect(build('type_changed', { from: 't1', to: 't2' })).toMatchObject({
      field: 'type',
      oldValue: 'Question',
      newValue: 'Issue',
    });
  });

  it('category change renders "None" for an empty side and resolves the other', () => {
    expect(build('category_changed', { from: null, to: 'c2' })).toMatchObject({
      field: 'category',
      oldValue: 'None',
      newValue: 'Technical',
    });
  });

  it('unknown FK id degrades to a placeholder rather than the raw id', () => {
    expect(build('type_changed', { from: 'tX', to: 't1' })).toMatchObject({
      oldValue: 'Unknown',
      newValue: 'Question',
    });
  });

  it('initial assignment shows Unassigned -> agent name', () => {
    expect(build('agent_assigned', { agent_id: 'a1' })).toMatchObject({
      field: 'assignee',
      oldValue: 'Unassigned',
      newValue: 'Alice',
    });
  });

  it('reassignment shows old agent -> new agent and carries the reason note', () => {
    expect(
      build('agent_reassigned', { from_agent_id: 'a1', to_agent_id: 'a2', reason: 'on PTO' }),
    ).toMatchObject({
      field: 'assignee',
      oldValue: 'Alice',
      newValue: 'Bob',
      note: 'on PTO',
    });
  });

  it('unassignment shows old agent -> Unassigned', () => {
    expect(build('agent_unassigned', { previous_agent_id: 'a2' })).toMatchObject({
      field: 'assignee',
      oldValue: 'Bob',
      newValue: 'Unassigned',
    });
  });

  it('privacy change maps booleans to Public/Private', () => {
    expect(build('privacy_changed', { from: false, to: true })).toMatchObject({
      field: 'privacy',
      oldValue: 'Public',
      newValue: 'Private',
    });
  });

  it('title change quotes both sides', () => {
    expect(build('title_changed', { from: 'Old', to: 'New' })).toMatchObject({
      field: 'title',
      oldValue: '"Old"',
      newValue: '"New"',
    });
  });

  it('custom-field change uses the field name and shows old -> new', () => {
    expect(
      build('custom_field_changed', { field: 'Region', from: 'EU', to: 'US', value: 'US' }),
    ).toEqual({
      actorName: 'Carol',
      field: 'Region',
      oldValue: 'EU',
      newValue: 'US',
    });
  });

  it('custom-field checkbox values map to Yes/No', () => {
    expect(
      build('custom_field_changed', { field: 'VIP', from: false, to: true, value: true }),
    ).toMatchObject({ field: 'VIP', oldValue: 'No', newValue: 'Yes' });
  });

  it('legacy custom-field rows (value only, no from/to) show just the new value', () => {
    expect(build('custom_field_changed', { field: 'Region', value: 'US' })).toEqual({
      actorName: 'Carol',
      field: 'Region',
      oldValue: null,
      newValue: 'US',
    });
  });

  it('post edit shows a before/after snippet labelled by post kind', () => {
    expect(
      build('post_edited', { post_type: 'post', from: 'old body', to: 'new body' }),
    ).toMatchObject({ actorName: 'Carol', field: 'reply', oldValue: 'old body', newValue: 'new body' });
    expect(build('post_edited', { post_type: 'comment', from: 'a', to: 'b' })).toMatchObject({
      field: 'comment',
    });
    expect(build('post_edited', { post_type: 'note', from: 'a', to: 'b' })).toMatchObject({
      field: 'note',
    });
  });

  it('post edit collapses whitespace and truncates long bodies', () => {
    const long = 'word '.repeat(40); // 200 chars
    const res = build('post_edited', { post_type: 'post', from: '', to: long });
    expect(res.oldValue).toBe('—');
    expect(res.newValue?.endsWith('…')).toBe(true);
    expect((res.newValue ?? '').length).toBeLessThanOrEqual(81);
  });

  it('post edit carries full untruncated copy text for both sides', () => {
    const long = 'word '.repeat(40).trim();
    const res = build('post_edited', { post_type: 'post', from: 'short before', to: long });
    expect(res.oldCopyText).toBe('short before');
    expect(res.newCopyText).toBe(long);
  });

  it('post edit omits copy text for an empty side', () => {
    const res = build('post_edited', { post_type: 'post', from: '', to: 'hi' });
    expect(res.oldCopyText).toBeUndefined();
    expect(res.newCopyText).toBe('hi');
  });

  it('post deletion carries full body as message copy text', () => {
    const res = build('post_deleted', { post_type: 'comment', body: 'the whole deleted body' });
    expect(res.messageCopyText).toBe('the whole deleted body');
  });

  it('post deletion with empty body has no copy text', () => {
    expect(build('post_deleted', { post_type: 'post', body: '' }).messageCopyText).toBeUndefined();
  });
});

describe('isActivityVisibleToNonAgent', () => {
  it('shows ordinary change entries to non-agents', () => {
    expect(isActivityVisibleToNonAgent('status_changed', { from: 'open', to: 'closed' })).toBe(true);
    expect(isActivityVisibleToNonAgent('tag_added', { tag_id: 'g1' })).toBe(true);
  });

  it('hides agent-only workflow events', () => {
    expect(isActivityVisibleToNonAgent('draft_published', {})).toBe(false);
    expect(isActivityVisibleToNonAgent('post_privacy_changed', {})).toBe(false);
  });

  it('shows post edits/deletions only for public, non-private posts/comments', () => {
    expect(isActivityVisibleToNonAgent('post_edited', { post_type: 'post', is_private: false })).toBe(true);
    expect(isActivityVisibleToNonAgent('post_deleted', { post_type: 'comment', is_private: false })).toBe(true);
  });

  it('hides body-snippet entries for notes and private posts', () => {
    expect(isActivityVisibleToNonAgent('post_edited', { post_type: 'note', is_private: false })).toBe(false);
    expect(isActivityVisibleToNonAgent('post_deleted', { post_type: 'post', is_private: true })).toBe(false);
  });

  it('fails closed for legacy/malformed rows missing the flags', () => {
    expect(isActivityVisibleToNonAgent('post_edited', {})).toBe(false);
    expect(isActivityVisibleToNonAgent('post_edited', null)).toBe(false);
    expect(isActivityVisibleToNonAgent('post_deleted', { post_type: 'post' })).toBe(false); // no is_private
    expect(isActivityVisibleToNonAgent('post_deleted', { is_private: false })).toBe(false); // no post_type
  });
});

describe('snippet', () => {
  it('collapses whitespace/newlines and trims', () => {
    expect(snippet('  a\n\n b\t c  ')).toBe('a b c');
  });
  it('returns the em dash for empty input', () => {
    expect(snippet('')).toBe('—');
    expect(snippet(null)).toBe('—');
  });
  it('truncates with an ellipsis past the max', () => {
    expect(snippet('abcdef', 3)).toBe('abc…');
  });
});

describe('buildActivityDescriptor — prose entries', () => {
  it('resolves tag ids to names (fixes the empty-tag bug)', () => {
    expect(build('tag_added', { tag_id: 'g1' })).toEqual({
      actorName: 'Carol',
      message: 'added tag "urgent"',
    });
    expect(build('tag_removed', { tag_id: 'g2' })).toMatchObject({
      message: 'removed tag "vip"',
    });
  });

  it('prefers an explicit tag_name when present', () => {
    expect(build('tag_added', { tag_name: 'legacy' })).toMatchObject({
      message: 'added tag "legacy"',
    });
  });

  it('post deletion retains the removed body as a snippet, labelled by kind', () => {
    expect(build('post_deleted', { post_type: 'post', body: 'spam content' })).toMatchObject({
      actorName: 'Carol',
      message: 'deleted a reply: "spam content"',
    });
    expect(build('post_deleted', { post_type: 'comment', body: 'oops' })).toMatchObject({
      message: 'deleted a comment: "oops"',
    });
    expect(build('post_deleted', { post_type: 'note', body: 'internal' })).toMatchObject({
      message: 'deleted a note: "internal"',
    });
  });

  it('post deletion with an empty body omits the quote', () => {
    expect(build('post_deleted', { post_type: 'post', body: '' })).toEqual({
      actorName: 'Carol',
      message: 'deleted a reply',
    });
  });

  it('renders a creation event', () => {
    expect(build('created', {})).toEqual({ actorName: 'Carol', message: 'created the ticket' });
  });

  it('falls back to a generic message for unknown actions', () => {
    expect(build('teleported', null)).toEqual({
      actorName: 'Carol',
      message: 'performed teleported',
    });
  });
});

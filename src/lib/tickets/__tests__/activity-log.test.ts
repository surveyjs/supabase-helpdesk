import { describe, it, expect } from 'vitest';
import {
  buildActivityDescriptor,
  titleCaseValue,
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

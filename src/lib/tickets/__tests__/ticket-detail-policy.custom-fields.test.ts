import { describe, expect, it } from 'vitest';
import { computeTicketDetailFieldPolicy, type TicketDetailPolicyInput } from '../ticket-detail-policy';

function baseInput(over: Partial<TicketDetailPolicyInput> = {}): TicketDetailPolicyInput {
  return {
    isAgent: false,
    isMerged: false,
    isOwner: false,
    isBlocked: false,
    hasTypes: true,
    hasTags: true,
    tierKey: null,
    tierCaps: {
      change_status: false,
      set_severity: false,
      change_type: false,
      add_remove_tags: false,
      change_visibility: false,
    },
    tierRules: {
      statusAllowedTiers: [],
      severityAllowedTiers: [],
      typeAllowedTiers: [],
      tagsAllowedTiers: [],
      visibilityAllowedTiers: [],
    },
    customFieldNames: ['priority', 'note'],
    ...over,
  };
}

describe('computeTicketDetailFieldPolicy custom fields', () => {
  it('renders visible+editable entries for owner', () => {
    const p = computeTicketDetailFieldPolicy(baseInput({ isOwner: true }));
    expect(p['custom_fields.priority']).toEqual({ visible: true, editable: true });
    expect(p['custom_fields.note']).toEqual({ visible: true, editable: true });
  });

  it('renders visible+editable for agent', () => {
    const p = computeTicketDetailFieldPolicy(baseInput({ isAgent: true }));
    expect(p['custom_fields.priority']).toEqual({ visible: true, editable: true });
  });

  it('renders visible but read-only for non-owner non-agent', () => {
    const p = computeTicketDetailFieldPolicy(baseInput());
    expect(p['custom_fields.priority']).toEqual({ visible: true, editable: false });
  });

  it('disables editing on merged tickets', () => {
    const p = computeTicketDetailFieldPolicy(baseInput({ isOwner: true, isMerged: true }));
    expect(p['custom_fields.priority']).toEqual({ visible: true, editable: false });
  });

  it('disables editing for blocked viewers', () => {
    const p = computeTicketDetailFieldPolicy(baseInput({ isOwner: true, isBlocked: true }));
    expect(p['custom_fields.priority']).toEqual({ visible: true, editable: false });
  });

  it('omits entries when customFieldNames is empty/undefined', () => {
    const p = computeTicketDetailFieldPolicy(baseInput({ customFieldNames: [] }));
    expect(p['custom_fields.priority']).toBeUndefined();
  });
});

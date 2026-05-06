import {
  canTierUseControl,
  TICKET_DETAIL_ALLOWED_QUESTION_NAMES,
  type TicketDetailQuestionName,
  type TicketDetailTierControlRules,
} from '@/lib/constants/survey-ui-config';

export type TicketDetailFieldPolicy = Record<
  string,
  { visible: boolean; editable: boolean }
>;

export type TicketDetailPolicyInput = {
  isAgent: boolean;
  isMerged: boolean;
  isOwner: boolean;
  isBlocked: boolean;
  hasTypes: boolean;
  hasTags: boolean;
  tierKey: string | null;
  tierCaps: {
    change_status: boolean;
    set_severity: boolean;
    change_type: boolean;
    add_remove_tags: boolean;
    change_visibility: boolean;
  };
  tierRules: TicketDetailTierControlRules;
};

/**
 * Compute, per allowed SurveyJS question name, whether the current viewer
 * may see and/or change the field. Names always equal Supabase columns or
 * canonical relationship names — there is no name-mapping layer.
 */
export function computeTicketDetailFieldPolicy(
  input: TicketDetailPolicyInput,
): TicketDetailFieldPolicy {
  const {
    isAgent,
    isMerged,
    isOwner,
    isBlocked,
    hasTypes,
    hasTags,
    tierKey,
    tierCaps,
    tierRules,
  } = input;

  const policy: TicketDetailFieldPolicy = {};
  const allow = canTierUseControl;

  const editableIfNotMerged = (cond: boolean) => !isMerged && cond;

  // status
  policy.status = {
    visible: true,
    editable: editableIfNotMerged(
      isAgent || (tierCaps.change_status && allow(tierRules.statusAllowedTiers, tierKey)),
    ),
  };

  // urgency — only agents may edit
  policy.urgency = {
    visible: true,
    editable: editableIfNotMerged(isAgent),
  };

  // severity
  policy.severity = {
    visible: true,
    editable: editableIfNotMerged(
      isAgent || (tierCaps.set_severity && allow(tierRules.severityAllowedTiers, tierKey)),
    ),
  };

  // type_id
  policy.type_id = {
    visible: hasTypes,
    editable:
      hasTypes &&
      editableIfNotMerged(
        isAgent || (tierCaps.change_type && allow(tierRules.typeAllowedTiers, tierKey)),
      ),
  };

  // category_id — agent-only
  policy.category_id = {
    visible: true,
    editable: editableIfNotMerged(isAgent),
  };

  // assigned_agent_id — agent-only
  policy.assigned_agent_id = {
    visible: isAgent,
    editable: editableIfNotMerged(isAgent),
  };

  // is_private (visibility)
  policy.is_private = {
    visible: true,
    editable: editableIfNotMerged(
      isAgent || (tierCaps.change_visibility && allow(tierRules.visibilityAllowedTiers, tierKey)),
    ),
  };

  // tag_ids
  policy.tag_ids = {
    visible: hasTags,
    editable:
      hasTags &&
      (isAgent || (tierCaps.add_remove_tags && allow(tierRules.tagsAllowedTiers, tierKey))),
  };

  // is_following — owner already follows implicitly; blocked users cannot toggle
  const followVisible = !isOwner && !isBlocked;
  policy.is_following = {
    visible: followVisible,
    editable: followVisible,
  };

  // Ensure every allowed name has an entry.
  for (const name of TICKET_DETAIL_ALLOWED_QUESTION_NAMES as readonly TicketDetailQuestionName[]) {
    if (!policy[name]) policy[name] = { visible: false, editable: false };
  }

  return policy;
}

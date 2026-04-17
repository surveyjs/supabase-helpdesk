export const LIMITS = {
  TICKET_TITLE: 300,
  POST_BODY: 50_000,
  CANNED_RESPONSE_BODY: 50_000,
  KB_ARTICLE_BODY: 100_000,
  DISPLAY_NAME: 100,
  TEAM_NAME: 100,
  TAG_NAME: 50,
  CATEGORY_NAME: 100,
  TYPE_NAME: 100,
  CUSTOM_FIELD_TEXT_VALUE: 1_000,
  CSAT_COMMENT: 5_000,
  USER_NOTE_BODY: 50_000,
  ATTACHMENT_FILENAME: 255,
  TIER_KEY: 50,
  TIER_DISPLAY_NAME: 100,
} as const;

export function validateTitle(title: string | null | undefined): string | null {
  if (!title || !title.trim()) return 'Title is required.';
  if (title.length > LIMITS.TICKET_TITLE) return `Title must be ${LIMITS.TICKET_TITLE} characters or fewer.`;
  return null;
}

export function validateBody(body: string | null | undefined): string | null {
  if (!body || !body.trim()) return 'Body is required.';
  if (body.length > LIMITS.POST_BODY) return `Body must be ${LIMITS.POST_BODY.toLocaleString()} characters or fewer.`;
  return null;
}

export function validateRequired(value: string | null | undefined, fieldName: string): string | null {
  if (!value || !value.trim()) return `${fieldName} is required.`;
  return null;
}

export function validateLength(
  value: string | null | undefined,
  fieldName: string,
  maxLength: number,
  required = false,
): string | null {
  if (!value || !value.trim()) {
    return required ? `${fieldName} is required.` : null;
  }
  if (value.length > maxLength) {
    return `${fieldName} must be ${maxLength.toLocaleString()} characters or fewer.`;
  }
  return null;
}

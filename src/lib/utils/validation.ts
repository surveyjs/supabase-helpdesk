export function validateTitle(title: string | null | undefined): string | null {
  if (!title || !title.trim()) return 'Title is required.';
  if (title.length > 300) return 'Title must be 300 characters or fewer.';
  return null;
}

export function validateBody(body: string | null | undefined): string | null {
  if (!body || !body.trim()) return 'Body is required.';
  if (body.length > 50000) return 'Body must be 50,000 characters or fewer.';
  return null;
}

export function validateRequired(value: string | null | undefined, fieldName: string): string | null {
  if (!value || !value.trim()) return `${fieldName} is required.`;
  return null;
}

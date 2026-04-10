/**
 * Generate a URL slug from a title.
 * Must match the Postgres generate_slug() function exactly.
 */
export function generateSlug(title: string | null | undefined): string {
  if (!title) return 'untitled';

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'untitled';
}

/**
 * Attachment ids a post body shows inline, read from the post's *rendered*
 * HTML (see `renderMarkdown`): the `src` of an `<img>` or the `href` of an
 * `<a>` pointing at the stable `/attachments/<uuid>` route.
 *
 * Working on the HTML rather than the raw Markdown means code spans and code
 * blocks never count: their content is text, where `<` is escaped, so the
 * `<img …` / `<a …` tag prefix cannot occur there.
 */
const INLINE_ATTACHMENT_RE =
  /<(?:img|a)\b[^>]*?\s(?:src|href)="\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#][^"]*)?"/gi;

export function inlineAttachmentIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(INLINE_ATTACHMENT_RE)) ids.add(m[1].toLowerCase());
  return [...ids];
}

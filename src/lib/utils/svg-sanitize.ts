/**
 * Sanitize SVG content by stripping dangerous elements/attributes.
 * Strips: <script>, event handlers (onclick, onload, etc.), javascript: URLs,
 * data: URLs in xlink:href, foreign objects embedding scripts.
 *
 * Uses a dynamic import so that `isomorphic-dompurify` (and its `jsdom`
 * dependency) is only loaded when an SVG is actually being sanitized. This
 * avoids pulling jsdom into the server bundle of every route that transitively
 * imports a server action referencing this file.
 */
export async function sanitizeSvg(buffer: Uint8Array): Promise<Uint8Array> {
  const svgString = Buffer.from(buffer).toString('utf-8');

  const { default: DOMPurify } = await import('isomorphic-dompurify');

  const clean = DOMPurify.sanitize(svgString, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['svg'],
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: [
      'onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout',
      'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit',
      'onanimationstart', 'onanimationend', 'onanimationiteration',
    ],
  });

  return new Uint8Array(Buffer.from(clean, 'utf-8'));
}

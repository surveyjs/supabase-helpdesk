import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize SVG content by stripping dangerous elements/attributes.
 * Strips: <script>, event handlers (onclick, onload, etc.), javascript: URLs,
 * data: URLs in xlink:href, foreign objects embedding scripts.
 */
export function sanitizeSvg(buffer: Uint8Array): Uint8Array {
  const svgString = Buffer.from(buffer).toString('utf-8');

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

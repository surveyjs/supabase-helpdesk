/**
 * Unit tests for the server-side Markdown renderer.
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../markdown';

describe('renderMarkdown', () => {
  it('renders a single newline as a hard line break (<br>)', async () => {
    // Regression for #76: pressing Enter once should produce a visible line
    // break rather than collapsing the lines into a single space-joined line.
    const html = await renderMarkdown('Line one\nLine two');
    expect(html).toContain('<br>');
    expect(html).toContain('Line one');
    expect(html).toContain('Line two');
  });

  it('keeps blank-line separated text as distinct paragraphs', async () => {
    const html = await renderMarkdown('Para one\n\nPara two');
    expect(html.match(/<p>/g)?.length).toBe(2);
  });

  it('still renders GFM features like strikethrough', async () => {
    const html = await renderMarkdown('~~gone~~');
    expect(html).toContain('<del>');
  });

  it('sanitizes disallowed markup', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
  });

  describe('blockRemoteImages', () => {
    const opts = { blockRemoteImages: true };

    it('blocks remote images when asked', async () => {
      const html = await renderMarkdown('![logo](https://example.org/a.png)', opts);
      expect(html).toContain('class="external-image"');
      expect(html).toContain('href="https://example.org/a.png"');
      expect(html).not.toContain('<img');
    });

    it('keeps relative attachment images', async () => {
      const html = await renderMarkdown('![x](/attachments/123e4567-e89b-12d3-a456-426614174000)', opts);
      expect(html).toContain('<img src="/attachments/');
    });

    it('keeps storage-hosted images', async () => {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
      const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_URL = base;
      try {
        const html = await renderMarkdown(`![x](${base}/storage/v1/object/public/a/b.png)`, opts);
        expect(html).toContain('<img');
        expect(html).not.toContain('external-image');
      } finally {
        if (prev === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
      }
    });

    it('does not block by default', async () => {
      const html = await renderMarkdown('![logo](https://example.org/a.png)');
      expect(html).toContain('<img src="https://example.org/a.png"');
    });

    it('uses hostname when alt is empty', async () => {
      const html = await renderMarkdown('![](https://example.org/a.png)', opts);
      expect(html).toContain('External image: example.org');
    });
  });
});

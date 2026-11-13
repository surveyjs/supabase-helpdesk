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
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer nofollow"');
      expect(html).toContain('data-external-image');
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

    it('blocks protocol-relative images', async () => {
      const html = await renderMarkdown('![x](//tracker.example.net/p.gif)', opts);
      expect(html).toContain('class="external-image"');
      expect(html).toContain('href="https://tracker.example.net/p.gif"');
      expect(html).not.toContain('<img');
    });

    it('blocks look-alike hosts of the trusted origin', async () => {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
      const html = await renderMarkdown(`![x](${base}.evil.com/x.png)`, opts);
      expect(html).toContain('external-image');
      expect(html).not.toContain('<img');
    });

    it('never emits a javascript: image or link', async () => {
      const html = await renderMarkdown('![x](javascript:alert(1))', opts);
      expect(html).not.toContain('javascript:');
    });

    it('blocks scheme-only http: host form', async () => {
      const html = await renderMarkdown('![x](http:tracker.example/p.gif)', opts);
      expect(html).not.toContain('<img');
      expect(html).toContain('href="http://tracker.example/p.gif"');
    });

    // The Markdown parser percent-encodes backslashes, spaces and tabs in link
    // destinations, so these can only become same-origin relative paths. Assert
    // that nothing loadable from a third-party host is ever emitted as an <img>.
    // A src is remote when it has a scheme or starts with two slashes
    // (browsers strip leading whitespace and read `\` as `/`).
    const REMOTE_IMG = /<img\b[^>]*\ssrc="\s*(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i;

    it('the remote-<img> pattern catches remote srcs', () => {
      for (const html of [
        '<img src="//tracker.example/p.gif">',
        '<img alt="x" src="https://tracker.example/p.gif">',
        '<img src=" //tracker.example/p.gif">',
        '<img src="\\\\tracker.example/p.gif">',
        '<img src="http:tracker.example/p.gif">',
      ]) {
        expect(html).toMatch(REMOTE_IMG);
      }
      expect('<img src="/attachments/x.png">').not.toMatch(REMOTE_IMG);
    });

    it.each([
      '\\tracker.example/p.gif',
      '/\tracker.example/p.gif', // slash + TAB
      '/\\tracker.example/p.gif', // slash + backslash: browsers read it as `//`
      ' //tracker.example/p.gif',
    ])('never emits an <img> that targets a third-party host for %j', async (src) => {
      const html = await renderMarkdown(`![x](<${src}>)`, opts);
      expect(html).not.toMatch(REMOTE_IMG);
    });

    it('keeps plain relative images', async () => {
      const html = await renderMarkdown('![x](attachments/x.png)', opts);
      expect(html).toContain('<img src="attachments/x.png"');
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

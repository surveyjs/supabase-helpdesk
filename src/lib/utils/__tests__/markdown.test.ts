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
});

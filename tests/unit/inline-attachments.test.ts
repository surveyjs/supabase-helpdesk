import { describe, it, expect } from 'vitest';
import { inlineAttachmentIds } from '@/lib/tickets/inline-attachments';
import { renderMarkdown } from '@/lib/utils/markdown';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

describe('inlineAttachmentIds', () => {
  it('collects ids from img src and a href attributes', () => {
    const html = `<p><img src="/attachments/${U1}" alt="x"> and <a href="/attachments/${U2}">file</a></p>`;
    expect(inlineAttachmentIds(html)).toEqual([U1, U2]);
  });

  it('ignores ids that only appear as text in code', () => {
    expect(inlineAttachmentIds(`<p><code>/attachments/${U3}</code></p>`)).toEqual([]);
  });

  it('returns each id once', () => {
    const html = `<img src="/attachments/${U1}"><a href="/attachments/${U1}">again</a>`;
    expect(inlineAttachmentIds(html)).toEqual([U1]);
  });

  it('lower-cases ids', () => {
    expect(inlineAttachmentIds(`<img src="/attachments/${U1.toUpperCase()}">`)).toEqual([U1]);
  });

  it('works on rendered Markdown: code spans and blocks never match', async () => {
    const md = [
      `![shot](/attachments/${U1})`,
      '',
      `\`/attachments/${U2}\` and \`<img src="/attachments/${U2}">\``,
      '',
      '```',
      `<a href="/attachments/${U3}">x</a>`,
      '```',
    ].join('\n');
    const html = await renderMarkdown(md, { blockRemoteImages: true });
    expect(inlineAttachmentIds(html)).toEqual([U1]);
  });
});

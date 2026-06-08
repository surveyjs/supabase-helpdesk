import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'ul', 'ol', 'li',
    'a', 'strong', 'em', 'del', 's',
    'code', 'pre',
    'blockquote',
    'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'input',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    code: ['className'],
    pre: ['className'],
    input: ['type', 'checked', 'disabled'],
    th: ['align'],
    td: ['align'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // Render a single newline as a hard line break (<br>) so pressing Enter once
  // in the editor produces a visible line break, matching user expectation.
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify);

/**
 * Render Markdown to sanitized HTML (server-side).
 */
export async function renderMarkdown(text: string): Promise<string> {
  const result = await processor.process(text);
  return String(result);
}

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

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function trustedOrigins(): string[] {
  const origins: string[] = [];
  for (const v of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL, process.env.APP_URL]) {
    if (!v) continue;
    try { origins.push(new URL(v).origin); } catch { /* skip invalid */ }
  }
  return origins;
}

const DUMMY_BASE = 'http://x.invalid';

/**
 * Rehype plugin (runs after sanitize): replace <img> with an absolute remote
 * http(s) src by a link, so imported e-mails don't hot-load third-party images.
 * Relative URLs and images hosted by this app / Supabase storage are kept.
 */
function rehypeBlockRemoteImages() {
  return (tree: HastNode) => {
    const trusted = trustedOrigins();
    const walk = (node: HastNode) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (child.type === 'element' && child.tagName === 'img') {
          const src = String(child.properties?.src ?? '');
          let resolved: URL | null = null;
          try { resolved = new URL(src, DUMMY_BASE); } catch { /* unparsable: blocked below */ }
          // Unparsable src is treated as remote (blocked) to be safe.
          const isRemote = !resolved
            || (resolved.host !== new URL(DUMMY_BASE).host && !trusted.includes(resolved.origin));
          if (isRemote) {
            const href = src.startsWith('//') ? `https:${src}` : src;
            let label = String(child.properties?.alt ?? '').trim();
            if (!label) label = resolved ? resolved.hostname : src;
            return {
              type: 'element',
              tagName: 'a',
              properties: {
                href,
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                className: ['external-image'],
                'data-external-image': '',
              },
              children: [{ type: 'text', value: `External image: ${label}` }],
            } as unknown as HastNode;
          }
        }
        walk(child);
        return child;
      });
    };
    walk(tree);
  };
}

function buildProcessor(blockRemoteImages: boolean) {
  const base = unified()
    .use(remarkParse)
    .use(remarkGfm)
    // Render a single newline as a hard line break (<br>) so pressing Enter once
    // in the editor produces a visible line break, matching user expectation.
    .use(remarkBreaks)
    .use(remarkRehype)
    .use(rehypeSanitize, sanitizeSchema);
  return (blockRemoteImages ? base.use(rehypeBlockRemoteImages) : base).use(rehypeStringify);
}

const processor = buildProcessor(false);
const blockingProcessor = buildProcessor(true);

/**
 * Render Markdown to sanitized HTML (server-side).
 * `blockRemoteImages` replaces third-party images by plain links (ticket posts).
 */
export async function renderMarkdown(
  text: string,
  options: { blockRemoteImages?: boolean } = {},
): Promise<string> {
  const result = await (options.blockRemoteImages ? blockingProcessor : processor).process(text);
  return String(result);
}

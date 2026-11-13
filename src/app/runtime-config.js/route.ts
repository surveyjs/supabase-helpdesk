import { runtimeConfigScript } from '@/lib/runtime-config';

// Public, per-instance settings for the browser bundle. The root layout inlines
// the same script in <head>; this route is kept for backward compatibility. The
// image is shared by every instance, so these cannot be inlined at build time.
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(runtimeConfigScript(), {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}

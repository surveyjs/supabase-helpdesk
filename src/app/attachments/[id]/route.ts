import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Stable redirect endpoint for inline attachments embedded in post bodies.
 *
 * The Markdown editor persists `/attachments/<uuid>` URLs in the post body
 * (instead of expiring signed URLs). This route resolves the attachment id,
 * lets RLS authorise the read, and 302-redirects to a freshly-minted signed
 * URL each request.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  // RLS on `attachments` decides visibility (post visibility, orphan ownership, etc.).
  const { data: attachment } = await supabase
    .from('attachments')
    .select('id, storage_path, legacy_blob_id')
    .eq('id', id)
    .single();

  if (!attachment) return new NextResponse('Not found', { status: 404 });

  const storagePath = attachment.legacy_blob_id
    ? `migrated/${attachment.legacy_blob_id}`
    : attachment.storage_path;

  if (!storagePath) return new NextResponse('Not found', { status: 404 });

  const { data: signed } = await supabase.storage
    .from('attachments')
    .createSignedUrl(storagePath, 60 * 5); // 5 min — just for the redirect

  if (!signed?.signedUrl) {
    return new NextResponse('Failed to sign URL', { status: 500 });
  }

  // 302 so the browser keeps using /attachments/<id> (cacheable redirect would
  // pin the signed URL beyond its expiry).
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}

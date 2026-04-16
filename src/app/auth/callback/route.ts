import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

// Allowlist of valid internal redirect paths for the auth callback
const ALLOWED_NEXT_PATHS = ['/', '/reset-password', '/tickets'];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next') ?? '/';

  // Validate the `next` parameter to prevent open redirects:
  // must start with '/' (relative), must not start with '//' (protocol-relative),
  // and must be in the allowlist of known internal paths.
  const next = (
    rawNext.startsWith('/')
    && !rawNext.startsWith('//')
    && ALLOWED_NEXT_PATHS.includes(rawNext)
  ) ? rawNext : '/';

  if (code) {
    const supabase = await createServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // For OAuth users signing in for the first time: update display name from token claims
      const user = data.user;
      const provider = user.app_metadata?.provider;

      if (provider && provider !== 'email') {
        const displayName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.user_metadata?.preferred_username ||
          user.user_metadata?.user_name ||
          '';

        if (displayName) {
          const svc = createServiceRoleClient();
          // Only set display name if profile has empty display_name
          const { data: profile } = await svc
            .from('profiles')
            .select('display_name')
            .eq('id', user.id)
            .single();

          if (profile && (!profile.display_name || profile.display_name === user.email?.split('@')[0])) {
            await svc
              .from('profiles')
              .update({ display_name: displayName })
              .eq('id', user.id);
          }
        }
      }

      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = next;
      redirectUrl.searchParams.delete('code');
      redirectUrl.searchParams.delete('next');
      return NextResponse.redirect(redirectUrl);
    }
  }

  // On error or missing code, redirect to login with error
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('error', 'auth_callback_error');
  return NextResponse.redirect(loginUrl);
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

// Allowlist of valid internal redirect paths for the auth callback
const ALLOWED_NEXT_PATHS = ['/', '/reset-password'];

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
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

import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'];

// Routes that are accessible without authentication
const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/auth/callback'];
// Route prefixes that require authentication
const PROTECTED_PREFIXES = ['/admin', '/agent', '/tickets', '/notification-settings', '/profile', '/reset-password'];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();

  // Redirect authenticated users away from auth pages
  if (user && AUTH_ROUTES.includes(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Redirect unauthenticated users away from protected routes
  const pathname = request.nextUrl.pathname;
  if (!user) {
    const isPublic = PUBLIC_ROUTES.includes(pathname)
      || pathname.startsWith('/_next/')
      || pathname.startsWith('/api/')
      || /\.\w+$/.test(pathname); // static files (e.g. .svg, .png)
    const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      || pathname === '/';

    if (!isPublic && isProtected) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return supabaseResponse;
}

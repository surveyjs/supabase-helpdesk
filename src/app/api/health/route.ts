import { NextResponse } from 'next/server';

// Lightweight liveness probe used by the deploy pipeline (deploy/redeploy.sh)
// and the reverse proxy. Intentionally does not touch the database — it only
// confirms the Next.js server process is up and serving. Keep it cheap.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', time: new Date().toISOString() });
}

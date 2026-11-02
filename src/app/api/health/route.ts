import { NextResponse } from 'next/server';

// Liveness probe for docker, the reverse proxy and deploy/upgrade.sh (which
// waits for the new `version`). Intentionally does not touch the database —
// the schema is checked once at startup (docker/check-schema.mjs).
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    version: process.env.HELPDESK_VERSION ?? 'dev',
    time: new Date().toISOString(),
  });
}

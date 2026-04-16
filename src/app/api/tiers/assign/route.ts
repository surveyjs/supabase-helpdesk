import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { timingSafeEqual } from 'crypto';

export async function POST(request: NextRequest) {
  const serviceClient = createServiceRoleClient();

  // Authenticate via X-API-Key header
  const apiKey = request.headers.get('X-API-Key') ?? '';
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing X-API-Key header.' }, { status: 401 });
  }

  // Retrieve stored secret from Vault
  const { data: storedSecret } = await serviceClient.rpc('get_tier_api_secret');
  if (!storedSecret || typeof storedSecret !== 'string' || storedSecret.length === 0) {
    return NextResponse.json({ error: 'External tier assignment is not configured.' }, { status: 401 });
  }

  // Constant-time comparison
  const a = Buffer.from(apiKey, 'utf-8');
  const b = Buffer.from(storedSecret, 'utf-8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 });
  }

  // Parse request body
  let body: { email?: string; tierKey?: string; expiresAt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { email, tierKey, expiresAt } = body;
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email is required.' }, { status: 400 });
  }
  if (!tierKey || typeof tierKey !== 'string') {
    return NextResponse.json({ error: 'tierKey is required.' }, { status: 400 });
  }

  // Find user by email
  const { data: userProfile } = await serviceClient
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();

  if (!userProfile) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  if (tierKey === 'none') {
    // Remove tier
    const { error } = await serviceClient
      .from('profiles')
      .update({ tier_id: null, tier_expires_at: null })
      .eq('id', userProfile.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log with actor "API"
    await serviceClient.from('admin_audit_log').insert({
      admin_id: userProfile.id,
      action: 'tier_removed',
      target_type: 'profile',
      target_id: userProfile.id,
      details: { actor: 'API', email },
    });

    return NextResponse.json({ success: true, userId: userProfile.id, tierKey: 'none' });
  }

  // Find tier by key
  const { data: tier } = await serviceClient
    .from('subscription_tiers')
    .select('id, key')
    .eq('key', tierKey)
    .single();

  if (!tier) {
    return NextResponse.json({ error: 'Tier not found.' }, { status: 404 });
  }

  // Validate expiresAt if provided
  let parsedExpires: string | null = null;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: 'Invalid expiresAt date.' }, { status: 400 });
    }
    parsedExpires = d.toISOString();
  }

  const { error } = await serviceClient
    .from('profiles')
    .update({
      tier_id: tier.id,
      tier_expires_at: parsedExpires,
    })
    .eq('id', userProfile.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit log with actor "API"
  await serviceClient.from('admin_audit_log').insert({
    admin_id: userProfile.id,
    action: 'tier_assigned',
    target_type: 'profile',
    target_id: userProfile.id,
    details: { actor: 'API', email, tier_key: tier.key, expires_at: parsedExpires },
  });

  return NextResponse.json({ success: true, userId: userProfile.id, tierKey: tier.key });
}

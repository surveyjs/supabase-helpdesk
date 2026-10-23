import { describe, it, expect, vi } from 'vitest';
import { createAdmin, generatePassword, resetPassword } from './admin.mjs';

const base = { supabaseUrl: 'http://api-gw:8000', serviceRoleKey: 'svc', email: 'boss@example.com', password: 'pw' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createAdmin', () => {
  it('creates a confirmed user, then gives its profile the admin role', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ id: 'u1' }))
      .mockResolvedValueOnce(json([{ id: 'u1', role: 'admin' }]));
    expect(await createAdmin({ ...base, fetchImpl })).toBe('u1');
    const [[url1, init1], [url2, init2]] = fetchImpl.mock.calls;
    expect(url1).toBe('http://api-gw:8000/auth/v1/admin/users');
    expect(JSON.parse(init1.body)).toEqual({ email: 'boss@example.com', password: 'pw', email_confirm: true });
    expect(init1.headers).toMatchObject({ apikey: 'svc', Authorization: 'Bearer svc' });
    expect(url2).toBe('http://api-gw:8000/rest/v1/profiles?id=eq.u1');
    expect(init2.method).toBe('PATCH');
    expect(JSON.parse(init2.body)).toEqual({ role: 'admin' });
  });

  it('reports what Supabase said when the user cannot be created', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ msg: 'A user with this email address has already been registered' }, 422));
    await expect(createAdmin({ ...base, fetchImpl })).rejects.toThrow('Creating the user failed: HTTP 422 A user with this email address has already been registered');
  });

  it('fails if no profile got the admin role', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ id: 'u1' })).mockResolvedValueOnce(json([]));
    await expect(createAdmin({ ...base, fetchImpl })).rejects.toThrow(/no profile for user u1/);
  });
});

describe('resetPassword', () => {
  it('finds the user by email and sets the new password', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json([{ id: 'u1' }])).mockResolvedValueOnce(json({ id: 'u1' }));
    await resetPassword({ ...base, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api-gw:8000/rest/v1/profiles?select=id&email=eq.boss%40example.com');
    expect(fetchImpl.mock.calls[1][0]).toBe('http://api-gw:8000/auth/v1/admin/users/u1');
    expect(fetchImpl.mock.calls[1][1].method).toBe('PUT');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ password: 'pw' });
  });

  it('says so when no user has that email', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json([]));
    await expect(resetPassword({ ...base, fetchImpl })).rejects.toThrow('No user with email boss@example.com');
  });
});

describe('generatePassword', () => {
  it('is 24 URL-safe characters', () => {
    expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { JOBS, dueJobs, runJob } from './scheduler.mjs';

describe('dueJobs', () => {
  it('runs every job on the first tick', () => {
    expect(dueJobs(0, new Map()).map((j) => j.path)).toEqual(['/api/cron/notifications', '/api/cron/sla']);
  });

  it('runs notifications every 60 s and SLA checks every 300 s', () => {
    const last = new Map([['/api/cron/notifications', 0], ['/api/cron/sla', 0]]);
    expect(dueJobs(59_000, last)).toEqual([]);
    expect(dueJobs(60_000, last).map((j) => j.path)).toEqual(['/api/cron/notifications']);
    expect(dueJobs(300_000, last).map((j) => j.path)).toEqual(['/api/cron/notifications', '/api/cron/sla']);
  });
});

describe('runJob', () => {
  it('POSTs with the cron secret and reports the status', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await runJob(JOBS[0], { baseUrl: 'http://app:3001', secret: 's3', fetchImpl })).toBe('/api/cron/notifications -> HTTP 200');
    expect(fetchImpl).toHaveBeenCalledWith('http://app:3001/api/cron/notifications', expect.objectContaining({
      method: 'POST', headers: { Authorization: 'Bearer s3' },
    }));
  });

  it('never throws: a network error becomes a log line', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('connect ECONNREFUSED'); });
    expect(await runJob(JOBS[1], { baseUrl: 'http://app:3001', secret: 's3', fetchImpl }))
      .toBe('/api/cron/sla failed: connect ECONNREFUSED');
  });
});

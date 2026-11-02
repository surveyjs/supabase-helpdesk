// Calls the app's cron endpoints on a fixed schedule — the image's `scheduler`
// command (docker/scheduler.mjs). The same in both Supabase modes, unlike the
// pg_cron job in 001, which needed database-side settings nobody sets (004).

export const JOBS = [
  { path: '/api/cron/notifications', everySeconds: 60 },
  { path: '/api/cron/sla', everySeconds: 300 },
];

/**
 * @param {number} now ms
 * @param {Map<string, number>} lastRun ms of the last run, keyed by path
 */
export function dueJobs(now, lastRun, jobs = JOBS) {
  return jobs.filter((job) => now - (lastRun.get(job.path) ?? -Infinity) >= job.everySeconds * 1000);
}

/**
 * POST one job. Resolves to a log line; never throws.
 * @param {{ path: string }} job
 * @param {{ baseUrl: string, secret: string, fetchImpl?: typeof fetch }} options
 */
export async function runJob(job, { baseUrl, secret, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${baseUrl}${job.path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(55_000),
    });
    return `${job.path} -> HTTP ${res.status}`;
  } catch (err) {
    return `${job.path} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

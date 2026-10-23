// `scheduler` command: calls the app's cron endpoints (src/lib/deploy/scheduler.mjs).
import { JOBS, dueJobs, runJob } from './lib/scheduler.mjs';

const baseUrl = (process.env.APP_INTERNAL_URL ?? 'http://app:3001').replace(/\/+$/, '');
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('[scheduler] CRON_SECRET is required');
  process.exit(1);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`[scheduler] ${baseUrl}: ${JOBS.map((j) => `${j.path} every ${j.everySeconds}s`).join(', ')}`);
const lastRun = new Map();
for (;;) {
  const now = Date.now();
  for (const job of dueJobs(now, lastRun)) {
    lastRun.set(job.path, now);
    console.log(`[scheduler] ${await runJob(job, { baseUrl, secret })}`);
  }
  await sleep(10_000);
}

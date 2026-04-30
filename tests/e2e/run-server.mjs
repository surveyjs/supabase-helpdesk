/**
 * Wrapper used by Playwright's `webServer.command`.
 *
 * Runs `next build && next start` and tees combined stdout/stderr to
 * `server.log` (in repo root) so we can post-mortem `next start` crashes
 * that happen mid-test-run. Playwright still sees the original stream.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.resolve(__dirname, '..', '..', 'server.log');
// Append so consecutive runs don't lose the previous run's tail.
const logStream = fs.createWriteStream(logPath, { flags: 'a' });
function logLine(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  try { process.stdout.write(stamped); } catch {}
  try { logStream.write(stamped); } catch {}
}
logLine(`\n=== run-server.js started pid=${process.pid} ===\n`);

// Playwright may stop reading the webServer pipe once it sees `url` ready.
// On Windows a subsequent write to the closed pipe throws EPIPE, which would
// otherwise crash this wrapper silently and orphan `next start`.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    logStream.write(`[${new Date().toISOString()}] ${stream === process.stdout ? 'stdout' : 'stderr'} error: ${err.code || err.message}\n`);
  });
}

process.on('uncaughtException', (err) => {
  logLine(`uncaughtException in wrapper: ${err.stack || err}\n`);
});
process.on('unhandledRejection', (err) => {
  logLine(`unhandledRejection in wrapper: ${err && (err.stack || err)}\n`);
});
process.on('exit', (code) => {
  logStream.write(`[${new Date().toISOString()}] === wrapper exit code=${code} ===\n`);
});

function tee(child, label) {
  child.stdout.on('data', (chunk) => {
    try { process.stdout.write(chunk); } catch {}
    try { logStream.write(chunk); } catch {}
  });
  child.stderr.on('data', (chunk) => {
    try { process.stderr.write(chunk); } catch {}
    try { logStream.write(`[stderr ${label}] ${chunk}`); } catch {}
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: true });
    tee(child, cmd);
    child.on('exit', (code, signal) => {
      logLine(`=== ${cmd} ${args.join(' ')} exited code=${code} signal=${signal} ===\n`);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed: code=${code} signal=${signal}`));
    });
  });
}

(async () => {
  try {
    await run('npm', ['run', 'build']);
  } catch (err) {
    logLine(`build failed: ${err.message}\n`);
    process.exit(1);
  }

  // Give next start more headroom; default ~1.5GB has been crashing under
  // the e2e workload (~336 tests, 4 parallel browsers).
  const startEnv = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim(),
  };
  const start = spawn('npm', ['run', 'start'], { shell: true, env: startEnv });
  tee(start, 'next-start');
  logLine(`=== next start spawned pid=${start.pid} NODE_OPTIONS="${startEnv.NODE_OPTIONS}" ===\n`);

  // Periodic memory snapshot of the wrapper itself (not next start, but useful
  // to confirm the wrapper is alive).
  const memInterval = setInterval(() => {
    const mem = process.memoryUsage();
    logLine(`wrapper rss=${(mem.rss / 1024 / 1024).toFixed(0)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB\n`);
  }, 30_000);
  memInterval.unref();

  start.on('exit', (code, signal) => {
    logLine(`=== next start exited code=${code} signal=${signal} ===\n`);
    logStream.end(() => process.exit(code ?? 1));
  });

  // Forward signals so Playwright can stop the server cleanly.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      logLine(`=== wrapper received ${sig} ===\n`);
      start.kill(sig);
    });
  }
})();

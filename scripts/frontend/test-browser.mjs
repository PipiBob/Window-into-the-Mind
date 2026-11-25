import { spawnSync } from 'node:child_process';

for (const script of ['scripts/frontend/browser-guided.cjs']) {
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: {...process.env, READER_URL: process.env.READER_URL || 'http://127.0.0.1:5173/', TEST_OUTPUT: process.env.TEST_OUTPUT || 'test-results/frontend/browser'},
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

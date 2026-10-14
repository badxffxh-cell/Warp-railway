import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const apiDir = fileURLToPath(new URL('../', import.meta.url));
process.chdir(apiDir);
if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Define TEST_DATABASE_URL with a dedicated database ending in _test.');
const prisma = fileURLToPath(import.meta.resolve('prisma/build/index.js'));
const migration = spawnSync(process.execPath, [prisma, 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'inherit',
});
if (migration.status !== 0) process.exit(migration.status ?? 1);
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', 'test/auth.test.ts', 'test/mail.test.ts', 'test/community.test.ts', 'test/voice-errors.test.ts'],
  {
    env: process.env,
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);


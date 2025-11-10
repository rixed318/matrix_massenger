import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

execSync('npm run build --workspace @matrix-messenger/sdk', { stdio: 'inherit' });
execSync('npm run build --workspace @matrix-messenger/ui-tokens', { stdio: 'inherit' });

const requiredFiles = [
  resolve(root, 'docs/plugin-api.md'),
  resolve(root, 'packages/sdk/dist/index.js'),
  resolve(root, 'examples/echo-bot/src/index.ts'),
  resolve(root, 'examples/reminder-bot/src/index.ts'),
  resolve(root, 'packages/ui-tokens/dist/index.js'),
  resolve(root, 'packages/ui-tokens/dist/tailwind.js'),
];

for (const file of requiredFiles) {
  await fs.access(file);
}

const doc = await fs.readFile(resolve(root, 'docs/plugin-api.md'), 'utf8');
if (!doc.includes('# Matrix Messenger Plugin API')) {
  throw new Error('Plugin API documentation is missing the expected heading.');
}

console.log('SDK structure check passed.');

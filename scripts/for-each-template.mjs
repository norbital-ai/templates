import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { discoverTemplates } from './lib/templates.mjs';

/**
 * Run one pnpm command in every template.
 *
 * Templates are not workspace members — each owns its lockfile and resolves published
 * `@norbital-ai/*` versions, exactly as a tenant does — so there is no `--filter` that reaches
 * them and no root install that prepares them. This is the loop that replaces it.
 *
 *   node scripts/for-each-template.mjs install [key]
 */

const [command, filter] = process.argv.slice(2);
if (!command) throw new Error('Usage: for-each-template.mjs <pnpm-command> [template-key]');

const arguments_ = command === 'install' ? ['install'] : ['run', command];

for (const template of discoverTemplates(filter)) {
	console.log(`\n=== ${template.slug}: pnpm ${arguments_.join(' ')} ===`);
	execFileSync('pnpm', arguments_, { cwd: template.directory, stdio: 'inherit' });
}

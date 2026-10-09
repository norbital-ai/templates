/**
 * The shell mounts one toaster, `@norbital-ai/ui`'s. A toast from another library shows only on a page that mounts that
 * library's own toaster, so a refusal raised on any other page (the roster day sheet, the compliance tasks, a holiday
 * publish opened over People) was never seen.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : /\.(ts|svelte)$/.test(name) ? [path] : [];
	});

it('no source toasts through a toaster the shell does not mount', () => {
	const offenders = files(join(process.cwd(), 'src')).filter((path) =>
		/from 'svelte-sonner'/.test(readFileSync(path, 'utf8'))
	);
	assert.deepEqual(offenders, []);
});

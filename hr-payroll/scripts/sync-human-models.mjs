/**
 * Kiosk face-model sync: copies the five Human models the kiosk needs out of the
 * pnpm-installed `@vladmandic/human` package into `assets/models/human/`, where the
 * workspace asset route serves them same-origin (no CDN).
 *
 * The binaries are not committed — they arrive here via the `postinstall` hook, so a
 * fresh `pnpm install` is the whole download step. Re-running is idempotent: files
 * are only rewritten when the packaged bytes differ.
 */

import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = ['antispoof', 'blazeface', 'facemesh', 'faceres', 'iris'];
const SUFFIXES = ['.json', '.bin'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@vladmandic', 'human', 'models');
const target = join(root, 'assets', 'models', 'human');

const sha256 = async (path) => {
	const bytes = await readFile(path);
	return createHash('sha256').update(bytes).digest('hex');
};

let copied = 0;
await mkdir(target, { recursive: true });
for (const model of MODELS) {
	for (const suffix of SUFFIXES) {
		const from = join(source, `${model}${suffix}`);
		const to = join(target, `${model}${suffix}`);
		let stale = true;
		try {
			const [a, b] = await Promise.all([stat(from), stat(to)]);
			stale = a.size !== b.size || (await sha256(from)) !== (await sha256(to));
		} catch {
			stale = true;
		}
		if (stale) {
			await copyFile(from, to);
			copied += 1;
		}
	}
}
console.log(
	copied === 0
		? 'human models: up to date'
		: `human models: synced ${copied} file(s) into assets/models/human/`
);

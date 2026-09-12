/**
 * The blank template stays blank.
 *
 * The manifest's `counts` are what the website and a host read about this template, so a stray
 * collection or app left behind in the starter would make every downstream workspace inherit it
 * and every card lie. This asserts the declared zero against the actual source tree, which is the
 * one thing `pnpm templates:check` also recomputes — here it fails a plain `pnpm test` in the
 * template itself, before the push.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const walk = (directory: string): string[] => {
	let files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const path = `${directory}/${entry.name}`;
		files = entry.isDirectory() ? [...files, ...walk(path)] : [...files, path];
	}
	return files;
};

const manifest = JSON.parse(readFileSync(`${root}norbital.template.json`, 'utf8')) as {
	readonly counts: {
		readonly collections: number;
		readonly apps: number;
		readonly automations: number;
	};
};

test('the blank workspace declares and ships nothing', () => {
	const files = walk(`${root}src`);
	const collections = files.filter((file) => /\/collections\/.*\/\+model\.ts$/.test(file));
	const apps = files.filter((file) => /\/apps\/.*\/\+[^/]+\.svelte$/.test(file));
	const automations = files.filter((file) => /\/automations\/.*\/\+[^/]+\.ts$/.test(file));
	assert.deepEqual(
		{ collections: collections.length, apps: apps.length, automations: automations.length },
		manifest.counts
	);
});

/// <reference types="node" />
/**
 * The manifest's `counts` are what the website and a host read about this template; a stray collection, app or
 * automation left in the starter would make every card lie. The source tree must match them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const root = new URL('../', import.meta.url);
const files = readdirSync(new URL('src/', root), { recursive: true }).map(String);
const count = (pattern: RegExp) => files.filter((file) => pattern.test(file)).length;

test('the manifest counts match the source tree', () => {
	const manifest = JSON.parse(readFileSync(new URL('norbital.template.json', root), 'utf8'));
	expect({
		collections: count(/^data\/collection\/[^/]+\/\+collection\.ts$/),
		apps: count(/^app\/.+\/\+app\.ts$/),
		automations: count(/^automation\/\+[^/]+\.automation\.ts$/)
	}).toEqual(manifest.counts);
});

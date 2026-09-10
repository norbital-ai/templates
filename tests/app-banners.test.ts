// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every app the workspace ships states its banner, as a literal, in the compiled artifact.
 *
 * The Bolt compiler recovers `<AppShell banner="…">` by matching a double-quoted literal on the
 * tag. A `const banner = '…'` beside it and `{banner}` on the tag is invisible to that match, so
 * the app compiles with no banner at all — and nothing fails: the app's own hero reads the mounted
 * component and still shows the artwork, while the overview card reads the artifact and draws the
 * icon. The two disagree silently, which is why this is asserted against the compiled output
 * rather than against the source.
 *
 * `.norbital/generated/client.js` is written by `bolt sync`, which `pnpm test` runs first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const client = readFileSync(
	fileURLToPath(new URL('../.norbital/generated/client.js', import.meta.url)),
	'utf8'
);

/** `export const appMeta = { … };` as an object, read off the generated module. */
const appMeta = (() => {
	const marker = 'export const appMeta = ';
	const from = client.indexOf(marker);
	assert.notEqual(from, -1, 'the generated client declares appMeta');
	const open = from + marker.length;
	const close = client.indexOf('};', open);
	assert.notEqual(close, -1, 'appMeta is terminated');
	return JSON.parse(client.slice(open, close + 1));
})();

/** A kiosk app renders chromeless and never appears on the overview, so it needs no card image. */
const carded = Object.entries(appMeta).filter(([, meta]) => meta.kiosk !== true);

test('every app carries an app-media banner in the compiled artifact', () => {
	const missing = carded
		.filter(([, meta]) => typeof meta.banner !== 'string' || meta.banner.length === 0)
		.map(([name]) => name);
	assert.deepEqual(
		missing,
		[],
		`These apps compiled without a banner, so their overview card draws an icon. ` +
			`State the banner as a double-quoted literal on <AppShell>, not as a {expression}.`
	);
});

test('every compiled banner points at a published app-media asset of this template', () => {
	for (const [name, meta] of carded)
		assert.match(
			meta.banner,
			/^\/__bolt\/request\/api\/template-seed-assets\/hr-payroll\/app-media\/[\w.-]+\.webp$/,
			`${name} banner is not an hr-payroll app-media asset path`
		);
});

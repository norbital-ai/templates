// @vitest-environment happy-dom
/**
 * Every page of the three apps renders for an administrator with no console error and no over-budget view, over the
 * built artifact (`bolt build` first). Bolt gap: `testWorkspace({ root })` cannot compile in a DOM environment (the
 * compiler resolves itself through a file URL), so the sweep reads the artifact the build wrote.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { testWorkspace } from '@norbital-ai/bolt/test';
import { sweep } from '@norbital-ai/bolt/test/browser';

// `bolt test` runs vitest in the workspace root
const artifact = (file: string) =>
	readFileSync(`${process.cwd()}/.norbital/artifact/${file}`, 'utf8');
const pages = Object.fromEntries(
	Object.entries(import.meta.glob('../../src/app/**/+*.page.svelte')).map(([path, load]) => [
		path.replace(/^\.\.\/\.\.\/src\/app\//, '').replace(/\/\+([a-z0-9_]+)\.page\.svelte$/, '/$1'),
		load
	])
);

it('every app page renders', async () => {
	const t = await testWorkspace({
		manifest: JSON.parse(artifact('manifest.json')),
		guest: { source: artifact('guest.mjs') },
		transforms: JSON.parse(artifact('artifact.json')).transforms
	});
	const report = await sweep(t, { pages: pages as never, as: [{ admin: true }] });
	expect(report.visited.map((visit) => visit.path)).toEqual(
		expect.arrayContaining(['/app/crm/crm', '/app/sow/editor', '/app/transcriber/transcriber'])
	);
	expect(report.findings).toEqual([]);
});

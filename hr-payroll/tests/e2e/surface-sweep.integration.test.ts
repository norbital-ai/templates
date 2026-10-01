// @vitest-environment happy-dom
/**
 * Every page renders for every holder: the real shell over a test-kit workspace built from this template (`bolt check`)
 * and seeded with its public base pack, one member per policy, every page that member's navigation offers plus the
 * inbox and runs. A console error, a thrown page or a live view the host refuses as over budget is a finding.
 */
import { expect, it } from 'vitest';
import { testWorkspace } from '@norbital-ai/bolt/test';
import { sweep } from '@norbital-ai/bolt/test/browser';

/** `src/app/<app>/+<page>.page.svelte` as the shell names it, `<app>/<page>`. */
const pages = Object.fromEntries(
	Object.entries(import.meta.glob('../../src/app/**/+*.page.svelte')).map(([path, load]) => [
		path.replace(/^\.\.\/\.\.\/src\/app\//, '').replace(/\/\+([a-z0-9_]+)\.page\.svelte$/, '/$1'),
		load
	])
);

type RepresentationLoader = NonNullable<
	NonNullable<Parameters<typeof sweep>[1]>['representations']
>[string];
const representations = Object.fromEntries(
	Object.entries(
		import.meta.glob<Awaited<ReturnType<RepresentationLoader>>>(
			'../../src/data/collection/**/+representation.svelte'
		)
	).map(([path, load]) => [
		path.replace('../../src/data/collection/', '').replace('/+representation.svelte', ''),
		load
	])
);

it('every app page renders for every policy with no console error and no over-budget view', async () => {
	const t = await testWorkspace({
		root: process.cwd(), // `bolt test` runs in the workspace root
		seed: 'base'
	});
	const report = await sweep(t, { pages: pages as never, representations });
	expect(report.visited.map((visit) => visit.path)).toEqual(
		expect.arrayContaining(['/app/hr_employee/self_service', '/app/hr_controller/events/work'])
	);
	for (const collection of Object.keys(representations)) {
		expect(report.visited.some((visit) => visit.path.endsWith(`?record=${collection}/new`))).toBe(
			true
		);
	}
	expect(report.findings).toEqual([]);
});

// @vitest-environment happy-dom
/**
 * Every page renders for every holder: the real shell over this template on the test kit with public seed data,
 * one member per policy, every page that member's navigation offers plus the inbox and runs. A console error, a thrown
 * page or a live view the host refuses as over budget is a finding.
 */
import { expect, it } from 'vitest';
import { sweep } from '@norbital-ai/bolt/test/browser';
import { siteWithJob, workspace } from '../kit.ts';

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
	const t = await workspace();
	await siteWithJob(t);
	const report = await sweep(t, {
		pages: pages as never,
		representations
	});
	expect(report.visited.map((visit) => visit.path)).toEqual(
		expect.arrayContaining([
			'/app/field_ops_controller/dispatch',
			'/app/field_ops_controller/sites',
			'/app/field_ops_contractor/jobs'
		])
	);
	for (const collection of Object.keys(representations)) {
		expect(report.visited.some((visit) => visit.path.endsWith(`?record=${collection}/new`))).toBe(
			true
		);
	}
	expect(report.findings).toEqual([]);
});

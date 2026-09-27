// @vitest-environment happy-dom
/**
 * Every page renders for every holder: the real shell over this template on the test kit with the bank's sample pack,
 * one member per policy, every page that member's navigation offers plus the inbox and runs. A console error, a thrown
 * page or a live view the host refuses as over budget is a finding.
 */
import { expect, it } from 'vitest';
import { sweep } from '@norbital-ai/bolt/test/browser';
import { workspace } from '../kit.ts';

/** `src/app/<app>/+<page>.page.svelte` as the shell names it, `<app>/<page>`. */
const pages = Object.fromEntries(
	Object.entries(import.meta.glob('../../src/app/**/+*.page.svelte')).map(([path, load]) => [
		path.replace(/^\.\.\/\.\.\/src\/app\//, '').replace(/\/\+([a-z0-9_]+)\.page\.svelte$/, '/$1'),
		load
	])
);

it('every app page renders for every policy with no console error and no over-budget view', async () => {
	const report = await sweep(await workspace({ sample: true }), { pages: pages as never });
	expect(report.visited.map((visit) => visit.path)).toEqual(
		expect.arrayContaining(['/app/crm/desk', '/app/crm_purchase/desk'])
	);
	expect(report.findings).toEqual([]);
});

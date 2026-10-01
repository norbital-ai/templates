// @vitest-environment happy-dom
/**
 * Every page renders for every holder: the real shell over this template on the test kit with public seed data,
 * one member per policy, every page that member's navigation offers plus the inbox and runs. A console error, a thrown
 * page or a live view the host refuses as over budget is a finding.
 */
import { expect, it } from 'vitest';
import { sweep } from '@norbital-ai/bolt/test/browser';
import { committed, workspace } from '../kit.ts';
import { loadPack, readPack } from '@norbital-ai/bolt/engine';

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
	await loadPack(t.db, t.manifest, readPack(`${process.cwd()}/.norbital/seed/base`), t.clock.now());
	if (t.admin.actor.kind !== 'member') throw new Error('Fixture requires a member');
	const admin = t.as(t.admin);
	const account = (await admin.read('accounts', { limit: 1 })).rows[0]!;
	const product = (await admin.read('products', { limit: 1 })).rows[0]!;
	const quote = committed(
		await admin.act('quotes.create', {
			account_id: String(account.id),
			title: 'UI fixture',
			currency: 'SGD',
			tax_inclusive: false,
			owner_id: t.admin.actor.id
		})
	);
	committed(
		await admin.act('quote_lines.create', {
			quote_id: quote,
			product_id: String(product.id),
			quantity: 2,
			unit_price: 10,
			tax_rate: 9
		})
	);
	const report = await sweep(t, {
		pages: pages as never,
		representations
	});
	expect(report.visited.map((visit) => visit.path)).toEqual(
		expect.arrayContaining(['/app/crm/desk', '/app/crm_purchase/desk'])
	);
	for (const collection of Object.keys(representations)) {
		expect(report.visited.some((visit) => visit.path.endsWith(`?record=${collection}/new`))).toBe(
			true
		);
	}
	expect(report.findings).toEqual([]);
});

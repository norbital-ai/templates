// @vitest-environment happy-dom
/**
 * Every page renders for every holder: the real shell over this template's build on the test kit, one member per policy
 * (staff and external), and the portal's visitor, on the public seed plus a day of bookings so the schedule, the helper's
 * day and the customer's visits have rows to draw. A console error, a thrown page or a live view the host refuses is a
 * finding — the class of fault a wrong `every` or a refused read shows only in a browser.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadPack, readPack, type EngineManifest } from '@norbital-ai/bolt/engine';
import { testWorkspace } from '@norbital-ai/bolt/test';
import { sweep } from '@norbital-ai/bolt/test/browser';

const built = (file: string) => readFileSync(`${process.cwd()}/.norbital/artifact/${file}`, 'utf8');
/** `src/app/<app>/+<page>.page.svelte` as the shell names it, `<app>/<page>`. */
const pages = Object.fromEntries(
	Object.entries(import.meta.glob('../../src/app/**/+*.page.svelte')).map(([path, load]) => [
		path.replace(/^\.\.\/\.\.\/src\/app\//, '').replace(/\/\+([a-z0-9_]+)\.page\.svelte$/, '/$1'),
		load
	])
);

it('every page renders for every policy and the portal visitor, with no console error and no refused view', async () => {
	const t = await testWorkspace({
		manifest: JSON.parse(built('manifest.json')) as EngineManifest,
		guest: { source: built('guest.mjs') },
		transforms: (JSON.parse(built('artifact.json')) as { transforms: string[] }).transforms,
		now: '2026-09-29T00:00:00.000Z'
	});
	// the public seed, as provisioning restores it
	await loadPack(t.db, t.manifest, readPack(`${process.cwd()}/.norbital/seed/base`), t.clock.now());
	const book = (input: object) =>
		t.as(t.member(['operations'])).act('bookings.book', {
			customer: '0d500003-0000-4000-8000-000000000001',
			service: '0d500001-0000-4000-8000-000000000001',
			preference: 'any',
			start: '2026-09-29T02:00:00.000Z',
			repeat: 'weekly',
			visits: 2,
			...input
		});
	expect(await book({})).toMatchObject({ kind: 'committed' });
	const report = await sweep(t, { pages: pages as never });
	expect(report.visited.map((v) => v.path)).toEqual(
		expect.arrayContaining([
			'/app/scheduler/schedule/board',
			'/app/scheduler/schedule/live',
			'/app/helper/today',
			'/app/my_visits/visits',
			'/app/portal/book'
		])
	);
	expect(report.findings).toEqual([]);
});

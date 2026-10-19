// @vitest-environment happy-dom
/**
 * Every page renders for every holder: the real shell over this template on the test kit with public seed data,
 * one member per policy, every page that member's navigation offers plus the inbox and runs. A console error, a thrown
 * page or a live view the host refuses as over budget is a finding.
 * `sweep()` walks app navigation only, so the attendance kiosk (`src/kiosk/attendance/`) is not visited.
 *
 * happy-dom `sweep()` is the template surface walk. Real Chromium is Vitest browser mode
 * (`@vitest/browser-playwright`, `page` from `vitest/browser`) — https://vitest.dev/guide/browser/.
 */
import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { sweep, type SweepOptions } from '@norbital-ai/bolt/test/browser';
import { workspace } from '../kit.ts';

/** `src/app/<app>/+<page>.page.svelte` as the shell names it, `<app>/<page>`. */
type PageLoader = NonNullable<SweepOptions['pages']>[string];
const pages = Object.fromEntries(
	Object.entries(
		import.meta.glob<Awaited<ReturnType<PageLoader>>>('../../src/app/**/+*.page.svelte')
	).map(([path, load]) => [
		path.replace(/^\.\.\/\.\.\/src\/app\//, '').replace(/\/\+([a-z0-9_]+)\.page\.svelte$/, '/$1'),
		load
	])
);

type RepresentationLoader = NonNullable<SweepOptions['representations']>[string];
const representations = Object.fromEntries(
	Object.entries(
		import.meta.glob<Awaited<ReturnType<RepresentationLoader>>>(
			'../../src/data/collection/**/+representation.svelte'
		)
	).map(([path, load]) => {
		const collection = path
			.replace('../../src/data/collection/', '')
			.replace('/+representation.svelte', '')
			.split('/')
			.at(-1);
		if (collection === undefined || collection === '')
			throw new Error(`Missing representation collection: ${path}`);
		return [collection, load];
	})
);

it.live(
	'every app page renders for every policy with no console error and no over-budget view',
	() =>
		Effect.gen(function* () {
			const report = yield* sweep({ pages, representations });
			expect(report.visited.map((visit) => visit.path)).toEqual(
				expect.arrayContaining([
					'/app/hr_controller/people/people',
					'/app/hr_controller/payroll/payroll',
					'/app/hr_employee/self_service'
				])
			);
			for (const collection of Object.keys(representations)) {
				expect(
					report.visited.some((visit) => visit.path.endsWith(`?record=${collection}/new`))
				).toBe(true);
			}
			expect(report.findings).toEqual([]);
		}).pipe(Effect.provide(workspace()), Effect.scoped),
	{ timeout: 300_000 }
);

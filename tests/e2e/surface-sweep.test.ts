import { Effect } from 'effect';
// @vitest-environment happy-dom
/**
 * Every page renders for every holder: the real shell over this template on the test kit with public seed data,
 * one member per policy, every page that member's navigation offers plus the inbox and runs. A console error, a thrown
 * page or a live view the host refuses as over budget is a finding.
 */
import { expect, it } from '@effect/vitest';
import { sweep } from '@norbital-ai/bolt/test/browser';
import { siteWithJob, workspace } from '../kit.ts';
/** `src/app/<app>/+<page>.page.svelte` as the shell names it, `<app>/<page>`. */
type Options = NonNullable<Parameters<typeof sweep>[0]>;
type PageLoader = NonNullable<Options['pages']>[string];
const pages = Object.fromEntries(
	Object.entries(
		import.meta.glob<Awaited<ReturnType<PageLoader>>>('../../src/app/**/+*.page.svelte')
	).map(([path, load]) => [
		path.replace(/^\.\.\/\.\.\/src\/app\//, '').replace(/\/\+([a-z0-9_]+)\.page\.svelte$/, '/$1'),
		load
	])
);
type RepresentationLoader = NonNullable<Options['representations']>[string];
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
it.live(
	'every app page renders for every policy with no console error and no over-budget view',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			yield* siteWithJob(t);
			const report = yield* sweep({
				pages,
				representations
			}).pipe(Effect.provide(t.services));
			expect(report.visited.map((visit) => visit.path)).toEqual(
				expect.arrayContaining([
					'/app/field_ops_controller/dispatch',
					'/app/field_ops_controller/sites',
					'/app/field_ops_contractor/jobs'
				])
			);
			for (const collection of Object.keys(representations)) {
				expect(
					report.visited.some((visit) => visit.path.endsWith(`?record=${collection}/new`))
				).toBe(true);
			}
			expect(report.findings).toEqual([]);
		})
);

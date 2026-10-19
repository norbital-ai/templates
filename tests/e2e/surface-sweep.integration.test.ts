import { Effect } from 'effect';
// @vitest-environment happy-dom
/**
 * Every app page renders for every team: the real shell over a test-kit workspace built from this template and
 * seeded with its public base pack, one member per team's policies and an administrator, every page their navigation
 * offers. A console error, a thrown page or an over-budget live view is a finding.
 */
import { expect, it } from '@effect/vitest';
import { workspace as acquireWorkspace } from '../test-runtime.js';
import { sweep, type SweepOptions } from '@norbital-ai/bolt/test/browser';
import teams from '../../src/access_control/team/+team.ts';
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
	).map(([path, load]) => [
		path.replace('../../src/data/collection/', '').replace('/+representation.svelte', ''),
		load
	])
);
it.live('every app page renders for every team with no console error and no over-budget view', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({ root: process.cwd() });
		const report = yield* sweep({
			pages,
			representations,
			as: [{ admin: true }, ...Object.values(teams).map((spec) => ({ policies: spec.policies }))]
		}).pipe(Effect.provide(t.services));
		expect(report.visited.map((visit) => visit.path)).toEqual(
			expect.arrayContaining([
				'/app/construction_project_workspace/projects',
				'/app/construction_settings_reference_matrix/matrix',
				'/app/construction_settings_workforce/workforce'
			])
		);
		for (const collection of Object.keys(representations)) {
			expect(report.visited.some((visit) => visit.path.endsWith(`?record=${collection}/new`))).toBe(
				true
			);
		}
		expect(report.findings).toEqual([]);
	}).pipe(Effect.scoped)
);

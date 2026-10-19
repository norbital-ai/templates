import { Effect } from 'effect';
// @vitest-environment happy-dom
/**
 * Every page renders for every holder: internal pages use the real shell, public pages validate real isolated SSR
 * documents and shared-codec hydration data. Production browser probes cover public interactivity. One member per policy
 * (staff and external), and the portal's visitor, on the public seed plus a day of bookings so the schedule, the helper's
 * day and the customer's visits have rows to draw. A console error, a thrown page or a live view the host refuses is a
 * finding — the class of fault a wrong `every` or a refused read shows only in a browser.
 */
import * as NodeServices from '@effect/platform-node/NodeServices';
import { expect, it, vi } from '@effect/vitest';
import { readPack } from '@norbital-ai/bolt/engine';
import { readArtifact } from '@norbital-ai/bolt/artifact';
import type { ActInput } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { workspace as acquireWorkspace, fixtureId } from '../test-runtime.js';
import { sweep, type SweepOptions } from '@norbital-ai/bolt/test/browser';
import BookData from '../../src/app/portal/book.page.data.js';
import VisitsData from '../../src/app/portal/visits.page.data.js';
const publicPages = {
	'app/portal/book': BookData,
	'app/portal/visits': VisitsData
} satisfies NonNullable<SweepOptions['publicPages']>;
type PageLoader = NonNullable<SweepOptions['pages']>[string];
/** `src/app/<app>/+<page>.page.svelte` as the shell names it, `<app>/<page>`. */
const pages = Object.fromEntries(
	Object.entries(
		import.meta.glob<Awaited<ReturnType<PageLoader>>>([
			'../../src/app/**/+*.page.svelte',
			'!../../src/app/portal/+*.page.svelte'
		])
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
it.live(
	'every page renders for every policy and the portal visitor, with no console error and no refused view',
	() =>
		Effect.gen(function* () {
			const artifact = yield* readArtifact(`${process.cwd()}/.norbital/artifact`).pipe(
				Effect.provide(NodeServices.layer)
			);
			// Restore the public pack during acquisition, before any test member exists.
			const pack = yield* readPack(`${process.cwd()}/.norbital/seed/base`).pipe(
				Effect.provide(NodeServices.layer)
			);
			const t = yield* acquireWorkspace({
				artifact,
				pack,
				now: '2026-09-29T00:00:00.000Z'
			});
			const book = (input: Partial<ActInput<'bookings.book'>>) =>
				t
					.as(
						t.member(['operations'], {
							teams: ['team-operations'],
							teamPath: ['team-operations']
						})
					)
					.act('bookings.book', {
						customer: fixtureId('customers', '0d500003-0000-4000-8000-000000000001'),
						service: fixtureId('services', '0d500001-0000-4000-8000-000000000001'),
						preference: 'any',
						start: Instant('2026-09-29T02:00:00.000Z'),
						repeat: 'weekly',
						visits: 2,
						...input
					});
			expect(yield* book({})).toMatchObject({ kind: 'committed' });
			const report = yield* sweep({ pages, publicPages, representations }).pipe(
				Effect.provide(t.services)
			);
			expect(report.visited.map((v) => v.path)).toEqual(
				expect.arrayContaining([
					'/app/scheduler/schedule/board',
					'/app/scheduler/schedule/live',
					'/app/helper/today',
					'/app/portal/visits',
					'/app/portal/book'
				])
			);
			expect(
				report.visited.filter((visit) => visit.mode === 'ssr').map((visit) => visit.path)
			).toEqual(expect.arrayContaining(['/app/portal/book', '/app/portal/visits']));
			for (const collection of Object.keys(representations)) {
				expect(
					report.visited.some((visit) => visit.path.endsWith(`?record=${collection}/new`))
				).toBe(true);
			}
			expect(report.findings).toEqual([]);
		})
);
it.live('scopes the schedule to the workspace day when the browser uses Tokyo time', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({ root: process.cwd(), seed: 'base' });
		const reads = yield* Effect.acquireRelease(
			Effect.sync(() => {
				const reads = vi.spyOn(t.db, 'read');
				vi.stubEnv('TZ', 'Asia/Tokyo');
				return reads;
			}),
			(reads) =>
				Effect.sync(() => {
					reads.mockRestore();
					vi.unstubAllEnvs();
				})
		);
		const report = yield* sweep({
			pages,
			apps: ['scheduler/schedule'],
			as: [{ admin: true }]
		}).pipe(Effect.provide(t.services));
		expect(report.findings).toEqual([]);
		const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
		const start = new Date(`${day}T00:00:00+08:00`);
		const end = new Date(start.getTime() + 86400000);
		const queries = reads.mock.calls
			.flatMap(([statements]) => statements)
			.filter((statement) => statement.text.includes('visits'))
			.map((statement) => JSON.stringify(statement.params));
		expect(
			queries.some(
				(query) => query.includes(start.toISOString()) && query.includes(end.toISOString())
			)
		).toBe(true);
	})
);

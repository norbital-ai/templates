import { Effect } from 'effect';
import { readFileSync } from 'node:fs';
import { flushSync } from 'svelte';
// @vitest-environment happy-dom
/**
 * Every page renders for every holder: the real shell over this template on the test kit with public seed data,
 * one member per policy, every page that member's navigation offers plus the inbox and runs. A console error, a thrown
 * page or a live view the host refuses as over budget is a finding.
 */
import { expect, it } from '@effect/vitest';
import { sweep, visit } from '@norbital-ai/bolt/test/browser';
import { rows, siteWithJob, workspace } from '../kit.ts';
import { present } from '../test-runtime.ts';
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

const until = <E = never, R = never>(ready: () => boolean | Effect.Effect<boolean, E, R>) =>
	Effect.gen(function* () {
		const check = Effect.suspend(() => {
			const value = ready();
			return typeof value === 'boolean' ? Effect.succeed(value) : value;
		});
		for (let attempt = 0; attempt < 600 && !(yield* check); attempt++) {
			yield* Effect.sleep('5 millis');
			flushSync();
		}
		expect(yield* check).toBe(true);
	});

it.live('a controller files a photo without editing system-assigned provenance', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const t = yield* workspace();
			t.clock.set(new Date().toISOString());
			const { job } = yield* siteWithJob(t);
			const administrator = t.admin;
			if (administrator.actor.kind !== 'member')
				throw new Error('A member administrator is required');
			const { target } = yield* visit(
				'/app/field_ops_controller/dispatch?record=photo_evidence/new',
				{ ...administrator, id: administrator.actor.id },
				{ pages, representations }
			).pipe(Effect.provide(t.services));
			const field = (name: string) => target.querySelector(`[data-field="${name}"]`);
			yield* until(() => field('photo')?.querySelector('input[type=file]') != null);
			expect(field('source')).toBeNull();
			present(
				field('job_assignment_id')?.querySelector<HTMLButtonElement>('[role=combobox]')
			).click();
			yield* until(
				() => document.querySelector(`[role=option][data-value="${job}"] button`) !== null
			);
			present(
				document.querySelector<HTMLButtonElement>(`[role=option][data-value="${job}"] button`)
			).click();
			const input = present(field('photo')?.querySelector<HTMLInputElement>('input[type=file]'));
			Object.defineProperty(input, 'files', {
				configurable: true,
				value: [
					new File(
						[Uint8Array.from(readFileSync('tests/fixtures/photo-evidence.jpg'))],
						'field-report.jpg',
						{ type: 'image/jpeg' }
					)
				]
			});
			input.dispatchEvent(new Event('change', { bubbles: true }));
			present(field('photo')?.closest('form')).requestSubmit();
			const filed = () =>
				rows(
					t,
					'SELECT job_assignment_id, variation_request_id, photo, source, sha256, summary, flags FROM photo_evidence'
				);
			yield* until(() => filed().pipe(Effect.map((photos) => photos.length === 1)));
			expect(yield* filed()).toMatchObject([
				{
					job_assignment_id: job,
					variation_request_id: null,
					photo: { name: 'field-report.jpg' },
					source: { kind: 'workspace_upload' },
					sha256: '',
					summary: 'Workspace upload',
					flags: []
				}
			]);
		})
	)
);

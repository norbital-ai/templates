// A change of law is written, edited, moved and deleted where it stands, and every such write is checked on the law
// it leaves: on its own date and at every later change date. A row's params keep their family's shape, an expression
// reads only its family's roots, the subtotal chain stays linear, statutory dependencies stay acyclic, the first
// change stays the first, and no catalogue row an entry dated in that span names is taken away.
// Synthetic: the fixture's own law is only what the patches are written against; no figure of that law is under test.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { lawOn } from '../../src/lib/law.ts';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { isJsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { claimed } from '../amendment_kit.ts';
import { ENTITY, lawAt, pack, storedQuery, storedReader, workspace } from '../kit.ts';

const CODE = 'MY';
const NOW = '2026-08-20T02:00:00.000Z';
const seed = pack(
	CODE,
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 3120, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[]
);
const CLAIM = 'MEDICAL_CLAIM';
const SCHEME = 'EPF';
const FIXTURE = lawAt(CODE, NOW.slice(0, 10));
/** The fixture's chain of subtotals, by code: its first and last checkpoints. */
const CHAIN = FIXTURE.rows.subtotal.map((row) => String(row.code));
const FIRST = String(CHAIN[0]);
const LAST = String(CHAIN.at(-1));
/** The checkpoint the fixture's claim row posts to. */
const POSTS = FIXTURE.rows.claim_catalog.find((row) => row.code === CLAIM)?.subtotal;
const claim = (fields: JsonObject | null): JsonObject => ({ claim_catalog: { [CLAIM]: fields } });

/** The law's changes as stored, oldest first. */
const changes = (t: Kit) =>
	storedQuery(t, {
		jurisdiction_change: { where: { jurisdiction_code: { eq: CODE } }, limit: 100 }
	}).pipe(
		Effect.map(({ jurisdiction_change }) =>
			jurisdiction_change.rows.toSorted((left, right) =>
				left.effective_from.localeCompare(right.effective_from)
			)
		)
	);
/** What tells one stored chain from another: each change, its date and how often it was written. */
const written = (t: Kit) =>
	changes(t).pipe(
		Effect.map((rows) => rows.map((row) => [row.id, row.effective_from, row.revision]))
	);
const changeOn = (t: Kit, on: string) =>
	changes(t).pipe(
		Effect.map((rows) => {
			const row = rows.find((one) => one.effective_from === on);
			assert.ok(row !== undefined, `No change on ${on}`);
			return row;
		})
	);
const create = (t: Kit, on: string, law: JsonObject) =>
	Effect.flatMap(t.as(t.admin), (admin) =>
		admin.act({
			'jurisdiction_change.create': [{ jurisdiction_code: CODE, effective_from: on, law }]
		})
	);
const update = (
	t: Kit,
	on: string,
	set: { readonly effective_from?: string; readonly law?: JsonObject }
) =>
	Effect.all([t.as(t.admin), changeOn(t, on)]).pipe(
		Effect.flatMap(([admin, target]) =>
			admin.act({ 'jurisdiction_change.update': [{ target, set }] })
		)
	);
const remove = (t: Kit, on: string) =>
	Effect.all([t.as(t.admin), changeOn(t, on)]).pipe(
		Effect.flatMap(([admin, target]) => admin.act({ 'jurisdiction_change.delete': [{ target }] }))
	);
/** Why a write was refused. */
const refused = <A, E>(write: Effect.Effect<A, E>) => Effect.flip(write).pipe(Effect.map(String));
/** The claim row as the company's law holds it on a day in the workspace: the fold of the stored changes. */
const claimOn = (t: Kit, on: string) =>
	lawOn(storedReader(t), [{ entity: ENTITY, on }]).pipe(
		Effect.map(([law]) => law?.rows.claim_catalog.find((row) => row.code === CLAIM))
	);
const limitOn = (t: Kit, on: string) =>
	claimOn(t, on).pipe(
		Effect.map((row) => (isJsonObject(row?.lookup) ? row.lookup.annual_limit : undefined))
	);

describe('a write to a change of law', () => {
	it.live(
		'is refused while a row’s params are outside its family’s shape, naming the row, or reading a root its family lacks; corrected it is taken, and it is edited, moved and deleted where it stands',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const before = yield* written(t);
				const HELD = yield* limitOn(t, '2026-09-01');
				assert.equal(typeof HELD, 'number');
				// a param its family declares as a number, as text
				assert.match(
					yield* refused(create(t, '2026-09-01', claim({ lookup: { annual_limit: 'many' } }))),
					new RegExp(`${CLAIM}: params do not match the family shape`)
				);
				// a claim row prices from the entry and the wage, never from overtime
				assert.match(
					yield* refused(
						create(t, '2026-09-01', claim({ conversion: 'return ctx.overtime.total;' }))
					),
					/ctx\.overtime is unavailable at CALCULATION/
				);
				assert.deepEqual(yield* written(t), before);
				// the way out: the patch corrected. The law holds it from its date, and not a day before
				yield* create(t, '2026-09-01', claim({ lookup: { annual_limit: 2000 } }));
				assert.equal(yield* limitOn(t, '2026-08-31'), HELD);
				assert.equal(yield* limitOn(t, '2026-09-01'), 2000);
				// edited: every day it covers follows
				yield* update(t, '2026-09-01', { law: claim({ lookup: { annual_limit: 3000 } }) });
				assert.equal(yield* limitOn(t, '2026-09-01'), 3000);
				// an edit is checked as the first write was, and a refused one leaves the change as it stood
				assert.match(
					yield* refused(
						update(t, '2026-09-01', { law: claim({ lookup: { annual_limit: 'many' } }) })
					),
					new RegExp(`${CLAIM}: params do not match the family shape`)
				);
				assert.equal(yield* limitOn(t, '2026-09-01'), 3000);
				// moved: the days it no longer covers go back to the law before it
				yield* update(t, '2026-09-01', { effective_from: '2026-10-01' });
				assert.equal(yield* limitOn(t, '2026-09-30'), HELD);
				assert.equal(yield* limitOn(t, '2026-10-01'), 3000);
				// deleted: nothing of it is left
				yield* remove(t, '2026-10-01');
				assert.equal(yield* limitOn(t, '2026-10-01'), HELD);
				assert.deepEqual(yield* written(t), before);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'is refused when it breaks the subtotal chain, a statutory dependency or a row’s checkpoint',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const before = yield* written(t);
				for (const [law, reason] of [
					[
						{ subtotal: { [LAST]: { previous: FIRST } } },
						/Subtotals must form one linear chain, not a branch/
					],
					[
						{ subtotal: { [LAST]: { previous: null } } },
						/A subtotal chain needs exactly one first checkpoint/
					],
					[
						{ subtotal: { [LAST]: { previous: 'NOWHERE' } } },
						new RegExp(`${LAST}: predecessor is missing`)
					],
					[
						{ statutory_contribution_catalog: { [SCHEME]: { depends_on: [SCHEME] } } },
						new RegExp(`${SCHEME}: statutory dependency cycle`)
					],
					[
						{ statutory_contribution_catalog: { [SCHEME]: { depends_on: ['NOWHERE'] } } },
						/NOWHERE: unknown statutory dependency/
					],
					[
						claim({ subtotal: 'NOWHERE' }),
						new RegExp(`${CLAIM}: subtotal NOWHERE is not a subtotal of this law`)
					]
				] as const)
					assert.match(yield* refused(create(t, '2026-09-01', law)), reason);
				assert.deepEqual(yield* written(t), before);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'is checked at every later change date: a change a later one leans on is not deleted or moved past it, and the first change stays the first',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const before = yield* written(t);
				const [first, second] = yield* changes(t);
				assert.ok(first !== undefined && second !== undefined);
				const leans = new RegExp(`${CLAIM}: subtotal EXTRA is not a subtotal of this law`);
				// one change adds a checkpoint; a later one posts a row to it
				yield* create(t, '2026-09-01', { subtotal: { EXTRA: { name: 'Extra', previous: LAST } } });
				yield* create(t, '2026-10-01', claim({ subtotal: 'EXTRA' }));
				assert.equal((yield* claimOn(t, '2026-09-30'))?.subtotal, POSTS);
				assert.equal((yield* claimOn(t, '2026-10-01'))?.subtotal, 'EXTRA');
				// the earlier one holds on its own date either way; the law it would leave on the later date does not
				assert.match(yield* refused(remove(t, '2026-09-01')), leans);
				assert.match(
					yield* refused(update(t, '2026-09-01', { effective_from: '2026-11-01' })),
					leans
				);
				assert.match(
					yield* refused(update(t, '2026-10-01', { effective_from: '2026-08-25' })),
					leans
				);
				// the first change holds the whole law
				const whole = /The first change of a law holds the whole law/;
				assert.match(yield* refused(remove(t, first.effective_from)), whole);
				assert.match(
					yield* refused(update(t, second.effective_from, { effective_from: '2025-11-01' })),
					whole
				);
				// the way out: newest first
				yield* remove(t, '2026-10-01');
				yield* remove(t, '2026-09-01');
				assert.deepEqual(yield* written(t), before);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'cannot take away a catalogue row an entry dated on or after it names; from a later date it can',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* claimed(t, 100, '2026-08-10');
				// a row set to null is taken away from the change's date
				assert.match(
					yield* refused(create(t, '2026-08-01', claim(null))),
					new RegExp(`${CLAIM}: claim_catalog_entry rows dated on or after this change name it`)
				);
				assert.ok((yield* claimOn(t, '2026-08-10')) !== undefined);
				yield* create(t, '2026-09-01', claim(null));
				assert.ok((yield* claimOn(t, '2026-08-31')) !== undefined);
				assert.equal(yield* claimOn(t, '2026-09-01'), undefined);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

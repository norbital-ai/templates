// A change of law is a new sealed version, never an edit to a sealed one: every catalogue, rule, effect and subtotal
// row of a sealed version refuses create, update and delete, and a draft takes all three. Sealing checks each row
// against its family's declared shape and names the row that fails; corrected on the draft, the version seals.
// Synthetic: the draft is the fixture's own law copied whole under another code; no figure of that law is under test.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Cause, Effect, Exit } from 'effect';
import { type JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { pack, uuid, workspace } from './kit.ts';

const NOW = '2026-08-20T02:00:00.000Z';
const base = pack(
	'MY',
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
	[],
	'2026-08-15'
);
type Seed = typeof base;
const SEALED = String(base.entity_profile_version?.[0]?.input_schema_version_id);
const DRAFT = uuid(90000);
// every model a version owns; `subtotal` first, the rest name one
const MODELS = [
	'subtotal',
	'allowance_catalog',
	'overtime_catalog',
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'work_event_catalog',
	'workplace_case_catalog',
	'registered_rule',
	'registered_effect'
] as const;
type Model = (typeof MODELS)[number];
const NOT_DRAFT = /Only a draft jurisdiction configuration can be changed/;

/** The sealed version copied whole as a draft under another code, every id and link its own. */
const drafted = (change: (model: Model, row: JsonObject) => JsonObject = (_, row) => row): Seed => {
	const ids = new Map([[SEALED, DRAFT]]);
	const own = MODELS.map(
		(model) => [model, (base[model] ?? []).filter((row) => row.settings_id === SEALED)] as const
	);
	let next = 90001;
	for (const [, rows] of own) for (const row of rows) ids.set(String(row.id), uuid(next++));
	const moved = (row: JsonObject): JsonObject =>
		Object.fromEntries(
			Object.entries(row).map(([field, value]) => [
				field,
				typeof value === 'string' ? (ids.get(value) ?? value) : value
			])
		);
	const settings = (base.jurisdiction_settings ?? []).find((row) => row.id === SEALED);
	if (settings === undefined) throw new Error('No sealed version in the fixture');
	return {
		...base,
		jurisdiction_settings: [
			...(base.jurisdiction_settings ?? []),
			{ ...settings, id: DRAFT, code: 'ZZ', name: 'Draft', status: 'DRAFT' }
		],
		...Object.fromEntries(
			own.map(([model, rows]) => [
				model,
				[...(base[model] ?? []), ...rows.map((row) => change(model, moved(row)))]
			])
		)
	};
};
/** A new row for a version: its first row of the model under another code; a subtotal follows the chain's last. */
const added = (seed: Seed, model: Model, version: string): JsonObject => {
	const rows = (seed[model] ?? []).filter((row) => row.settings_id === version);
	const [first] = rows;
	if (first === undefined) throw new Error(`No ${model} row in the fixture`);
	const followed = new Set(rows.map((row) => row.previous_id));
	const last = rows.find((row) => !followed.has(row.id));
	return {
		...Object.fromEntries(Object.entries(first).filter(([field]) => field !== 'id')),
		code: `${String(first.code)}_NEW`,
		...(model === 'subtotal' && last !== undefined ? { previous_id: last.id } : {})
	};
};
/** Every row of the law, as `model/version/code → id`. */
const law = (t: Kit) =>
	t
		.storedQuery({
			subtotal: { limit: 10000 },
			allowance_catalog: { limit: 10000 },
			overtime_catalog: { limit: 10000 },
			statutory_contribution_catalog: { limit: 10000 },
			leave_catalog: { limit: 10000 },
			claim_catalog: { limit: 10000 },
			adhoc_catalog: { limit: 10000 },
			loan_catalog: { limit: 10000 },
			work_event_catalog: { limit: 10000 },
			workplace_case_catalog: { limit: 10000 },
			registered_rule: { limit: 10000 },
			registered_effect: { limit: 10000 }
		})
		.pipe(
			Effect.map(
				(got) =>
					new Map<string, string>(
						MODELS.flatMap((model) =>
							got[model].rows.map(
								(row) => [`${model}/${row.settings_id}/${row.code}`, String(row.id)] as const
							)
						)
					)
			)
		);
/** Why an act did not commit; `committed` when it did. */
const outcome = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.exit(effect).pipe(
		Effect.map((exit) => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'committed'))
	);
const statusOf = (t: Kit, id: string) =>
	t
		.storedQuery({ jurisdiction_settings: { limit: 100 } })
		.pipe(
			Effect.map(
				({ jurisdiction_settings }) =>
					jurisdiction_settings.rows.find((row) => row.id === id)?.status
			)
		);

describe('the rows of a version of the law', () => {
	const seed = drafted();
	it.live(
		'sealed, refuse create, update and delete on every model and stand unchanged; on a draft the same acts pass',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const acts = t.bodyActs(t.admin);
				const write = (model: Model, verb: 'create' | 'update' | 'delete', input: JsonObject) =>
					outcome(acts.checked([{ callable: `${model}.${verb}`, input: [input] }]));
				const before = yield* law(t);
				for (const model of MODELS) {
					const row = added(seed, model, SEALED);
					const held = before.get(`${model}/${SEALED}/${String(row.code).replace(/_NEW$/, '')}`);
					assert.ok(held !== undefined, model);
					assert.match(yield* write(model, 'create', row), NOT_DRAFT, `${model}.create`);
					assert.match(
						yield* write(model, 'update', { target: held, set: { code: 'CHANGED' } }),
						NOT_DRAFT,
						`${model}.update`
					);
					assert.match(
						yield* write(model, 'delete', { target: held }),
						NOT_DRAFT,
						`${model}.delete`
					);
				}
				assert.deepEqual(yield* law(t), before);
				// the draft is where the law is written: the same three acts, on each model
				for (const model of MODELS) {
					const row = added(seed, model, DRAFT);
					assert.equal(yield* write(model, 'create', row), 'committed', `${model}.create`);
					const made = (yield* law(t)).get(`${model}/${DRAFT}/${String(row.code)}`);
					assert.ok(made !== undefined, model);
					assert.equal(
						yield* write(model, 'update', {
							target: made,
							set: { code: `${String(row.code)}_2` }
						}),
						'committed',
						`${model}.update`
					);
					assert.equal(
						yield* write(model, 'delete', { target: made }),
						'committed',
						`${model}.delete`
					);
				}
				assert.deepEqual(yield* law(t), before);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('sealing a draft', () => {
	// one row of the draft holds a param its family declares as a number, as text
	const CLAIM = 'MEDICAL_CLAIM';
	const broken = drafted((model, row) =>
		model === 'claim_catalog' && row.code === CLAIM
			? {
					...row,
					lookup: { ...(isJsonObject(row.lookup) ? row.lookup : {}), annual_limit: 'many' }
				}
			: row
	);
	it.live(
		'is refused while a row’s params are outside its family’s shape, naming the row; a row cannot be saved reading a root its family lacks; corrected, the draft seals and is then closed',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = t.as(t.admin);
				const seal = outcome(
					admin.act('jurisdiction_settings.update', [
						{ target: idOf('jurisdiction_settings', DRAFT), set: { status: 'SEALED' } }
					])
				);
				assert.match(yield* seal, new RegExp(`${CLAIM}: params do not match the family shape`));
				assert.equal(yield* statusOf(t, DRAFT), 'DRAFT');
				const row = (yield* law(t)).get(`claim_catalog/${DRAFT}/${CLAIM}`);
				assert.ok(row !== undefined);
				const target = idOf('claim_catalog', row);
				// a claim row prices from the entry and the wage, never from overtime
				assert.match(
					yield* outcome(
						admin.act('claim_catalog.update', [
							{ target, set: { conversion: 'return ctx.overtime.total;' } }
						])
					),
					/ctx\.overtime is unavailable at CALCULATION/
				);
				// the way out: the row corrected on the draft
				yield* admin.act('claim_catalog.update', [
					{ target, set: { lookup: { annual_limit: 1000 } } }
				]);
				assert.equal(yield* seal, 'committed');
				assert.deepEqual((yield* t.runDue()).failed, []);
				assert.equal(yield* statusOf(t, DRAFT), 'SEALED');
				assert.match(
					yield* outcome(
						admin.act('claim_catalog.update', [{ target, set: { lookup: { annual_limit: 2000 } } }])
					),
					NOT_DRAFT
				);
			}).pipe(Effect.provide(workspace({ seed: broken, now: NOW })))
	);
});

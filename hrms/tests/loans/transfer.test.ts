// A transfer is one write (transfer-semantics.md §3.2, §5): the old stint's last day, the next stint under an id the
// sheet mints, and every loan and instalment that follows commit together or not at all. The page is not reachable from
// here, so the test reads what the Transfer sheet reads and sends the act map its planner (`transferActs`,
// src/lib/ui/person/stint_loans.ts) returns. Synthetic: the neutral test law, and a copy of it under a second code for a
// move across jurisdictions; no amount of a real law is under test.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { lawsOf } from '../../src/lib/law.ts';
import { isJsonObject, type JsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { buildLoanSchedule } from '../../src/lib/payroll_engine/loan_schedule.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { loansRead, transferActs, type Writes } from '../../src/lib/ui/person/stint_loans.ts';
import {
	EMPLOYMENT,
	ENTITY,
	PAY_GROUP,
	agreedTerms,
	current,
	decimalNumber,
	keyOf,
	pack,
	packTerms,
	query,
	refusal,
	seedLaw,
	stintOf,
	storedQuery,
	uuid,
	withSister,
	workspace
} from '../kit.ts';

const NOW = '2026-08-20T02:00:00.000Z';
const FIRST = idOf('employment', EMPLOYMENT);
const PERSON = idOf('employee_profile', uuid(4));
const SISTER = idOf('entity', uuid(900));
const SISTER_GROUP = idOf('pay_group', uuid(908));
const LAST = '2026-08-31';
const NEXT = '2026-09-01';
const PERIOD = { from: '2026-09-01', to: '2026-12-31' };
const FESTIVE = 'LOAN_RECOVERY_FESTIVE_ADVANCE';
// a row only the old law has: a loan on it cannot be opened again under the target law
const LOCAL = 'LOCAL_ADVANCE';
const ADVANCE = idOf('loan_catalog_entry', uuid(300));
const LOCAL_LOAN = idOf('loan_catalog_entry', uuid(301));

const base = pack('ZZ', 'Asia/Kuala_Lumpur', packTerms(3120, 'MANUAL_LABOUR'), {}, [], []);
type Seed = typeof base;
type Lent = {
	readonly id: Id<'loan_catalog_entry'>;
	readonly code: string;
	readonly principal: number;
};
/** Loans on the pack's stint, each on a monthly schedule over `PERIOD` no run has taken. */
const lent = (seed: Seed, loans: readonly Lent[]): Seed => ({
	...seed,
	loan_catalog_entry: loans.map(({ id, code, principal }) => ({
		id,
		entity_id: ENTITY,
		employment_id: EMPLOYMENT,
		catalog_code: code,
		quantity: principal,
		repayment_period: PERIOD
	})),
	loan_catalog_entry_repayment: loans.flatMap(({ id, principal }, loan) =>
		buildLoanSchedule({ principal, ...PERIOD, repayments: [] }).create.map((row, index) => ({
			id: uuid(310 + 10 * loan + index),
			entity_id: ENTITY,
			employment_id: EMPLOYMENT,
			loan_id: id,
			amount: row.amount,
			paid_on: row.paid_on
		}))
	)
});
const ADVANCE_ONLY: readonly Lent[] = [{ id: ADVANCE, code: FESTIVE, principal: 1200 }];
const BOTH: readonly Lent[] = [...ADVANCE_ONLY, { id: LOCAL_LOAN, code: LOCAL, principal: 600 }];

/** The old law with a loan row of its own (`LOCAL`) beside the fixture's. */
const withLocalRow = (changes: readonly JsonObject[]): readonly JsonObject[] =>
	changes.map((row) => {
		const law = isJsonObject(row.law) ? row.law : {};
		const loans = isJsonObject(law.loan_catalog) ? law.loan_catalog : {};
		return {
			...row,
			law: {
				...law,
				loan_catalog: {
					...loans,
					[LOCAL]: { lookup: {}, subtotal: 'NET', description: 'A local advance.' }
				}
			}
		};
	});
/** The sister company under a second law (`ZY`): the fixture's law under another code, without the `LOCAL` row. */
const across = (seed: Seed): Seed => {
	const sister = withSister(seed);
	const law = seedLaw('ZZ');
	return {
		...sister,
		entity: (sister.entity ?? []).map((row) =>
			row.id === SISTER ? { ...row, settings_code: 'ZY' } : row
		),
		jurisdiction: [
			...(sister.jurisdiction ?? []),
			...law.jurisdiction.map((row, index) => ({
				...row,
				id: uuid(700 + index),
				code: 'ZY',
				name: 'Second test law'
			}))
		],
		jurisdiction_change: [
			...withLocalRow(sister.jurisdiction_change ?? []),
			...law.jurisdiction_change.map((row, index) => ({
				...row,
				id: uuid(710 + index),
				jurisdiction_code: 'ZY'
			}))
		]
	};
};
const lawOf = (seed: Seed, code: string) => {
	const law = lawsOf(seed)(code, NEXT);
	assert.ok(law !== undefined, `No ${code} law on ${NEXT}`);
	return law;
};

/** The next stint as the sheet builds it: the person under `entity` from `NEXT`, its first terms and parameters. */
const next = (entity: Id<'entity'>, group: Id<'pay_group'>): JsonObject => ({
	employee_id: PERSON,
	entity_id: entity,
	effective_range: { from: NEXT, to: null },
	terms: [
		{
			effective_from: NEXT,
			engagement: 'EMPLOYEE',
			pay_group_id: group,
			...agreedTerms(3120, 'MANUAL_LABOUR')
		}
	],
	parameters: [
		{ effective_from: NEXT, parameters: { residency_status: 'CITIZEN', marital_status: 'SINGLE' } }
	]
});
/** What the Transfer sheet sends: the old stint's loans as read now, planned with the stint into one act map. */
const planned = (
	t: Kit,
	seed: Seed,
	options: { readonly carry: boolean; readonly settle?: boolean; readonly group?: Id<'pay_group'> }
) =>
	Effect.gen(function* () {
		const held = yield* query(t, yield* t.as(t.admin), loansRead(FIRST));
		return transferActs(
			held,
			yield* stintOf(t),
			{ lastDay: LAST, reason: 'Transfer' },
			next(SISTER, options.group ?? SISTER_GROUP),
			{
				entityId: SISTER,
				law: lawOf(seed, options.carry ? 'ZZ' : 'ZY'),
				carry: options.carry,
				settle: options.settle ?? false
			}
		);
	});
const send = (t: Kit, acts: Writes, key: string) =>
	Effect.flatMap(t.as(t.admin), (admin) => admin.act(acts, { key }));

const byId = <R extends { readonly id: string }>(rows: readonly R[]) =>
	rows.toSorted((left, right) => left.id.localeCompare(right.id));
/** The stints, loans and instalments as stored, each as the fields a transfer may move. */
const stored = (t: Kit) =>
	storedQuery(t, {
		employment: { fields: ['id', 'entity_id', 'effective_range'], limit: 10 },
		loan_catalog_entry: {
			fields: ['id', 'entity_id', 'employment_id', 'catalog_code', 'quantity', 'repayment_period'],
			limit: 100
		},
		loan_catalog_entry_repayment: {
			fields: [
				'id',
				'entity_id',
				'employment_id',
				'loan_id',
				'amount',
				'paid_on',
				'payment_reference',
				'payroll_run_id'
			],
			limit: 100
		}
	}).pipe(
		Effect.map((found) => ({
			stints: byId(
				found.employment.rows.map((row) => ({
					id: row.id,
					entity_id: row.entity_id,
					from: row.effective_range.from,
					to: row.effective_range.to
				}))
			),
			loans: byId(
				found.loan_catalog_entry.rows.map((row) => ({
					id: row.id,
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					quantity: decimalNumber(row.quantity),
					from: row.repayment_period.from,
					to: row.repayment_period.to
				}))
			),
			instalments: byId(
				found.loan_catalog_entry_repayment.rows.map((row) => ({
					id: row.id,
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					loan_id: row.loan_id,
					amount: decimalNumber(row.amount),
					paid_on: row.paid_on,
					payment_reference: row.payment_reference,
					sealed: row.payroll_run_id !== null
				}))
			)
		}))
	);
type Stored = Effect.Success<ReturnType<typeof stored>>;
/** After a transfer that did not commit: the person's one stint still open, none beside it, and no loan moved. */
const untouched = (t: Kit, before: Stored) =>
	Effect.gen(function* () {
		const after = yield* stored(t);
		assert.deepEqual(
			after.stints.map((row) => [row.id, row.to]),
			[[FIRST, null]]
		);
		assert.deepEqual(after.loans, before.loans);
		assert.deepEqual(after.instalments, before.instalments);
	});
/** The stint the transfer started. */
const nextOf = (after: Stored) => {
	const made = after.stints.find((row) => row.id !== FIRST);
	assert.ok(made !== undefined, 'No next stint');
	return made;
};
const cents = (rows: Stored['instalments']) =>
	Math.round(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0) * 100);

describe('a transfer under the same law', () => {
	const seed = withSister(lent(base, ADVANCE_ONLY));
	const quiet = withSister(base);

	it.live(
		'ends the old stint, starts the next and moves each loan with its open schedule, in one write',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const before = yield* stored(t);
				const acts = yield* planned(t, seed, { carry: true });
				// the loan's own write takes its open instalments along
				assert.deepEqual(Object.keys(acts), [
					'employment.update',
					'employment.create',
					'loan_catalog_entry.update'
				]);
				assert.equal((yield* send(t, acts, crypto.randomUUID())).kind, 'committed');
				const after = yield* stored(t);
				const made = nextOf(after);
				assert.equal(after.stints.length, 2);
				assert.equal(after.stints.find((row) => row.id === FIRST)?.to, LAST);
				assert.deepEqual([made.entity_id, made.from, made.to], [SISTER, NEXT, null]);
				// the loan and every instalment stand under the next stint and its company, otherwise as they were
				const under = { entity_id: SISTER, employment_id: made.id };
				assert.deepEqual(
					after.loans,
					before.loans.map((row) => ({ ...row, ...under }))
				);
				assert.deepEqual(
					after.instalments,
					before.instalments.map((row) => ({ ...row, ...under }))
				);
				assert.deepEqual((yield* t.run_due()).failed, []);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('with nothing outstanding, is the two stint writes alone', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const acts = yield* planned(t, quiet, { carry: true });
			assert.deepEqual(Object.keys(acts), ['employment.update', 'employment.create']);
			assert.equal((yield* send(t, acts, crypto.randomUUID())).kind, 'committed');
			const after = yield* stored(t);
			const made = nextOf(after);
			assert.equal(after.stints.find((row) => row.id === FIRST)?.to, LAST);
			assert.deepEqual([made.entity_id, made.from, made.to], [SISTER, NEXT, null]);
			assert.deepEqual(after.loans, []);
		}).pipe(Effect.provide(workspace({ seed: quiet, now: NOW })))
	);

	it.live(
		'sent again under its key, answers from its commit: one next stint, each loan moved once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const acts = yield* planned(t, seed, { carry: true });
				const key = crypto.randomUUID();
				assert.equal((yield* send(t, acts, key)).kind, 'committed');
				const first = yield* stored(t);
				// an unknown outcome is settled by sending the same write again, never by planning another
				assert.equal((yield* send(t, acts, key)).kind, 'committed');
				assert.deepEqual(yield* stored(t), first);
				assert.equal(first.stints.length, 2);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a transfer across jurisdictions', () => {
	const seed = across(lent(base, BOTH));

	it.live(
		'drops the open schedule, settles the loan the target law has no row for and opens the other again on the next stint',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const before = yield* stored(t);
				const acts = yield* planned(t, seed, { carry: false });
				assert.deepEqual(Object.keys(acts).slice(0, 3), [
					'employment.update',
					'employment.create',
					'loan_catalog_entry_repayment.delete'
				]);
				assert.deepEqual(Object.keys(acts).slice(3).toSorted(), [
					'loan_catalog_entry.create',
					'loan_catalog_entry_repayment.create'
				]);
				assert.equal((yield* send(t, acts, crypto.randomUUID())).kind, 'committed');
				const after = yield* stored(t);
				const made = nextOf(after);
				assert.deepEqual([made.entity_id, made.from], [SISTER, NEXT]);
				assert.equal(after.stints.find((row) => row.id === FIRST)?.to, LAST);
				// the old loans stay with the old employer, and of their instalments only the settlement is left
				assert.deepEqual(
					after.loans.filter((row) => row.employment_id === FIRST),
					before.loans
				);
				assert.deepEqual(
					after.instalments
						.filter((row) => row.employment_id === FIRST)
						.map((row) => [
							row.loan_id,
							row.amount,
							row.paid_on,
							row.payment_reference,
							row.entity_id
						]),
					[[LOCAL_LOAN, 600, LAST, 'Transfer settlement', ENTITY]]
				);
				// the advance is opened again under the target law, with its own schedule from the first day
				const [replacement, ...others] = after.loans.filter((row) => row.employment_id === made.id);
				assert.ok(replacement !== undefined);
				assert.deepEqual(others, []);
				assert.deepEqual(
					[replacement.entity_id, replacement.catalog_code, replacement.quantity, replacement.from],
					[SISTER, FESTIVE, 1200, NEXT]
				);
				const schedule = after.instalments.filter((row) => row.employment_id === made.id);
				assert.ok(schedule.length > 0);
				assert.ok(
					schedule.every(
						(row) => row.loan_id === replacement.id && row.entity_id === SISTER && !row.sealed
					)
				);
				assert.equal(cents(schedule), 1200 * 100);
				assert.deepEqual((yield* t.run_due()).failed, []);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('settles every loan from the old stint’s final pay when HR says so', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const before = yield* stored(t);
			const acts = yield* planned(t, seed, { carry: false, settle: true });
			assert.equal(acts['loan_catalog_entry.create'], undefined);
			assert.equal((yield* send(t, acts, crypto.randomUUID())).kind, 'committed');
			const after = yield* stored(t);
			assert.deepEqual(after.loans, before.loans);
			assert.deepEqual(
				after.instalments
					.map((row) => [row.loan_id, row.amount, row.paid_on, row.payment_reference])
					.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
				[
					[ADVANCE, 1200, LAST, 'Transfer settlement'],
					[LOCAL_LOAN, 600, LAST, 'Transfer settlement']
				]
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a transfer that cannot commit whole', () => {
	const seed = withSister(lent(base, ADVANCE_ONLY));
	const crossing = across(lent(base, BOTH));

	it.live(
		'on a stint another write moved since the sheet read it, conflicts and writes nothing',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const acts = yield* planned(t, seed, { carry: true });
				yield* (yield* t.as(t.admin)).act({
					'employment.update': [
						{ target: yield* current(t, 'employment', FIRST), set: { reason: 'Promoted' } }
					]
				});
				const before = yield* stored(t);
				const failed = yield* Effect.flip(send(t, acts, crypto.randomUUID()));
				assert.equal(failed._tag, 'ActConflict');
				yield* untouched(t, before);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'on an instalment another write changed, the dependent delete conflicts: neither stint nor loan moves',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const acts = yield* planned(t, crossing, { carry: false });
				const [instalment] = (yield* stored(t)).instalments;
				assert.ok(instalment !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'loan_catalog_entry_repayment.update': [
						{
							target: yield* current(t, 'loan_catalog_entry_repayment', instalment.id),
							set: { payment_reference: 'Agreed by phone' }
						}
					]
				});
				const before = yield* stored(t);
				const failed = yield* Effect.flip(send(t, acts, crypto.randomUUID()));
				assert.equal(failed._tag, 'ActConflict');
				// no instalment went and none came: no settlement, no replacement loan or schedule
				yield* untouched(t, before);
			}).pipe(Effect.provide(workspace({ seed: crossing, now: NOW })))
	);

	it.live('refused in one of its writes, writes none of them', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const before = yield* stored(t);
			// the next stint names the old company's payroll: its terms are refused, and with them the whole move
			const acts = yield* planned(t, seed, { carry: true, group: idOf('pay_group', PAY_GROUP) });
			const refused = yield* refusal(send(t, acts, crypto.randomUUID()));
			assert.equal(keyOf(refused), 'errors.contract_terms_pay_group_other_company');
			yield* untouched(t, before);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

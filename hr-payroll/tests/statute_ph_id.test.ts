// Philippine and Indonesian rows read what their statutes set, and a case row's form refuses an entry that leaves it
// unfilled. The figures here are synthetic: these prove the mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { objectValue, idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	read,
	sealEvents,
	wholeDays,
	workspace,
	leaveCreate
} from './kit.ts';

const ROOT = 'seed/public/jurisdiction';
const rowOf = (code: string, version: number, file: string, name: string) => {
	const row = read(join(ROOT, code, `version_${version}`, `${file}.json`)).find(
		(item) => item.code === name
	);
	assert.ok(row !== undefined, name);
	return row;
};

const LAW = {
	grant_days: 10,
	solo_parent_days: 13,
	termination_days: 6,
	allocation_days: 2,
	max_events: 2
};

const terms = {
	rate: { amount: 60_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_FIELD',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('PH', 'Asia/Manila', terms, {}, [], [], '2026-11-15');
const seed = {
	...base,
	leave_catalog: (base.leave_catalog ?? []).map((row) =>
		row.code === 'MATERNITY_LEAVE'
			? { ...row, lookup: { ...objectValue(row.lookup), ...LAW, grant_days: 3 } }
			: row
	),
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		payroll: { date_of_birth: '1990-01-01', gender: 'FEMALE', marital_status: 'MARRIED' }
	}))
};
const take = (t: Kit, employment: Id<'employee_contract'>, dates: readonly string[]) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: employment,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'MATERNITY_LEAVE')),
			days: wholeDays(...dates)
		})
	]);
const CASE = 'CROSS_BORDER_WORK_RECORD';
const EMPLOYMENT = idOf('employee_contract', String(base.employee_contract?.[0]?.id));
const file = (t: Kit, inputs: JsonObject) =>
	t.as(t.admin).act('workplace_case_catalog_entry.create', [
		{
			catalog_id: idOf('workplace_case_catalog', catalogRow(seed, 'workplace_case_catalog', CASE)),
			entity_id: ENTITY,
			employment_id: EMPLOYMENT,
			kind: CASE,
			opened_on: PlainDate('2026-11-03'),
			inputs
		}
	]);

describe('on a real workspace', () => {
	it.live('the leave holds at what the birth left her', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const version = yield* sealEvents(t, '2026-11-02', [
				{ kind: 'CHILD_BIRTH', on: '2026-11-02', allocated_days: 1 }
			]);
			yield* t.runDue();
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'entitled'), 2);
			assert.match(
				String(yield* Effect.flip(take(t, version, ['2026-11-03', '2026-11-04', '2026-11-05']))),
				/insufficient balance/
			);
			yield* take(t, version, ['2026-11-03', '2026-11-04']);
			yield* t.runDue();
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'used'), 2);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
	it.live('sealing a contract raises the employee registration duties once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-11-02', []);
			yield* t.runDue();
			const raised = t
				.storedQuery({ obligation: { limit: 200 } })
				.pipe(
					Effect.map(({ obligation }) =>
						obligation.rows.map((row) => String(row.occurrence_key)).toSorted()
					)
				);
			const first = yield* raised;
			assert.ok(first.some((key) => key.startsWith('SSS_EMPLOYEE_REPORT:')));
			const version = (yield* t.storedQuery({ employee_contract: { limit: 1 } })).employee_contract
				.rows[0]?.id;
			assert.ok(version !== undefined);
			yield* t
				.as(t.admin)
				.act('employee_contract.update', [
					{ target: version, set: { reason: 'Details confirmed' } }
				]);
			yield* t.runDue();
			// a second write of the same contract raises nothing more
			assert.deepEqual(yield* raised, first);
			assert.equal(new Set(first).size, first.length);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
	it.live('a payee-only run raises no remittance duty', () => {
		const payee = {
			...seed,
			employee_contract: (seed.employee_contract ?? []).map((row) => ({
				...row,
				engagement: 'PAYEE'
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-11', kind: 'ON_CYCLE' }]);
			yield* t.runDue();
			const { obligation } = yield* t.storedQuery({ obligation: { limit: 300 } });
			for (const code of [
				'SSS_CONTRIBUTION_REMITTANCE',
				'PHILHEALTH_PREMIUM_REMITTANCE',
				'HDMF_CONTRIBUTION_REMITTANCE',
				'BIR_1603Q_FRINGE_BENEFITS',
				'SSS_LOAN_REMITTANCE',
				'PAGIBIG_LOAN_REMITTANCE'
			])
				assert.equal(
					obligation.rows.filter((row) => String(row.occurrence_key).startsWith(`${code}:`)).length,
					0,
					code
				);
		}).pipe(Effect.provide(workspace({ seed: payee, now: '2026-11-20T02:00:00.000Z' })));
	});
	it.live('a pay-bump pair raises no predecessor exit and does not re-register', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-11-02', []);
			yield* t.runDue();
			const after = yield* t.storedQuery({ obligation: { limit: 200 } });
			// every exit duty names its fact: none was raised for the version the bump closed
			assert.deepEqual(
				after.obligation.rows
					.map((row) => String(row.occurrence_key))
					.filter((key) => /(^|:)exit:/.test(key)),
				[]
			);
			assert.equal(
				after.obligation.rows.filter((row) =>
					String(row.occurrence_key).startsWith('SSS_EMPLOYEE_REPORT:')
				).length,
				1,
				'one employee registration, not one per contract'
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
	it.live('a case filed without what its form requires is refused, naming it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = String(yield* Effect.flip(file(t, { country: 'SG' })));
			assert.match(refused, /This case needs period, work_days\./);
			yield* file(t, {
				country: 'SG',
				period: { from: '2026-11-03', to: '2026-11-03' },
				work_days: [{ date: '2026-11-03' }]
			});
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
});

describe('an Indonesian entity profile', () => {
	const rule = rowOf('ID', 3, 'registered_rule', 'SHARED_STRUCTURED_ENTITY_INPUTS');
	const lookup = {
		registration_number: { required: true, minLength: 1 },
		tax_registration_number: { required: true, minLength: 3, maxLength: 4 }
	};
	const valid = (tax?: string) =>
		evaluate(
			String(rule.validate),
			'CALCULATION',
			{
				lookup,
				entry: {
					entity_extension_data: {
						registration_number: '1',
						...(tax === undefined ? {} : { tax_registration_number: tax })
					}
				}
			},
			'validate'
		);
	it('holds the tax number to its bounds', () => {
		assert.equal(valid('123'), true);
		assert.equal(valid('1234'), true);
		assert.equal(valid('12'), false);
		assert.equal(valid('12345'), false);
		assert.equal(valid(), false);
	});
});

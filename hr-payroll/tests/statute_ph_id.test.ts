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
import type { LeavePerson } from '../src/lib/ledger/entitlement.ts';
import { entitlementPlans } from '../src/lib/ledger/service.ts';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { objectValue, idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, accountsIn, catalogRow, measureOf, pack, read, sealEvents, wholeDays, workspace, leaveCreate } from './kit.ts';

const ROOT = 'seed/public/jurisdiction';
const rowOf = (code: string, version: number, file: string, name: string) => {
	const row = read(join(ROOT, code, `version_${version}`, `${file}.json`)).find(
		(item) => item.code === name
	);
	assert.ok(row !== undefined, name);
	return row;
};
const number = (source: unknown, context: object) =>
	Number(evaluate(String(source), 'CALCULATION', context, 'expression'));

const LAW = {
	grant_days: 10,
	solo_parent_days: 13,
	termination_days: 6,
	allocation_days: 2,
	max_events: 2
};
const person = (
	events: readonly JsonObject[],
	gender: string,
	maritalStatus: string,
	extension: JsonObject
): LeavePerson => ({
	started: '2020-01-01',
	partTime: false,
	gender,
	maritalStatus,
	employment: {
		...(Array.isArray(extension.children) ? { children: extension.children } : {}),
		events,
		employee_extension_data: Object.fromEntries(
			Object.entries(extension).filter(([key]) => key !== 'children')
		)
	}
});
/** What the events on a contract open of a Philippine row, by event date. */
const opened = (
	code: string,
	events: readonly JsonObject[],
	gender = 'FEMALE',
	extension: JsonObject = {}
) =>
	entitlementPlans(
		[
			{
				account: 'leave',
				code,
				lookup: { ...objectValue(rowOf('PH', 2, 'leave_catalog', code).lookup), ...LAW }
			}
		],
		person(events, gender, 'MARRIED', extension),
		{
			scope: 'PH',
			started: '2020-01-01',
			events: events.map(({ kind, on }) => ({ kind: String(kind), on: String(on) }))
		},
		'balance',
		{},
		'2026-12-31'
	)
		.flatMap((plan) => plan.wanted)
		.reduce<Record<string, number>>(
			(days, row) => ({ ...days, [row.period.slice(-10)]: row.amount }),
			{}
		);

describe('Philippine maternity leave', () => {
	const on = '2026-03-02';
	const birth = { kind: 'CHILD_BIRTH', on };
	it('gives a birth the grant, and a solo parent the higher figure', () => {
		assert.deepEqual(opened('MATERNITY_LEAVE', [birth]), { [on]: 10 });
		assert.deepEqual(opened('MATERNITY_LEAVE', [birth], 'FEMALE', { solo_parent: true }), {
			[on]: 13
		});
	});
	it('gives a miscarriage or emergency termination its own figure, every time', () => {
		const lost = { kind: 'PREGNANCY_TERMINATION', on: '2025-03-02' };
		assert.deepEqual(opened('MATERNITY_LEAVE', [lost, birth]), { [lost.on]: 6, [on]: 10 });
		assert.deepEqual(opened('MATERNITY_LEAVE', [lost], 'FEMALE', { solo_parent: true }), {
			[lost.on]: 6
		});
	});
	it('keeps what she does not allocate, and she can allocate no more than the limit', () => {
		assert.deepEqual(opened('MATERNITY_LEAVE', [{ ...birth, allocated_days: 1 }]), { [on]: 9 });
		assert.deepEqual(opened('MATERNITY_LEAVE', [{ ...birth, allocated_days: 5 }]), { [on]: 8 });
		assert.deepEqual(
			opened('MATERNITY_LEAVE', [{ ...birth, allocated_days: 2 }], 'FEMALE', { solo_parent: true }),
			{ [on]: 11 }
		);
	});
});

describe('Philippine paternity leave', () => {
	it('stops after the limit of deliveries, a miscarriage among them, however the list is ordered', () => {
		const third = { kind: 'CHILD_BIRTH', on: '2026-03-02' };
		const first = { kind: 'CHILD_BIRTH', on: '2024-03-02' };
		const second = { kind: 'PREGNANCY_TERMINATION', on: '2025-03-02' };
		assert.deepEqual(opened('PATERNITY_LEAVE', [third, first, second], 'MALE'), {
			[first.on]: 10,
			[second.on]: 10
		});
	});
	it('gives solo parent leave to a solo parent, after six months', () => {
		const lookup = objectValue(rowOf('PH', 2, 'leave_catalog', 'SOLO_PARENT_LEAVE').lookup);
		const days = (solo_parent: boolean, as_of: string) =>
			number(lookup.entitlement, {
				lookup,
				as_of,
				subject: {
					employment: {
						service_started_on: '2026-01-05',
						employee_extension_data: { solo_parent }
					}
				}
			});
		assert.equal(days(false, '2026-11-01'), 0);
		assert.equal(days(true, '2026-03-01'), 0);
		assert.equal(days(true, '2026-11-01'), lookup.grant_days);
	});
	it('gives allocated days only through the allocation row', () => {
		const given = { kind: 'MATERNITY_ALLOCATION', on: '2026-03-02', allocated_days: 3 };
		assert.deepEqual(opened('PATERNITY_LEAVE', [given], 'MALE'), {});
		assert.deepEqual(opened('MATERNITY_ALLOCATION_LEAVE', [given], 'MALE'), { [given.on]: 3 });
	});
});

describe('Philippine allocated maternity leave', () => {
	it('holds the days allocated, up to its figure, and no birth opens it', () => {
		const on = '2026-03-02';
		assert.deepEqual(
			opened('MATERNITY_ALLOCATION_LEAVE', [
				{ kind: 'MATERNITY_ALLOCATION', on, allocated_days: 12 }
			]),
			{ [on]: 10 }
		);
		assert.deepEqual(opened('MATERNITY_ALLOCATION_LEAVE', [{ kind: 'CHILD_BIRTH', on }]), {});
	});
});

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
			const { obligation } = yield* t.storedQuery({ obligation: { limit: 200 } });
			for (const code of [
				'SSS_EMPLOYEE_REPORT',
				'PHILHEALTH_EMPLOYEE_REPORT',
				'HDMF_EMPLOYEE_REGISTRATION',
				'BIR_EMPLOYEE_TIN_REGISTRATION'
			])
				assert.equal(
					obligation.rows.filter((row) => String(row.occurrence_key).startsWith(`${code}:`))
						.length,
					1,
					code
				);
			const version = (yield* t.storedQuery({ employee_contract: { limit: 1 } })).employee_contract
				.rows[0]?.id;
			assert.ok(version !== undefined);
			yield* t.as(t.admin).act('employee_contract.update', [
				{ target: version, set: { employee_name: 'Renamed Worker' } }
			]);
			yield* t.runDue();
			const after = yield* t.storedQuery({ obligation: { limit: 200 } });
			assert.equal(
				after.obligation.rows.filter((row) =>
					String(row.occurrence_key).startsWith('SSS_EMPLOYEE_REPORT:')
				).length,
				1
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
	it.live('a true leaver raises each exit duty once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t.as(t.admin).act('employee_contract.update', [
				{
					target: EMPLOYMENT,
					set: {
						effective_range: { from: '2025-01-01', to: '2026-06-30' },
						final_pay_due_on: '2026-07-30',
						reason: 'Resignation'
					}
				}
			]);
			yield* t.runDue();
			const exit = [
				'encash-leave-on-exit',
				'raise-exit-pay',
				'FINAL_PAY_RELEASE',
				'HDMF_SEPARATION_REPORT',
				'PHILHEALTH_SEPARATION_REPORT',
				'PERSONAL_DATA_DISPOSAL'
			];
			const first = yield* t.storedQuery({ obligation: { limit: 200 } });
			for (const code of exit)
				assert.equal(
					first.obligation.rows.filter((row) => String(row.occurrence_key).startsWith(`${code}:`))
						.length,
					1,
					code
				);
			yield* t.as(t.admin).act('employee_contract.update', [
				{ target: EMPLOYMENT, set: { reason: 'Resignation confirmed' } }
			]);
			yield* t.runDue();
			const second = yield* t.storedQuery({ obligation: { limit: 200 } });
			for (const code of exit)
				assert.equal(
					second.obligation.rows.filter((row) =>
						String(row.occurrence_key).startsWith(`${code}:`)
					).length,
					1,
					code
				);
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
				.act('payroll_run.create', [
					{ entity_id: ENTITY, period: '2026-11', kind: 'ON_CYCLE' }
				]);
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
					obligation.rows.filter((row) =>
						String(row.occurrence_key).startsWith(`${code}:`)
					).length,
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
			const exits = yield* t.storedQuery({ contract_exit: { limit: 10 } });
			assert.equal(exits.contract_exit.rows.length, 0);
			const after = yield* t.storedQuery({ obligation: { limit: 200 } });
			for (const code of [
				'encash-leave-on-exit',
				'raise-exit-pay',
				'FINAL_PAY_RELEASE',
				'HDMF_SEPARATION_REPORT',
				'PHILHEALTH_SEPARATION_REPORT',
				'PERSONAL_DATA_DISPOSAL'
			])
				assert.equal(
					after.obligation.rows.filter((row) =>
						String(row.occurrence_key).startsWith(`${code}:`)
					).length,
					0,
					code
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

describe('a case row with a form', () => {
	it('has the rule that reads it, in every version that carries one', () => {
		for (const code of ['CN', 'TW', 'SG', 'PH', 'ID'])
			for (const version of readdirSync(join(ROOT, code))) {
				const path = (name: string) => join(ROOT, code, version, `${name}.json`);
				if (!existsSync(path('workplace_case_catalog'))) continue;
				const forms = read(path('workplace_case_catalog')).filter(
					(row) => objectValue(row.lookup).input_schema != null
				);
				const rules = read(path('registered_rule')).filter(
					(row) => row.code === 'CASE_INPUTS_REQUIRED'
				);
				assert.equal(rules.length, forms.length > 0 ? 1 : 0, `${code} ${version}`);
			}
	});
});

describe('Indonesian daily pay', () => {
	const month = (name: string, week: number) => {
		const row = rowOf('ID', 3, 'adhoc_catalog', name);
		return number(row.conversion, {
			subject: {
				employment: {
					effective_range: { from: '2025-01-01', to: null },
					terms: {
						rate: { amount: 100, unit: 'DAILY' },
						normal_days_per_week: week,
						allowances: {}
					}
				}
			},
			entry: { unit: 'DAY' },
			lookup: {
				...objectValue(row.lookup),
				six_day_week: 6,
				daily_paid_days_six_day: 10,
				daily_paid_days_five_day: 4
			},
			as_of: '2026-01-15',
			balances: {},
			calendar_days: 31,
			working_days: 22,
			month_wage: 2200,
			day_rate: 100,
			hour_rate: 12.5
		});
	};
	for (const name of ['THR', 'THR_HOLIDAY'])
		it(`${name}: before the first pay of the year, a month follows the working week`, () => {
			assert.equal(month(name, 6), 1000);
			assert.equal(month(name, 5), 400);
		});
});

describe('Indonesian TER', () => {
	const row = rowOf('ID', 3, 'statutory_contribution_catalog', 'PPH21');
	const [settings] = read(join(ROOT, 'ID/version_3/jurisdiction_settings.json'));
	const tax = (dependants: number) =>
		number(row.employee_amount, {
			subject: {
				employment: {
					payroll: { marital_status: 'MARRIED', gender: 'MALE' },
					dependents_count: dependants,
					effective_range: { from: '2025-01-01', to: null }
				}
			},
			lookup: {
				...objectValue(settings?.lookup),
				...objectValue(row.lookup),
				ptkp_ter_table: { 'K/0': '1', 'K/1': '2', 'K/3': '3' },
				ter_1: [{ up_to: null, rate: 0.01 }],
				ter_2: [{ up_to: null, rate: 0.02 }],
				ter_3: [{ up_to: null, rate: 0.03 }]
			},
			run: {
				pay_date: '2026-06-25',
				salary_coverage: { from: '2026-06-01', to: '2026-06-30' }
			},
			as_of: '2026-06-30',
			subtotals: { ADDITIONAL_WAGES: 100_000 },
			statutory: {},
			balances: { month: {} }
		});
	it('takes the table of the PTKP category', () => {
		assert.deepEqual([tax(0), tax(1), tax(3)], [1000, 2000, 3000]);
	});
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

import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { lineage, world, type Tables } from './jurisdiction_kit.js';
import { fixtureId } from './fixture_values.js';
import { evaluateStrict } from '../src/lib/payroll_engine/expressions.js';

const law = lineage('MY');
const present = <A>(value: A): NonNullable<A> => {
	assert.ok(value != null);
	return value;
};
const ObjectValue = Schema.Record(Schema.String, Schema.Json);
const objectValue = (value: unknown) => Schema.decodeUnknownSync(ObjectValue)(value);

it('MY correction keeps superseded law rows and selects the new chronological active chain', () => {
	assert.equal(law.versionOn('2026-09-30'), 'version_5');
	assert.equal(law.versionOn('2026-10-01'), 'version_9');
	assert.equal(law.versionOn('2026-12-01'), 'version_10');
	assert.equal(law.versionOn('2028-06-01'), 'version_11');
	assert.equal(law.versionOn('2031-06-01'), 'version_12');
	for (const version of ['version_6', 'version_7', 'version_8']) {
		assert.equal(law.settingsOf(version)['voided_at'], '2026-10-20T00:00:00.000Z');
		assert.ok(law.rows(version, 'work_catalog').length > 0);
	}
});

it('MY first-phase SKBBK uses the printed low-wage contributions without subtracting invalidity twice', () => {
	const catalogue = law.byCode('version_9', 'statutory_contribution_catalog', 'SKBBK');
	const configuration = objectValue(catalogue['configuration']);
	const rules = Schema.decodeUnknownSync(Schema.Array(ObjectValue))(configuration['rules']);
	const expression = Schema.decodeUnknownSync(Schema.String)(present(rules.at(-1))['employee']);
	for (const [wage, amount] of [
		[30, 0.2],
		[50, 0.3],
		[70, 0.5],
		[100, 0.65],
		[140, 0.9],
		[200, 1.25],
		[250, 1.85],
		[6000, 44.65]
	])
		assert.equal(
			Math.round(Number(evaluateStrict(expression, { base: { assessed: wage } })) * 100) / 100,
			amount
		);
});

for (const allowanceInput of ['code', 'prior-snapshot ID'] as const)
	it.effect(
		`MY payroll prices ordinary, rest and holiday bands with meal allowance by ${allowanceInput}`,
		Effect.fnUntraced(function* () {
			const tables: Tables = law.law();
			if (allowanceInput === 'prior-snapshot ID')
				assert.notEqual(
					law.byCode('version_5', 'allowance_catalog', 'MEAL_ALLOWANCE')['id'],
					law.byCode('version_9', 'allowance_catalog', 'MEAL_ALLOWANCE')['id']
				);
			const company = fixtureId('my-correction-company');
			const employee = fixtureId('my-correction-employee');
			const contract = fixtureId('my-correction-contract');
			const shift = fixtureId('my-correction-shift');
			const rest = fixtureId('my-correction-rest');
			tables.set('entity', [
				{
					id: company,
					name: 'Example Malaysia',
					settings_code: 'MY',
					pay_frequency: 'MONTHLY',
					pay_cutoff_day: 1,
					effective_range: { from: '2026-01-01', to: null },
					facts: {
						normal_daily_hours: 8,
						normal_days_per_week: 5,
						hrd_registration_class: 'NOT_REGISTERED'
					}
				}
			]);
			tables.set('employment_profile', [
				{
					id: employee,
					name: 'Example Employee',
					nationality: 'MY',
					date_of_birth: '1990-01-01',
					gender: 'FEMALE',
					marital_status: 'SINGLE',
					spouse_status: 'NONE',
					children: [],
					facts: {}
				}
			]);
			tables.set('employment_contract', [
				{
					id: contract,
					employee_id: employee,
					company_id: company,
					employee_number: 'EXAMPLE',
					contract_number: 1,
					effective_range: { from: '2026-01-01', to: null },
					facts: {
						contract_terms: [
							{
								effective_range: { from: '2026-01-01', to: null },
								base_salary: { value: 3000, currency: 'MYR' },
								residency_status: 'CITIZEN',
								work_classification: 'EA_COVERED',
								statutory_work_category: 'NON_MANUAL',
								employment_type: 'PERMANENT',
								facts: { normal_hours_per_day: 8, normal_days_per_week: 5 },
								allowances: [
									['SUA', 260],
									['MEAL_ALLOWANCE', 104]
								].map(([code, amount]) => ({
									...(code !== 'MEAL_ALLOWANCE' || allowanceInput === 'code' ? { code } : {}),
									catalogue_id: law.byCode(
										code === 'MEAL_ALLOWANCE' && allowanceInput === 'prior-snapshot ID'
											? 'version_5'
											: 'version_9',
										'allowance_catalog',
										String(code)
									)['id'],
									amount: { value: amount, currency: 'MYR' }
								}))
							}
						]
					}
				}
			]);
			tables.set('shift_definition', [
				{
					id: shift,
					company_id: company,
					code: 'D',
					variant: { day_type: 'WORK', start_time: '08:00', end_time: '16:00' }
				},
				{ id: rest, company_id: company, code: 'R', variant: { day_type: 'REST' } }
			]);
			tables.set('holiday', [
				{
					id: fixtureId('my-correction-holiday'),
					company_id: company,
					date: '2026-10-10',
					name: 'Example paid holiday',
					kind: 'PUBLIC_HOLIDAY',
					published_at: '2026-01-01T00:00:00.000Z',
					given_to: 'EVERYONE'
				}
			]);
			tables.set(
				'roster_entry',
				[
					['2026-10-03', shift, 10],
					['2026-10-07', rest, 4],
					['2026-10-08', rest, 11],
					['2026-10-10', shift, 10]
				].map(([date, planned, hours]) => ({
					id: fixtureId(`my-correction-${date}`),
					employment_id: contract,
					work_date: date,
					shift_definition_id: planned,
					// the shift days' two hours past 16:00 are approved overtime; the untimed rest days need none
					...(planned === shift ? { planned_overtime_hours: Number(hours) - 8 } : {}),
					payslip_id: null,
					worked_intervals: [
						{
							start: `${date}T00:00:00.000Z`,
							end: `${date}T${String(hours).padStart(2, '0')}:00:00.000Z`
						}
					]
				}))
			);
			for (const table of [
				'shift_pattern',
				'adhoc_catalog_entry',
				'claim_catalog_entry',
				'leave_catalog_entry',
				'loan_catalog_entry',
				'loan_repayment_entry',
				'payslip',
				'payroll_run'
			])
				tables.set(table, []);
			const plan = yield* world(tables).run(company, '2026-10', 'REGULAR');
			const slip = present(plan.payslips.find((row) => row.employment_id === contract));
			const amount = (code: string) =>
				Math.round(
					slip.base
						.filter((line) => line.component_code === code)
						.reduce((sum, line) => sum + Number(line.amount), 0) * 100
				) / 100;
			assert.equal(amount('BASIC'), 3000);
			assert.equal(amount('SUA'), 260);
			assert.equal(amount('MEAL_ALLOWANCE'), 104);
			assert.equal(amount('OVERTIME'), 48.52);
			assert.equal(amount('REST_DAY_WORK'), 194.08);
			assert.equal(amount('REST_DAY_OVERTIME'), 97.04);
			assert.equal(amount('HOLIDAY_WORK'), 250.77);
			assert.equal(amount('HOLIDAY_OVERTIME'), 94.04);
			assert.equal(slip.gross, 4048.45);
			assert.equal(slip.pins.filter((pin) => pin.collection === 'roster_entry').length, 4);
		}),
		15_000
	);

it.effect(
	'MY leave under a 21st cutoff charges the attendance window, not the salary month',
	Effect.fnUntraced(function* () {
		const tables: Tables = law.law();
		const company = fixtureId('my-cutoff-company');
		const employee = fixtureId('my-cutoff-employee');
		const contract = fixtureId('my-cutoff-contract');
		const unpaid = law.byCode('version_2', 'leave_catalog', 'UNPAID_LEAVE')['id'];
		tables.set('entity', [
			{
				id: company,
				name: 'Example Malaysia',
				settings_code: 'MY',
				pay_frequency: 'MONTHLY',
				pay_cutoff_day: 21,
				effective_range: { from: '2025-01-01', to: null },
				facts: {
					normal_daily_hours: 8,
					normal_days_per_week: 5,
					hrd_registration_class: 'NOT_REGISTERED'
				}
			}
		]);
		tables.set('employment_profile', [
			{
				id: employee,
				name: 'Example Employee',
				nationality: 'MY',
				date_of_birth: '1990-01-01',
				gender: 'FEMALE',
				marital_status: 'SINGLE',
				spouse_status: 'NONE',
				children: [],
				facts: {}
			}
		]);
		tables.set('employment_contract', [
			{
				id: contract,
				employee_id: employee,
				company_id: company,
				employee_number: 'EXAMPLE',
				contract_number: 1,
				effective_range: { from: '2025-01-01', to: null },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2025-01-01', to: null },
							base_salary: { value: 3100, currency: 'MYR' },
							residency_status: 'CITIZEN',
							work_classification: 'EA_COVERED',
							statutory_work_category: 'NON_MANUAL',
							employment_type: 'PERMANENT',
							facts: { normal_hours_per_day: 8, normal_days_per_week: 5 },
							allowances: []
						}
					]
				}
			}
		]);
		// January attends 21 Dec – 20 Jan: the December days are this run's, 26 January is February's, and a row
		// across the cutoff charges only its days up to 20 January (2 of 4).
		const leave = [
			['dec', '2025-12-22', '2025-12-23', 2],
			['late', '2026-01-26', '2026-01-26', 1],
			['across', '2026-01-19', '2026-01-22', 4]
		] as const;
		tables.set(
			'leave_catalog_entry',
			leave.map(([key, from, to, days]) => ({
				id: fixtureId(`my-cutoff-${key}`),
				catalog_id: unpaid,
				employment_id: contract,
				company_id: company,
				payslip_id: null,
				activity: 'TIME_OFF',
				occurred_on: from,
				from,
				to,
				days,
				facts: {}
			}))
		);
		for (const table of [
			'shift_definition',
			'holiday',
			'roster_entry',
			'shift_pattern',
			'adhoc_catalog_entry',
			'claim_catalog_entry',
			'loan_catalog_entry',
			'loan_repayment_entry',
			'payslip',
			'payroll_run'
		])
			tables.set(table, []);
		const plan = yield* world(tables).run(company, '2026-01', 'REGULAR');
		const slip = present(plan.payslips.find((row) => row.employment_id === contract));
		const amount = (code: string) =>
			Math.round(
				slip.base
					.filter((line) => line.component_code === code)
					.reduce((sum, line) => sum + Number(line.amount), 0) * 100
			) / 100;
		assert.equal(amount('BASIC'), 3100);
		// 2 + 2 days × 3,100 ÷ 31
		assert.equal(amount('NO_PAY_LEAVE'), -400);
		assert.deepEqual(
			slip.pins
				.filter((pin) => pin.collection === 'leave_catalog_entry')
				.map((pin) => pin.id)
				.toSorted(),
			[fixtureId('my-cutoff-dec'), fixtureId('my-cutoff-across')].toSorted()
		);
	}),
	15_000
);

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { currency } from '@norbital-ai/std/decimal';
import { admitContractTerms, rosterFindings } from '../src/lib/payroll_engine/admit.js';
import { Reads, readsFrom } from '../src/lib/payroll_engine/foundation.js';
import { buildPayrollRun } from '../src/lib/payroll_engine/run.js';
import { CONTRACT } from '../src/lib/payroll_engine/rows.js';
import { world, type Tables } from './jurisdiction_kit.js';
import { fixtureId, nativeId } from './fixture_values.js';
import { readSeedRows } from './seed_values.js';

/**
 * An entity's `validation_severity` over the public SG seed: absent keeps each rule's own kind; a default of `warn`
 * turns a refusal into a warning at every site; a rule's own choice wins over the default.
 */
type Row = Record<string, unknown>;
const SG = resolve(process.cwd(), 'seed/jurisdiction/SG');
const law = (name: string): Row[] =>
	readdirSync(SG)
		.filter((entry) => entry.startsWith('version_'))
		.flatMap((dir) =>
			existsSync(resolve(SG, dir, `${name}.json`)) ? readSeedRows(resolve(SG, dir), name) : []
		);
const COMPANY = nativeId('entity', fixtureId('severity-company'));
const PERSON = nativeId('employment_profile', fixtureId('severity-person'));
const CONTRACT_ID = nativeId('employment_contract', fixtureId('severity-contract'));
const term = (salary: number) => ({
	base_salary: { value: salary, currency: currency('SGD') },
	effective_range: { from: PlainDate('2019-01-01'), to: null },
	residency_status: 'CITIZEN',
	work_classification: 'EA_COVERED',
	statutory_work_category: 'NON_MANUAL',
	employment_type: 'PERMANENT',
	facts: { race: 'CHINESE', religion: 'OTHER' },
	shift_pattern_id: fixtureId('severity-week'),
	allowances: []
});
const tablesWith = (severity: unknown, rules: readonly Row[]): Tables => {
	const settings = law('jurisdiction_settings');
	const march = settings.find((row) => {
		const range = Schema.decodeUnknownSync(
			Schema.Struct({ from: Schema.String, to: Schema.NullOr(Schema.String) })
		)(row['effective_range']);
		return range.from <= '2026-03-01' && (range.to == null || range.to >= '2026-03-01');
	});
	assert.ok(march);
	return new Map<string, Row[]>([
		...[
			'jurisdiction_settings',
			'statutory_contribution_catalog',
			'work_catalog',
			'allowance_catalog',
			'adhoc_catalog',
			'claim_catalog',
			'leave_catalog',
			'loan_catalog'
		].map((name): [string, Row[]] => [name, law(name)]),
		[
			'rule_set',
			rules.map(({ code, ...rules }) => ({
				id: fixtureId(`severity-${String(code)}`),
				settings_id: march['id'],
				family: 'VALIDATIONS',
				code,
				name: code,
				rules
			}))
		],
		[
			'entity',
			[
				{
					id: COMPANY,
					name: 'Omni',
					settings_code: 'SG',
					pay_frequency: 'MONTHLY',
					pay_cutoff_day: 1,
					effective_range: { from: PlainDate('2019-01-01'), to: null },
					facts: {},
					...(severity === undefined ? {} : { validation_severity: severity })
				}
			]
		],
		[
			'employment_profile',
			[
				{
					id: PERSON,
					name: 'Dernese',
					date_of_birth: PlainDate('1997-06-30'),
					nationality: 'SG',
					facts: {}
				}
			]
		],
		[
			'employment_contract',
			[
				{
					id: CONTRACT_ID,
					employee_id: PERSON,
					company_id: COMPANY,
					employee_number: 'e1',
					contract_number: 1,
					effective_range: { from: PlainDate('2019-01-01'), to: null },
					facts: { contract_terms: [term(4800)] }
				}
			]
		],
		[
			'shift_definition',
			[
				{
					id: fixtureId('severity-work'),
					company_id: COMPANY,
					code: 'DAY',
					variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
				},
				{
					id: fixtureId('severity-rest'),
					company_id: COMPANY,
					code: 'REST',
					variant: { day_type: 'REST' }
				}
			]
		],
		[
			'shift_pattern',
			[
				{
					id: fixtureId('severity-week'),
					code: 'WEEK',
					company_id: COMPANY,
					effective_range: { from: PlainDate('2018-12-31'), to: null },
					pattern: {
						days: [
							...Array.from({ length: 5 }, () => ({
								roster_code_id: nativeId('shift_definition', fixtureId('severity-work'))
							})),
							{ roster_code_id: nativeId('shift_definition', fixtureId('severity-rest')) },
							{ roster_code_id: nativeId('shift_definition', fixtureId('severity-rest')) }
						]
					}
				}
			]
		],
		...[
			'adhoc_catalog_entry',
			'claim_catalog_entry',
			'leave_catalog_entry',
			'loan_catalog_entry',
			'loan_repayment_entry',
			'roster_entry',
			'holiday',
			'payslip',
			'payroll_run'
		].map((name): [string, Row[]] => [name, []])
	]);
};
const FLOOR = {
	code: 'FLOOR',
	site: 'payslip',
	kind: 'refuse',
	when: 'terms.base_salary < 5000.0',
	message: 'basic below the floor'
};
const CLEARANCE = {
	code: 'CLEARANCE',
	site: 'payslip',
	kind: 'hold',
	when: 'true',
	message: 'awaiting tax clearance'
};
const MINIMUM = {
	code: 'MINIMUM_BASE',
	site: 'contract',
	kind: 'refuse',
	when: 'term.base_salary < 1500.0',
	message: 'The base salary is below the minimum.'
};
const REST = {
	code: 'OVERTIME',
	site: 'roster',
	kind: 'refuse',
	when: 'day.overtime_hours > 0.0',
	message: 'overtime worked'
};
const payroll = (tables: Tables) =>
	Effect.result(
		world(tables).provide(
			buildPayrollRun({ company_id: COMPANY, period: '2026-03', kind: 'REGULAR' })
		)
	);
/** A changed term starting 1 March 2026 at 1,000: the contract site judges it. */
const admit = (tables: Tables) =>
	world(tables).withRead((read) =>
		Effect.gen(function* () {
			const [held] = (yield* read('employment_contract', { select: CONTRACT, all: true })).rows;
			assert.ok(held);
			const facts = {
				contract_terms: [
					{ ...term(1000), effective_range: { from: PlainDate('2026-03-01'), to: null } }
				]
			};
			return yield* Effect.result(
				admitContractTerms({ contract: { ...held, facts }, before: held.facts }).pipe(
					Effect.provideService(Reads, readsFrom(read))
				)
			);
		})
	);
const roster = (tables: Tables) =>
	world(tables).provide(
		rosterFindings(COMPANY, [
			{
				ref: 1,
				employment_id: CONTRACT_ID,
				work_date: '2026-03-02',
				worked_intervals: [
					{
						start: Instant('2026-03-02T01:00:00.000Z'),
						end: Instant('2026-03-02T12:00:00.000Z')
					}
				],
				leave_code: ''
			}
		])
	);

it.effect(
	'absent: each rule keeps its own kind, so a refusal still refuses at every site',
	Effect.fnUntraced(function* () {
		const tables = tablesWith(undefined, [FLOOR, MINIMUM, REST]);
		const run = yield* payroll(tables);
		assert.ok(run._tag === 'Failure');
		assert.match(run.failure.message, /basic below the floor/);
		const contract = yield* admit(tables);
		assert.ok(contract._tag === 'Failure');
		assert.equal(contract.failure.message, 'The base salary is below the minimum.');
		assert.deepEqual(
			(yield* roster(tables)).map((row) => [row.code, row.kind]),
			[['OVERTIME', 'refuse']]
		);
	})
);

it.effect(
	'default warn: the same rules only warn — the run pays, the contract commits, the roster day warns',
	Effect.fnUntraced(function* () {
		const tables = tablesWith({ default: 'warn', rules: {} }, [FLOOR, MINIMUM, REST]);
		const run = yield* payroll(tables);
		assert.ok(run._tag === 'Success');
		assert.deepEqual(run.success.warnings, ['Dernese: basic below the floor']);
		assert.equal(run.success.payslips[0]?.hold, null);
		assert.equal((yield* admit(tables))._tag, 'Success');
		assert.deepEqual(
			(yield* roster(tables)).map((row) => [row.code, row.kind]),
			[['OVERTIME', 'warn']]
		);
	})
);

it.effect(
	'a rule’s own refuse wins over the default warn',
	Effect.fnUntraced(function* () {
		const tables = tablesWith({ default: 'warn', rules: { FLOOR: 'refuse' } }, [FLOOR]);
		const run = yield* payroll(tables);
		assert.ok(run._tag === 'Failure');
		assert.match(run.failure.message, /basic below the floor/);
	})
);

it.effect(
	'a hold rule set to warn warns without holding the slip; record keeps the hold',
	Effect.fnUntraced(function* () {
		const warned = yield* payroll(
			tablesWith({ default: 'record', rules: { CLEARANCE: 'warn' } }, [CLEARANCE])
		);
		assert.ok(warned._tag === 'Success');
		assert.deepEqual(warned.success.warnings, ['Dernese: awaiting tax clearance']);
		assert.equal(warned.success.payslips[0]?.hold, null);
		const held = yield* payroll(tablesWith({ default: 'record', rules: {} }, [CLEARANCE]));
		assert.ok(held._tag === 'Success');
		assert.equal(held.success.payslips[0]?.hold, 'awaiting tax clearance');
	})
);

it.effect(
	'a statutory refuse_when binds by its scheme code: warned by default, refused by its own choice',
	Effect.fnUntraced(function* () {
		const guarded = (severity: unknown) => {
			const tables = tablesWith(severity, []);
			for (const row of tables.get('statutory_contribution_catalog') ?? [])
				if (row['code'] === 'CPF')
					row['configuration'] = {
						...Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
							row['configuration']
						),
						refuse_when: [{ when: 'true', message: 'CPF refused' }]
					};
			return payroll(tables);
		};
		const refused = yield* guarded(undefined);
		assert.ok(refused._tag === 'Failure');
		assert.match(refused.failure.message, /CPF refused/);
		const warned = yield* guarded({ default: 'warn', rules: {} });
		assert.ok(warned._tag === 'Success');
		assert.ok(warned.success.warnings.includes('Dernese: CPF refused'));
		const own = yield* guarded({ default: 'warn', rules: { CPF: 'refuse' } });
		assert.ok(own._tag === 'Failure');
	})
);

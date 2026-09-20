/**
 * Elections are declared on the scheme row and read as `scheme.elections.<key>`: the scheme write
 * refuses a formula or rule naming a key the row does not declare, and the fact write refuses a
 * value under an undeclared key or of another type than declared.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { Schema } from 'effect';
import { statutoryFactStatusSchema } from '../src/datatypes/statutory_fact_status/+definition.ts';
import schemes from '../src/collections/statutory_contributions/+collection.ts';
import facts from '../src/collections/employment_statutory_facts/+collection.ts';
import { transformOne } from './helpers/transform.ts';
import { buildStatutory, settingsVersions } from './fixtures/statutory-world.ts';

test('Taiwan declaration values survive the statutory fact write and reach payroll', () => {
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [{ key: 'DECLARED', wage: 300250, citizenship: 'CITIZEN', children: 0 }]
		},
		(world) => {
			for (const [code, elections] of [
				['INCOME_TAX', { table_declaration_reference: 'DECL-12', table_dependants: 12 }],
				['NHI', { enrolled_dependants: 2 }]
			] as const) {
				const contribution = world.statutory_contributions.find(
					(row) => row.code === code && row.settings_id === settingsVersions('TW')[1]!.id
				)!;
				const otherVersions = new Set(
					world.statutory_contributions
						.filter((row) => row.code === code && row.id !== contribution.id)
						.map((row) => row.id)
				);
				world.employment_statutory_facts.splice(
					0,
					world.employment_statutory_facts.length,
					...world.employment_statutory_facts.filter(
						(row) => !otherVersions.has(row.statutory_contribution_id)
					)
				);
				const fact = world.employment_statutory_facts.find(
					(row) => row.statutory_contribution_id === contribution.id
				)!;
				const saved = transformOne(
					facts,
					{
						status: {
							kind: 'REGISTERED',
							reference_number: 'TAX-01',
							rate_override: null,
							// The declared grade the fixture supplied stays: the write adds the
							// declaration under test without erasing the required elections.
							elections: {
								...((fact.status as { elections?: Record<string, unknown> } | null)?.elections ??
									{}),
								...elections
							}
						}
					},
					fact,
					{ statutory_contributions: { findMany: () => Effect.succeed([contribution]) } }
				);
				Object.assign(fact, saved);
			}
		}
	);
	assert.equal(
		slips.get('DECLARED')!.statutory.find((row) => row.scheme_code === 'INCOME_TAX')
			?.employee_amount,
		17091
	);
	assert.equal(
		slips.get('DECLARED')!.statutory.find((row) => row.scheme_code === 'NHI')?.employee_amount,
		14100
	);
});

test('conflicting active declarations across statutory versions stop payroll', () => {
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'TW',
					period: '2026-01',
					riskClass: '1',
					people: [{ key: 'CONFLICT', wage: 300250, citizenship: 'CITIZEN' }]
				},
				(world) => {
					const contribution = world.statutory_contributions.find(
						(row) => row.code === 'INCOME_TAX' && row.settings_id === settingsVersions('TW')[1]!.id
					)!;
					const fact = world.employment_statutory_facts.find(
						(row) => row.statutory_contribution_id === contribution.id
					)!;
					fact.status = {
						kind: 'REGISTERED',
						reference_number: 'TAX-02',
						rate_override: null,
						elections: { table_declaration_reference: 'DECL-12', table_dependants: 12 }
					};
				}
			),
		/Conflicting statutory declarations/
	);
});

for (const [jurisdiction, expected] of [
	['PH', 3000],
	['TW', 0]
] as const)
	test(`statutory declarations from a ${jurisdiction} catalogue remain within their jurisdiction`, () => {
		const { slips } = buildStatutory(
			{
				code: 'TW',
				period: '2026-01',
				riskClass: '1',
				people: [{ key: 'MOBILE', wage: 60000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				const scheme = world.statutory_contributions.find((row) => row.code === 'INCOME_TAX')!;
				const settings = world.jurisdiction_settings.find((row) => row.id === scheme.settings_id)!;
				const schemeIds = new Set(
					world.statutory_contributions
						.filter((row) => row.code === 'INCOME_TAX')
						.map((row) => row.id)
				);
				const declaration = world.employment_statutory_facts.find((row) =>
					schemeIds.has(row.statutory_contribution_id)
				)!;
				world.employment_statutory_facts.splice(
					0,
					world.employment_statutory_facts.length,
					...world.employment_statutory_facts.filter(
						(row) => !schemeIds.has(row.statutory_contribution_id)
					),
					{
						...declaration,
						statutory_contribution_id: 'other-scheme',
						status: { kind: 'NOT_REGISTERED', reason: 'Declared exemption in source jurisdiction' }
					}
				);
				world.jurisdiction_settings.push({
					...settings,
					id: 'other-settings',
					code: `${jurisdiction}-other`,
					jurisdiction_code: jurisdiction
				});
				world.statutory_contributions.push({
					...scheme,
					id: 'other-scheme',
					settings_id: 'other-settings'
				});
			}
		);
		assert.equal(
			slips.get('MOBILE')!.statutory.find((row) => row.scheme_code === 'INCOME_TAX')
				?.employee_amount ?? 0,
			expected
		);
	});

const scheme = {
	id: 'pcb',
	settings_id: 'draft',
	code: 'PCB',
	elections: [{ key: 'disabled', type: 'boolean' }],
	assessed_on: 'BASE',
	rules: [{ when: 'scheme.elections.disabled', employee: '0.0', employer: '0.0' }]
};

const db = {
	jurisdiction_settings: {
		findMany: ({ where }: { where: { id: { in: readonly string[] } } }) =>
			Effect.succeed(
				where.id.in.map((id) => ({ id, code: 'PUB', name: 'Public fixture', sealed_at: null }))
			)
	},
	statutory_contributions: {
		findMany: ({ where }: { where: Record<string, unknown> }) =>
			Effect.succeed('id' in where ? [scheme] : [])
	},
	allowance_catalogue: { findMany: () => Effect.succeed([]) },
	adhoc_catalogue: { findMany: () => Effect.succeed([]) },
	claim_catalogue: { findMany: () => Effect.succeed([]) },
	loan_catalogue: { findMany: () => Effect.succeed([]) },
	leave_catalogue: { findMany: () => Effect.succeed([]) }
};

const writeScheme = (input: Record<string, unknown>) => transformOne(schemes, input, undefined, db);
const writeFact = (status: Record<string, unknown>) =>
	transformOne(
		facts,
		{ employee_id: 'e', statutory_contribution_id: 'pcb', status },
		undefined,
		db
	);

test('first contribution liability accepts calendar dates and refuses impossible dates', async () => {
	const status = { kind: 'REGISTERED', reference_number: 'R', rate_override: null };
	for (const first of [null, '2000-02-29']) {
		const result = await statutoryFactStatusSchema['~standard'].validate({
			...status,
			first_contribution_due_on: first
		});
		assert.equal(result.issues, undefined);
	}
	for (const first of ['2000-02-30', '2026-2-1', 'not-a-date']) {
		const result = await statutoryFactStatusSchema['~standard'].validate({
			...status,
			first_contribution_due_on: first
		});
		assert.ok(result.issues?.length);
	}
});

test('deduction declarations reject unknown categories, invalid months and duplicate references', () => {
	const deductionScheme = {
		...scheme,
		rules: [
			{
				when: 'true',
				deduction: 'scheme.deductions.EDUCATION',
				employee: 'base - scheme.deduction',
				employer: '0.0'
			}
		]
	};
	const claim = {
		period: '2026-03',
		category: 'EDUCATION',
		amount: 100,
		source: 'EMPLOYEE',
		reference: 'TP1 March'
	};
	const write = (claims: readonly Record<string, unknown>[]) =>
		transformOne(
			facts,
			{
				employee_id: 'e',
				statutory_contribution_id: 'pcb',
				status: {
					kind: 'REGISTERED',
					reference_number: 'R',
					rate_override: null,
					deduction_claims: claims
				}
			},
			undefined,
			{ ...db, statutory_contributions: { findMany: () => Effect.succeed([deductionScheme]) } }
		);
	assert.doesNotThrow(() => writeScheme(deductionScheme));
	assert.doesNotThrow(() => write([claim, { ...claim, reference: 'Correction', amount: -20 }]));
	assert.throws(() => write([claim, claim]), /Duplicate deduction claim/);
	assert.throws(() => write([{ ...claim, period: '2026-13' }]), /YYYY-MM/);
	assert.throws(
		() => write([{ ...claim, category: 'UNKNOWN' }]),
		/does not use deduction category/
	);
	assert.throws(() => write([{ ...claim, reference: ' ' }]), /declaration reference/);
});

test('computed deductions cannot select their own rule or depend on themselves', () => {
	for (const field of ['when', 'deduction']) {
		assert.throws(
			() =>
				writeScheme({
					...scheme,
					rules: [
						{
							when: 'true',
							employee: '0.0',
							employer: '0.0',
							[field]: field === 'when' ? 'scheme.deduction > 0.0' : 'scheme.deduction + 1.0'
						}
					]
				}),
			/deduction.*evaluated after/
		);
	}
	assert.throws(
		() =>
			writeScheme({
				...scheme,
				rules: [
					{ when: 'true', deduction: 'scheme.elections.disabled', employee: '0.0', employer: '0.0' }
				]
			}),
		/deduction: .*money amount/
	);
});

test('child declarations reject invalid counts, unknown categories and duplicate tax-year rows', () => {
	const childScheme = {
		...scheme,
		rules: [{ when: 'true', employee: 'scheme.child_claims.UNDER_18 * 2000.0', employer: '0.0' }]
	};
	const claim = {
		year: '2026',
		relief_class: 'UNDER_18',
		full_count: 1,
		half_count: 1,
		reference: 'Declaration 2026'
	};
	const registered = { kind: 'REGISTERED', reference_number: 'R', rate_override: null };
	const write = (claims: readonly Record<string, unknown>[]) =>
		transformOne(
			facts,
			{
				employee_id: 'e',
				statutory_contribution_id: 'pcb',
				status: { ...registered, child_claims: claims }
			},
			undefined,
			{ ...db, statutory_contributions: { findMany: () => Effect.succeed([childScheme]) } }
		);
	assert.doesNotThrow(() => writeScheme(childScheme));
	assert.doesNotThrow(() => write([claim, { ...claim, year: '2027' }]));
	assert.throws(() => write([claim, claim]), /one child-claim row per tax year/);
	assert.throws(
		() => write([{ ...claim, relief_class: 'UNUSED' }]),
		/does not use child relief class/
	);
	assert.throws(() => write([{ ...claim, year: '26' }]), /four-digit tax year/);
	assert.throws(() => write([{ ...claim, reference: ' ' }]), /declaration reference/);
	for (const amount of [-1, 0.5]) {
		assert.throws(() =>
			Schema.decodeUnknownSync(statutoryFactStatusSchema)({
				...registered,
				child_claims: [{ ...claim, full_count: amount }]
			})
		);
		assert.throws(() =>
			Schema.decodeUnknownSync(statutoryFactStatusSchema)({
				...registered,
				child_claims: [{ ...claim, half_count: amount }]
			})
		);
	}
});

test('a scheme write refuses a rule or formula reading an election the row does not declare', () => {
	// A declared boolean is typed as one at compile, so a bare `scheme.elections.disabled` is a
	// boolean `when` — and `&& scheme.elections.x`, as the SG ladders read an opt-in, compiles.
	assert.doesNotThrow(() => writeScheme(scheme));
	assert.doesNotThrow(() =>
		writeScheme({
			...scheme,
			rules: [{ when: 'base > 0.0 && scheme.elections.disabled', employee: '0.0', employer: '0.0' }]
		})
	);
	assert.throws(
		() =>
			writeScheme({
				...scheme,
				rules: [{ when: 'scheme.elections.zakat > 0.0', employee: '0.0', employer: '0.0' }]
			}),
		/Rule 1: .*reads scheme.elections.zakat, which the scheme does not declare/
	);
	assert.throws(
		() => writeScheme({ ...scheme, assessed_on: 'BASE + scheme.elections.extra' }),
		/Assessed-on: .*reads scheme.elections.extra/
	);
	// A declared type is the type the value is checked as: a boolean used as money is refused.
	assert.throws(
		() =>
			writeScheme({
				...scheme,
				rules: [{ when: 'true', employee: 'scheme.elections.disabled', employer: '0.0' }]
			}),
		/Rule 1 employee: .*must produce a money amount/
	);
});

test('a fact write refuses an election the scheme does not declare, or of another type', () => {
	const registered = { kind: 'REGISTERED', reference_number: 'R', rate_override: null };
	assert.doesNotThrow(() => writeFact(registered));
	assert.doesNotThrow(() => writeFact({ ...registered, elections: { disabled: true } }));
	assert.throws(
		() => writeFact({ ...registered, elections: { zakat: 100 } }),
		/PCB does not declare the election zakat/
	);
	assert.throws(
		() => writeFact({ ...registered, elections: { disabled: 'yes' } }),
		/declares the election disabled as a boolean; this value is a string/
	);
});

test('rebate formulas are checked against declared elections and money types', () => {
	assert.doesNotThrow(() =>
		writeScheme({
			...scheme,
			rules: [
				{
					when: 'true',
					employee: '0.0',
					employer: '0.0',
					rebate: 'scheme.elections.disabled ? 100.0 : 0.0'
				}
			]
		})
	);
	assert.throws(
		() =>
			writeScheme({
				...scheme,
				rules: [
					{ when: 'true', employee: '0.0', employer: '0.0', rebate: 'scheme.elections.zakat' }
				]
			}),
		/Rule 1 rebate: .*reads scheme.elections.zakat/
	);
	assert.throws(
		() =>
			writeScheme({
				...scheme,
				rules: [
					{ when: 'true', employee: '0.0', employer: '0.0', rebate: 'scheme.elections.disabled' }
				]
			}),
		/Rule 1 rebate: .*must produce a money amount/
	);
});

/**
 * Elections are declared on the scheme row and read as `scheme.elections.<key>`: the scheme write
 * refuses a formula or rule naming a key the row does not declare, and the fact write refuses a
 * value under an undeclared key or of another type than declared.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { statutoryFactStatusFault } from '../src/lib/datatypes/statutory_fact_status.ts';
import facts from '../src/data/collection/employment_statutory_facts/+collection.ts';
import { transform } from './helpers/bodies.ts';

/** One input through the 0.0.1 transform over in-memory tables; its payload back. */
const transformOne = async (collection, input, existing, tables) =>
	(await transform(collection, [input], { existing: [existing], tables }))[0];
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
				// The write's refusals are `employment-statutory-facts.test.ts`'s; here the declared values reach payroll.
				const saved = {
					status: {
						kind: 'REGISTERED',
						reference_number: 'TAX-01',
						rate_override: null,
						// The declared grade the fixture supplied stays: the write adds the declaration under test
						// without erasing the required elections.
						elections: {
							...((fact.status as { elections?: Record<string, unknown> } | null)?.elections ?? {}),
							...elections
						}
					}
				};
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
	['TW', 3000]
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

const db = { statutory_contributions: [scheme] };

const writeFact = (status: Record<string, unknown>) =>
	transformOne(
		facts,
		{ employee_id: 'e', statutory_contribution_id: 'pcb', status },
		undefined,
		db
	);

test('first contribution liability accepts calendar dates and refuses impossible dates', async () => {
	const status = { kind: 'REGISTERED' as const, reference_number: 'R', rate_override: null };
	for (const first of [null, '2000-02-29']) {
		assert.equal(
			statutoryFactStatusFault({ ...status, first_contribution_due_on: first }),
			undefined
		);
	}
	for (const first of ['2000-02-30', '2026-2-1', 'not-a-date']) {
		assert.ok(statutoryFactStatusFault({ ...status, first_contribution_due_on: first }));
	}
});

test('deduction declarations reject unknown categories, invalid months and duplicate references', async () => {
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
			{ statutory_contributions: [deductionScheme] }
		);
	await write([claim, { ...claim, reference: 'Correction', amount: -20 }]);
	await assert.rejects(write([claim, claim]), /Duplicate deduction claim/);
	await assert.rejects(write([{ ...claim, period: '2026-13' }]), /YYYY-MM/);
	await assert.rejects(
		write([{ ...claim, category: 'UNKNOWN' }]),
		/does not use deduction category/
	);
	await assert.rejects(write([{ ...claim, reference: ' ' }]), /declaration reference/);
});

test('child declarations reject invalid counts, unknown categories and duplicate tax-year rows', async () => {
	const childScheme = {
		...scheme,
		rules: [
			{ when: 'true', employee: 'scheme.child_claims.UNDER_18.full * 2000.0', employer: '0.0' }
		]
	};
	const claim = {
		year: '2026',
		relief_class: 'UNDER_18',
		full_count: 1,
		half_count: 1,
		reference: 'Declaration 2026'
	};
	const registered = { kind: 'REGISTERED' as const, reference_number: 'R', rate_override: null };
	const write = (claims: readonly Record<string, unknown>[]) =>
		transformOne(
			facts,
			{
				employee_id: 'e',
				statutory_contribution_id: 'pcb',
				status: { ...registered, child_claims: claims }
			},
			undefined,
			{ statutory_contributions: [childScheme] }
		);
	await write([claim, { ...claim, year: '2027' }]);
	await assert.rejects(write([claim, claim]), /one child-claim row per tax year/);
	await assert.rejects(
		write([{ ...claim, relief_class: 'UNUSED' }]),
		/does not use child relief class/
	);
	await assert.rejects(write([{ ...claim, year: '26' }]), /four-digit tax year/);
	await assert.rejects(write([{ ...claim, reference: ' ' }]), /declaration reference/);
	for (const amount of [-1, 0.5]) {
		assert.ok(
			statutoryFactStatusFault({
				...registered,
				child_claims: [{ ...claim, full_count: amount }]
			})
		);
		assert.ok(
			statutoryFactStatusFault({
				...registered,
				child_claims: [{ ...claim, half_count: amount }]
			})
		);
	}
});

test('a fact write refuses an election the scheme does not declare, or of another type', async () => {
	const registered = { kind: 'REGISTERED', reference_number: 'R', rate_override: null };
	await writeFact(registered);
	await writeFact({ ...registered, elections: { disabled: true } });
	await assert.rejects(
		writeFact({ ...registered, elections: { zakat: 100 } }),
		/PCB does not declare the election zakat/
	);
	await assert.rejects(
		writeFact({ ...registered, elections: { disabled: 'yes' } }),
		/declares the election disabled as a boolean; this value is a string/
	);
});

test('a dated non-registration can carry an evidenced election without asserting enrolment', async () => {
	const outside = {
		kind: 'NOT_REGISTERED' as const,
		reason: 'First month before fund participation begins',
		elections: { disabled: true },
		declaration_reference: 'JOIN-2026-04'
	};
	const saved = await writeFact(outside);
	assert.deepEqual(saved.status, outside);
	assert.deepEqual((await writeFact({ ...outside, reason: 'Provident fund member' })).status, {
		...outside,
		reason: 'Provident fund member'
	});
	assert.equal(statutoryFactStatusFault(outside), undefined);
	assert.match(
		statutoryFactStatusFault({ ...outside, declaration_reference: '' }) ?? '',
		/declaration_reference/
	);
	await assert.rejects(
		writeFact({ ...outside, elections: { undeclared: true } }),
		/PCB does not declare the election undeclared/
	);
	await assert.rejects(
		writeFact({ ...outside, elections: { disabled: 'yes' } }),
		/PCB declares the election disabled as a boolean; this value is a string/
	);
	await assert.rejects(
		transformOne(
			facts,
			{ employee_id: 'e', statutory_contribution_id: 'pcb', status: outside },
			undefined,
			{
				statutory_contributions: [
					{ ...scheme, elections: [{ key: 'disabled', type: 'boolean', scope: 'EMPLOYMENT' }] }
				]
			}
		),
		/requires a named employment/
	);
});

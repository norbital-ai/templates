import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import {
	COMPANY_ID,
	contributionSchemes,
	createStatutoryWorld,
	settingsIdOn
} from './fixtures/statutory-world.ts';
import { payrollWorld, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import { runTransform } from './helpers/ctx.ts';
import { weeklyInstalments } from '../src/lib/payroll/run/period.ts';

const people = [609.5, 2000, 4500, 4502.03, 10000].map((wage, index) => ({
	key: `SDL-${index}`,
	wage,
	citizenship: 'FOREIGNER',
	pay_frequency: 'SEMI_MONTHLY' as const
}));

test('SG SDL lists exactly the 12 local institutions in the 2014 Exemption Order', () => {
	const named = [
		'Institute of Technical Education',
		'Nanyang Polytechnic',
		'Nanyang Technological University',
		'National University of Singapore',
		'Ngee Ann Polytechnic',
		'Republic Polytechnic',
		'Singapore Institute of Technology',
		'Singapore Management University',
		'Singapore Polytechnic',
		'Singapore University of Technology and Design',
		'Temasek Polytechnic',
		'Singapore University of Social Sciences',
		'OTHER'
	];
	for (const period of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01']) {
		const scheme = contributionSchemes('SG').find(
			(row) => row.settings_id === settingsIdOn('SG', `${period}-01`) && row.code === 'SDL'
		);
		assert.deepEqual(
			scheme?.elections.find((field) => field.key === 'sdl_local_institution')?.options,
			named,
			period
		);
	}
});

for (const [name, elections, individualEmployer, expected] of [
	['Singapore service', { sdl_service_scope: 'SINGAPORE_SERVICE' }, false, 5],
	[
		'leave attributable to earlier Singapore service',
		{ sdl_service_scope: 'SINGAPORE_LEAVE' },
		false,
		5
	],
	['wholly overseas service', { sdl_service_scope: 'OUTSIDE_SINGAPORE' }, false, 0],
	[
		'private household domestic servant',
		{
			sdl_household_role: 'DOMESTIC_SERVANT',
			sdl_wholly_exclusive: true,
			sdl_nonbusiness: true
		},
		true,
		0
	],
	[
		'company-employed domestic servant',
		{ sdl_household_role: 'DOMESTIC_SERVANT', sdl_wholly_exclusive: true, sdl_nonbusiness: true },
		false,
		5
	],
	[
		'business-connected gardener',
		{ sdl_household_role: 'GARDENER', sdl_wholly_exclusive: true },
		true,
		5
	],
	[
		'nonexclusive private chauffeur',
		{ sdl_household_role: 'CHAUFFEUR', sdl_nonbusiness: true },
		true,
		5
	]
] as const)
	test(`SG SDL scope: ${name}`, () => {
		for (const period of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01']) {
			const world = createStatutoryWorld({
				code: 'SG',
				period,
				companyFacts: { sdl_individual_employer: individualEmployer },
				people: [
					{
						key: 'SCOPE',
						wage: 2000,
						citizenship: 'FOREIGNER',
						registrations: { SDL: { kind: 'REGISTERED', elections } }
					}
				]
			});
			const built = settle(world, period);
			const charged = built.payslip_payroll_run
				.flatMap((slip) => slip.statutory)
				.filter((row) => row.scheme_code === 'SDL')
				.reduce((sum, row) => sum + row.employer_amount, 0);
			assert.equal(charged, expected, period);
		}
	});

test('SG SDL refuses a service-scope revision inside one calendar month', () => {
	const world = createStatutoryWorld({
		code: 'SG',
		period: '2026-07',
		people: [{ key: 'MIDMONTH', wage: 2000, citizenship: 'FOREIGNER' }]
	});
	const original = world.employment_statutory_facts.find((row) =>
		world.statutory_contributions.some(
			(scheme) =>
				scheme.id === row.statutory_contribution_id &&
				scheme.settings_id === settingsIdOn('SG', '2026-07-31') &&
				scheme.code === 'SDL'
		)
	)!;
	const sdlIds = new Set(
		world.statutory_contributions
			.filter((scheme) => scheme.code === 'SDL')
			.map((scheme) => scheme.id)
	);
	world.employment_statutory_facts.splice(
		0,
		world.employment_statutory_facts.length,
		...world.employment_statutory_facts.filter(
			(row) => !sdlIds.has(row.statutory_contribution_id) || row === original
		)
	);
	original.effective_range = { start: '2015-01-01', end: '2026-07-14' };
	world.employment_statutory_facts.push({
		...original,
		id: 'sdl-july-15',
		effective_range: { start: '2026-07-15', end: null },
		status: {
			...original.status,
			elections: { ...original.status.elections, sdl_service_scope: 'OUTSIDE_SINGAPORE' }
		}
	});
	assert.throws(() => settle(world, '2026-07'), /SDL.*service scope.*month/i);
});

test('SG SDL cannot be waived by an unregistered label or missing employer classification', () => {
	const unregistered = createStatutoryWorld({
		code: 'SG',
		period: '2026-07',
		people: [
			{
				key: 'UNREGISTERED',
				wage: 2000,
				citizenship: 'FOREIGNER',
				registrations: { SDL: { kind: 'NOT_REGISTERED' } }
			}
		]
	});
	assert.throws(() => settle(unregistered, '2026-07'), /SDL:.*service scope.*required/i);
	const unknownEmployer = createStatutoryWorld({
		code: 'SG',
		period: '2026-07',
		people: [{ key: 'UNKNOWN', wage: 2000, citizenship: 'FOREIGNER' }]
	});
	delete unknownEmployer.companies[0]!.facts.sdl_individual_employer;
	assert.throws(
		() => settle(unknownEmployer, '2026-07'),
		/SDL employer is an individual.*required/i
	);
});

test('SG SDL refuses foreign-currency wages before treating their amount as SGD', () => {
	const world = createStatutoryWorld({
		code: 'SG',
		period: '2026-07',
		people: [{ key: 'USD-WAGE', wage: 2000, citizenship: 'FOREIGNER' }]
	});
	world.employment_terms[0]!.currency = 'USD';
	assert.throws(
		() => settle(world, '2026-07'),
		/USD-WAGE has USD contract wages.*assesses SGD.*sourced conversion/s
	);
});

test('SG SDL charges no levy when no wages are payable', () => {
	for (const period of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01']) {
		const world = createStatutoryWorld({
			code: 'SG',
			period,
			people: [{ key: 'ZERO-WAGE', wage: 0, citizenship: 'FOREIGNER' }]
		});
		const built = settle(world, period);
		assert.equal(
			built.payslip_payroll_run
				.flatMap((slip) => slip.statutory)
				.filter((row) => row.scheme_code === 'SDL')
				.reduce((sum, row) => sum + row.employer_amount, 0),
			0,
			period
		);
	}
});

for (const [name, elections, expected] of [
	[
		'listed student with institution-approved training',
		{
			sdl_student_class: 'LOCAL_TERTIARY',
			sdl_local_institution: 'National University of Singapore',
			sdl_local_student_confirmed: true,
			sdl_local_student_reference: 'NUS-STUDENT-2026',
			sdl_local_training_approved: true,
			sdl_local_approval_reference: 'NUS-TRAINING-2026'
		},
		0
	],
	[
		'unlisted institution',
		{
			sdl_student_class: 'LOCAL_TERTIARY',
			sdl_local_institution: 'OTHER',
			sdl_local_student_confirmed: true,
			sdl_local_student_reference: 'OTHER-STUDENT',
			sdl_local_training_approved: true,
			sdl_local_approval_reference: 'OTHER-TRAINING'
		},
		5
	],
	[
		'unconfirmed student standing',
		{
			sdl_student_class: 'LOCAL_TERTIARY',
			sdl_local_institution: 'National University of Singapore',
			sdl_local_student_confirmed: false,
			sdl_local_training_approved: true,
			sdl_local_approval_reference: 'NUS-TRAINING-2026'
		},
		5
	],
	[
		'training without institution approval',
		{
			sdl_student_class: 'LOCAL_TERTIARY',
			sdl_local_institution: 'National University of Singapore',
			sdl_local_student_confirmed: true,
			sdl_local_student_reference: 'NUS-STUDENT-2026',
			sdl_local_training_approved: false
		},
		5
	]
] as const)
	test(`SG SDL local student: ${name}`, () => {
		for (const period of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01']) {
			const world = createStatutoryWorld({
				code: 'SG',
				period,
				people: [
					{
						key: 'LOCAL-STUDENT',
						wage: 2000,
						citizenship: 'FOREIGNER',
						registrations: { SDL: { kind: 'REGISTERED', elections } }
					}
				]
			});
			const built = settle(world, period);
			const charged = built.payslip_payroll_run
				.flatMap((slip) => slip.statutory)
				.filter((row) => row.scheme_code === 'SDL')
				.reduce((sum, row) => sum + row.employer_amount, 0);
			assert.equal(charged, expected, period);
		}
	});

test('SG SDL local student approval and standing require their own evidence references', () => {
	const world = createStatutoryWorld({
		code: 'SG',
		period: '2026-07',
		people: [
			{
				key: 'NO-APPROVAL-PROOF',
				wage: 2000,
				citizenship: 'FOREIGNER',
				registrations: {
					SDL: {
						kind: 'REGISTERED',
						elections: {
							sdl_student_class: 'LOCAL_TERTIARY',
							sdl_local_institution: 'National University of Singapore',
							sdl_local_student_confirmed: true,
							sdl_local_student_reference: 'NUS-STUDENT-2026',
							sdl_local_training_approved: true
						}
					}
				}
			}
		]
	});
	assert.throws(() => settle(world, '2026-07'), /SDL:.*training-approval reference.*required/i);
});

test('SG SDL does not infer student exemption from an INTERN employment label', () => {
	const world = createStatutoryWorld({
		code: 'SG',
		period: '2026-07',
		people: [
			{ key: 'UNAPPROVED-INTERN', wage: 2000, citizenship: 'FOREIGNER', employment_type: 'INTERN' }
		]
	});
	const built = settle(world, '2026-07');
	assert.equal(
		built.payslip_payroll_run
			.flatMap((slip) => slip.statutory)
			.filter((row) => row.scheme_code === 'SDL')
			.reduce((sum, row) => sum + row.employer_amount, 0),
		5
	);
});

test('SG SDL refuses an undeclared student class and a midmonth training approval', () => {
	const missing = createStatutoryWorld({
		code: 'SG',
		period: '2026-07',
		people: [{ key: 'MISSING-STUDENT-CLASS', wage: 2000, citizenship: 'FOREIGNER' }]
	});
	const current = missing.employment_statutory_facts.find((row) =>
		missing.statutory_contributions.some(
			(scheme) =>
				scheme.id === row.statutory_contribution_id &&
				scheme.settings_id === settingsIdOn('SG', '2026-07-31') &&
				scheme.code === 'SDL'
		)
	)!;
	const missingSdlIds = new Set(
		missing.statutory_contributions
			.filter((scheme) => scheme.code === 'SDL')
			.map((scheme) => scheme.id)
	);
	missing.employment_statutory_facts.splice(
		0,
		missing.employment_statutory_facts.length,
		...missing.employment_statutory_facts.filter(
			(row) => !missingSdlIds.has(row.statutory_contribution_id) || row === current
		)
	);
	delete current.status.elections.sdl_student_class;
	assert.throws(() => settle(missing, '2026-07'), /SDL:.*student exemption class.*required/i);

	const changing = createStatutoryWorld({
		code: 'SG',
		period: '2026-07',
		people: [{ key: 'MIDMONTH-STUDENT', wage: 2000, citizenship: 'FOREIGNER' }]
	});
	const original = changing.employment_statutory_facts.find(
		(row) => row.statutory_contribution_id === current.statutory_contribution_id
	)!;
	const sdlIds = new Set(
		changing.statutory_contributions
			.filter((scheme) => scheme.code === 'SDL')
			.map((scheme) => scheme.id)
	);
	changing.employment_statutory_facts.splice(
		0,
		changing.employment_statutory_facts.length,
		...changing.employment_statutory_facts.filter(
			(row) => !sdlIds.has(row.statutory_contribution_id) || row === original
		)
	);
	original.effective_range = { start: '2015-01-01', end: '2026-07-14' };
	changing.employment_statutory_facts.push({
		...original,
		id: 'sdl-local-july-15',
		effective_range: { start: '2026-07-15', end: null },
		status: {
			...original.status,
			elections: {
				...original.status.elections,
				sdl_student_class: 'LOCAL_TERTIARY',
				sdl_local_institution: 'National University of Singapore',
				sdl_local_student_confirmed: true,
				sdl_local_student_reference: 'NUS-STUDENT-2026',
				sdl_local_training_approved: true,
				sdl_local_approval_reference: 'NUS-TRAINING-2026'
			}
		}
	});
	assert.throws(() => settle(changing, '2026-07'), /SDL.*student exemption class.*month/i);
});

for (const studentClass of ['OVERSEAS_TERTIARY', 'SCHOOL_HOLIDAY'] as const)
	test(`SG SDL ${studentClass} refuses pending its distinct exemption mechanism`, () => {
		const world = createStatutoryWorld({
			code: 'SG',
			period: '2026-07',
			people: [
				{
					key: studentClass,
					wage: 2000,
					citizenship: 'FOREIGNER',
					registrations: {
						SDL: { kind: 'REGISTERED', elections: { sdl_student_class: studentClass } }
					}
				}
			]
		});
		assert.throws(
			() => settle(world, '2026-07'),
			/overseas-tertiary or school-holiday SDL exemption/i
		);
	});

function settle(world: PayrollWorld, period: string) {
	const prepared = gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period });
	const built = buildPayrollRun(prepared);
	world.payroll_runs.push({
		id: period,
		company_id: COMPANY_ID,
		period,
		company_charges: built.company_charges
	});
	for (const slip of built.payslip_payroll_run)
		world.payslips.push({ ...slip, payroll_run_id: period, paid_at: prepared.window.payDate });
	return built;
}

for (const period of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01'])
	test(`SG SDL ${period} keeps five employee costs of $40.75 and publishes $40 payable`, () => {
		const world = createStatutoryWorld({
			code: 'SG',
			period,
			people: people.map((person) => ({ ...person, pay_frequency: 'MONTHLY' as const }))
		});
		const built = settle(world, period);
		const costs = built.payslip_payroll_run.flatMap((slip) =>
			slip.statutory.filter((row) => row.scheme_code === 'SDL').map((row) => row.employer_amount)
		);
		assert.deepEqual(costs, [2, 5, 11.25, 11.25, 11.25]);
		assert.deepEqual(built.company_remittances, [
			{
				scheme_code: 'SDL',
				month: period,
				currency: 'SGD',
				accrued_amount: 40.75,
				payable_amount: 40
			}
		]);
	});

test('SG payroll run write includes the separate SDL remittance payable', async () => {
	const period = '2026-07';
	const world = createStatutoryWorld({
		code: 'SG',
		period,
		people: people.map((person) => ({ ...person, pay_frequency: 'MONTHLY' as const }))
	});
	const [run] = await runTransform(payrollRuns, [{ company_id: COMPANY_ID, period }], {
		tables: world
	});
	assert.deepEqual(run.company_remittances, [
		{
			scheme_code: 'SDL',
			month: period,
			currency: 'SGD',
			accrued_amount: 40.75,
			payable_amount: 40
		}
	]);
	assert.equal(
		run.company_charges.some((charge) => charge.scheme_code === 'SDL'),
		false
	);
});

for (const cutoff of ['FIRST', 'SPLIT', 'LAST'] as const)
	test(`SG SDL ${cutoff} publishes one month-end payable across two runs`, () => {
		const world = createStatutoryWorld({
			code: 'SG',
			period: '2026-07-1',
			payFrequency: 'SEMI_MONTHLY',
			people
		});
		world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
		const first = settle(world, '2026-07-1');
		const second = settle(world, '2026-07-2');
		assert.deepEqual(first.company_remittances, []);
		assert.deepEqual(second.company_remittances, [
			{
				scheme_code: 'SDL',
				month: '2026-07',
				currency: 'SGD',
				accrued_amount: 40.75,
				payable_amount: 40
			}
		]);
		const costs = [...first.payslip_payroll_run, ...second.payslip_payroll_run]
			.flatMap((slip) => slip.statutory)
			.filter((row) => row.scheme_code === 'SDL')
			.reduce((sum, row) => sum + row.employer_amount, 0);
		assert.equal(costs, 40.75);
	});

for (const month of ['2026-02', '2026-03'])
	for (const cutoff of ['FIRST', 'SPLIT', 'LAST'] as const)
		test(`SG SDL ${cutoff} publishes one payable after ${month}'s final weekly run`, () => {
			const weeks = weeklyInstalments(month);
			const world = createStatutoryWorld({
				code: 'SG',
				period: `${month}-1`,
				payFrequency: 'WEEKLY',
				people: people.map((person) => ({
					...person,
					wage: person.wage / weeks.length,
					pay_frequency: 'WEEKLY' as const
				}))
			});
			world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
			const runs = weeks.map((week) => settle(world, `${month}-${week.sequence}`));
			assert.ok(runs.slice(0, -1).every((run) => run.company_remittances.length === 0));
			assert.deepEqual(runs.at(-1)!.company_remittances, [
				{ scheme_code: 'SDL', month, currency: 'SGD', accrued_amount: 40.75, payable_amount: 40 }
			]);
			const costs = runs
				.flatMap((run) => run.payslip_payroll_run)
				.flatMap((slip) => slip.statutory)
				.filter((row) => row.scheme_code === 'SDL')
				.reduce((sum, row) => sum + row.employer_amount, 0);
			assert.equal(costs, 40.75);
		});

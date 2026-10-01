import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';

/** Circular 460 C.1–2; certified Circular 274 H.2–4. Synthetic membership declarations only. */
const expectSaved = (
	result: ReturnType<typeof buildStatutory>,
	person: string,
	code: string,
	employee: number,
	employer: number
) => {
	assert.ok(result.slips.has(person), 'a saved payslip must exist');
	const charge = result.slips.get(person)?.statutory.find((row) => row.scheme_code === code);
	assert.deepEqual(
		[charge?.employee_amount ?? 0, charge?.employer_amount ?? 0],
		[employee, employer]
	);
};

const run = (age = 61, elections: Record<string, string> = {}, kind = 'REGISTERED') =>
	buildStatutory({
		code: 'PH',
		period: '2026-10',
		region: 'NCR',
		companyFacts: { minimum_wage_exemption_approved: true },
		people: [
			{
				key: 'MEMBER',
				wage: 10_000,
				age,
				registrations: { HDMF: { kind, declaration_reference: 'SYNTHETIC-DECLARATION', elections } }
			}
		]
	});

test('PH-HD05 — existing membership at 61–64 continues; compulsory Fund retirement is 65', () => {
	expectSaved(run(60), 'MEMBER', 'HDMF', 200, 200);
	expectSaved(run(61), 'MEMBER', 'HDMF', 200, 200);
	expectSaved(run(64), 'MEMBER', 'HDMF', 200, 200);
	expectSaved(run(65), 'MEMBER', 'HDMF', 0, 0);
	assert.throws(() => run(65, { membership_status: 'MANDATORY' }), /compulsory Fund retirement/);
});

test('PH-HD05 — first private membership may start at 60; a later initial private entry is not continuing membership', () => {
	expectSaved(run(60, { first_membership_on: '2026-01-01' }), 'MEMBER', 'HDMF', 200, 200);
	assert.throws(
		() => run(61, { first_membership_on: '2026-10-31' }),
		/Initial private Pag-IBIG coverage after age 60/
	);
	expectSaved(
		run(61, {
			membership_status: 'NEVER_COVERED'
		}),
		'MEMBER',
		'HDMF',
		0,
		0
	);
	assert.throws(
		() =>
			run(60, {
				membership_status: 'NEVER_COVERED'
			}),
		/Never-covered exemption/
	);
});

test('PH-HD05 — other mandatory classes do not inherit the private initial-age bound', () => {
	for (const coverage_class of ['SEAFARER', 'GSIS', 'UNIFORMED', 'FOREIGN_BASED']) {
		expectSaved(
			run(61, {
				coverage_class,
				initial_coverage_class: coverage_class,
				first_membership_on: '2026-10-31'
			}),
			'MEMBER',
			'HDMF',
			200,
			200
		);
	}
	expectSaved(
		run(61, { initial_coverage_class: 'SEAFARER', first_membership_on: '2026-10-31' }),
		'MEMBER',
		'HDMF',
		200,
		200
	);
});

test('PH-HD05 — optional retirement claim requires evidenced mandatory re-enrolment; compulsory retirement cannot re-enter', () => {
	const history = {
		last_termination_reason: 'OPTIONAL_RETIREMENT',
		last_termination_on: '2026-01-01',
		reenrolled_on: '2026-02-01'
	};
	expectSaved(run(61, history), 'MEMBER', 'HDMF', 200, 200);
	assert.throws(
		() => run(61, { ...history, reenrolled_on: '' }),
		/re-enrolment date.*(?:required|ISO calendar day)/
	);
	assert.throws(
		() => run(61, { ...history, reenrolled_on: '2025-12-01' }),
		/re-enrolment must follow/
	);
	assert.throws(
		() => run(61, { ...history, last_termination_reason: 'COMPULSORY_RETIREMENT' }),
		/cannot be followed by mandatory re-enrolment/
	);
});

test('PH-HD05 — self-paying classes and recorded voluntary membership do not acquire an employer payroll match', () => {
	for (const coverage_class of ['SELF_EMPLOYED', 'OTHER_EARNING']) {
		expectSaved(
			run(61, { coverage_class, initial_coverage_class: coverage_class }),
			'MEMBER',
			'HDMF',
			0,
			0
		);
	}
	expectSaved(
		run(61, {
			membership_status: 'VOLUNTARY',
			coverage_class: 'VOLUNTARY',
			initial_coverage_class: 'VOLUNTARY'
		}),
		'MEMBER',
		'HDMF',
		0,
		0
	);
});

test('PH-HD05 — absent membership declarations owe input; missing scheme identifier never waives liability', () => {
	for (const key of [
		'coverage_class',
		'membership_status',
		'membership_evidence_reference',
		'first_membership_on',
		'initial_coverage_class'
	]) {
		assert.throws(
			() => run(61, { [key]: '' }),
			/required before calculation|must be one of|must be an ISO calendar day|must contain at least/
		);
	}
	expectSaved(run(61, {}, 'NOT_REGISTERED'), 'MEMBER', 'HDMF', 200, 200);
});

test('PH-HD05 — prior voluntary membership and unrecorded termination history cannot establish continued mandatory private cover', () => {
	assert.throws(
		() => run(61, { initial_coverage_class: 'VOLUNTARY' }),
		/Initial mandatory private coverage date is required/
	);
	assert.throws(
		() =>
			run(61, { initial_coverage_class: 'VOLUNTARY', private_coverage_started_on: '2026-10-31' }),
		/Voluntary Pag-IBIG membership does not establish/
	);
	expectSaved(
		run(61, { initial_coverage_class: 'VOLUNTARY', private_coverage_started_on: '2020-01-01' }),
		'MEMBER',
		'HDMF',
		200,
		200
	);
	assert.throws(() => run(61, { last_termination_reason: '' }), /Last Pag-IBIG termination ground/);
	assert.throws(
		() => run(61, { first_membership_on: '2027-01-01' }),
		/between birth and this assessment period/
	);
	assert.throws(() => run(61, { coverage_class: 'KASAMBAHAY' }), /classification must agree/);
});

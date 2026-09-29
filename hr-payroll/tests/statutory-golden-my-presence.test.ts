/**
 * Malaysia's presence tests read the recorded stays (`presence_periods`): ITA 1967 s.7(1)(a)–(c),
 * (1A) and Schedule 6 paras 21–22, AGC online text as at 1 January 2026. Every figure is by hand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStatutory, buildStatutory, expectStatutory } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { isEligible, personContext } from '../src/lib/payroll/run/eligibility.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
/** A non-citizen: EPF Part F only. */
const MY_FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };

const foreigner = (key: string) => ({
	key,
	wage: 5001,
	citizenship: 'FOREIGNER',
	tax_residency: 'NON_RESIDENT',
	hire_date: '2026-01-01',
	registrations: MY_FOREIGN
});

/** Record one stay per person, by the person's key. */
const stays =
	(byKey: Record<string, { start: string; end: string | null }>) => (world: PayrollWorld) => {
		Object.assign(world, {
			presence_periods: Object.entries(byKey).map(([key, period], index) => ({
				id: `stay-${index}`,
				employee_id: world.employees.find((row) => row.name === key)!.id,
				jurisdiction_code: 'MY',
				period: { from: period.start, to: period.end },
				reference: 'passport stamps',
				approval_id: null
			}))
		});
	};

test('presence counts: whole entry and exit days, clipped to the rule date, by calendar year', () => {
	const person = (asOf: string, presence: { start: string; end: string | null }[]) =>
		personContext({ employment: { service_start: '2026-01-01' }, terms: null, presence, asOf });
	const on = (asOf: string, presence: { start: string; end: string | null }[]) =>
		person(asOf, presence).employee;
	// 1 Jan – 31 Mar is 31 + 28 + 31 = 90 days (2022, 2023, 2025); 2024 is a leap year, so
	// 1 Jan – 29 Mar is 31 + 29 + 29 = 89.
	const history = [
		{ start: '2022-01-01', end: '2022-03-31' },
		{ start: '2023-01-01', end: '2023-03-31' },
		{ start: '2024-01-01', end: '2024-03-29' },
		{ start: '2025-01-01', end: '2025-03-31' },
		{ start: '2026-01-01', end: null }
	];
	const march31 = on('2026-03-31', history);
	assert.deepEqual(
		[march31.presence_recorded, march31.presence_days, march31.presence_years_90],
		[true, 90, 3]
	);
	// s.7(1)(c): 90 days this year and 90 in three of the four preceding years — resident on the
	// 31st, not on the 30th (89 days).
	const s7c = 'employee.presence_days >= 90 && employee.presence_years_90 >= 3';
	assert.equal(isEligible(s7c, person('2026-03-31', history)), true);
	assert.equal(isEligible(s7c, person('2026-03-30', history)), false);
	assert.equal(on('2026-03-30', history).presence_days, 89);
	// A stay ending 31 December and one entering 1 January are one unbroken stay: 31 linked days.
	const crossing = on('2026-01-15', [
		{ start: '2025-12-01', end: '2025-12-31' },
		{ start: '2026-01-01', end: null }
	]);
	assert.deepEqual([crossing.presence_days, crossing.presence_linked_days], [15, 31]);
	// Days after the rule date have not happened: 1–10 February.
	assert.equal(on('2026-02-10', [{ start: '2026-02-01', end: '2026-12-31' }]).presence_days, 10);
	// Nothing recorded.
	assert.deepEqual(
		[on('2026-02-10', []).presence_recorded, on('2026-02-10', []).presence_days],
		[false, 0]
	);
});

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — presence alone cannot prove the sixty-day employment exemption`, () => {
		const prepare = stays({ NR: { start: '2026-01-01', end: '2026-03-02' } });
		assert.throws(
			() => buildStatutory({ code, period: '2026-01', people: [foreigner('NR')] }, prepare),
			/PCB: Schedule 6 paragraph 21 needs dated days employment was exercised in Malaysia/
		);
		// Sixty-one presence days could still contain sixty or fewer exercised-employment days.
		assert.throws(
			() => buildStatutory({ code, period: '2026-03', people: [foreigner('NR')] }, prepare),
			/PCB: Schedule 6 paragraph 21 needs dated days employment was exercised in Malaysia/
		);
	});

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — a stay linked to 182 consecutive days of the previous year is resident; 181 is not (ITA s.7(1)(b))`, () => {
		// Both in Malaysia without a break since 2025, 31 days in January 2026. From 3 July 2025,
		// 3–31 July (29) + 31 + 30 + 31 + 30 + 31 = 182 consecutive days in 2025: resident for 2026
		// under s.7(1)(b), whatever the recorded NON_RESIDENT. D(b)(1) normal remuneration, as the
		// 182-day contract golden: K1 = K2 = 101, LP1 25.25, relief 9,000, P = 49,774.75, Table 1
		// 600 + 14,774.75 × 6% = 1,486.485 ÷ 12 = 123.873 → 123.87 → 123.90. From 4 July, 181 days:
		// not resident; physical presence alone does not prove days employment was exercised here.
		const book = assessStatutory(
			{ code, period: '2026-01', people: [foreigner('L-182')] },
			stays({ 'L-182': { start: '2025-07-03', end: null } })
		);
		expectStatutory(book, 'L-182', 'PCB', 123.9, 0);
		assert.throws(
			() =>
				buildStatutory(
					{ code, period: '2026-01', people: [foreigner('L-181')] },
					stays({ 'L-181': { start: '2025-07-04', end: null } })
				),
			/PCB: Schedule 6 paragraph 21 needs dated days employment was exercised in Malaysia/
		);
	});

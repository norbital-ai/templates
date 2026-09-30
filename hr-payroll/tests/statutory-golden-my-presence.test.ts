/**
 * Malaysia's presence tests read the recorded stays (`presence_periods`): ITA 1967 s.7(1)(a)–(c),
 * (1A) and Schedule 6 paras 21–22, AGC online text as at 1 January 2026. Every figure is by hand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	chargeOf,
	expectStatutory
} from './fixtures/statutory-world.ts';
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

/** Record one stay per person, by the person's key; `employment_exercised` where the employee worked here. */
const stays =
	(byKey: Record<string, { start: string; end: string | null; employment_exercised?: boolean }>) =>
	(world: PayrollWorld) => {
		Object.assign(world, {
			presence_periods: Object.entries(byKey).map(([key, period], index) => ({
				id: `stay-${index}`,
				employee_id: world.employees.find((row) => row.name === key)!.id,
				jurisdiction_code: 'MY',
				period: { from: period.start, to: period.end },
				employment_exercised: period.employment_exercised === true,
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
	assert.deepEqual([march31.presence_recorded, march31.presence_days], [true, 90]);
	// presence_days_in(n): the calendar year n before 2026, whole; 0 is this year through the rule
	// date, and a year before the first stay reads 0.
	const daysIn = (n: number, days: number, asOf = '2026-03-31') =>
		isEligible(`employee.presence_days_in(${n}) == ${days}`, person(asOf, history));
	[90, 90, 89, 90, 90, 0].forEach((days, n) =>
		assert.equal(daysIn(n, days), true, `presence_days_in(${n})`)
	);
	assert.equal(daysIn(0, 89, '2026-03-30'), true);
	// s.7(1)(c)(ii): 90 days this year and 90 in any three of the four preceding years, the rule
	// writing the four years itself — 2025, 2023, 2022 at 90 (2024 at 89): resident on the 31st,
	// not on the 30th (89 days this year).
	const s7c =
		'employee.presence_days >= 90 && (employee.presence_days_in(1) >= 90 ? 1 : 0) + (employee.presence_days_in(2) >= 90 ? 1 : 0) + (employee.presence_days_in(3) >= 90 ? 1 : 0) + (employee.presence_days_in(4) >= 90 ? 1 : 0) >= 3';
	assert.equal(isEligible(s7c, person('2026-03-31', history)), true);
	assert.equal(isEligible(s7c, person('2026-03-30', history)), false);
	// Drop 2022 (four years back): only 2023 and 2025 reach 90 — two of four, not resident. A 90-day
	// year five back (2021) is outside the four and does not stand in for it.
	const twoOfFour = [{ start: '2021-01-01', end: '2021-03-31' }, ...history.slice(1)];
	assert.equal(isEligible(s7c, person('2026-03-31', twoOfFour)), false);
	// A stay crossing years splits by calendar year: 1 Dec 2024 – 31 Mar 2025 is 31 in 2024
	// (two back) and 90 in 2025 (one back).
	const across = person('2026-01-10', [{ start: '2024-12-01', end: '2025-03-31' }]);
	assert.equal(
		isEligible(
			'employee.presence_days_in(2) == 31 && employee.presence_days_in(1) == 90 && employee.presence_days_in(0) == 0',
			across
		),
		true
	);
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
	// Employment days (Sch.6 para 21): only stays recorded `employment_exercised`, inside the stint.
	// A contract 1 February – 13 March 2026, in Malaysia 25 January – 15 March and 1–5 April (a
	// visit, not work). Present: 7 (25–31 Jan) + 28 + 15 + 5 = 55. Employed here: 28 (Feb) + 13
	// (1–13 Mar) = 41 — the 25–31 January and 14–15 March days fall outside the stint.
	const contract = personContext({
		employment: { service_start: '2026-02-01', exit_date: '2026-03-13' },
		terms: null,
		presence: [
			{ start: '2026-01-25', end: '2026-03-15', employment_exercised: true },
			{ start: '2026-04-01', end: '2026-04-05' }
		],
		asOf: '2026-04-30'
	}).employee;
	assert.deepEqual([contract.presence_days, contract.employment_days], [55, 41]);
	// Through the rule date: on 28 February, 28 days employed here.
	assert.equal(
		personContext({
			employment: { service_start: '2026-02-01', exit_date: '2026-03-13' },
			terms: null,
			presence: [{ start: '2026-01-25', end: '2026-03-15', employment_exercised: true }],
			asOf: '2026-02-28'
		}).employee.employment_days,
		28
	);
	// Presence without the flag counts no employment day.
	assert.equal(on('2026-03-31', history).employment_days, 0);
});

for (const code of ['MY'] as const)
	test(`${code} — presence alone proves no employment day; sixty recorded employment days are exempt, sixty-one are not (ITA Sch.6 paras 21–22)`, () => {
		const claiming = (key: string) => ({
			...foreigner(key),
			registrations: {
				...MY_FOREIGN,
				PCB: { kind: 'REGISTERED', elections: { pcb_sch6_para21: true } }
			}
		});
		// In Malaysia 1 January – 2 March 2026 (31 + 28 + 2 = 61 days), no employment recorded as
		// exercised here: a para 21 claim refuses; without the claim, D(a)'s 30% × 5,001 = 1,500.30.
		const present = stays({ NR: { start: '2026-01-01', end: '2026-03-02' } });
		assert.throws(
			() => buildStatutory({ code, period: '2026-01', people: [claiming('NR')] }, present),
			/PCB: Schedule 6 paragraph 21 needs dated days employment was exercised in Malaysia/
		);
		expectStatutory(
			assessStatutory({ code, period: '2026-01', people: [foreigner('NR')] }, present),
			'NR',
			'PCB',
			1500.3,
			0
		);
		// Recorded as employment exercised here, hired 1 January, so every day is inside the stint.
		// To 1 March: 31 January, 31 days; 28 February, 59; 31 March, 31 + 28 + 1 = 60 — "not
		// exceeding sixty days" (para 21(a)): nil. To 2 March: 61 days by 31 March, para 22(a) —
		// the exemption is gone: 30% × 5,001 = 1,500.30 (no earlier nil slip in this world to recover).
		const worked = (end: string) =>
			stays({ NR: { start: '2026-01-01', end, employment_exercised: true } });
		const pcb = (period: string, end: string, person = claiming('NR')) =>
			assessStatutory({ code, period, people: [person] }, worked(end));
		expectStatutory(pcb('2026-01', '2026-03-01'), 'NR', 'PCB', 0, 0);
		expectStatutory(pcb('2026-02', '2026-03-01'), 'NR', 'PCB', 0, 0);
		expectStatutory(pcb('2026-03', '2026-03-01'), 'NR', 'PCB', 0, 0);
		expectStatutory(pcb('2026-03', '2026-03-02'), 'NR', 'PCB', 1500.3, 0);
		// Employment days without the claim: the ordinary non-resident 30%.
		expectStatutory(pcb('2026-01', '2026-03-01', foreigner('NR')), 'NR', 'PCB', 1500.3, 0);
	});

for (const code of ['MY'] as const)
	test(`${code} — a stay linked to 182 consecutive days of the previous year is resident; 181 is not (ITA s.7(1)(b))`, () => {
		// Both in Malaysia without a break since 2025, 31 days in January 2026. From 3 July 2025,
		// 3–31 July (29) + 31 + 30 + 31 + 30 + 31 = 182 consecutive days in 2025: resident for 2026
		// under s.7(1)(b), whatever the recorded NON_RESIDENT. D(b)(1) normal remuneration, as the
		// 182-day contract golden: K1 = K2 = 100.02 (Part F 2% × 5,001, A1760 para 2), no SOCSO
		// relief without a TP1 claim (MTD spec 2026 D.2(ii) item k), relief 9,000, P = 4,900.98 × 12
		// − 9,000 = 49,811.76, Table 1 600 + 14,811.76 × 6% = 1,488.7056 ÷ 12 = 124.058 → 124.05.
		// From 4 July, 181 days: not resident, and no para 21 claim — D(a)'s 30% × 5,001 = 1,500.30.
		const book = assessStatutory(
			{ code, period: '2026-01', people: [foreigner('L-182')] },
			stays({ 'L-182': { start: '2025-07-03', end: null } })
		);
		expectStatutory(book, 'L-182', 'PCB', 124.05, 0);
		expectStatutory(
			assessStatutory(
				{ code, period: '2026-01', people: [foreigner('L-181')] },
				stays({ 'L-181': { start: '2025-07-04', end: null } })
			),
			'L-181',
			'PCB',
			1500.3,
			0
		);
		// No recorded status at all: the linked 182-day stay makes the employee known to be
		// resident (124.05, no note); at 181 days D(a)'s "not known to be resident" 30% applies
		// (1,500.30) and the run names the employee whose residence is unrecorded.
		const unrecorded = (key: string) => ({
			code,
			period: '2026-01',
			people: [{ ...foreigner(key), tax_residency: null }]
		});
		const at = (key: string, start: string) => stays({ [key]: { start, end: null } });
		const notes = (key: string, start: string) =>
			buildStatutory(unrecorded(key), at(key, start)).warnings.filter((line) =>
				line.startsWith(`CONTRIBUTION_RULE_WARNING: ${key}: PCB: tax residence is not recorded`)
			).length;
		expectStatutory(
			assessStatutory(unrecorded('U-182'), at('U-182', '2025-07-03')),
			'U-182',
			'PCB',
			124.05,
			0
		);
		assert.equal(notes('U-182', '2025-07-03'), 0);
		expectStatutory(
			assessStatutory(unrecorded('U-181'), at('U-181', '2025-07-04')),
			'U-181',
			'PCB',
			1500.3,
			0
		);
		assert.equal(notes('U-181', '2025-07-04'), 1);
	});

for (const code of ['MY'] as const)
	test(`${code} — 90 days this year and 90 in three of the four preceding years is resident; two of four is not (ITA s.7(1)(c)(ii))`, () => {
		// March 2026, 5,001, both recorded NON_RESIDENT. P3: 1 January – 31 March in 2022, 2023, 2025
		// (90 days each) and 2026 (90 by the 31st); 2024 to 29 March, 89 (leap year). P2: the same
		// but 2021 in place of 2022 — five years back, outside the four: two of four. A third,
		// recorded RESIDENT with no stays, is the resident MTD P3 must match; P2 is D(a)'s 30% ×
		// 5,001 = 1,500.30.
		const years = ['2023', '2024', '2025'];
		const p3 = ['2022', ...years];
		const p2 = ['2021', ...years];
		const rows = (key: string, from: readonly string[]) =>
			[...from, '2026'].map((year) => ({
				key,
				start: `${year}-01-01`,
				end: year === '2026' ? null : year === '2024' ? '2024-03-29' : `${year}-03-31`
			}));
		const book = assessStatutory(
			{
				code,
				period: '2026-03',
				people: [foreigner('P3'), foreigner('P2'), { ...foreigner('R'), tax_residency: 'RESIDENT' }]
			},
			(world: PayrollWorld) => {
				Object.assign(world, {
					presence_periods: [...rows('P3', p3), ...rows('P2', p2)].map((row, index) => ({
						id: `stay-${index}`,
						employee_id: world.employees.find((person) => person.name === row.key)!.id,
						jurisdiction_code: 'MY',
						period: { from: row.start, to: row.end },
						employment_exercised: false,
						reference: 'passport stamps',
						approval_id: null
					}))
				});
			}
		);
		const resident = chargeOf(book, 'R', 'PCB');
		assert.notEqual(resident.employee, 1500.3);
		expectStatutory(book, 'P3', 'PCB', resident.employee, resident.employer);
		expectStatutory(book, 'P2', 'PCB', 1500.3, 0);
	});

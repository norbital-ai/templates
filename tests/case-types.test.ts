// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Generalised benefit cases (capability L5), on jurisdiction-free case types: every figure is a
 * stored phase expression over the `case` site, hand-computed here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessCase,
	calculateBenefitCandidate,
	casePhases,
	caseSite,
	previousCases
} from '../src/lib/benefit-cases/benefit.ts';
import { caseDutyEvents } from '../src/lib/benefit-cases/duties.ts';
import { caseTypeFault } from '../src/lib/datatypes/case_types.ts';

const base = {
	event_kinds: ['ONSET'],
	movement_kinds: [],
	components: { award: 'AWARD', differential: 'EMPLOYER' },
	min_event_on: '2020-01-01',
	min_days_after_event: 0,
	premium_schemes: [],
	differential_exemption_facts: [],
	authority: 'Fixture rules'
};

const salaryDays = 'round(case.salary * phase.days / 30.0, 0.01, "HALF_UP")';

/** Full pay for the first 14 days (60 in hospital), two thirds after; an insurer refunds it all. */
const INJURY = {
	...base,
	case_type: 'INJURY_LEAVE',
	facts: [
		{ key: 'certified_days', type: 'number', label: 'Certified days', integer: true, minimum: 0 },
		{ key: 'hospitalised', type: 'boolean', label: 'Hospitalised' }
	],
	phases: [
		{
			code: 'FULL',
			days: 'int(min(case.facts.certified_days, case.facts.hospitalised ? 60.0 : 14.0))',
			award: '0.0',
			wage: salaryDays,
			employer_pays: salaryDays,
			reimbursable: 'phase.employer_pays'
		},
		{
			code: 'REDUCED',
			days: 'int(max(0.0, case.facts.certified_days - (case.facts.hospitalised ? 60.0 : 14.0)))',
			award: '0.0',
			wage: salaryDays,
			employer_pays: 'round(case.salary * phase.days / 30.0 * 2.0 / 3.0, 0.01, "HALF_UP")',
			reimbursable: 'phase.employer_pays'
		}
	]
};

const injury = (facts) => ({
	event_kind: 'ONSET',
	event_on: '2026-03-02',
	application_on: '2026-03-03',
	leave_from: '2026-03-02',
	facts
});

test('a work-injury case pays full then reduced tiers, each refunded by the insurer', () => {
	const result = assessCase({
		case_type: INJURY,
		benefit_case: injury({ certified_days: 20, hospitalised: false }),
		inputs: { salary: 3000 }
	});
	// 3,000 × 14 ÷ 30 = 1,400; 3,000 × 6 ÷ 30 × 2/3 = 400.
	assert.deepEqual(
		result.phases.map((p) => [p.code, p.start, p.end, p.days, p.employer_pays, p.wage]),
		[
			['FULL', '2026-03-02', '2026-03-15', 14, 1400, 1400],
			['REDUCED', '2026-03-16', '2026-03-21', 6, 400, 600]
		]
	);
	assert.equal(result.compensable_days, 20);
	assert.equal(result.employer_pays, 1800);
	assert.equal(result.reimbursable, 1800);
	// No advance: the employer's outlay is its own pay, all of it refunded.
	assert.equal(result.advance_due_on, null);
	assert.equal(result.employer_outlay, 1800);
	assert.equal(result.employer_net_cost, 0);
});

test('a tier with no days is skipped, and a hospital stay lengthens the full tier', () => {
	const short = assessCase({
		case_type: INJURY,
		benefit_case: injury({ certified_days: 10, hospitalised: false }),
		inputs: { salary: 3000 }
	});
	assert.deepEqual(
		short.phases.map((p) => [p.code, p.days, p.employer_pays]),
		[['FULL', 10, 1000]]
	);
	const long = assessCase({
		case_type: INJURY,
		benefit_case: injury({ certified_days: 70, hospitalised: true }),
		inputs: { salary: 3000 }
	});
	// 3,000 × 60 ÷ 30 = 6,000; 3,000 × 10 ÷ 30 × 2/3 = 666.666… → 666.67.
	assert.deepEqual(
		long.phases.map((p) => [p.code, p.days, p.employer_pays]),
		[
			['FULL', 60, 6000],
			['REDUCED', 10, 666.67]
		]
	);
	assert.equal(long.employer_pays, 6666.67);
	assert.throws(
		() =>
			assessCase({
				case_type: INJURY,
				benefit_case: injury({ certified_days: 0, hospitalised: false }),
				inputs: { salary: 3000 }
			}),
		/no whole compensable days/
	);
});

/**
 * A scheme pays 60% of the average monthly earnings; the employer advances it within 7 days of
 * the event, tops pay up to full salary, and the government refunds the advance.
 */
const SICK = {
	...base,
	case_type: 'SICK_LEAVE',
	facts: [{ key: 'days', type: 'number', label: 'Days', integer: true, minimum: 0 }],
	earnings: { months: 3 },
	advance_due: 'add_days(case.event_on, 7)',
	phases: [
		{
			code: 'BENEFIT',
			days: 'int(case.facts.days)',
			award: 'round(avg(earnings.map(e, e.amount)) / 30.0 * phase.days * 0.6, 0.01, "HALF_UP")',
			wage: salaryDays,
			employer_pays: `${salaryDays} - phase.award`,
			reimbursable: 'phase.award'
		}
	]
};

test('a statutory benefit with a government-refunded advance and an employer top-up', () => {
	const result = assessCase({
		case_type: SICK,
		benefit_case: { event_kind: 'ONSET', event_on: '2026-04-06', facts: { days: 10 } },
		inputs: {
			salary: 3600,
			earnings: [
				{ period: '2026-01', amount: 3000 },
				{ period: '2026-02', amount: 3300 },
				{ period: '2026-03', amount: 3600 }
			]
		}
	});
	// Average 3,300 ÷ 30 × 10 × 0.6 = 660; full pay 3,600 × 10 ÷ 30 = 1,200; top-up 540.
	assert.equal(result.award, 660);
	assert.equal(result.wage, 1200);
	assert.equal(result.employer_pays, 540);
	assert.equal(result.reimbursable, 660);
	assert.equal(result.advance_due_on, '2026-04-13');
	// The employer advances the award: outlay 540 + 660, of which 660 comes back.
	assert.equal(result.employer_outlay, 1200);
	assert.equal(result.employer_net_cost, 540);
});

test('a negative employer figure pays nothing', () => {
	const result = assessCase({
		case_type: SICK,
		benefit_case: { event_kind: 'ONSET', event_on: '2026-04-06', facts: { days: 10 } },
		inputs: { salary: 600, earnings: [{ period: '2026-03', amount: 3000 }] }
	});
	// Award 3,000 ÷ 30 × 10 × 0.6 = 600 exceeds full pay 200: the signed top-up is −400.
	assert.equal(result.phases[0].employer_pays, -400);
	assert.equal(result.employer_pays, 0);
});

/** The two highest of four monthly credits ÷ 60 a day, with two paid months before the close. */
const CREDITED = {
	...base,
	case_type: 'CREDITED_LEAVE',
	facts: [],
	credits: { scheme: 'FUND', cap: 1000, months: 4, closes_months_before_event: '1' },
	phases: [
		{
			code: 'ALL',
			days: '30',
			award:
				'credits.size() >= 2 ? round(sum(credits.map(c, c.amount).top(2)) / 60.0 * phase.days, 0.01, "HALF_UP") : 0.0',
			employer_pays: '0.0',
			reimbursable: 'phase.award'
		}
	]
};

const statement = (coverage_month, credited_amount, paid_on) => ({
	scheme_code: 'FUND',
	coverage_month,
	credited_amount,
	paid_on,
	source_reference: `FUND ${coverage_month}`
});

test('a credit window counts only credits paid before it closes', () => {
	const months = [
		statement('2026-01', 500, '2026-01-31'),
		statement('2026-02', 700, '2026-02-28'),
		statement('2026-03', 0, null),
		statement('2026-04', 900, '2026-05-01')
	];
	const priced = (history) =>
		calculateBenefitCandidate({
			case_type: CREDITED,
			benefit_case: { event_kind: 'ONSET', event_on: '2026-06-10', facts: {} },
			months: history
		});
	const result = priced(months);
	// The window closes 2026-05-01: January–April; April was paid on the close and does not count.
	assert.deepEqual(result.qualifying_window, { from: '2026-01', through: '2026-04' });
	assert.equal(result.window_closes_on, '2026-05-01');
	assert.equal(result.paid_months, 2);
	// (700 + 500) ÷ 60 × 30 = 600.
	assert.equal(result.candidate_benefit, 600);
	const onTime = months.map((row) =>
		row.coverage_month === '2026-04' ? { ...row, paid_on: '2026-04-30' } : row
	);
	// (900 + 700) ÷ 60 × 30 = 800.
	assert.equal(priced(onTime).candidate_benefit, 800);
	// One paid credit is short of the stored two: no award.
	const unpaid = months.map((row) =>
		row.coverage_month === '2026-02' ? { ...row, credited_amount: 0, paid_on: null } : row
	);
	assert.equal(priced(unpaid).paid_months, 1);
	assert.equal(priced(unpaid).candidate_benefit, 0);
	assert.throws(() => priced(months.slice(0, 3)), /all 4 FUND contribution months/);
	assert.throws(
		() => priced([...months.slice(0, 3), statement('2026-04', 1200, '2026-04-30')]),
		/monthly credit is 0–1000/
	);
});

test('earlier cases of the person are read oldest first, this one and later ones excluded', () => {
	const rows = [
		{ id: 'c3', case_type: 'SICK_LEAVE', leave_from: '2026-05-01', leave_through: '2026-05-03' },
		{ id: 'c1', case_type: 'SICK_LEAVE', leave_from: '2026-01-05', leave_through: '2026-01-09' },
		{ id: 'c2', case_type: 'INJURY_LEAVE', event_on: '2026-02-01' },
		{ id: 'c4', case_type: 'SICK_LEAVE', leave_from: '2026-04-01', leave_through: '2026-04-02' }
	];
	assert.deepEqual(previousCases('c4', '2026-04-01', rows), [
		{ kind: 'SICK_LEAVE', started_on: '2026-01-05', ended_on: '2026-01-09', days: 5 },
		{ kind: 'INJURY_LEAVE', started_on: '2026-02-01', ended_on: '', days: 0 }
	]);
	// A third sick case in the year pays no award: `previous` read by a stored expression.
	const REPEAT = {
		...SICK,
		phases: [
			{
				...SICK.phases[0],
				award: `previous.filter(p, p.kind == case.kind).size() >= 1 ? 0.0 : ${SICK.phases[0].award}`
			}
		]
	};
	const site = caseSite(
		REPEAT,
		{ event_kind: 'ONSET', event_on: '2026-04-01', facts: { days: 2 } },
		[],
		{
			salary: 3000,
			earnings: [{ period: '2026-03', amount: 3000 }],
			previous: previousCases('c4', '2026-04-01', rows)
		}
	);
	const [phase] = casePhases(REPEAT, site);
	assert.equal(phase.award, 0);
	// Full pay 3,000 × 2 ÷ 30 = 200, all of it the employer's.
	assert.equal(phase.employer_pays, 200);
});

test('a case raises CASE_EVENT duty events for its application, event and award', () => {
	const events = caseDutyEvents({
		id: 'case-1',
		case_type: 'SICK_LEAVE',
		application_on: '2026-04-07',
		event_on: '2026-04-06',
		awarded_on: null,
		facts: { days: 10 }
	});
	assert.deepEqual(
		events.map((event) => [event.on, event.subject.kind, event.subject.id, event.ref, event.date]),
		[
			['CASE_EVENT', 'CASE', 'case-1', 'APPLICATION', '2026-04-07'],
			['CASE_EVENT', 'CASE', 'case-1', 'EVENT', '2026-04-06']
		]
	);
	assert.deepEqual(events[0].context.case, { type: 'SICK_LEAVE', facts: { days: 10 } });
});

test('a case type states its phases', () => {
	assert.equal(caseTypeFault(INJURY), undefined);
	assert.equal(caseTypeFault(SICK), undefined);
	assert.equal(caseTypeFault(CREDITED), undefined);
	assert.match(caseTypeFault({ ...SICK, phases: [] }), /at least one phase/);
	assert.match(
		caseTypeFault({ ...INJURY, phases: [INJURY.phases[0], INJURY.phases[0]] }),
		/phase codes are nonempty and unique/
	);
	assert.match(
		caseTypeFault({ ...SICK, phases: [{ ...SICK.phases[0], reimbursable: ' ' }] }),
		/every phase states/
	);
	assert.match(
		caseTypeFault({ ...CREDITED, credits: { ...CREDITED.credits, months: 0 } }),
		/credit window/
	);
});

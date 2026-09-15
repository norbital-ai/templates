// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	classifyWageComparand,
	deriveStatutoryWages
} from '../src/collections/payroll_runs/lib/statutory-wages.ts';
import {
	compileEligibility,
	isEligible,
	personContext
} from '../src/collections/payroll_runs/lib/eligibility.ts';

/**
 * Who the overtime ladder covers is the version's own `overtime_when`, a boolean over the person
 *. The Malaysian predicate below is the seed bank's: Employment Act 1955 First
 * Schedule paragraph 1A, as substituted by the Employment (Amendment of First Schedule) Order 2022
 * [P.U. (A) 262] — exclusion first, then the categories covered "irrespective of the amount of
 * wages", then the ceiling. Paragraph 1A reads "the person whose wages **exceeds** four thousand
 * ringgit a month", which is why RM4,000 exactly is covered.
 *
 * Every value asserted below is the statute's, not the engine's.
 */
const MY_WHEN =
	'terms.statutory_work_category != "VESSEL_WORK" && (terms.statutory_work_category == "MANUAL_LABOUR" || terms.statutory_work_category == "MANUAL_LABOUR_SUPERVISOR" || terms.statutory_work_category == "COMMERCIAL_VEHICLE_OPERATOR" || terms.statutory_wages <= 4000.0)';
/** Art.82: managerial employees are outside, and no wage figure is named. */
const PH_WHEN = 'employment.classification != "MANAGERIAL"';
const EXEMPT = ['MANUAL_LABOUR', 'MANUAL_LABOUR_SUPERVISOR', 'COMMERCIAL_VEHICLE_OPERATOR'];

const subject = (overrides = {}) =>
	personContext({
		employee: null,
		employment: { service_start: '2024-01-01' },
		terms: {
			statutory_work_category: overrides.category ?? 'NON_MANUAL',
			work_classification: overrides.classification ?? 'EA_COVERED'
		},
		statutoryWages: overrides.wages ?? 3000,
		asOf: '2026-03-31'
	});
const covered = (when, overrides = {}) => isEligible(when, subject(overrides));

test('every seeded predicate compiles over the person, and an empty one covers everyone', () => {
	assert.equal(compileEligibility(MY_WHEN), null);
	assert.equal(compileEligibility(PH_WHEN), null);
	assert.equal(compileEligibility(''), null);
	// Absence of a restriction is the opposite of a restriction that excludes everyone.
	assert.equal(covered('', { wages: 1_000_000_000, classification: 'MANAGERIAL' }), true);
});

test('the ceiling is inclusive: wages exactly at RM4,000 are covered, a cent above is not', () => {
	assert.equal(covered(MY_WHEN, { wages: 4000 }), true);
	assert.equal(covered(MY_WHEN, { wages: 4000.01 }), false);
});

test('an exempt category is covered however high the wage — First Schedule para 2', () => {
	for (const category of EXEMPT)
		assert.equal(covered(MY_WHEN, { category, wages: 50_000 }), true, category);
});

test('an excluded category is not covered however low the wage', () => {
	// Para 2(4) vessel work disapplies Part XII, which is where ss.60, 60A and 60D live, so the
	// entire rest-day / hours-of-work / holiday ladder is out — wage is never reached.
	assert.equal(covered(MY_WHEN, { category: 'VESSEL_WORK', wages: 1000 }), false);
});

test('a predicate reads the column it names, not a look-alike in the other vocabulary', () => {
	// The Philippine predicate is on work_classification: a statutory work category that happens to
	// be exempt in Malaysia changes nothing here, and a manager is out whatever they earn.
	assert.equal(covered(PH_WHEN, { category: 'MANUAL_LABOUR', classification: 'EA_COVERED' }), true);
	assert.equal(covered(PH_WHEN, { classification: 'MANAGERIAL', wages: 200_000 }), false);
});

test('an unclassified person falls through to the wage test', () => {
	assert.equal(covered(MY_WHEN, { category: '', wages: 3000 }), true);
	assert.equal(covered(MY_WHEN, { category: '', wages: 5000 }), false);
});

// ── the comparand: s.2 wages, classified from the component model ────────────────────────────

const component = (destination, direction, source) => ({
	destination,
	direction,
	definition: source == null ? null : { source }
});

test('the comparand classification is the statute read against what a component can say', () => {
	// s.2: basic wages AND all other cash payments for work done; para 3 lessens that by overtime
	// payment. The catalogue spine names the first two: the schedule source is the contracted basic
	// wage and a PAY/ADD line is any other cash payment. Para 3's overtime exclusion needs no
	// category, because overtime is not a component at all — it is derived from the clocks and the
	// ladder, so it is never in the set being classified and cannot enter the comparand to begin with.
	assert.equal(classifyWageComparand(component('PAY', 'ADD', 'SCHEDULE')), 'BASIC_WAGES');
	assert.equal(classifyWageComparand(component('PAY', 'ADD', 'ENTRY')), 'CASH_FOR_WORK');
	assert.equal(classifyWageComparand(component('NET', 'ADD', 'ENTRY')), 'NOT_WAGES');
	assert.equal(classifyWageComparand(component('NET', 'SUBTRACT', 'ENTRY')), 'NOT_WAGES');
	assert.equal(classifyWageComparand(component('PAY', 'SUBTRACT', 'ENTRY')), 'NOT_WAGES');
	assert.equal(classifyWageComparand(component('DISPLAY', null, 'ENTRY')), 'NOT_WAGES');
	assert.equal(classifyWageComparand(component('EMPLOYER', null, 'ENTRY')), 'NOT_WAGES');
});

test('the comparand is basic plus cash-for-work — the basic+allowance case', () => {
	// RM3,800 basic plus a RM500 fixed allowance is RM4,300 of para 3 wages, outside the ladder —
	// while base salary alone would say in.
	const comparand = deriveStatutoryWages({
		baseSalary: { value: 3800, currency: 'MYR' },
		payments: [
			{ category: 'CASH_FOR_WORK', amount: 500 },
			{ category: 'NOT_WAGES', amount: 300 }
		]
	});
	assert.deepEqual(comparand, { value: 4300, currency: 'MYR' });
	assert.equal(covered(MY_WHEN, { wages: comparand.value }), false);

	// The same person with no allowance settling this run stays inside.
	const bare = deriveStatutoryWages({
		baseSalary: { value: 3800, currency: 'MYR' },
		payments: [{ category: 'NOT_WAGES', amount: 700 }]
	});
	assert.equal(covered(MY_WHEN, { wages: bare.value }), true);
});

test('a reversal on an allowance takes its amount back out of the comparand', () => {
	const comparand = deriveStatutoryWages({
		baseSalary: { value: 3800, currency: 'MYR' },
		payments: [
			{ category: 'CASH_FOR_WORK', amount: 500 },
			{ category: 'CASH_FOR_WORK', amount: -500 }
		]
	});
	assert.equal(comparand.value, 3800);
});

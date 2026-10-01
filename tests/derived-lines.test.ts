import assert from 'node:assert/strict';
import test from 'node:test';
import {
	accumulatePayslip,
	dayFactTotals,
	deriveLines,
	type DerivedLine
} from '../src/lib/payroll/run/accumulate.ts';
import type { CatalogueComponent } from '../src/lib/payroll/run/configuration.ts';

const workItem = (
	code: string,
	output: string,
	source: 'SCHEDULE' | 'DERIVED_NORMAL' | 'DERIVED_DAY'
): CatalogueComponent => ({
	id: `s:${output}`,
	catalogue_id: 's',
	settings_id: 's',
	code,
	name: code,
	output,
	eligibility: '',
	family: 'WORK',
	destination: 'PAY',
	direction: 'ADD',
	bands: [],
	definition: { source, unit: 'MONEY' }
});

const BASIC = workItem('BASIC', 'salary', 'SCHEDULE');
const COMPONENTS = [
	BASIC,
	workItem('MW_TOP_UP', 'derived:MW_TOP_UP', 'DERIVED_NORMAL'),
	workItem('GUARANTEE', 'derived:GUARANTEE', 'DERIVED_NORMAL'),
	workItem('OUTPUT_BONUS', 'derived:OUTPUT_BONUS', 'DERIVED_DAY')
];

/** Piece pay settled as the salary line. */
const piecePay = (amount: number) => ({
	catalogueComponent: BASIC,
	bucket: 'EARNING' as const,
	label: 'BASIC',
	amount
});

/** A floor of 60.00 a working day over 26 working days: 1,560.00. */
const TOP_UP: DerivedLine = {
	code: 'MW_TOP_UP',
	amount: 'max(0.0, 60.0 * period.working_days - BASE)'
};
const CONTEXT = { period: { working_days: 26 } };

test('piece pay below the floor produces a top-up line to the floor', () => {
	const items = [piecePay(1200)];
	const derived = deriveLines({
		rules: [TOP_UP],
		items,
		components: COMPONENTS,
		context: CONTEXT,
		currency: 'USD'
	});
	// 60 × 26 = 1,560; 1,560 − 1,200 = 360.
	assert.deepEqual(
		derived.map((line) => [line.catalogueComponent.code, line.bucket, line.amount]),
		[['MW_TOP_UP', 'EARNING', 360]]
	);
	const accumulated = accumulatePayslip({ items: [...items, ...derived] });
	assert.equal(accumulated.reserved.BASE, 1560);
	assert.equal(accumulated.codes.get('MW_TOP_UP'), 360);
});

test('piece pay at or above the floor produces no derived line', () => {
	for (const pay of [1560, 1600])
		assert.deepEqual(
			deriveLines({
				rules: [TOP_UP],
				items: [piecePay(pay)],
				components: COMPONENTS,
				context: CONTEXT,
				currency: 'USD'
			}),
			[]
		);
});

test('a later derived line reads the earlier one, and a false when writes nothing', () => {
	const derived = deriveLines({
		rules: [
			TOP_UP,
			// A guaranteed 1,600.00 read after the top-up: 1,600 − 1,560 = 40.
			{ code: 'GUARANTEE', amount: 'max(0.0, 1600.0 - BASE)' },
			{ code: 'OUTPUT_BONUS', when: 'BASE > 5000.0', amount: '100.0', component: 'DAY_PAY' }
		],
		items: [piecePay(1200)],
		components: COMPONENTS,
		context: CONTEXT,
		currency: 'USD'
	});
	assert.deepEqual(
		derived.map((line) => [line.catalogueComponent.code, line.amount]),
		[
			['MW_TOP_UP', 360],
			['GUARANTEE', 40]
		]
	);
});

test('a per-output line reads the period total of a work-day fact and feeds DAY_PAY', () => {
	const dayFacts = dayFactTotals(
		[
			{ date: '2026-09-01', facts: { pieces: 40 } },
			{ date: '2026-09-02', facts: { pieces: 35, note: 'late' } },
			{ date: '2026-10-01', facts: { pieces: 99 } }
		],
		{ start: '2026-09-01', end: '2026-09-30' }
	);
	assert.deepEqual(dayFacts, { pieces: 75 });
	const derived = deriveLines({
		rules: [
			{
				code: 'OUTPUT_BONUS',
				when: 'day_facts.pieces > 70.0',
				// (75 − 70) × 2.50 = 12.50
				amount: '(day_facts.pieces - 70.0) * 2.5',
				component: 'DAY_PAY'
			}
		],
		items: [piecePay(1600)],
		components: COMPONENTS,
		context: { ...CONTEXT, day_facts: dayFacts },
		currency: 'USD'
	});
	assert.deepEqual(
		derived.map((line) => [line.catalogueComponent.code, line.amount]),
		[['OUTPUT_BONUS', 12.5]]
	);
	const accumulated = accumulatePayslip({ items: [piecePay(1600), ...derived] });
	assert.equal(accumulated.reserved.DAY_PAY, 12.5);
	assert.equal(accumulated.reserved.BASE, 1600);
});

test('a derived amount is rounded to the currency minor unit', () => {
	const derived = deriveLines({
		rules: [{ code: 'GUARANTEE', amount: '100.0 / 3.0' }],
		items: [],
		components: COMPONENTS,
		context: {},
		currency: 'USD'
	});
	assert.equal(derived[0]?.amount, 33.33);
});

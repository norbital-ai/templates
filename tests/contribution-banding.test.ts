/**
 * Which band a statutory contribution is read on, and what that band then charges.
 *
 * Nothing tested this. `scripts/verify-payroll-arithmetic.mjs` imports `selectBand`, `bandFloor`,
 * `contribute` and `scaleProgressive` and never calls any of them, and the public seed carries two
 * schemes with one open-ended `{ by: 'WAGE', from: 0, to: null }` band apiece — so no seeded
 * scenario has ever had a second tier to choose between. Every decision below is one the source
 * calls out as expensive to get wrong, and each was unguarded:
 *
 *   E3   a wage band is chosen by its **ceiling**, because the published schedules read "wages
 *        exceeding X but not exceeding Y". Keying on the floor moves every SOCSO and EIS figure by
 *        one band, on every payslip in the company.
 *   E24  a wage above every ceiling is an **error**. A ceiling is an open-ended terminal band, not
 *        the absence of one; quietly reusing the last finite band is a wrong-answer generator.
 *   E1   a progressive band's `constant` is the **accumulated** charge on every band below it, not
 *        a flat addend. Read as an addend, a chargeable income of 44,111.40 yields 3,246.68 where
 *        the answer is 1,146.68 — a 175.00 monthly error that grows without bound.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	bandCeiling,
	bandFloor,
	bandReference,
	selectBand,
	type BandContext
} from '../src/collections/payroll_runs/lib/bands.ts';
import { scaleProgressive } from '../src/collections/payroll_runs/lib/contribute.ts';
import type {
	ContributionConfig,
	ContributionRate
} from '../src/collections/payroll_runs/lib/configuration.ts';

const rate = (
	selector: ContributionRate['selector'],
	award: ContributionRate['award']
): ContributionRate => ({ selector, award }) as ContributionRate;

const wage = (from: number, to: number | null): ContributionRate['selector'] =>
	({ by: 'WAGE', from, to }) as ContributionRate['selector'];

const percent = (employee: number, employer: number): ContributionRate['award'] =>
	({ kind: 'PERCENT', employee, employer }) as ContributionRate['award'];

const context = (base: number, over: Partial<BandContext> = {}): BandContext => ({
	base,
	age: null,
	headcount: 10,
	riskClass: null,
	marital: null,
	...over
});

/** Two closed bands and an open terminal one, in the ascending-ceiling order the engine promises. */
const LADDER = [
	rate(wage(0, 3000), percent(1, 2)),
	rate(wage(3000, 4800), percent(3, 4)),
	rate(wage(4800, null), percent(5, 6))
];

test('a wage exactly on a boundary belongs to the band that ends there, not the one that starts', () => {
	// E3. 4800.00 reads as "exceeding 3000 but not exceeding 4800", which is the middle band.
	assert.equal(bandReference(selectBand(LADDER, context(4800), 'PUB').selector), '3000 – 4800');
	// A cent more crosses into the next one, which is the whole of what the boundary means.
	assert.equal(bandReference(selectBand(LADDER, context(4800.01), 'PUB').selector), '4800 – ∞');
	assert.equal(bandReference(selectBand(LADDER, context(3000), 'PUB').selector), '0 – 3000');
	assert.equal(bandReference(selectBand(LADDER, context(3000.01), 'PUB').selector), '3000 – 4800');
});

test('the band chosen is the one whose award is charged, so a boundary is money', () => {
	assert.deepEqual(selectBand(LADDER, context(4800), 'PUB').award, {
		kind: 'PERCENT',
		employee: 3,
		employer: 4
	});
	assert.deepEqual(selectBand(LADDER, context(4800.01), 'PUB').award, {
		kind: 'PERCENT',
		employee: 5,
		employer: 6
	});
});

test('a wage above every ceiling is refused by name, never folded into the last band', () => {
	// E24. Closed ladder: the schedule states no terminal band, so a wage past it has no answer.
	const closed = [rate(wage(0, 3000), percent(1, 2)), rate(wage(3000, 4800), percent(3, 4))];
	assert.throws(
		() => selectBand(closed, context(5000), 'PUB'),
		/PUB has no band covering a base of 5000: the highest band ends at 4800/
	);
	assert.throws(() => selectBand(closed, context(5000), 'PUB'), /open-ended terminal band/);
});

test('a combination no band admits is refused rather than charged on the nearest one', () => {
	const aged = [
		rate(
			{ by: 'WAGE_AND_AGE', from: 0, to: null, age_from: 0, age_to: 60 } as never,
			percent(11, 13)
		)
	];
	assert.equal(selectBand(aged, context(3000, { age: 45 }), 'PUB').award.employee, 11);
	assert.throws(
		() => selectBand(aged, context(3000, { age: 61 }), 'PUB'),
		/PUB has no band for a base of 3000 at age 61/
	);
	// Age is a filter applied before the wage ceiling, so an unknown age matches no age band at all.
	assert.throws(() => selectBand(aged, context(3000), 'PUB'), /no band for a base of 3000/);
});

test('a twice-published scale reads an unrecorded marital status on the SINGLE ladder', () => {
	const scale = [
		rate({ by: 'WAGE_AND_MARITAL', from: 0, to: null, marital: 'SINGLE' } as never, percent(7, 0)),
		rate({ by: 'WAGE_AND_MARITAL', from: 0, to: null, marital: 'MARRIED' } as never, percent(4, 0))
	];
	assert.equal(selectBand(scale, context(3000), 'PUB').award.employee, 7);
	assert.equal(selectBand(scale, context(3000, { marital: 'MARRIED' }), 'PUB').award.employee, 4);
});

test('a band with no selector or no award stops the run rather than paying nothing', () => {
	assert.throws(
		() => selectBand([rate(null, percent(1, 2))], context(100), 'PUB'),
		/PUB rate band has no selector/
	);
	assert.throws(
		() => selectBand([rate(wage(0, null), null)], context(100), 'PUB'),
		/PUB rate band has no award/
	);
});

test('a headcount or risk band accepts any wage, because its dimension already decided', () => {
	assert.equal(
		bandCeiling({ by: 'HEADCOUNT', from: 0, to: 50 } as never),
		Number.POSITIVE_INFINITY
	);
	assert.equal(bandCeiling({ by: 'RISK_CLASS', class: 'A' } as never), Number.POSITIVE_INFINITY);
	assert.equal(bandFloor({ by: 'RISK_CLASS', class: 'A' } as never), 0);
	const byHeadcount = [rate({ by: 'HEADCOUNT', from: 0, to: 5 } as never, percent(1, 1))];
	assert.equal(
		selectBand(byHeadcount, context(999_999, { headcount: 4 }), 'PUB').award.employee,
		1
	);
	assert.throws(
		() => selectBand(byHeadcount, context(1000, { headcount: 5 }), 'PUB'),
		/no band for a base of 1000/
	);
});

/**
 * The cumulative constant, on the exact figure the source names as the expensive one.
 *
 * `constant + (chargeable − band_from) × rate%`. Read as a flat addend the same inputs give
 * 3,246.68, so the assertion below is the difference between two readings of one column.
 */
test('a progressive band charges the accumulated constant plus the marginal slice', () => {
	const contribution = {
		row: { code: 'PUB-TAX' },
		rates: [
			rate(wage(0, 5000), { kind: 'PROGRESSIVE', constant: 0, rate: 1 } as never),
			rate(wage(5000, 20_000), { kind: 'PROGRESSIVE', constant: 50, rate: 3 } as never),
			rate(wage(20_000, null), { kind: 'PROGRESSIVE', constant: 600, rate: 6 } as never)
		]
	} as unknown as ContributionConfig;

	assert.equal(
		scaleProgressive(contribution, 44_111.4, context(0)),
		600 + 24_111.4 * 0.06,
		'the constant is the charge accumulated below the band, not a flat addend'
	);
	assert.notEqual(
		scaleProgressive(contribution, 44_111.4, context(0)),
		44_111.4 * 0.06 + 600,
		'read as an addend this is the 175.00-a-month error decision E1 names'
	);
	// The bottom of a band charges its constant and nothing more; a zero or negative base charges 0.
	assert.equal(scaleProgressive(contribution, 20_000, context(0)), 50 + 15_000 * 0.03);
	assert.equal(scaleProgressive(contribution, 0, context(0)), 0);
	assert.equal(scaleProgressive(contribution, -1, context(0)), 0);
});

test('scaling through a band that is not progressive is refused by name', () => {
	const flat = {
		row: { code: 'PUB-EPF' },
		rates: [rate(wage(0, null), percent(11, 13))]
	} as unknown as ContributionConfig;
	assert.throws(
		() => scaleProgressive(flat, 1000, context(0)),
		/PUB-EPF band 0 – ∞ is not a progressive award/
	);
});

// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The invariant the database stopped holding, held here instead.
 *
 * `payslip_sources.source` was globally `unique`, so one input belonged to exactly one payslip and
 * nobody had to be trusted for that to be true. Partial consumption made it false: a loan instalment
 * the negative-net guard could only part-pay stays outstanding, and the next run recovers the
 * remainder against the same obligation. The merged shape says `unique(source, payslip_id)` instead
 * — double-consumption inside one run is still impossible — and the cross-run ceiling became
 * arithmetic.
 *
 * Arithmetic is only an invariant while something checks it, which is what this file is. It is
 * deliberately about the *rule*, not about a run: `overConsumesObligation` is the whole of the
 * decision, so a test of it is a test of the ceiling wherever the engine calls it from.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	OBLIGATION_OVER_CONSUMED,
	obligationOverConsumedMessage,
	overConsumesObligation
} from './settlement_refusals.ts';

const consumption = (overrides) => ({
	obligation_id: '7f9c8b2e-4c1a-4d3b-9f6e-2a1b3c4d5e6f',
	reference: 'LOAN-2026-004',
	entitlement: 1200,
	consumed: 0,
	proposed: 100,
	period: '2026-08',
	...overrides
});

test('the ceiling is what earlier paid runs already took, not what one run takes', () => {
	// The case the old global unique index refused outright, and the case that made it wrong: eleven
	// instalments recovered across eleven runs, each of them a separate payslip claiming the same
	// obligation. Every one of these is legitimate.
	for (const consumed of [0, 100, 500, 1100]) {
		assert.equal(
			overConsumesObligation(consumption({ consumed, proposed: 100 })),
			false,
			`${consumed}`
		);
	}
	// And the twelfth run, which would take the loan past its principal, is not.
	assert.equal(overConsumesObligation(consumption({ consumed: 1200, proposed: 100 })), true);
	assert.equal(overConsumesObligation(consumption({ consumed: 1150, proposed: 100 })), true);
});

test('a part-recovered instalment may be finished by a later run', () => {
	// The shortfall case in full. A run could only afford 40 of a 100 instalment; nothing is copied
	// into a fresh row, so the next run comes back for the remaining 60 against the same obligation.
	assert.equal(
		overConsumesObligation(consumption({ entitlement: 100, consumed: 40, proposed: 60 })),
		false
	);
	// Asking for 61 is one more than the obligation is worth, and that is the whole rule.
	assert.equal(
		overConsumesObligation(consumption({ entitlement: 100, consumed: 40, proposed: 61 })),
		true
	);
});

test('rounding is not over-consumption, and a cent past rounding is', () => {
	// Amounts are rounded to the currency's minor unit on the way into a payslip, so a schedule that
	// sums to its principal exactly can land a hundredth over it across a dozen runs. Refusing that
	// would refuse the last instalment of a correct loan.
	assert.equal(
		overConsumesObligation(consumption({ entitlement: 1000, consumed: 900, proposed: 100.01 })),
		false
	);
	assert.equal(
		overConsumesObligation(consumption({ entitlement: 1000, consumed: 900, proposed: 100.02 })),
		true
	);
});

test('the refusal names itself, the obligation, what is left, and what was asked for', () => {
	// The name is the contract between this file, the engine that raises it and anything that reads
	// a failed run. Asserting the literal is what makes renaming it in one place a failure here
	// rather than a silently unhooked guard.
	assert.equal(OBLIGATION_OVER_CONSUMED, 'OBLIGATION_OVER_CONSUMED');

	const message = obligationOverConsumedMessage(
		consumption({ entitlement: 1200, consumed: 1150, proposed: 100 })
	);
	assert.match(message, /^OBLIGATION_OVER_CONSUMED: /);
	assert.match(message, /LOAN-2026-004/);
	assert.match(message, /1150\.00/);
	assert.match(message, /100\.00/);
	// The outstanding figure is the only part a person can act on: it is what the run may settle for.
	assert.match(message, /50\.00 outstanding/);
	assert.match(message, /2026-08/);

	// An obligation with no customer reference still produces a readable sentence rather than
	// "Obligation null".
	assert.match(
		obligationOverConsumedMessage(consumption({ reference: null })),
		/^OBLIGATION_OVER_CONSUMED: This obligation/
	);
});

// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ENTRY_OVER_CONSUMED,
	REPAYMENT_OVER_RECOVERED,
	entryOverConsumedMessage,
	overConsumesEntry,
	overRecoversRepayment,
	repaymentOverRecoveredMessage,
	entryAlreadyCapturedMessage,
	ENTRY_ALREADY_CAPTURED
} from './settlement_refusals.js';

/**
 * The two cross-run ceilings the junction shape traded database invariants for, and the
 * single-use capture refusal beside them. Each is stated here as a boundary — one cent of
 * rounding passes, two do not — and the operator-facing sentence is asserted to carry the named
 * refusal, because renaming the name in one place and not the others silently unhooks the guard.
 */

const entryConsumption = (consumed: number, proposed: number) => ({
	component_entry_id: 'en-1',
	component_code: 'TRANSPORT',
	entitlement: 100,
	consumed,
	proposed,
	period: '2026-03'
});

test('one cent of rounding is not an over-consumption; a cent more is', () => {
	assert.equal(overConsumesEntry(entryConsumption(99.99, 0.02)), false);
	assert.equal(overConsumesEntry(entryConsumption(99.98, 0.03)), true);
});

test('the entry refusal names the entry, what is left, and what was asked', () => {
	const message = entryOverConsumedMessage({
		component_entry_id: 'en-1',
		component_code: 'TRANSPORT',
		entitlement: 100,
		consumed: 40,
		proposed: 61,
		period: '2026-03'
	});
	assert.match(message, new RegExp(ENTRY_OVER_CONSUMED));
	assert.match(message, /TRANSPORT/);
	assert.match(message, /60\.00 outstanding/);
});

const repaymentConsumption = (consumed: number, proposed: number) => ({
	loan_repayment_id: 'rp-1',
	due_date: '2026-03-01',
	amount_due: 100,
	consumed,
	proposed,
	period: '2026-04'
});

test('the repayment ceiling is exact: to the amount due and never past it', () => {
	assert.equal(overRecoversRepayment(repaymentConsumption(80, 20)), false);
	assert.equal(
		overRecoversRepayment(repaymentConsumption(80.005, 20)),
		false,
		'one cent of rounding'
	);
	assert.equal(overRecoversRepayment(repaymentConsumption(80.02, 20)), true);
});

test('the repayment refusal names the due date and the overrun', () => {
	const message = repaymentOverRecoveredMessage(repaymentConsumption(60, 41));
	assert.match(message, new RegExp(REPAYMENT_OVER_RECOVERED));
	assert.match(message, /due 2026-03/);
});

test('the capture refusal tells the person a one-off settles once', () => {
	const message = entryAlreadyCapturedMessage({ capturedBy: '2026-02', period: '2026-03' });
	assert.match(message, new RegExp(ENTRY_ALREADY_CAPTURED));
	assert.match(message, /2026-02/);
	assert.match(message, /new component entry/);
});

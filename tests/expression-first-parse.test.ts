import assert from 'node:assert/strict';
import test from 'node:test';
import {
	evaluateNumber,
	programFor,
	runtimeExpressionEngine
} from '../src/lib/expressions/evaluate.ts';

test('first parse registers functions and cached programs bind each evaluation engine', () => {
	const expression = 'minimum_wage("X") + sum([1, 1])';
	const first = programFor(expression);
	assert.equal(
		evaluateNumber(runtimeExpressionEngine({ minimumWage: () => 200 }), expression, {}),
		202
	);
	assert.strictEqual(programFor(expression), first);
	assert.equal(
		evaluateNumber(runtimeExpressionEngine({ minimumWage: () => 300 }), expression, {}),
		302
	);
	assert.strictEqual(programFor(expression), first);
});

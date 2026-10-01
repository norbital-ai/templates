import assert from 'node:assert/strict';
import test from 'node:test';
import { compileExpression } from '../src/lib/expressions/compile.ts';
import { obligationContext } from '../src/lib/obligations/materialise.ts';

test('calendar obligation dates compile with a representative year while runtime roots stay blank', () => {
	assert.equal(
		compileExpression({
			expression: 'string(int(period.start.substring(0, 4)) + 1) + "-03-01"',
			site: 'obligation',
			type: 'date'
		}),
		null
	);
	assert.match(
		compileExpression({ expression: 'period.missing', site: 'obligation', type: 'date' }) ?? '',
		/not available|unknown|does not|no /i
	);
	assert.notEqual(compileExpression({ expression: '42', site: 'obligation', type: 'date' }), null);
	assert.deepEqual(obligationContext().period, { start: '', end: '' });
});

test('fixed-width filing dates compile without hiding invalid substring bounds', () => {
	assert.equal(
		compileExpression({
			expression:
				'filing.pay_date.substring(8, 10) + filing.pay_date.substring(5, 7) + filing.pay_date.substring(0, 4)',
			site: 'filing',
			type: 'text'
		}),
		null
	);
	assert.notEqual(
		compileExpression({
			expression: 'filing.pay_date.substring(8, 11)',
			site: 'filing',
			type: 'text'
		}),
		null
	);
});

import { expect, it } from '@effect/vitest';
import { columns, SourceRowInvalid } from '../src/integration/kingdee/cdc.js';

it('names the invalid source column with SourceRowInvalid', () => {
	try {
		columns({ amount: 12.5 }).decimal('amount');
		throw new Error('Expected the precise source column to be refused');
	} catch (error) {
		expect(error).toBeInstanceOf(SourceRowInvalid);
		expect(error).toMatchObject({
			_tag: 'SourceRowInvalid',
			column: 'amount',
			reason: 'Precise amounts must be projected as text'
		});
	}
});

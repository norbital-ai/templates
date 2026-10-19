import { expect, it as test } from '@effect/vitest';
import { marginSeries } from '../src/lib/financial-series.js';
test('real margins include reversals, keep currencies separate, and never total missing costs as zero', () => {
	const base = {
		owner: 'sales-1',
		owner_name: 'Salesperson',
		currency: 'SGD',
		net: '20',
		margin: '8'
	};
	expect(
		marginSeries([base, { ...base, margin: '-2' }, { ...base, currency: 'USD', margin: '4' }])
	).toEqual([
		{ currency: 'SGD', salesperson: 'Salesperson', margin: '6' },
		{ currency: 'USD', salesperson: 'Salesperson', margin: '4' }
	]);
	expect(marginSeries([base, { ...base, margin: null }])).toEqual([
		{ currency: 'SGD', salesperson: 'Salesperson', margin: null }
	]);
});

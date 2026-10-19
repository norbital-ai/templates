import { expect, it } from '@effect/vitest';
import { commissionFault } from '../src/lib/commission-expressions.js';

it('checks commission member paths against the declared formula roots', () => {
	expect(commissionFault('product.code == "SKU-1"', 'bool')).toBeUndefined();
	expect(commissionFault('product.cost > 0', 'bool')).toContain('product.cost');
	expect(commissionFault('rule.fixed_rate * basis_quantity', 'money')).toBeUndefined();
});

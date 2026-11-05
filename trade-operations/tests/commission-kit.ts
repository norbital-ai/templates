import { Effect } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { fixtureId } from './test-runtime.js';
import { committed, confirm, draft, PRODUCT, type T } from './kit.js';
/** The SGD commission rule and the product's WEST floor: once per workspace. */
export const commissionRule = Effect.fnUntraced(function* (t: T) {
	const as = t.as(t.admin);
	const rule = committed(
		'commission_rules',
		yield* as.act('commission_rules.create', [
			{
				currency: 'SGD',
				effective_on: PlainDate('2026-01-01'),
				basis_unit: 't',
				fixed_rate: Decimal.of('10'),
				spread_pct: Decimal.of('20')
			}
		])
	);
	const floor = committed(
		'pricing_floors',
		yield* as.act('pricing_floors.create', [
			{
				product: PRODUCT,
				currency: 'SGD',
				group_code: 'WEST',
				effective_on: PlainDate('2026-01-01'),
				unit: 'kg',
				floor_price: Decimal.of('1'),
				tax_inclusive: false
			}
		])
	);
	return { rule, floor };
});
/** The WEST warehouse the product's commission floor applies at. */
export const WEST = fixtureId('warehouses', '00000000-0000-4000-8000-000000000301');
/** A new salesperson's 1,000 kg sale at the WEST warehouse, sealed unless `confirmOrder` is false. */
export const commissionSale = Effect.fnUntraced(function* (t: T, confirmOrder = true) {
	const as = t.as(t.admin);
	const sales = t.member(['sales']);
	const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.id), undefined, WEST);
	committed(
		'order_lines',
		yield* as.act('order_lines.update', [
			{ target: own.line, set: { quantity: Decimal.of('1000') } }
		])
	);
	if (confirmOrder) yield* confirm(t, own.order);
	return { sales, own };
});

import { Effect } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { fixtureId } from './test-runtime.js';
import { committed, confirm, draft, PRODUCT, workspace } from './kit.js';
export const configuredCommission = Effect.fnUntraced(function* ({
	confirmOrder = true,
	over = {}
}: {
	confirmOrder?: boolean;
	over?: Parameters<typeof workspace>[0];
} = {}) {
	const t = yield* workspace(over),
		as = t.as(t.admin);
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
	const sales = t.member(['sales']);
	const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.id));
	committed('order_lines', yield* as.act('order_lines.delete', [{ target: own.line }]));
	committed(
		'orders',
		yield* as.act('orders.update', [
			{
				target: own.order,
				set: { warehouse: fixtureId('warehouses', '00000000-0000-4000-8000-000000000301') }
			}
		])
	);
	own.line = committed(
		'order_lines',
		yield* as.act('order_lines.create', [
			{
				order: own.order,
				product: PRODUCT,
				quantity: Decimal.of('1000'),
				unit_price: Decimal.of('2'),
				discount_pct: Decimal.of('0'),
				tax_rate: Decimal.of('9')
			}
		])
	);
	if (confirmOrder) yield* confirm(t, own.order);
	return { t, as, sales, own, rule, floor };
});

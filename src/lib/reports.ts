import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Result, Schema } from 'effect';
import {
	agreement,
	agreements,
	agreementSelect,
	withAgreement,
	type AgreementOrder
} from './agreements.js';
import {
	commissionContext,
	evaluateCommission,
	DEFAULT_COMMISSION_EXPRESSION,
	COMMISSION_ENGINE
} from './commission-expressions.js';
import { isMasked } from './access.js';
import type { QueryCtx, Row } from '@norbital-ai/bolt';
import { d, hash, sum } from './commercial.js';
import { minorDigits } from '@norbital-ai/std/decimal';
const text = { kind: 'text' } as const;
const money = { kind: 'money', currency: 'currency' } as const;
export const reportQueries = {
	ar_aging: {
		description: 'Open issued invoices by due-date bucket, with unapplied payments kept separate.',
		input: { as_of: { kind: 'date', default: { today: '' } } },
		output: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					order: { kind: 'id', of: 'orders' },
					order_number: text,
					party_name: text,
					invoice: { kind: 'id', of: 'transactions' },
					invoice_number: text,
					currency: { kind: 'currency' },
					due_on: { kind: 'date', optional: true },
					as_of: { kind: 'date' },
					balance: money,
					overpaid: money,
					bucket: {
						kind: 'enum',
						values: ['not_due', '1_30', '31_60', '61_90', 'over_90', 'no_due_date']
					}
				}
			}
		}
	},
	sales_analysis: {
		description: 'Monthly sales and returns by currency and salesperson.',
		input: { from: { kind: 'date', optional: true }, to: { kind: 'date', optional: true } },
		output: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					currency: { kind: 'currency' },
					owner: { kind: 'id', of: 'sys_user' },
					owner_name: text,
					period: { kind: 'date' },
					orders: { kind: 'int' },
					source_lines: { kind: 'int' },
					unresolved_lines: { kind: 'int' },
					freight_treatment: { kind: 'enum', values: ['deduct', 'include'] },
					freight: { ...money, optional: true },
					net: { ...money, optional: true },
					tax: { ...money, optional: true },
					total: { ...money, optional: true }
				}
			}
		}
	},
	sales_detail: {
		description: 'Sales and returns for the selected dates.',
		input: { from: { kind: 'date', optional: true }, to: { kind: 'date', optional: true } },
		output: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					order: { kind: 'id', of: 'orders' },
					product: { kind: 'id', of: 'products', optional: true },
					party: { kind: 'id', of: 'parties' },
					owner: { kind: 'id', of: 'sys_user' },
					sold_price: { kind: 'decimal', scale: 8, optional: true },
					floor_net: { kind: 'decimal', scale: 8, optional: true },
					order_number: text,
					party_name: text,
					product_name: text,
					owner_name: text,
					reference: text,
					external_code: text,
					business_on: { kind: 'date' },
					kind: { kind: 'enum', values: ['shipment', 'return', 'invoice_only'] },
					unit: text,
					quantity: { kind: 'decimal', scale: 3 },
					lot_number: { kind: 'text', optional: true },
					cost: { ...money, optional: true },
					margin: { ...money, optional: true },
					currency: { kind: 'currency' },
					net: { ...money, optional: true },
					tax: { ...money, optional: true },
					freight: { ...money, optional: true },
					total: { ...money, optional: true },
					freight_treatment: { kind: 'enum', values: ['deduct', 'include'] }
				}
			}
		}
	},
	commission: {
		description:
			'Commission from SO-sealed prices, floors, unit conversion and applicable rule. Missing inputs remain unresolved.',
		input: {
			order: { kind: 'id', of: 'orders', optional: true },
			version: { kind: 'int', min: 1, optional: true }
		},
		output: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					order: { kind: 'id', of: 'orders' },
					number: text,
					owner: { kind: 'id', of: 'sys_user' },
					owner_name: text,
					ordered_on: { kind: 'date' },
					currency: { kind: 'currency' },
					product: text,
					quantity: { kind: 'decimal', scale: 3 },
					basis_unit: text,
					spread: { kind: 'decimal', scale: 8, optional: true },
					amount: { kind: 'money', currency: 'currency', optional: true },
					reason: {
						kind: 'enum',
						values: [
							'resolved',
							'rule_missing',
							'expression_error',
							'ineligible',
							'floor_missing',
							'conversion_missing',
							'unit_mismatch'
						]
					}
				}
			}
		}
	}
} as const;
export const reportSelect = {
	...agreementSelect,
	number: true,
	direction: true,
	status: true,
	owner: true,
	ordered_on: true,
	currency: true,
	sealed_snapshot: true,
	sealed_commission: true,
	seal_hash: true
} as const;
type CommissionOrder = AgreementOrder & Pick<Row<'orders'>, 'id' | 'direction' | 'currency'>;
export type CommissionFact = Pick<
	Row<'source_sales_lines'>,
	| 'id'
	| 'order'
	| 'seal_hash'
	| 'order_line'
	| 'kind'
	| 'unit'
	| 'quantity'
	| 'currency'
	| 'net_amount'
	| 'active'
	| 'business_on'
>;
export const commissionFactSelect = {
	order: true,
	seal_hash: true,
	order_line: true,
	kind: true,
	unit: true,
	quantity: true,
	currency: true,
	net_amount: true,
	active: true,
	business_on: true
} as const;
function commissionLines(
	record: CommissionOrder,
	seal?: string,
	actual?: readonly CommissionFact[]
) {
	const version = seal ? agreement(record, seal) : agreements(record).at(-1);
	const order = version
		? { ...withAgreement(record, version), ...(actual ? { status: 'confirmed' as const } : {}) }
		: record;
	if (
		!order.sealed_snapshot ||
		isMasked(order.sealed_snapshot) ||
		order.direction !== 'sales' ||
		!['confirmed', 'closed'].includes(order.status)
	)
		return [];
	const snapshot = order.sealed_snapshot;
	const rule = order.sealed_commission;
	const entries = actual
		? actual.map((fact) => ({
				line: snapshot.lines.find((line) => line.id === fact.order_line),
				fact
			}))
		: snapshot.lines.map((line) => ({ line, fact: undefined }));
	return entries.map(({ line, fact }) => {
		const orderLine = line?.id ?? fact?.order_line;
		const rawQuantity = fact?.quantity ?? line?.quantity;
		if (orderLine === undefined || rawQuantity === undefined)
			throw new Error('No commission source line');
		const base = {
			order_line: orderLine,
			product: line?.product_name ?? '',
			quantity: d(rawQuantity),
			basis_unit: rule?.basis_unit ?? '',
			spread: null,
			amount: null
		};
		if (
			!line ||
			(fact &&
				(fact.net_amount === null || fact.unit !== line.unit || fact.currency !== order.currency))
		)
			return { ...base, reason: 'expression_error' as const };
		if (!rule) return { ...base, reason: 'rule_missing' as const };
		const quantity = fact ? d(fact.quantity).abs().toString() : line.quantity;
		const factNet = fact?.net_amount;
		if (fact && factNet == null) return { ...base, reason: 'expression_error' as const };
		const net = factNet == null ? line.net : d(factNet).abs().toString();
		const evaluated = Result.try(() => {
			if (rule.engine_version && rule.engine_version !== COMMISSION_ENGINE)
				throw new Error('Unknown commission engine');
			const factor =
				line.commission_factor &&
				d(line.commission_factor).gt(0) &&
				line.commission_basis_unit === rule.basis_unit
					? line.commission_factor
					: null;
			const context = commissionContext({
				quantity,
				net,
				floor_net: line.floor_net || null,
				factor,
				product_code: line.product_code,
				product_name: line.product_name,
				unit: line.unit,
				currency: order.currency,
				ordered_on: order.ordered_on,
				party_code: snapshot.party_code,
				fixed_rate: rule.fixed_rate,
				spread_pct: rule.spread_pct,
				parameters: rule.parameters ?? []
			});
			const result = evaluateCommission(
				rule.eligibility_expression ?? 'true',
				rule.amount_expression ?? DEFAULT_COMMISSION_EXPRESSION,
				context
			);
			const spread =
				line.floor_net && factor
					? d(net).div(quantity, 18).minus(line.floor_net).div(factor, 18).round(8)
					: null;
			return {
				...base,
				spread,
				amount: (fact?.kind === 'return' ? result.amount.neg() : result.amount).round(
					minorDigits(order.currency)
				),
				reason: result.eligible ? ('resolved' as const) : ('ineligible' as const)
			};
		});
		if (Result.isSuccess(evaluated)) return evaluated.success;
		{
			const reason =
				rule.amount_expression && rule.amount_expression !== DEFAULT_COMMISSION_EXPRESSION
					? ('expression_error' as const)
					: !line.floor_net
						? ('floor_missing' as const)
						: !line.commission_factor || d(line.commission_factor).lte(0)
							? ('conversion_missing' as const)
							: line.commission_basis_unit !== rule.basis_unit
								? ('unit_mismatch' as const)
								: ('expression_error' as const);
			return { ...base, reason };
		}
	});
}
type ReportOrder = Pick<Row<'orders'>, 'id' | keyof typeof reportSelect>;
export function commissionRows(orders: readonly ReportOrder[], selectedVersion?: number | null) {
	return orders.flatMap((record) => {
		const version =
			selectedVersion == null
				? agreements(record).at(-1)
				: agreements(record).find((v) => v.version === selectedVersion);
		if (selectedVersion != null && !version) return [];
		const order = version ? withAgreement(record, version) : record;
		return commissionLines(order).map(({ order_line, ...line }) => ({
			...line,
			owner_name: '',
			order: order.id,
			number: order.number,
			owner: order.owner,
			ordered_on: order.ordered_on,
			currency: order.currency
		}));
	});
}
export class AgreementUnavailable extends Schema.TaggedError<AgreementUnavailable>()(
	'AgreementUnavailable',
	{ message: Schema.String }
) {}
export const commissionCalculation = Effect.fnUntraced(function* (
	record: CommissionOrder,
	seal?: string,
	actual?: readonly CommissionFact[]
) {
	const version = seal ? agreement(record, seal) : agreements(record).at(-1);
	if (seal && !version)
		return yield* Effect.fail(
			new AgreementUnavailable({ message: 'Approved contract version unavailable' })
		);
	const order = version ? withAgreement(record, version) : record;
	const lines = commissionLines(order, seal, actual);
	const unresolved_lines = lines.filter((line) => line.amount === null).length;
	const amount = unresolved_lines
		? null
		: sum(lines.flatMap((line) => (line.amount === null ? [] : [line.amount]))).round(
				minorDigits(order.currency)
			);
	const snapshot = {
		seal_hash: order.seal_hash ?? '',
		eligible: actual ? Boolean(version) : ['confirmed', 'closed'].includes(order.status),
		lines: lines.map((line) => ({
			order_line: line.order_line,
			product: line.product,
			quantity: line.quantity.toString(),
			basis_unit: line.basis_unit,
			spread: line.spread?.toString() ?? null,
			amount: line.amount?.toString() ?? null,
			reason: line.reason
		}))
	};
	return {
		calculation_hash: yield* hash({
			snapshot,
			rule: order.sealed_commission,
			...(actual ? { actual } : {})
		}),
		amount,
		unresolved_lines,
		snapshot
	};
});
export const salesAnalysis = Effect.fnUntraced(function* (
	ctx: QueryCtx,
	range: {
		from?: string | null;
		to?: string | null;
	} = {}
) {
	if (range.from && range.to && range.from > range.to) yield* ctx.refuse('errors.report_range');
	const { sources, orders, users } = yield* ctx.read({
		sources: {
			collection: 'source_sales_lines',
			where: { active: { eq: true } },
			select: {
				order: true,
				seal_hash: true,
				business_on: true,
				net_amount: true,
				tax_amount: true,
				freight: true
			},
			all: true
		},
		orders: {
			collection: 'orders',
			where: {
				direction: { eq: 'sales' },
				seal_hash: { isNull: false }
			},
			select: { ...agreementSelect, owner: true, currency: true },
			all: true
		},
		users: { collection: 'sys_user', select: { name: true }, all: true }
	});
	const byOrder = new Map(orders.rows.map((o) => [o.id, o]));
	const byUser = new Map(users.rows.map((u) => [u.id, u.name]));
	const groups = new Map<
		string,
		{
			currency: Row<'orders'>['currency'];
			owner: Row<'orders'>['owner'];
			owner_name: string;
			period: Row<'source_sales_lines'>['business_on'];
			freight_treatment: Row<'orders'>['freight_treatment'];
			orderIds: Set<string>;
			source_lines: number;
			unresolved_lines: number;
			net: ReturnType<typeof d> | null;
			tax: ReturnType<typeof d> | null;
			total: ReturnType<typeof d> | null;
			freight: ReturnType<typeof d> | null;
		}
	>();
	for (const source of sources.rows) {
		if (
			(range.from && source.business_on < range.from) ||
			(range.to && source.business_on > range.to)
		)
			continue;
		const record = byOrder.get(source.order);
		const version = record ? agreement(record, source.seal_hash) : undefined;
		if (!record || !version) continue;
		const order = withAgreement(record, version);
		const period = source.business_on.slice(0, 7) + '-01';
		const key = `${order.currency}:${order.owner}:${period}:${order.freight_treatment}`;
		const group = groups.get(key) ?? {
			currency: order.currency,
			owner: order.owner,
			owner_name: byUser.get(order.owner) ?? '',
			period: PlainDate(period),
			freight_treatment: order.freight_treatment,
			orderIds: new Set<string>(),
			source_lines: 0,
			unresolved_lines: 0,
			net: d(0),
			tax: d(0),
			total: d(0),
			freight: d(0)
		};
		const net = source.net_amount,
			tax = source.tax_amount,
			freight = source.freight;
		const booked =
			net === null || (order.freight_treatment === 'deduct' && freight === null)
				? null
				: order.freight_treatment === 'deduct'
					? freight === null
						? null
						: net.minus(freight)
					: net;
		group.orderIds.add(order.id);
		group.source_lines++;
		if (net === null || tax === null || freight === null) group.unresolved_lines++;
		group.net = group.net === null || booked === null ? null : group.net.plus(booked);
		group.tax = group.tax === null || tax === null ? null : group.tax.plus(tax);
		group.freight = group.freight === null || freight === null ? null : group.freight.plus(freight);
		group.total =
			group.total === null || net === null || tax === null ? null : group.total.plus(net).plus(tax);
		groups.set(key, group);
	}
	return [...groups.values()]
		.map(({ orderIds, ...row }) => ({
			...row,
			orders: orderIds.size,
			net: row.net?.round(minorDigits(row.currency)) ?? null,
			tax: row.tax?.round(minorDigits(row.currency)) ?? null,
			total: row.total?.round(minorDigits(row.currency)) ?? null,
			freight: row.freight?.round(minorDigits(row.currency)) ?? null
		}))
		.sort(
			(a, b) =>
				b.period.localeCompare(a.period) ||
				a.currency.localeCompare(b.currency) ||
				a.owner.localeCompare(b.owner) ||
				a.freight_treatment.localeCompare(b.freight_treatment)
		);
});
export const salesDetail = Effect.fnUntraced(function* (
	ctx: QueryCtx,
	range: {
		from?: string | null;
		to?: string | null;
	}
) {
	if (range.from && range.to && range.from > range.to) yield* ctx.refuse('errors.report_range');
	const { sources, orders, lines, products, parties, users } = yield* ctx.read({
		sources: {
			collection: 'source_sales_lines',
			where: { active: { eq: true } },
			select: {
				order: true,
				order_line: true,
				seal_hash: true,
				reference: true,
				external_code: true,
				business_on: true,
				kind: true,
				unit: true,
				quantity: true,
				lot_number: true,
				unit_cost: true,
				net_amount: true,
				tax_amount: true,
				freight: true
			},
			all: true
		},
		orders: {
			collection: 'orders',
			where: {
				direction: { eq: 'sales' },
				seal_hash: { isNull: false }
			},
			select: { ...agreementSelect, number: true, party: true, owner: true, currency: true },
			all: true
		},
		lines: { collection: 'order_lines', select: { product: true }, all: true },
		products: { collection: 'products', select: { name: true }, all: true },
		parties: { collection: 'parties', select: { name: true }, all: true },
		users: { collection: 'sys_user', select: { name: true }, all: true }
	});
	const byOrder = new Map(orders.rows.map((row) => [row.id, row]));
	const byLine = new Map<string, (typeof lines.rows)[number]>(
		lines.rows.map((row) => [row.id, row])
	);
	const byProduct = new Map(products.rows.map((row) => [row.id, row.name]));
	const byParty = new Map(parties.rows.map((row) => [row.id, row.name]));
	const byUser = new Map(users.rows.map((row) => [row.id, row.name]));
	return sources.rows
		.flatMap((source) => {
			const record = byOrder.get(source.order);
			const version = record ? agreement(record, source.seal_hash) : undefined;
			const order = record && version ? withAgreement(record, version) : undefined;
			if (
				!order ||
				(range.from && source.business_on < range.from) ||
				(range.to && source.business_on > range.to)
			)
				return [];
			const capturedFloor = version?.snapshot.lines.find(
				(item) => item.id === source.order_line
			)?.floor_net;
			const line = byLine.get(source.order_line);
			const net = source.net_amount,
				tax = source.tax_amount,
				freight = source.freight;
			const booked =
				net === null || (order.freight_treatment === 'deduct' && freight === null)
					? null
					: order.freight_treatment === 'deduct'
						? freight === null
							? null
							: net.minus(freight)
						: net;
			return [
				{
					order: order.id,
					product:
						products.rows.find(
							(p) =>
								p.id ===
								version?.snapshot.lines.find((item) => item.id === source.order_line)?.product
						)?.id ?? null,
					party: order.party,
					owner: order.owner,
					sold_price: net === null ? null : net.div(source.quantity, 8),
					floor_net: capturedFloor ? d(capturedFloor) : null,
					order_number: order.number,
					party_name: byParty.get(order.party) ?? '',
					product_name:
						version?.snapshot.lines.find((item) => item.id === source.order_line)?.product_name ??
						(line ? (byProduct.get(line.product) ?? '') : ''),
					owner_name: byUser.get(order.owner) ?? '',
					reference: source.reference,
					external_code: source.external_code,
					business_on: source.business_on,
					kind: source.kind,
					unit: source.unit,
					quantity: source.quantity,
					lot_number: source.lot_number,
					cost:
						source.lot_number && source.unit_cost !== null
							? d(source.unit_cost).times(source.quantity).round(minorDigits(order.currency))
							: null,
					margin:
						source.lot_number && source.unit_cost !== null && booked !== null
							? booked
									.minus(d(source.unit_cost).times(source.quantity))
									.round(minorDigits(order.currency))
							: null,
					currency: order.currency,
					freight_treatment: order.freight_treatment,
					net: booked?.round(minorDigits(order.currency)) ?? null,
					tax,
					freight,
					total:
						net === null || tax === null ? null : net.plus(tax).round(minorDigits(order.currency))
				}
			];
		})
		.sort(
			(a, b) =>
				b.business_on.localeCompare(a.business_on) || a.external_code.localeCompare(b.external_code)
		);
});

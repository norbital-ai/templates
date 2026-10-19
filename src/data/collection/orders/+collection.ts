import { averageLotCost } from '../../../lib/lot-cost.js';
import {
	agreements,
	agreementSelect,
	confirmationBasis,
	operationalLines
} from '../../../lib/agreements.js';
import { agreementText, publishedTemplate, orderDocument } from '../../../lib/order-document.js';
import { COMMISSION_ENGINE } from '../../../lib/commission-expressions.js';
import { isMasked } from '../../../lib/access.js';
import { Refusal } from '@norbital-ai/bolt/errors';
import { collection, type QueryCtx, type TransformCtx, type Row } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import {
	contract,
	creditWarning,
	currentFloors,
	d,
	hash,
	price,
	snapshot,
	sum
} from '../../../lib/commercial.js';
import {
	commissionRows,
	reportQueries,
	reportSelect,
	salesAnalysis,
	salesDetail
} from '../../../lib/reports.js';
const terms = [
	'title',
	'direction',
	'party',
	'owner',
	'warehouse',
	'ordered_on',
	'currency',
	'tax_inclusive',
	'valid_from',
	'valid_until',
	'payment_terms',
	'delivery_terms',
	'notes'
] as const;
const c = collection('orders', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: terms,
			with: {
				lines: {
					create: { columns: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate'] }
				}
			}
		}
	},
	update: {
		input: {
			columns: [...terms, 'status', 'check_hash', 'reason']
		}
	},
	queries: {
		document_versions: {
			description: 'Approved contract versions available to preview or export.',
			input: { order: { kind: 'id', of: 'orders' } },
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: { version: { kind: 'int' }, approved_at: { kind: 'instant' } }
				}
			}
		},
		document_preview: {
			description: 'Render a quotation or retained agreement using a published document template.',
			input: {
				order: { kind: 'id', of: 'orders' },
				version: { kind: 'int', min: 1, optional: true },
				locale: { kind: 'enum', values: ['en', 'zh'], default: 'en' }
			},
			output: {
				kind: 'object',
				fields: {
					title: { kind: 'text' },
					html: { kind: 'text' },
					reference: { kind: 'text' },
					template_version: { kind: 'text' },
					contract_version: { kind: 'text' }
				}
			}
		},
		...reportQueries,
		confirmation_check: {
			description: 'Current checks and version-bound acknowledgment for this order.',
			input: { order: { kind: 'id', of: 'orders' }, revision: { kind: 'int', optional: true } },
			output: {
				kind: 'object',
				fields: {
					check_hash: { kind: 'text' },
					warning: { kind: 'bool' },
					unavailable: { kind: 'bool' },
					gross: { kind: 'text' },
					credit_as_of: { kind: 'text', optional: true },
					below_inventory_cost: { kind: 'list', of: { kind: 'text' } }
				}
			}
		},
		quotation_export: {
			description: 'Current saved commercial terms of this unfinalized order, without a seal.',
			input: { order: { kind: 'id', of: 'orders' }, revision: { kind: 'int', optional: true } },
			output: {
				kind: 'object',
				fields: { number: { kind: 'text' }, contract: { kind: 'text' }, revision: { kind: 'int' } }
			}
		},
		sealed_export: {
			description: 'Customer-facing commercial facts from this order seal only.',
			input: { order: { kind: 'id', of: 'orders' } },
			output: {
				kind: 'object',
				fields: {
					number: { kind: 'text' },
					contract: { kind: 'text' },
					seal_hash: { kind: 'text' }
				}
			}
		}
	},
	actions: {
		cancel: {
			description: 'Cancel the remaining order.',
			target: 'record',
			input: { reason: { kind: 'text' } }
		},
		close: {
			description: 'Close the remaining quantity.',
			target: 'record',
			input: { reason: { kind: 'text' } }
		},
		revise: {
			description: 'Draft the next contract version within this order.',
			target: 'record',
			input: { reason: { kind: 'text', optional: true } }
		}
	}
});
export default c;
type OrderInput = Parameters<Parameters<typeof c.transform>[0]>[0][number];
/** Price every new line against the same currency, ledger and floor catalogue. */
function priceLines(
	document: Pick<Row<'orders'>, 'currency' | 'tax_inclusive' | 'ordered_on'>,
	items: NonNullable<NonNullable<OrderInput['lines']>['create']>,
	products: readonly Row<'products'>[],
	floors: readonly Row<'pricing_floors'>[],
	ledger: Row<'parties'>['source'],
	group: string | undefined
) {
	const currency = document.currency,
		inclusive = document.tax_inclusive;
	const children = [];
	for (const line of items) {
		const product = products.find((p) => p.id === line.product);
		if (!product?.active) throw new Refusal({ message: 'errors.product_inactive' });
		if (product.source !== ledger) throw new Refusal({ message: 'errors.ledger_mismatch' });
		const quantity = d(line.quantity),
			unit_price = d(line.unit_price),
			discount_pct = d(line.discount_pct ?? 0),
			tax_rate = d(line.tax_rate ?? product.tax_rate);
		if (quantity.lte(0)) throw new Refusal({ message: 'errors.quantity_positive' });
		if (unit_price.lt(0)) throw new Refusal({ message: 'errors.price_required' });
		if (discount_pct.lt(0) || discount_pct.gt(100) || tax_rate.lt(0) || tax_rate.gt(100))
			throw new Refusal({ message: 'errors.percentage' });
		const floor = floors
			.filter(
				(f) =>
					f.product === product.id &&
					f.currency === currency &&
					f.group_code === group &&
					f.effective_on <= document.ordered_on &&
					d(f.minimum_quantity).lte(quantity)
			)
			.sort(
				(a, b) =>
					b.effective_on.localeCompare(a.effective_on) ||
					d(b.minimum_quantity).cmp(a.minimum_quantity)
			)[0];
		if (floor && floor.unit !== product.unit)
			throw new Refusal({ message: 'errors.unit_mismatch' });
		const floor_net = floor
			? floor.tax_inclusive
				? d(floor.floor_price).div(d(1).plus(d(floor.tax_rate).div(100, 6)), 8)
				: floor.floor_price
			: null;
		children.push({
			...line,
			product_code: product.external_code,
			product_name: product.name,
			unit: product.unit,
			quantity,
			unit_price,
			discount_pct,
			tax_rate,
			...price(
				{ currency, tax_inclusive: inclusive },
				{ quantity, unit_price, discount_pct, tax_rate }
			),
			floor_net,
			floor_on: floor?.effective_on ?? null,
			commission_factor: product.commission_factor,
			commission_basis_unit: product.commission_basis_unit
		});
	}
	return children;
}
c.transform(function* (inputs, ctx: TransformCtx<'orders'>) {
	const ids = ctx.existing.flatMap((o) => (o ? [o.id] : []));
	const {
		parties,
		lines,
		settings,
		templates,
		products,
		transactions,
		salesReceipts,
		purchaseReceipts,
		sourcePayments,
		rules,
		floors,
		warehouses,
		references
	} = yield* ctx.db.read({
		references: {
			collection: 'orders',
			where: { id: { in: ids } },
			select: { number: true },
			all: true
		},
		rules: {
			collection: 'commission_rules',
			where: { active: { eq: true }, code: { eq: 'default' } },
			all: true
		},
		parties: {
			collection: 'parties',
			where: { id: { in: inputs.map((v, i) => v.party ?? ctx.existing[i]!.party) } },
			all: true
		},
		lines: { collection: 'order_lines', where: { order: { in: ids } }, all: true },
		templates: {
			collection: 'document_templates',
			where: { status: { eq: 'published' } },
			all: true
		},
		settings: {
			collection: 'commercial_settings',
			where: { code: { eq: 'default' } },
			limit: 1
		},
		products: {
			collection: 'products',
			where: {
				or: [
					{ id: { in: { member: 'lines', field: 'product' } } },
					{ id: { in: inputs.flatMap((v) => v.lines?.create?.map((l) => l.product) ?? []) } }
				]
			},
			all: true
		},
		floors: {
			collection: 'pricing_floors',
			where: { product: { in: { member: 'products', field: 'id' } } },
			all: true
		},
		warehouses: {
			collection: 'warehouses',
			where: {
				id: { in: inputs.flatMap((v, i) => v.warehouse ?? ctx.existing[i]?.warehouse ?? []) }
			},
			all: true
		},
		transactions: { collection: 'transactions', where: { order: { in: ids } }, all: true },
		salesReceipts: { collection: 'ext_sales_orders', where: { order: { in: ids } }, all: true },
		purchaseReceipts: {
			collection: 'ext_purchase_orders',
			where: { order: { in: ids } },
			all: true
		},
		sourcePayments: { collection: 'source_payments', where: { order: { in: ids } }, all: true }
	});
	const config = settings.rows[0];
	const template = publishedTemplate(templates.rows, 'contract');
	const transformed = [];
	for (const [i, input] of inputs.entries()) {
		if (input.closure_snapshot !== undefined) return yield* ctx.refuse('errors.order_sealed');
		const old = ctx.existing[i];
		if (old && input.direction !== undefined && input.direction !== old.direction)
			return yield* ctx.refuse('errors.line_basis_locked', { field: 'direction' });
		const validFrom = input.valid_from !== undefined ? input.valid_from : old?.valid_from;
		const validUntil = input.valid_until !== undefined ? input.valid_until : old?.valid_until;
		if (validFrom && validUntil && validUntil < validFrom)
			return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
		const party = parties.rows.find((p) => p.id === (input.party ?? old?.party));
		const next = input.status ?? old?.status ?? 'draft';
		const createOrder = function* () {
			if (!party || !party.active)
				return yield* ctx.refuse('errors.party_inactive', { field: 'party' });
			const direction = input.direction ?? old?.direction;
			if (party.kind !== 'both' && party.kind !== (direction === 'sales' ? 'customer' : 'supplier'))
				return yield* ctx.refuse('errors.party_direction', { field: 'party' });
			const ledger = party.source;
			const warehouse = warehouses.rows.find(
				(w) => w.id === (input.warehouse !== undefined ? input.warehouse : old?.warehouse)
			);
			if (warehouse && warehouse.source !== ledger)
				return yield* ctx.refuse('errors.ledger_mismatch', { field: 'warehouse' });
			if (!input.currency) return yield* ctx.refuse('errors.currency_price');
			const currency = input.currency;
			const inclusive = input.tax_inclusive ?? false;
			const group = warehouse?.group_code;
			const children = yield* Effect.try({
				try: () =>
					priceLines(
						{
							currency,
							tax_inclusive: inclusive,
							ordered_on: PlainDate(input.ordered_on ?? ctx.today)
						},
						input.lines?.create ?? [],
						products.rows,
						floors.rows,
						ledger,
						group
					),
				catch: (cause) =>
					cause instanceof Refusal ? cause : new Refusal({ message: String(cause) })
			});
			return {
				...input,
				ledger,
				party_name: party.name,
				...(input.lines?.create ? { lines: { create: children } } : {})
			};
		};
		if (old === undefined) {
			transformed.push(yield* createOrder());
			continue;
		}
		const revise = function* () {
			if (
				!old.sealed_snapshot ||
				!old.seal_hash ||
				!old.sealed_contract ||
				!old.sealed_at ||
				!old.sealed_by
			)
				return yield* ctx.refuse('errors.order_not_confirmed');
			if (!ctx.admin && !ctx.policies.includes('manager'))
				return yield* ctx.refuse('errors.amendment_authority');
			if (terms.some((k) => input[k] !== undefined && input[k] !== old[k]))
				return yield* ctx.refuse('errors.save_before_confirm');
			return {
				...input,
				contract_versions: agreements(old),
				operational_contracts: agreements(old).map((v) => ({
					seal_hash: v.seal_hash,
					lines: operationalLines(v.snapshot, lines.rows)
				})),
				check_hash: null
			};
		};
		const closeOrder = function* () {
			if (next === old.status) return yield* ctx.refuse('errors.order_sealed');
			if (!input.reason?.trim())
				return yield* ctx.refuse('errors.reason_required', { field: 'reason' });
			const closure_snapshot = lines.rows
				.filter((l) => l.order === old.id)
				.map((line) => {
					const fulfilled = sum([
						...transactions.rows
							.filter(
								(row) => row.order === old.id && row.kind === 'delivery' && row.status === 'issued'
							)
							.flatMap((row) =>
								(row.items ?? [])
									.filter((item) => item.order_line_id === line.id)
									.map((item) => item.quantity)
							)
					]);
					return {
						order_line: line.id,
						product_name: line.product_name,
						unit: line.unit,
						ordered: d(line.quantity).toString(),
						fulfilled: fulfilled.toString(),
						released: d(line.quantity).minus(fulfilled).toString()
					};
				})
				.sort((a, b) => a.order_line.localeCompare(b.order_line));
			const external = [...salesReceipts.rows, ...purchaseReceipts.rows].filter(
				(row) => row.order === old.id && row.agreement_hash === old.seal_hash
			);
			if (
				next === 'cancelled' &&
				(transactions.rows.some((row) => row.order === old.id && row.status === 'issued') ||
					sourcePayments.rows.some((row) => row.order === old.id && row.active))
			)
				return yield* ctx.refuse('errors.cancel_obligations');
			if (
				(next === 'cancelled' || closure_snapshot.some((line) => d(line.released).gt(0))) &&
				external.some((row) => row.status !== 'void')
			)
				return yield* ctx.refuse('errors.remote_close_required');
			if (next === 'closed') return { ...input, closure_snapshot };
			return next === 'cancelled' ? { ...input, closure_snapshot } : input;
		};
		const cancelOrder = function* () {
			if (!input.reason?.trim())
				return yield* ctx.refuse('errors.reason_required', { field: 'reason' });
			return input;
		};
		const editOrder = function* () {
			if (!party || !party.active)
				return yield* ctx.refuse('errors.party_inactive', { field: 'party' });
			const direction = input.direction ?? old?.direction;
			if (party.kind !== 'both' && party.kind !== (direction === 'sales' ? 'customer' : 'supplier'))
				return yield* ctx.refuse('errors.party_direction', { field: 'party' });
			const ledger = party.source;
			const warehouse = warehouses.rows.find(
				(w) => w.id === (input.warehouse !== undefined ? input.warehouse : old?.warehouse)
			);
			if (warehouse && warehouse.source !== ledger)
				return yield* ctx.refuse('errors.ledger_mismatch', { field: 'warehouse' });
			const own = lines.rows.filter((l) => l.order === old.id);
			if (
				old.contract_versions?.length &&
				(['party', 'owner', 'warehouse', 'currency', 'direction', 'ordered_on'] as const).some(
					(k) => input[k] !== undefined && input[k] !== old[k]
				)
			)
				return yield* ctx.refuse('errors.line_basis_locked');
			if (
				own.length &&
				(
					['party', 'warehouse', 'currency', 'tax_inclusive', 'direction', 'ordered_on'] as const
				).some((k) => input[k] !== undefined && input[k] !== old[k])
			)
				return yield* ctx.refuse('errors.line_basis_locked');
			return { ...input, ledger, check_hash: null };
		};
		const confirmOrder = function* () {
			if (!party || !party.active)
				return yield* ctx.refuse('errors.party_inactive', { field: 'party' });
			const direction = input.direction ?? old?.direction;
			if (party.kind !== 'both' && party.kind !== (direction === 'sales' ? 'customer' : 'supplier'))
				return yield* ctx.refuse('errors.party_direction', { field: 'party' });
			const ledger = party.source;
			const warehouse = warehouses.rows.find(
				(w) => w.id === (input.warehouse !== undefined ? input.warehouse : old?.warehouse)
			);
			if (warehouse && warehouse.source !== ledger)
				return yield* ctx.refuse('errors.ledger_mismatch', { field: 'warehouse' });
			const own = lines.rows.filter((l) => l.order === old.id);
			if (terms.some((k) => input[k] !== undefined && input[k] !== old[k]))
				return yield* ctx.refuse('errors.save_before_confirm');
			if (!config || !template) return yield* ctx.refuse('errors.configuration_missing');
			if (!own.length) return yield* ctx.refuse('errors.lines_required');
			if (old.warehouse && !warehouses.rows.find((w) => w.id === old.warehouse)?.active)
				return yield* ctx.refuse('errors.warehouse_inactive');
			if (!old.payment_terms.trim())
				return yield* ctx.refuse('errors.payment_terms', { field: 'payment_terms' });
			if (own.some((l) => !products.rows.find((p) => p.id === l.product)?.active))
				return yield* ctx.refuse('errors.product_inactive');
			const basis = currentFloors(
				old,
				own,
				floors.rows,
				warehouses.rows.find((w) => w.id === old.warehouse)?.group_code
			);
			const sealed = {
				...snapshot(old, party, basis, template.version),
				document_title: template.title
			};
			const check_hash = yield* hash(confirmationBasis(old.revision, sealed, config, template));
			if (input.check_hash !== check_hash) return yield* ctx.refuse('errors.check_changed');
			if (
				config.require_floor &&
				old.direction === 'sales' &&
				basis.some((l) => l.floor_net === null)
			)
				return yield* ctx.refuse('errors.floor_missing');
			const rule = rules.rows
				.filter((r) => r.currency === old.currency && r.effective_on <= old.ordered_on)
				.sort((a, b) => b.effective_on.localeCompare(a.effective_on))[0];
			const sealed_commission = rule
				? {
						rule_id: rule.id,
						engine_version: COMMISSION_ENGINE,
						eligibility_expression: rule.eligibility_expression,
						amount_expression: rule.amount_expression,
						parameters: rule.parameters ?? [],
						effective_on: rule.effective_on,
						currency: rule.currency,
						basis_unit: rule.basis_unit ?? '',
						fixed_rate: d(rule.fixed_rate).toString(),
						spread_pct: d(rule.spread_pct).toString()
					}
				: null;
			const reference = references.rows.find((o) => o.id === old.id)?.number;
			if (!reference) return yield* ctx.refuse('errors.order_reference_missing');
			const contract_version = (old.contract_versions?.length ?? 0) + 1;
			const sealed_contract = agreementText(template, sealed, reference);
			const seal_hash = yield* hash({
				sealed,
				contract: sealed_contract,
				version: contract_version
			});
			return {
				...input,
				party_name: party.name,
				sealed_at: ctx.now,
				sealed_by: ctx.actor.kind === 'member' ? ctx.actor.id : ctx.actor.kind,
				contract_version,
				sealed_snapshot: sealed,
				sealed_commission,
				freight_treatment: config.freight_treatment,
				sealed_contract,
				sealed_contract_version: sealed.contract_version,
				seal_hash,
				operational_contracts: [
					...agreements(old).map((v) => ({
						seal_hash: v.seal_hash,
						lines: operationalLines(v.snapshot, lines.rows)
					})),
					{
						seal_hash,
						lines: operationalLines(sealed, lines.rows)
					}
				]
			};
		};
		const sealed = function* () {
			return yield* ctx.refuse('errors.order_sealed');
		};
		const invalid = function* () {
			return yield* ctx.refuse('errors.transition');
		};
		type Status = Row<'orders'>['status'];
		type Handler =
			| typeof revise
			| typeof closeOrder
			| typeof cancelOrder
			| typeof editOrder
			| typeof confirmOrder
			| typeof sealed;
		const TRANSITIONS: Record<`${Status}->${Status}`, Handler> = {
			'draft->draft': editOrder,
			'draft->confirmed': confirmOrder,
			'draft->closed': invalid,
			'draft->cancelled': cancelOrder,
			'confirmed->draft': revise,
			'confirmed->confirmed': sealed,
			'confirmed->closed': closeOrder,
			'confirmed->cancelled': closeOrder,
			'closed->draft': closeOrder,
			'closed->confirmed': closeOrder,
			'closed->closed': sealed,
			'closed->cancelled': closeOrder,
			'cancelled->draft': closeOrder,
			'cancelled->confirmed': closeOrder,
			'cancelled->closed': closeOrder,
			'cancelled->cancelled': sealed
		};
		transformed.push(yield* TRANSITIONS[`${old.status}->${next}`]());
	}
	return transformed;
});
c.query('confirmation_check', function* ({ order, revision }, ctx: QueryCtx) {
	const { orders, lines, credits, settings, templates, parties, floors, warehouses, stock } =
		yield* ctx.read({
			stock: { collection: 'stock_snapshots', all: true },
			floors: { collection: 'pricing_floors', all: true },
			warehouses: { collection: 'warehouses', all: true },
			orders: { collection: 'orders', id: order },
			lines: { collection: 'order_lines', where: { order: { eq: order } }, all: true },
			credits: {
				collection: 'credit_snapshots',
				where: { party: { is: { orders: { some: { id: { eq: order } } } } } },
				all: true
			},
			parties: {
				collection: 'parties',
				where: { orders: { some: { id: { eq: order } } } },
				limit: 1
			},
			templates: {
				collection: 'document_templates',
				where: { status: { eq: 'published' } },
				all: true
			},
			settings: { collection: 'commercial_settings', where: { code: { eq: 'default' } }, limit: 1 }
		});
	const doc = orders;
	if (doc && isMasked(doc.currency)) yield* ctx.refuse('errors.commercial_access');
	const party = parties.rows[0];
	const config = settings.rows[0];
	const template = publishedTemplate(templates.rows, 'contract');
	if (!doc || !party || !config || !template)
		return yield* ctx.refuse('errors.configuration_missing');
	if (revision !== undefined && revision !== doc.revision)
		yield* ctx.refuse('errors.check_changed');
	const credit = credits.rows
		.filter((v) => v.currency === doc.currency)
		.sort((a, b) => b.as_of.localeCompare(a.as_of))[0];
	const sealed = {
		...snapshot(
			doc,
			party,
			currentFloors(
				doc,
				lines.rows,
				floors.rows,
				warehouses.rows.find((w) => w.id === doc.warehouse)?.group_code
			),
			template.version
		),
		document_title: template.title
	};
	return {
		check_hash: yield* hash(confirmationBasis(doc.revision, sealed, config, template)),
		...creditWarning(
			doc,
			sum(lines.rows.map((l) => l.total)),
			credit,
			ctx.now,
			config.credit_fresh_minutes
		),
		gross: sealed.total,
		credit_as_of: credit?.as_of ?? null,
		below_inventory_cost:
			doc.direction === 'sales'
				? lines.rows
						.filter((line) => {
							const average = averageLotCost(stock.rows, line.product, line.unit, doc.currency);
							return average !== null && price(doc, line).net.div(line.quantity, 8).lt(average);
						})
						.map((line) => line.product_name)
				: []
	};
});
c.query('sealed_export', function* ({ order }, ctx: QueryCtx) {
	const doc = yield* ctx.get('orders', order);
	if (!doc?.sealed_contract || !doc.seal_hash)
		return yield* ctx.refuse('errors.order_not_confirmed');
	if (isMasked(doc.sealed_contract)) return yield* ctx.refuse('errors.agreement_access');
	return { number: doc.number, contract: doc.sealed_contract, seal_hash: doc.seal_hash };
});
c.action('revise', function* (input, ctx) {
	yield* ctx.act('orders.update', {
		target: ctx.target.id,
		set: { status: 'draft', reason: input.reason ?? '' }
	});
});
for (const operation of ['cancel', 'close'] as const)
	c.action(operation, function* (input, ctx) {
		const old = ctx.target;
		if (!input.reason.trim()) yield* ctx.refuse('errors.reason_required');
		yield* ctx.act('orders.update', {
			target: old.id,
			set: { status: operation === 'close' ? 'closed' : 'cancelled', reason: input.reason }
		});
	});
c.query('sales_analysis', function* (input, ctx) {
	return yield* salesAnalysis(ctx, input);
});
c.query('commission', function* (input, ctx) {
	const orders = yield* ctx.read('orders', {
		where: {
			...(input.order ? { id: { eq: input.order } } : {}),
			direction: { eq: 'sales' },
			status: { in: ['draft', 'confirmed', 'closed'] }
		},
		select: reportSelect,
		all: true
	});
	const users = yield* ctx.read('sys_user', { select: { name: true }, all: true });
	return commissionRows(orders.rows, input.version).map((row) => ({
		...row,
		owner_name: users.rows.find((u) => u.id === row.owner)?.name ?? ''
	}));
});
c.query('ar_aging', function* (input, ctx: QueryCtx) {
	const as_of = input.as_of ?? ctx.today;
	if (as_of > ctx.today) yield* ctx.refuse('errors.report_future');
	const { invoices, sourcePayments, orders } = yield* ctx.read({
		invoices: {
			collection: 'transactions',
			where: { kind: { eq: 'invoice' }, status: { eq: 'issued' }, issued_on: { lte: as_of } },
			all: true
		},
		sourcePayments: {
			collection: 'source_payments',
			where: { settled_on: { lte: as_of }, active: { eq: true } },
			all: true
		},
		orders: {
			collection: 'orders',
			where: { id: { in: { member: 'invoices', field: 'order' } } },
			all: true
		}
	});
	return invoices.rows.flatMap((invoice) => {
		const order = orders.rows.find((o) => o.id === invoice.order);
		if (!order) return [];
		const paid = sum(
			sourcePayments.rows.filter((p) => p.invoice === invoice.id).map((p) => p.amount)
		);
		if (invoice.total === null) return [];
		const raw = d(invoice.total).minus(paid);
		const balance = raw.lt(0) ? d(0) : raw;
		const overpaid = raw.lt(0) ? d(0).minus(raw) : d(0);
		if (balance.eq(0) && overpaid.eq(0)) return [];
		const days = invoice.due_on
			? Math.floor(
					(Date.parse(as_of + 'T00:00:00Z') - Date.parse(invoice.due_on + 'T00:00:00Z')) / 86400000
				)
			: null;
		const thresholds = [
			[0, 'not_due'],
			[30, '1_30'],
			[60, '31_60'],
			[90, '61_90'],
			[Infinity, 'over_90']
		] as const;
		const bucket =
			days === null
				? 'no_due_date'
				: (thresholds.find(([threshold]) => days <= threshold)?.[1] ?? 'over_90');
		return [
			{
				order: order.id,
				order_number: order.number,
				party_name: order.party_name ?? '',
				invoice: invoice.id,
				invoice_number: invoice.reference,
				currency: invoice.currency,
				due_on: invoice.due_on,
				as_of,
				balance,
				overpaid,
				bucket
			}
		];
	});
});
c.query('sales_detail', function* (input, ctx) {
	return yield* salesDetail(ctx, input);
});
c.query('quotation_export', function* ({ order, revision }, ctx: QueryCtx) {
	const { doc, lines, parties, settings, templates } = yield* ctx.read({
		doc: { collection: 'orders', id: order },
		lines: { collection: 'order_lines', where: { order: { eq: order } }, all: true },
		parties: {
			collection: 'parties',
			where: { orders: { some: { id: { eq: order } } } },
			limit: 1
		},
		templates: {
			collection: 'document_templates',
			where: { status: { eq: 'published' } },
			all: true
		},
		settings: { collection: 'commercial_settings', where: { code: { eq: 'default' } }, limit: 1 }
	});
	const party = parties.rows[0];
	const config = settings.rows[0];
	const template = publishedTemplate(templates.rows, 'contract');
	if (!doc || !party || !config || !template)
		return yield* ctx.refuse('errors.configuration_missing');
	if (doc.status !== 'draft') yield* ctx.refuse('errors.order_sealed');
	if (isMasked(doc.currency)) yield* ctx.refuse('errors.commercial_access');
	if (revision !== undefined && revision !== doc.revision)
		yield* ctx.refuse('errors.check_changed');
	if (!lines.rows.length) yield* ctx.refuse('errors.lines_required');
	const current = snapshot(doc, party, lines.rows, template.version);
	return {
		number: doc.number,
		revision: doc.revision,
		contract: agreementText(template, current, doc.number)
	};
});
c.query('document_versions', function* ({ order }, ctx) {
	const result = yield* ctx.read('orders', {
		where: { id: { eq: order } },
		select: { ...agreementSelect, currency: true },
		limit: 1
	});
	const row = result.rows[0];
	if (!row || isMasked(row.currency)) return yield* ctx.refuse('errors.agreement_access');
	return agreements(row).map((v) => ({ version: v.version, approved_at: v.approved_at }));
});
c.query('document_preview', function* (input, ctx) {
	return yield* orderDocument(ctx, input);
});

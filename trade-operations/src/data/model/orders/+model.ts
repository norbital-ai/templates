import { orderTrade, type OrderTrade } from '../../../lib/order-trade.js';
import { lineDeletes } from '../../../lib/order-review.js';
import { logisticsDocument, logisticsLine, logisticsOrder } from '../../../lib/logistics.js';
import { commissionRule } from '../../../lib/commission-expressions.js';
import { kingdeeWriteTarget } from '../../../integration/kingdee/configuration.js';
import { model, type Id, type Row, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { floorFor, floorNetInUnit, quoteBelowFloor } from '../../../lib/commercial.js';
import {
	printValueKind,
	orderedPrintValues,
	validPrintValues
} from '../../../lib/print-details.js';
const commissionShape = {
	kind: 'object',
	fields: {
		engine_version: { kind: 'text', optional: true },
		eligibility_expression: { kind: 'text', optional: true },
		amount_expression: { kind: 'text', optional: true },
		parameters: {
			kind: 'object',
			fields: { name: { kind: 'text' }, value: { kind: 'text' } },
			optional: true,
			many: true
		},
		rule_id: {
			kind: 'text'
		},
		effective_on: {
			kind: 'text'
		},
		currency: {
			kind: 'text'
		},
		basis_unit: {
			kind: 'text'
		},
		fixed_rate: {
			kind: 'text'
		},
		spread_pct: {
			kind: 'text'
		}
	}
} as const;
const terms = [
	'title',
	'direction',
	'party',
	'owner',
	'warehouse',
	'ordered_on',
	'print_values',
	'currency',
	'tax_inclusive',
	'valid_from',
	'valid_until',
	'payment_terms',
	'trade',
	'packaging',
	'payment_method',
	'buyer_contact',
	'customer_po_no',
	'delivery_address',
	'logistics_handler',
	'notes'
] as const;
// what Kingdee keeps on a synced order's header: changed there, read back here
/** An active member of the Logistics team, the only people an order's logistics handler may name. */
const logisticsStaff = (
	users: readonly { readonly id: string; readonly team: string | null; readonly active: boolean }[],
	id: string
) => users.some((u) => u.id === id && u.team === 'logistics' && u.active);
const kingdeeHeader = ['party', 'currency', 'ordered_on', 'owner', 'payment_terms'] as const;
// what a line is priced against: a change re-prices a draft's lines (and a synced order's, which Kingdee then takes)
const pricingBasis = ['party', 'warehouse', 'currency', 'tax_inclusive', 'ordered_on'] as const;
/** The party and warehouse an order names must be active, match its direction, and share the party's ledger. */
const admitParty = Effect.fnUntraced(function* <
	P extends Pick<StoredRow<'parties'>, 'active' | 'kind' | 'source' | 'name' | 'address'>
>(
	ctx: WriteCtx<'orders'>,
	party: P | undefined,
	direction: Row<'orders'>['direction'],
	warehouse: Pick<StoredRow<'warehouses'>, 'source'> | undefined
) {
	if (!party || !party.active)
		return yield* ctx.refuse('errors.party_inactive', { field: 'party' });
	if (party.kind !== 'both' && party.kind !== (direction === 'sales' ? 'customer' : 'supplier'))
		return yield* ctx.refuse('errors.party_direction', { field: 'party' });
	if (warehouse && warehouse.source !== party.source)
		return yield* ctx.refuse('errors.ledger_mismatch', { field: 'warehouse' });
	return party;
});
type Contact = Pick<StoredRow<'contacts'>, 'id' | 'party' | 'primary'>;
/** The contact an order's buyer is: one of its party's, by default the party's Kingdee contact. */
const buyerOf = (contacts: readonly Contact[], party: Id<'parties'>) =>
	contacts.find((c) => c.party === party && c.primary)?.id ?? null;
/** Follow the previous party or warehouse default until the writer supplies their own place. */
function defaultPlaces(
	direction: Row<'orders'>['direction'],
	trade: OrderTrade,
	address: string | null | undefined,
	set: { trade?: OrderTrade; delivery_address?: string | null },
	before: { warehouse?: string | null | undefined; address?: string | null | undefined },
	after: { warehouse?: string | null | undefined; address?: string | null | undefined }
) {
	const site =
		trade.kind === 'domestic'
			? 'delivery_place'
			: direction === 'sales'
				? 'place_of_loading'
				: 'place_of_delivery';
	const source = trade.kind === 'domestic' && direction === 'sales' ? 'address' : 'warehouse';
	const current =
		trade.kind === 'domestic'
			? trade.delivery_place
			: direction === 'sales'
				? trade.place_of_loading
				: trade.place_of_delivery;
	return {
		...(after[source] !== undefined &&
		!(set.trade && Object.hasOwn(set.trade, site) && current == null) &&
		(!current || current === before[source])
			? { trade: { ...trade, [site]: after[source] } }
			: {}),
		...(direction === 'sales' &&
		set.delivery_address === undefined &&
		after.address !== undefined &&
		(!address || address === before.address)
			? { delivery_address: after.address }
			: {})
	};
}

export default model('orders', {
	description: 'orders',
	record_label: 'record.number',
	fields: {
		freight_treatment: { kind: 'enum', values: ['deduct', 'include'], default: 'deduct' },
		number: {
			kind: 'seq',
			pattern: 'TR-{yyyy}-{0000}'
		},
		title: {
			kind: 'text'
		},
		direction: {
			kind: 'enum',
			values: ['sales', 'purchasing']
		},
		party: { kind: 'ref', to: 'parties', inverse: 'orders' },
		owner: { kind: 'ref', to: 'sys_user', default: { var: 'actor.id' } },
		warehouse: { kind: 'ref', to: 'warehouses', optional: true },
		ledger: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		source_order_key: { kind: 'text', optional: true, hidden: true },
		archived: { kind: 'bool', default: false },
		// `confirmed`: synced to Kingdee, once; from then on the order and its SO or PO stay in step
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['confirmed'] },
				confirmed: {}
			}
		},
		ordered_on: {
			kind: 'date',
			default: { var: 'today' }
		},
		currency: {
			kind: 'currency'
		},
		tax_inclusive: {
			kind: 'bool',
			default: false
		},
		valid_from: { kind: 'date', optional: true },
		valid_until: { kind: 'date', optional: true },
		// Kingdee's settlement method (结算方式), written to the SO or PO
		payment_terms: {
			kind: 'ref',
			to: 'settlements',
			optional: true,
			where: { active: { eq: true } }
		},
		trade: { kind: 'json', shape: orderTrade, default: { kind: 'domestic' } },
		packaging: { kind: 'text', optional: true },
		payment_method: { kind: 'enum', values: ['wire_transfer', 'acceptance_bill'], optional: true },
		// one of the party's contacts: its name, phone and email print on the documents
		buyer_contact: { kind: 'ref', to: 'contacts', optional: true },
		// the buyer's own reference for this order (需方合同号)
		customer_po_no: { kind: 'text', optional: true },
		delivery_address: { kind: 'text', optional: true },
		// the seller's own logistics staff, as SalesBridge assigns them; it prints in the contract's signature block
		logistics_handler: {
			kind: 'ref',
			to: 'sys_user',
			optional: true,
			where: { team: { eq: 'logistics' }, active: { eq: true } }
		},
		notes: {
			kind: 'text',
			optional: true
		},
		print_values: printValueKind,
		party_name: {
			kind: 'text',
			optional: true
		},
		net: {
			kind: 'sum',
			of: 'lines.net'
		},
		tax: {
			kind: 'sum',
			of: 'lines.tax'
		},
		total: {
			kind: 'sum',
			of: 'lines.total'
		},
		line_count: {
			kind: 'count',
			of: 'lines'
		},
		// the commission rule in force on the order date, stamped when it syncs: a later rule edit leaves it be
		commission: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: commissionShape,
			was: 'sealed_commission'
		},
		// the Kingdee account set and branch a synced order is written to
		write_target: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: { kind: 'object', fields: { account: { kind: 'text' }, branch: { kind: 'text' } } }
		},
		// the Kingdee SO as last read
		kingdee: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				fields: {
					fid: { kind: 'text' },
					reference: { kind: 'text' },
					version: { kind: 'text' },
					status: { kind: 'enum', values: ['draft', 'issued', 'void'] },
					closed: { kind: 'bool' },
					exchange_rate: { kind: 'text' }
				}
			}
		}
	},
	outputs: {
		default: {
			fields: 'all',
			party: { fields: 'all' },
			ledger: { fields: ['active', 'status'] },
			payment_terms: { fields: ['code', 'name'] },
			buyer_contact: { fields: ['name', 'phone', 'email'] },
			// documents print each product's brand and origin
			lines: { fields: 'all', product: { fields: ['brand', 'brand_en', 'producing_area'] } },
			transactions: { fields: 'all' }
		},
		logistics: {
			fields: logisticsOrder,
			party: { fields: 'all' },
			lines: { fields: logisticsLine },
			transactions: { fields: logisticsDocument },
			warehouse: { fields: ['name'] }
		}
	},
	constraints: {
		natural_key: { unique: ['source_order_key'], import_key: true }
	},
	indexes: { search: { text: ['number', 'title', 'party_name'] } },
	create: {
		// each line prices itself in its own `create.transform`, after this one
		fields: [
			...terms,
			'source_order_key',
			'status',
			'ledger',
			'write_target',
			'kingdee',
			'party_name'
		],
		lines: {
			fields: [
				'product',
				'quantity',
				'unit_price',
				'discount_pct',
				'tax_rate',
				'print_values',
				'line_key',
				'source_entry_id'
			]
		},
		filled: { fields: ['status', 'ledger'], lines: { fields: ['unit_price', 'tax_rate'] } },
		transform: function* (changes, ctx) {
			if (ctx.approving) return changes.map(({ set }) => set);
			// the Kingdee read brings an SO created there in as it stands
			if (ctx.actor.kind === 'system' && 'sync' in ctx.actor.by)
				return changes.map(({ set }) => set);
			if (
				changes.some(
					({ after, set }) =>
						after.status !== 'draft' ||
						set.write_target ||
						set.kingdee ||
						set.ledger ||
						set.party_name
				)
			)
				return yield* ctx.refuse('errors.save_before_confirm');
			const rows = changes.map(({ after }) => after);
			const partyIds = rows.map((r) => r.party);
			const {
				parties,
				warehouses,
				contacts,
				sys_user: handlers
			} = yield* ctx.query({
				parties: { where: { id: { in: partyIds } } },
				sys_user: {
					where: { id: { in: rows.flatMap((r) => r.logistics_handler ?? []) } },
					fields: ['team', 'active']
				},
				warehouses: { where: { id: { in: rows.flatMap((r) => r.warehouse ?? []) } } },
				contacts: {
					where: { party: { in: partyIds } },
					fields: ['party', 'primary']
				}
			});
			const out = [];
			for (const { after: row, set } of changes) {
				if (row.print_values && !validPrintValues(row.print_values))
					return yield* ctx.refuse('errors.print_values_invalid', { field: 'print_values' });
				if (row.valid_from && row.valid_until && row.valid_until < row.valid_from)
					return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
				// Kingdee takes no order without its settlement method, so an order starts with one
				if (!row.payment_terms)
					return yield* ctx.refuse('errors.payment_terms_required', { field: 'payment_terms' });
				if (row.logistics_handler && !logisticsStaff(handlers.rows, row.logistics_handler))
					return yield* ctx.refuse('errors.logistics_handler', { field: 'logistics_handler' });
				const warehouse = warehouses.rows.find((w) => w.id === row.warehouse);
				const party = yield* admitParty(
					ctx,
					parties.rows.find((p) => p.id === row.party),
					row.direction,
					warehouse
				);
				if (
					row.buyer_contact &&
					!contacts.rows.some((c) => c.id === row.buyer_contact && c.party === row.party)
				)
					return yield* ctx.refuse('errors.contact_party', { field: 'buyer_contact' });
				out.push({
					...set,
					...(row.print_values ? { print_values: orderedPrintValues(row.print_values) } : {}),
					...defaultPlaces(
						row.direction,
						row.trade ?? { kind: 'domestic' },
						row.delivery_address,
						set,
						{},
						{
							warehouse: warehouse?.name,
							address: party.address
						}
					),
					...(set.buyer_contact === undefined
						? { buyer_contact: buyerOf(contacts.rows, row.party) }
						: {}),
					source_order_key: row.source_order_key ?? crypto.randomUUID(),
					ledger: party.source,
					party_name: party.name
				});
			}
			return out;
		}
	},
	update: {
		// the last three are the transform's own; the Kingdee read writes them for an SO that moves customer or arrives
		fields: [
			...terms,
			'status',
			'archived',
			'source_order_key',
			'kingdee',
			'party_name',
			'commission',
			'freight_treatment'
		],
		lines: {
			fields: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate', 'print_values']
		},
		transform: function* (changes, ctx) {
			if (ctx.approving) return changes.map(({ set }) => set);
			// the Kingdee read writes what the SO holds
			if (ctx.actor.kind === 'system' && 'sync' in ctx.actor.by)
				return changes.map(({ set }) => set);
			if (
				changes.some(
					({ before }) =>
						before.status === 'draft' && before.source_order_key?.startsWith('kingdee:')
				)
			)
				return yield* ctx.refuse('errors.evidence_sealed');
			const ids = changes.map((c) => c.before.id);
			const partyIds = [
				...new Set(changes.flatMap(({ before, after }) => [before.party, after.party]))
			];
			const {
				parties,
				order_lines: lines,
				commercial_settings: settings,
				commission_rules: rules,
				warehouses,
				contacts,
				sys_user: handlers
			} = yield* ctx.query({
				sys_user: {
					where: { id: { in: changes.flatMap(({ set }) => set.logistics_handler ?? []) } },
					fields: ['team', 'active']
				},
				commission_rules: { where: { active: { eq: true }, code: { eq: 'default' } } },
				parties: { where: { id: { in: partyIds } } },
				order_lines: { where: { order: { in: ids } } },
				commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 },
				warehouses: {
					where: {
						id: {
							in: changes.flatMap(({ before, after }) => [
								...(before.warehouse ? [before.warehouse] : []),
								...(after.warehouse ? [after.warehouse] : [])
							])
						}
					}
				},
				contacts: { where: { party: { in: partyIds } }, fields: ['party', 'primary'] }
			});
			const productIds = [...new Set(lines.rows.map((l) => l.product))];
			const { products, pricing_floors: floors } = yield* ctx.query({
				products: { where: { id: { in: productIds } } },
				pricing_floors: { where: { product: { in: productIds } } }
			});
			const config = settings.rows[0];
			// a line removed through this layer meets the same rule as a direct line delete
			const removed = changes.flatMap(({ set }) => set.lines?.delete ?? []).map(({ id }) => id);
			if (removed.length)
				yield* lineDeletes(
					(yield* ctx.query({ order_lines: { where: { id: { in: removed } } } })).order_lines.rows,
					ctx
				);
			// the Kingdee ledgers a draft -> confirmed order writes to, read once for the batch
			const syncing = changes.flatMap(({ before, after }) =>
				before.status !== 'confirmed' && after.status !== 'draft' ? [before.ledger] : []
			);
			const ledgers = syncing.length
				? (yield* ctx.query({
						sys_integration: {
							where: { id: { in: syncing }, integration: { eq: 'kingdee' } },
							fields: ['configuration']
						}
					})).sys_integration.rows
				: [];
			const transformed = [];
			for (const { before: old, set: input, after } of changes) {
				if (
					input.kingdee !== undefined ||
					input.party_name !== undefined ||
					input.commission !== undefined ||
					input.freight_treatment !== undefined
				)
					return yield* ctx.refuse('errors.evidence_sealed');
				if (
					input.source_order_key !== undefined &&
					input.source_order_key !== old.source_order_key &&
					(ctx.actor.kind !== 'system' || old.status === 'confirmed')
				)
					return yield* ctx.refuse('errors.evidence_sealed');
				if (input.print_values && !validPrintValues(input.print_values))
					return yield* ctx.refuse('errors.print_values_invalid', { field: 'print_values' });
				if (input.direction !== undefined && input.direction !== old.direction)
					return yield* ctx.refuse('errors.line_basis_locked', { field: 'direction' });
				if (after.valid_from && after.valid_until && after.valid_until < after.valid_from)
					return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
				if (input.payment_terms === null)
					return yield* ctx.refuse('errors.payment_terms_required', { field: 'payment_terms' });
				if (input.logistics_handler && !logisticsStaff(handlers.rows, input.logistics_handler))
					return yield* ctx.refuse('errors.logistics_handler', { field: 'logistics_handler' });
				const metadata = Object.keys(input).every((key) =>
					['title', 'notes', 'archived'].includes(key)
				);
				if (old.archived && Object.keys(input).some((key) => key !== 'archived'))
					return yield* ctx.refuse('errors.order_archived');
				if (input.archived === true && !metadata) return yield* ctx.refuse('errors.order_archived');
				if (metadata) {
					transformed.push(input);
					continue;
				}
				// Kingdee keeps a synced order's header; the sync's read brings its changes in
				const header = kingdeeHeader.find(
					(k) => old.status === 'confirmed' && input[k] !== undefined && input[k] !== old[k]
				);
				if (header) return yield* ctx.refuse('errors.kingdee_header', { field: header });
				const party = parties.rows.find((p) => p.id === after.party);
				const warehouse = warehouses.rows.find((w) => w.id === after.warehouse);
				const admitted = yield* admitParty(ctx, party, old.direction, warehouse);
				if (
					after.buyer_contact &&
					!contacts.rows.some((c) => c.id === after.buyer_contact && c.party === after.party)
				)
					return yield* ctx.refuse('errors.contact_party', { field: 'buyer_contact' });
				const own = lines.rows.filter((l) => l.order === old.id);
				const movedParty = after.party !== old.party;
				const defaults = {
					...defaultPlaces(
						old.direction,
						after.trade,
						after.delivery_address,
						input,
						{
							warehouse: warehouses.rows.find((w) => w.id === old.warehouse)?.name,
							address: parties.rows.find((p) => p.id === old.party)?.address
						},
						{
							...(after.warehouse !== old.warehouse || old.trade.kind !== after.trade.kind
								? { warehouse: warehouse?.name ?? null }
								: {}),
							...(movedParty || old.trade.kind !== after.trade.kind
								? { address: admitted.address }
								: {})
						}
					),
					// a new party brings its own contact unless the writer names one
					...(movedParty && input.buyer_contact === undefined
						? { buyer_contact: buyerOf(contacts.rows, after.party) }
						: {})
				};
				// a changed pricing basis re-prices every line through this order's layer (each line's own transform)
				const repriced =
					own.length && pricingBasis.some((k) => input[k] !== undefined && input[k] !== old[k])
						? {
								lines: {
									...input.lines,
									update: [
										...(input.lines?.update ?? []),
										...own
											.filter((l) => !input.lines?.update?.some((u) => u.target.id === l.id))
											.map((l) => ({
												target: { id: l.id, revision: l.revision },
												set: { quantity: l.quantity }
											}))
									]
								}
							}
						: {};
				const common = {
					...input,
					...defaults,
					...repriced,
					ledger: admitted.source,
					...(input.print_values ? { print_values: orderedPrintValues(input.print_values) } : {})
				};
				if (old.status === 'confirmed' || after.status === 'draft') {
					transformed.push(common);
					continue;
				}
				// draft -> confirmed: the saved order goes to Kingdee as it stands
				if (terms.some((k) => input[k] !== undefined && input[k] !== old[k]))
					return yield* ctx.refuse('errors.save_before_confirm');
				if (!config) return yield* ctx.refuse('errors.configuration_missing');
				if (!own.length) return yield* ctx.refuse('errors.lines_required');
				// a line a commercial manager has yet to decide waits, rather than reaching Kingdee
				if (own.some((l) => l.$approval)) return yield* ctx.refuse('errors.lines_pending');
				if (old.warehouse && !warehouse?.active)
					return yield* ctx.refuse('errors.warehouse_inactive');
				if (!old.payment_terms)
					return yield* ctx.refuse('errors.payment_terms', { field: 'payment_terms' });
				if (own.some((l) => !products.rows.find((p) => p.id === l.product)?.active))
					return yield* ctx.refuse('errors.product_inactive');
				// a floor that moved since the line was priced still holds
				if (
					config.floor_rule === 'refuse' &&
					old.direction === 'sales' &&
					own.some((l) => {
						const floor = floorFor(old, warehouse?.group_code, l, floors.rows);
						const floorNet = floor ? floorNetInUnit(floor, l.unit) : null;
						return (
							!floor ||
							floorNet === null ||
							quoteBelowFloor({ ...l, floor_net: floorNet }, old.tax_inclusive)
						);
					})
				)
					return yield* ctx.refuse('errors.floor_below');
				transformed.push({
					...common,
					source_order_key: old.source_order_key ?? crypto.randomUUID(),
					party_name: admitted.name,
					freight_treatment: config.freight_treatment,
					write_target: kingdeeWriteTarget(ledgers.find((l) => l.id === old.ledger)?.configuration),
					commission: commissionRule(rules.rows, old.currency, old.ordered_on)
				});
			}
			return transformed;
		}
	},
	// an own draft's delete is judged by its holders' policies; its lines go with it
	delete: {}
});

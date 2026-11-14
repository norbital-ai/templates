import { lineDeletes } from '../../../lib/order-review.js';
import { logisticsDocument, logisticsLine, logisticsOrder } from '../../../lib/logistics.js';
import { agreementTemplate, sealDocument } from '../../../lib/order-document.js';
import { confirmationBasis } from '../../../lib/confirmation.js';
import { COMMISSION_ENGINE } from '../../../lib/commission-expressions.js';
import { kingdeeWriteTarget } from '../../../integration/kingdee/configuration.js';
import { model, type Row, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { currentFloors, hash, quoteBelowFloor, snapshot } from '../../../lib/commercial.js';
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
	'document_template',
	'print_values',
	'currency',
	'tax_inclusive',
	'valid_from',
	'valid_until',
	'payment_terms',
	'delivery_terms',
	'shipping_terms',
	'place_of_loading',
	'place_of_delivery',
	'packaging',
	'shipping_mark',
	'time_of_shipment',
	'other_terms',
	'payment_method',
	'buyer_contact',
	'buyer_mobile',
	'delivery_address',
	'delivery_date',
	'logistics_handler',
	'notes',
	'supporting_documents'
] as const;
/** The party and warehouse an order names must be active, match its direction, and share the party's ledger. */
const admitParty = Effect.fnUntraced(function* (
	ctx: WriteCtx<'orders'>,
	party:
		Pick<StoredRow<'parties'>, 'active' | 'kind' | 'source' | 'name' | 'external_code'> | undefined,
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
		document_template: {
			kind: 'ref',
			to: 'document_templates',
			optional: true,
			where: { status: { eq: 'published' } }
		},
		ledger: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		source_order_key: { kind: 'text', optional: true, hidden: true },
		archived: { kind: 'bool', default: false },
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
		payment_terms: {
			kind: 'text'
		},
		delivery_terms: {
			kind: 'text',
			optional: true
		},
		shipping_terms: { kind: 'text', optional: true },
		place_of_loading: { kind: 'text', optional: true },
		place_of_delivery: { kind: 'text', optional: true },
		packaging: { kind: 'text', optional: true },
		shipping_mark: { kind: 'text', optional: true },
		time_of_shipment: { kind: 'text', optional: true },
		other_terms: { kind: 'text', optional: true },
		payment_method: { kind: 'text', optional: true },
		buyer_contact: { kind: 'text', optional: true },
		buyer_mobile: { kind: 'text', format: 'phone', optional: true },
		delivery_address: { kind: 'text', optional: true },
		delivery_date: { kind: 'date', optional: true },
		logistics_handler: { kind: 'ref', to: 'sys_user', optional: true },
		notes: {
			kind: 'text',
			optional: true
		},
		print_values: printValueKind,
		supporting_documents: {
			kind: 'file',
			accept: [
				'application/pdf',
				'image/jpeg',
				'image/png',
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			],
			max: '20MiB',
			many: true,
			optional: true
		},
		check_hash: {
			kind: 'text',
			optional: true,
			hidden: true
		},
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
		// the commission rule in force when the order was confirmed
		commission: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: commissionShape,
			was: 'sealed_commission'
		},
		// the Kingdee account set and branch a confirmed sales order is written to
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
			lines: { fields: 'all' },
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
		fields: [...terms, 'source_order_key'],
		lines: {
			fields: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate', 'print_values']
		},
		filled: { fields: [], lines: { fields: ['unit_price', 'tax_rate'] } },
		transform: function* (changes, ctx) {
			const rows = changes.map(({ after }) => after);
			const {
				parties,
				warehouses,
				commercial_settings: settings,
				document_templates: layouts
			} = yield* ctx.query({
				parties: { where: { id: { in: rows.map((r) => r.party) } } },
				warehouses: { where: { id: { in: rows.flatMap((r) => r.warehouse ?? []) } } },
				commercial_settings: {
					where: { code: { eq: 'default' } },
					fields: ['default_document_layout', 'default_purchase_document_layout'],
					limit: 1
				},
				document_templates: { where: { status: { eq: 'published' } } }
			});
			const config = settings.rows[0];
			const defaultLayout = (direction: Row<'orders'>['direction']) => {
				const preferred =
					direction === 'purchasing'
						? config?.default_purchase_document_layout
						: config?.default_document_layout;
				return [preferred, config?.default_document_layout].find(
					(id) => id != null && layouts.rows.some((layout) => layout.id === id)
				);
			};
			const out = [];
			for (const { after: row, set } of changes) {
				if (
					row.document_template &&
					!layouts.rows.some((layout) => layout.id === row.document_template)
				)
					return yield* ctx.refuse('errors.document_layout_unpublished', {
						field: 'document_template'
					});
				if (row.print_values && !validPrintValues(row.print_values))
					return yield* ctx.refuse('errors.print_values_invalid', { field: 'print_values' });
				if (row.valid_from && row.valid_until && row.valid_until < row.valid_from)
					return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
				const party = yield* admitParty(
					ctx,
					parties.rows.find((p) => p.id === row.party),
					row.direction,
					warehouses.rows.find((w) => w.id === row.warehouse)
				);
				out.push({
					...set,
					document_template: row.document_template ?? defaultLayout(row.direction) ?? null,
					...(row.print_values ? { print_values: orderedPrintValues(row.print_values) } : {}),
					source_order_key: row.source_order_key ?? crypto.randomUUID(),
					ledger: party.source,
					party_name: party.name
				});
			}
			return out;
		}
	},
	update: {
		fields: [...terms, 'status', 'check_hash', 'archived', 'source_order_key', 'kingdee'],
		lines: {
			fields: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate', 'print_values']
		},
		transform: function* (changes, ctx) {
			// the Kingdee read writes what the SO holds
			if (ctx.actor.kind === 'system' && 'sync' in ctx.actor.by)
				return changes.map(({ set }) => set);
			const ids = changes.map((c) => c.before.id);
			const {
				parties,
				order_lines: lines,
				commercial_settings: settings,
				document_templates: templates,
				commission_rules: rules,
				warehouses
			} = yield* ctx.query({
				commission_rules: { where: { active: { eq: true }, code: { eq: 'default' } } },
				parties: {
					where: { id: { in: changes.map(({ after }) => after.party) } }
				},
				order_lines: { where: { order: { in: ids } } },
				document_templates: { where: { status: { eq: 'published' } } },
				commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 },
				warehouses: {
					where: {
						id: {
							in: changes.flatMap(({ before, set }) =>
								set.warehouse !== undefined ? (set.warehouse ?? []) : (before.warehouse ?? [])
							)
						}
					}
				}
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
			// the Kingdee ledgers a draft -> confirmed sales order writes to, read once for the batch
			const confirming = changes.flatMap(({ before, after }) =>
				before.direction === 'sales' && before.status !== 'confirmed' && after.status !== 'draft'
					? [before.ledger]
					: []
			);
			const ledgers = confirming.length
				? (yield* ctx.query({
						sys_integration: {
							where: { id: { in: confirming }, integration: { eq: 'kingdee' } },
							fields: ['configuration']
						}
					})).sys_integration.rows
				: [];
			const transformed = [];
			for (const { before: old, set: input, after } of changes) {
				if (input.kingdee !== undefined) return yield* ctx.refuse('errors.evidence_sealed');
				if (
					input.source_order_key !== undefined &&
					input.source_order_key !== old.source_order_key &&
					(ctx.actor.kind !== 'system' || old.status === 'confirmed')
				)
					return yield* ctx.refuse('errors.evidence_sealed');
				if (
					input.document_template &&
					!templates.rows.some((layout) => layout.id === input.document_template)
				)
					return yield* ctx.refuse('errors.document_layout_unpublished', {
						field: 'document_template'
					});
				if (input.print_values && !validPrintValues(input.print_values))
					return yield* ctx.refuse('errors.print_values_invalid', { field: 'print_values' });
				if (input.direction !== undefined && input.direction !== old.direction)
					return yield* ctx.refuse('errors.line_basis_locked', { field: 'direction' });
				if (after.valid_from && after.valid_until && after.valid_until < after.valid_from)
					return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
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
				const party = parties.rows.find((p) => p.id === after.party);
				const warehouse = warehouses.rows.find((w) => w.id === after.warehouse);
				const admitted = yield* admitParty(ctx, party, old.direction, warehouse);
				const own = lines.rows.filter((l) => l.order === old.id);
				// a confirmed order keeps its party, owner and the basis its lines were priced on
				if (
					(
						[
							'party',
							'warehouse',
							'currency',
							'tax_inclusive',
							'direction',
							'ordered_on',
							...(old.status === 'confirmed' ? (['owner'] as const) : [])
						] as const
					).some(
						(k) =>
							(own.length || old.status === 'confirmed') &&
							input[k] !== undefined &&
							input[k] !== old[k]
					)
				)
					return yield* ctx.refuse('errors.line_basis_locked');
				// Kingdee keeps the SO header; the sync's read brings its changes in
				if (
					old.status === 'confirmed' &&
					old.write_target &&
					input.payment_terms !== undefined &&
					input.payment_terms !== old.payment_terms
				)
					return yield* ctx.refuse('errors.kingdee_header', { field: 'payment_terms' });
				if (old.status === 'confirmed' || after.status === 'draft') {
					transformed.push({
						...input,
						ledger: admitted.source,
						check_hash: null,
						...(input.print_values ? { print_values: orderedPrintValues(input.print_values) } : {})
					});
					continue;
				}
				// draft -> confirmed
				if (terms.some((k) => input[k] !== undefined && input[k] !== old[k]))
					return yield* ctx.refuse('errors.save_before_confirm');
				const template = agreementTemplate(templates.rows, old.document_template);
				if (!config) return yield* ctx.refuse('errors.configuration_missing');
				if (!template)
					return yield* ctx.refuse('errors.document_layout_unpublished', {
						field: 'document_template'
					});
				if (!own.length) return yield* ctx.refuse('errors.lines_required');
				if (old.warehouse && !warehouse?.active)
					return yield* ctx.refuse('errors.warehouse_inactive');
				if (old.direction === 'sales' && !old.payment_terms.trim())
					return yield* ctx.refuse('errors.payment_terms', { field: 'payment_terms' });
				if (own.some((l) => !products.rows.find((p) => p.id === l.product)?.active))
					return yield* ctx.refuse('errors.product_inactive');
				const basis = currentFloors(old, own, floors.rows, warehouse?.group_code);
				const check_hash = yield* hash(
					confirmationBasis(
						old.revision,
						{ ...snapshot(old, admitted, basis, template.version), ...sealDocument(template) },
						config,
						template
					)
				);
				if (input.check_hash !== check_hash) return yield* ctx.refuse('errors.check_changed');
				if (
					config.require_floor &&
					old.direction === 'sales' &&
					basis.some((l) => l.floor_net === null)
				)
					return yield* ctx.refuse('errors.floor_missing');
				if (config.require_floor && old.direction === 'sales' && basis.some(quoteBelowFloor))
					return yield* ctx.refuse('errors.floor_below');
				const rule = rules.rows
					.filter((r) => r.currency === old.currency && r.effective_on <= old.ordered_on)
					.sort((a, b) => b.effective_on.localeCompare(a.effective_on))[0];
				const writeTarget =
					old.direction === 'sales'
						? kingdeeWriteTarget(ledgers.find((l) => l.id === old.ledger)?.configuration)
						: null;
				transformed.push({
					...input,
					source_order_key: old.source_order_key ?? crypto.randomUUID(),
					party_name: admitted.name,
					freight_treatment: config.freight_treatment,
					write_target: writeTarget,
					commission: rule
						? {
								rule_id: rule.id,
								engine_version: COMMISSION_ENGINE,
								eligibility_expression: rule.eligibility_expression,
								amount_expression: rule.amount_expression,
								parameters: rule.parameters ?? [],
								effective_on: rule.effective_on,
								currency: rule.currency,
								basis_unit: rule.basis_unit ?? '',
								fixed_rate: rule.fixed_rate,
								spread_pct: rule.spread_pct
							}
						: null
				});
			}
			return transformed;
		}
	},
	// an own draft's delete is judged by its holders' policies; its lines go with it
	delete: {}
});

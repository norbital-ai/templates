import { Decimal, sum } from '@norbital-ai/std/decimal';
import { averageLotCost } from '../../../lib/lot-cost.js';
import {
	agreements,
	agreementSelect,
	confirmationBasis,
	operationalLines
} from '../../../lib/agreements.js';
import { agreementText, publishedTemplate, orderDocument } from '../../../lib/order-document.js';
import { COMMISSION_ENGINE } from '../../../lib/commission-expressions.js';
import { submitOrder, type OrderPayload } from '../../../integration/kingdee/submission.js';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import {
	isMasked,
	model,
	type CreateRow,
	type UpdateSet,
	type Row,
	type StoredRow,
	type WriteCtx
} from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { creditWarning, currentFloors, hash, price, snapshot } from '../../../lib/commercial.js';
import {
	commissionRows,
	reportQueries,
	reportSelect,
	salesAnalysis,
	salesDetail
} from '../../../lib/reports.js';
const snapshotShape = {
	kind: 'object',
	fields: {
		title: { kind: 'text', optional: true },
		document_title: { kind: 'text', optional: true },
		warehouse: { kind: 'text', optional: true },
		party_code: {
			kind: 'text'
		},
		party_name: {
			kind: 'text'
		},
		direction: {
			kind: 'enum',
			values: ['sales', 'purchasing']
		},
		currency: {
			kind: 'text'
		},
		tax_inclusive: {
			kind: 'bool'
		},
		valid_from: { kind: 'text', optional: true },
		valid_until: { kind: 'text', optional: true },
		payment_terms: {
			kind: 'text'
		},
		delivery_terms: {
			kind: 'text'
		},
		contract_version: {
			kind: 'text'
		},
		lines: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					id: {
						kind: 'text'
					},
					product: { kind: 'text', optional: true },
					product_code: {
						kind: 'text'
					},
					product_name: {
						kind: 'text'
					},
					unit: {
						kind: 'text'
					},
					quantity: {
						kind: 'text'
					},
					unit_price: {
						kind: 'text'
					},
					discount_pct: {
						kind: 'text'
					},
					tax_rate: {
						kind: 'text'
					},
					net: {
						kind: 'text'
					},
					tax: {
						kind: 'text'
					},
					total: {
						kind: 'text'
					},
					floor_net: {
						kind: 'text'
					},
					commission_factor: {
						kind: 'text'
					},
					commission_basis_unit: {
						kind: 'text'
					}
				}
			}
		},
		net: {
			kind: 'text'
		},
		tax: {
			kind: 'text'
		},
		total: {
			kind: 'text'
		},
		order_id: {
			kind: 'text'
		}
	}
} as const;
const commissionShape = {
	kind: 'object',
	fields: {
		engine_version: { kind: 'text', optional: true },
		eligibility_expression: { kind: 'text', optional: true },
		amount_expression: { kind: 'text', optional: true },
		parameters: {
			kind: 'list',
			optional: true,
			of: { kind: 'object', fields: { name: { kind: 'text' }, value: { kind: 'text' } } }
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
	'currency',
	'tax_inclusive',
	'valid_from',
	'valid_until',
	'payment_terms',
	'delivery_terms',
	'notes',
	'supporting_documents'
] as const;
/** The party and warehouse an order names must be active, match its direction, and share the party's ledger. */
const admitParty = Effect.fnUntraced(function* (
	ctx: WriteCtx<'orders'>,
	party: StoredRow<'parties'> | undefined,
	direction: Row<'orders'>['direction'],
	warehouse: StoredRow<'warehouses'> | undefined
) {
	if (!party || !party.active)
		return yield* ctx.refuse('errors.party_inactive', { field: 'party' });
	if (party.kind !== 'both' && party.kind !== (direction === 'sales' ? 'customer' : 'supplier'))
		return yield* ctx.refuse('errors.party_direction', { field: 'party' });
	if (warehouse && warehouse.source !== party.source)
		return yield* ctx.refuse('errors.ledger_mismatch', { field: 'warehouse' });
	return party;
});
/** What the ledger receives for a confirmed order: its sealed agreement, or `null` when there is nothing to submit. */
function orderPayload(row: Row<'orders'>): OrderPayload | null {
	if (
		row.status !== 'confirmed' ||
		!row.seal_hash ||
		!row.sealed_contract ||
		isMasked(row.sealed_contract) ||
		!row.sealed_snapshot ||
		isMasked(row.sealed_snapshot)
	)
		return null;
	const snapshot = row.sealed_snapshot;
	const versions =
		row.contract_versions && !isMasked(row.contract_versions) ? row.contract_versions : [];
	const approved = versions.find((version) => version.seal_hash === row.seal_hash);
	return {
		order_id: String(row.id),
		reference: row.number,
		direction: snapshot.direction,
		agreement_hash: row.seal_hash,
		version: approved?.version ?? row.contract_version,
		owner_id: String(row.owner),
		ordered_on: approved?.ordered_on ?? row.ordered_on,
		currency: snapshot.currency,
		tax_inclusive: snapshot.tax_inclusive,
		party_code: snapshot.party_code,
		payment_terms: snapshot.payment_terms,
		lines: snapshot.lines.map(
			({
				id,
				product_code,
				unit,
				quantity,
				unit_price,
				discount_pct,
				tax_rate,
				net,
				tax,
				total
			}) => ({
				id,
				product_code,
				unit,
				quantity,
				unit_price,
				discount_pct,
				tax_rate,
				net,
				tax,
				total
			})
		)
	};
}
export default model('orders', {
	description: 'orders',
	label: 'number',
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
		owner: { kind: 'ref', to: 'sys_user', default: { actor: 'id' } },
		warehouse: { kind: 'ref', to: 'warehouses', optional: true },
		ledger: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: {
					to: ['confirmed', 'cancelled']
				},
				confirmed: {
					to: ['closed', 'cancelled'],
					edit: [
						'reason',
						'closure_snapshot',
						'contract_versions',
						'operational_contracts',
						'check_hash'
					]
				},
				closed: {
					edit: 'none'
				},
				cancelled: {
					edit: 'none'
				}
			}
		},
		ordered_on: {
			kind: 'date',
			default: {
				today: ''
			}
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
		notes: {
			kind: 'text',
			optional: true
		},
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
			multiple: true,
			optional: true
		},
		check_hash: {
			kind: 'text',
			optional: true,
			hidden: true
		},
		reason: {
			kind: 'text',
			optional: true
		},
		// Price-free projection of the approved contracts for scoped stock reads.
		operational_contracts: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						seal_hash: { kind: 'text' },
						lines: {
							kind: 'list',
							of: {
								kind: 'object',
								fields: {
									id: { kind: 'text' },
									product: { kind: 'text', optional: true },
									unit: { kind: 'text' },
									quantity: { kind: 'text' }
								}
							}
						}
					}
				}
			}
		},
		contract_version: { kind: 'int', default: 1, min: 1 },
		contract_versions: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						version: { kind: 'int' },
						seal_hash: { kind: 'text' },
						contract: { kind: 'text' },
						approved_at: { kind: 'instant' },
						approved_by: { kind: 'text' },
						ordered_on: { kind: 'date' },
						freight_treatment: { kind: 'enum', values: ['deduct', 'include'] },
						snapshot: snapshotShape,
						commission: { ...commissionShape, optional: true }
					}
				}
			}
		},
		sealed_at: {
			kind: 'instant',
			optional: true
		},
		sealed_by: {
			hidden: true,
			kind: 'text',
			optional: true
		},
		sealed_contract_version: {
			hidden: true,
			kind: 'text',
			optional: true
		},
		sealed_contract: {
			hidden: true,
			kind: 'text',
			optional: true
		},
		sealed_snapshot: {
			kind: 'json',
			shape: snapshotShape,
			optional: true
		},
		closure_snapshot: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						order_line: { kind: 'text' },
						product_name: { kind: 'text' },
						unit: { kind: 'text' },
						ordered: { kind: 'text' },
						fulfilled: { kind: 'text' },
						released: { kind: 'text' }
					}
				}
			}
		},
		seal_hash: {
			hidden: true,
			kind: 'text',
			optional: true
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
		sealed_commission: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: commissionShape
		}
	},
	search: {
		text: ['number', 'title', 'party_name']
	},
	read: 'all',
	create: {
		columns: terms,
		// each line prices itself in its own `create.transform`, after this one
		with: {
			lines: {
				create: { columns: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate'] }
			}
		},
		transform: function* (rows, ctx) {
			const { parties, warehouses } = yield* ctx.db.query({
				parties: { from: 'parties', where: { id: { in: rows.map((r) => r.party) } }, all: true },
				warehouses: {
					from: 'warehouses',
					where: { id: { in: rows.flatMap((r) => r.warehouse ?? []) } },
					all: true
				}
			});
			const out: CreateRow<'orders'>[] = [];
			for (const row of rows) {
				if (row.closure_snapshot !== undefined) return yield* ctx.refuse('errors.order_sealed');
				if (row.valid_from && row.valid_until && row.valid_until < row.valid_from)
					return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
				const party = yield* admitParty(
					ctx,
					parties.rows.find((p) => p.id === row.party),
					row.direction,
					warehouses.rows.find((w) => w.id === row.warehouse)
				);
				out.push({ ...row, ledger: party.source, party_name: party.name });
			}
			return out;
		}
	},
	update: {
		columns: [...terms, 'status', 'check_hash', 'reason'],
		transform: function* (changes, ctx) {
			const ids = changes.map((c) => c.before.id);
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
			} = yield* ctx.db.query({
				references: {
					from: 'orders',
					where: { id: { in: ids } },
					select: { number: true },
					all: true
				},
				rules: {
					from: 'commission_rules',
					where: { active: { eq: true }, code: { eq: 'default' } },
					all: true
				},
				parties: {
					from: 'parties',
					where: { id: { in: changes.map(({ before, set }) => set.party ?? before.party) } },
					all: true
				},
				lines: { from: 'order_lines', where: { order: { in: ids } }, all: true },
				templates: {
					from: 'document_templates',
					where: { status: { eq: 'published' } },
					all: true
				},
				settings: {
					from: 'commercial_settings',
					where: { code: { eq: 'default' } },
					limit: 1
				},
				products: {
					from: 'products',
					where: { id: { in: { member: 'lines', field: 'product' } } },
					all: true
				},
				floors: {
					from: 'pricing_floors',
					where: { product: { in: { member: 'products', field: 'id' } } },
					all: true
				},
				warehouses: {
					from: 'warehouses',
					where: {
						id: {
							in: changes.flatMap(({ before, set }) =>
								set.warehouse !== undefined ? (set.warehouse ?? []) : (before.warehouse ?? [])
							)
						}
					},
					all: true
				},
				transactions: { from: 'transactions', where: { order: { in: ids } }, all: true },
				salesReceipts: { from: 'ext_sales_orders', where: { order: { in: ids } }, all: true },
				purchaseReceipts: {
					from: 'ext_purchase_orders',
					where: { order: { in: ids } },
					all: true
				},
				sourcePayments: { from: 'source_payments', where: { order: { in: ids } }, all: true }
			});
			const config = settings.rows[0];
			const template = publishedTemplate(templates.rows, 'contract');
			const transformed: UpdateSet<'orders'>[] = [];
			for (const { before: old, set: input } of changes) {
				if (input.closure_snapshot !== undefined) return yield* ctx.refuse('errors.order_sealed');
				if (input.direction !== undefined && input.direction !== old.direction)
					return yield* ctx.refuse('errors.line_basis_locked', { field: 'direction' });
				const validFrom = input.valid_from !== undefined ? input.valid_from : old.valid_from;
				const validUntil = input.valid_until !== undefined ? input.valid_until : old.valid_until;
				if (validFrom && validUntil && validUntil < validFrom)
					return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
				const party = parties.rows.find((p) => p.id === (input.party ?? old.party));
				const warehouse = warehouses.rows.find(
					(w) => w.id === (input.warehouse !== undefined ? input.warehouse : old.warehouse)
				);
				const next = input.status ?? old.status;
				const counterparts = [...salesReceipts.rows, ...purchaseReceipts.rows].filter(
					(row) => row.order === old.id
				);
				// Even an unapproved or void source counterpart keeps its original agreement immutable.
				if (
					counterparts.length &&
					(next === 'draft' || (old.status === 'draft' && next === 'confirmed'))
				)
					return yield* ctx.refuse('errors.order_sealed');
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
										(row) =>
											row.order === old.id && row.kind === 'delivery' && row.status === 'issued'
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
								ordered: Decimal.of(line.quantity).toString(),
								fulfilled: fulfilled.toString(),
								released: Decimal.of(line.quantity).minus(fulfilled).toString()
							};
						})
						.sort((a, b) => a.order_line.localeCompare(b.order_line));
					const external = counterparts;
					if (
						next === 'cancelled' &&
						(transactions.rows.some((row) => row.order === old.id && row.status === 'issued') ||
							sourcePayments.rows.some((row) => row.order === old.id && row.active))
					)
						return yield* ctx.refuse('errors.cancel_obligations');
					if (
						(next === 'cancelled' ||
							closure_snapshot.some((line) => Decimal.of(line.released).gt(0))) &&
						(external.length === 0 || external.some((row) => row.status !== 'void'))
					)
						return yield* ctx.refuse('errors.remote_close_required');
					if (next === 'closed') return { ...input, closure_snapshot };
					return next === 'cancelled' ? { ...input, closure_snapshot } : input;
				};
				const cancelOrder = function* () {
					if (counterparts.length || old.seal_hash) return yield* closeOrder();
					if (!input.reason?.trim())
						return yield* ctx.refuse('errors.reason_required', { field: 'reason' });
					return input;
				};
				const editOrder = function* () {
					const admitted = yield* admitParty(ctx, party, old.direction, warehouse);
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
							[
								'party',
								'warehouse',
								'currency',
								'tax_inclusive',
								'direction',
								'ordered_on'
							] as const
						).some((k) => input[k] !== undefined && input[k] !== old[k])
					)
						return yield* ctx.refuse('errors.line_basis_locked');
					return { ...input, ledger: admitted.source, check_hash: null };
				};
				const confirmOrder = function* () {
					const admitted = yield* admitParty(ctx, party, old.direction, warehouse);
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
						...snapshot(old, admitted, basis, template.version),
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
								fixed_rate: Decimal.of(rule.fixed_rate).toString(),
								spread_pct: Decimal.of(rule.spread_pct).toString()
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
						party_name: admitted.name,
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
					'confirmed->draft': sealed,
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
			},
			run: function* ({ order }, ctx) {
				const result = yield* ctx.query('orders', {
					where: { id: { eq: order } },
					select: { ...agreementSelect, currency: true },
					limit: 1
				});
				const row = result.rows[0];
				if (!row || isMasked(row.currency)) return yield* ctx.refuse('errors.agreement_access');
				return agreements(row).map((v) => ({ version: v.version, approved_at: v.approved_at }));
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
			},
			run: function* (input, ctx) {
				return yield* orderDocument(ctx, input);
			}
		},
		ar_aging: {
			...reportQueries.ar_aging,
			run: function* ({ as_of }, ctx) {
				if (as_of > ctx.today) yield* ctx.refuse('errors.report_future');
				const { invoices, sourcePayments, orders } = yield* ctx.query({
					invoices: {
						from: 'transactions',
						where: { kind: { eq: 'invoice' }, status: { eq: 'issued' }, issued_on: { lte: as_of } },
						all: true
					},
					sourcePayments: {
						from: 'source_payments',
						where: { settled_on: { lte: as_of }, active: { eq: true } },
						all: true
					},
					orders: {
						from: 'orders',
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
					const raw = Decimal.of(invoice.total).minus(paid);
					const balance = raw.lt(0) ? Decimal.of(0) : raw;
					const overpaid = raw.lt(0) ? Decimal.of(0).minus(raw) : Decimal.of(0);
					if (balance.eq(0) && overpaid.eq(0)) return [];
					const days = invoice.due_on
						? Math.floor(
								(Date.parse(as_of + 'T00:00:00Z') - Date.parse(invoice.due_on + 'T00:00:00Z')) /
									86400000
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
			}
		},
		sales_analysis: {
			...reportQueries.sales_analysis,
			run: function* (input, ctx) {
				return yield* salesAnalysis(ctx, input);
			}
		},
		sales_detail: {
			...reportQueries.sales_detail,
			run: function* (input, ctx) {
				return yield* salesDetail(ctx, input);
			}
		},
		commission: {
			...reportQueries.commission,
			run: function* (input, ctx) {
				const { orders, users } = yield* ctx.query({
					orders: {
						from: 'orders',
						where: {
							...(input.order ? { id: { eq: input.order } } : {}),
							direction: { eq: 'sales' },
							status: { in: ['draft', 'confirmed', 'closed'] }
						},
						select: reportSelect,
						all: true
					},
					users: { from: 'sys_user', select: { name: true }, all: true }
				});
				return commissionRows(orders.rows, input.version).map((row) => ({
					...row,
					owner_name: users.rows.find((u) => u.id === row.owner)?.name ?? ''
				}));
			}
		},
		confirmation_check: {
			description:
				'Current checks and version-bound acknowledgment for this order; credit freshness is judged as of `as_of`.',
			input: {
				order: { kind: 'id', of: 'orders' },
				revision: { kind: 'int', optional: true },
				as_of: { kind: 'instant' }
			},
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
			},
			run: function* ({ order, revision, as_of }, ctx) {
				const { orders, lines, credits, settings, templates, parties, floors, warehouses, stock } =
					yield* ctx.query({
						stock: { from: 'stock_snapshots', all: true },
						floors: { from: 'pricing_floors', all: true },
						warehouses: { from: 'warehouses', all: true },
						orders: { from: 'orders', id: order },
						lines: { from: 'order_lines', where: { order: { eq: order } }, all: true },
						credits: {
							from: 'credit_snapshots',
							where: { party: { is: { orders: { some: { id: { eq: order } } } } } },
							all: true
						},
						parties: {
							from: 'parties',
							where: { orders: { some: { id: { eq: order } } } },
							limit: 1
						},
						templates: {
							from: 'document_templates',
							where: { status: { eq: 'published' } },
							all: true
						},
						settings: { from: 'commercial_settings', where: { code: { eq: 'default' } }, limit: 1 }
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
						as_of,
						config.credit_fresh_minutes
					),
					gross: sealed.total,
					credit_as_of: credit?.as_of ?? null,
					below_inventory_cost:
						doc.direction === 'sales'
							? lines.rows
									.filter((line) => {
										const average = averageLotCost(
											stock.rows,
											line.product,
											line.unit,
											doc.currency
										);
										return (
											average !== null && price(doc, line).net.div(line.quantity, 8).lt(average)
										);
									})
									.map((line) => line.product_name)
							: []
				};
			}
		},
		quotation_export: {
			description: 'Current saved commercial terms of this unfinalized order, without a seal.',
			input: { order: { kind: 'id', of: 'orders' }, revision: { kind: 'int', optional: true } },
			output: {
				kind: 'object',
				fields: { number: { kind: 'text' }, contract: { kind: 'text' }, revision: { kind: 'int' } }
			},
			run: function* ({ order, revision }, ctx) {
				const { doc, lines, parties, settings, templates } = yield* ctx.query({
					doc: { from: 'orders', id: order },
					lines: { from: 'order_lines', where: { order: { eq: order } }, all: true },
					parties: {
						from: 'parties',
						where: { orders: { some: { id: { eq: order } } } },
						limit: 1
					},
					templates: {
						from: 'document_templates',
						where: { status: { eq: 'published' } },
						all: true
					},
					settings: { from: 'commercial_settings', where: { code: { eq: 'default' } }, limit: 1 }
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
			},
			run: function* ({ order }, ctx) {
				const doc = yield* ctx.query('orders', { id: order });
				if (!doc?.sealed_contract || !doc.seal_hash)
					return yield* ctx.refuse('errors.order_not_confirmed');
				if (isMasked(doc.sealed_contract)) return yield* ctx.refuse('errors.agreement_access');
				return { number: doc.number, contract: doc.sealed_contract, seal_hash: doc.seal_hash };
			}
		}
	},
	syncs: {
		// one way out: each confirmed contract version is created once in the order's own ledger
		kingdee: {
			with: 'kingdee',
			write: function* ({ op, row, $version }, ctx) {
				const payload = op === 'delete' ? null : orderPayload(row);
				// drafts, closures and edits of an already submitted version are local-only
				if (payload === null || $version === payload.agreement_hash) return null;
				// the immutable key: a retry after a lost acknowledgement finds the same ledger order
				const key = `${payload.order_id}:${payload.agreement_hash}`;
				// A rejected first delivery must not roll back and delete the approved local SO.
				const remote = yield* submitOrder(payload, key, ctx).pipe(
					Effect.mapError(
						(cause) =>
							new FacilityFailure({
								kind: 'upstream',
								message: `Kingdee SO delivery needs attention; the sealed order is retained for retry. ${cause._tag === 'SourceRowInvalid' ? `${cause.column}: ${cause.reason}` : String(cause)}`
							})
					)
				);
				return { $id: remote, $version: payload.agreement_hash };
			}
		},
		// Export: the quotation or an approved contract version as the published document template renders it
		document: {
			with: 'file',
			// export only: no file imports orders
			parser: [],
			context: {
				order: { kind: 'id', of: 'orders' },
				version: { kind: 'int', min: 1, optional: true },
				locale: { kind: 'enum', values: ['en', 'zh'], default: 'en' }
			},
			write: function* ({ context }, ctx) {
				const document = yield* ctx.db.query('orders.document_preview', context);
				return { document: { html: document.html }, name: `${document.reference}.pdf` };
			}
		}
	}
});

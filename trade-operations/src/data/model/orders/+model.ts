import { model } from '../../../../.norbital/models/orders.ts';
import { lineDeletes } from '../../../lib/order-review.js';
import { isCurrency, text } from '../../../lib/values.js';
import {
	logisticsDocument,
	logisticsLine,
	logisticsOrder,
	logisticsReceipt
} from '../../../lib/logistics.js';
import {
	agreements,
	agreement,
	agreementState,
	locallyAccepted,
	resolvableKingdee,
	currentAgreement,
	agreedTotal,
	executableAgreement,
	kingdeeAgreement,
	kingdeeTermsChanged,
	type ContractVersion,
	confirmationBasis,
	operationalLines
} from '../../../lib/agreements.js';
import { agreementText, agreementTemplate, sealDocument } from '../../../lib/order-document.js';
import { COMMISSION_ENGINE } from '../../../lib/commission-expressions.js';
import { submitOrder, type OrderPayload } from '../../../integration/kingdee/submission.js';
import { kingdeeWriteTarget } from '../../../integration/kingdee/configuration.js';
import { readContractVersions } from '../../../integration/kingdee/contract-versions.js';
import {
	retainedContractDocuments,
	selectedContractDocuments
} from '../../../lib/contract-files.js';
import { draftLineMatches, draftLineTarget } from '../../../lib/contract-draft.js';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import {
	type CreatedRow,
	type Finding,
	type Row,
	type StoredRow,
	type WriteCtx
} from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { currentFloors, hash, quoteBelowFloor, snapshot } from '../../../lib/commercial.js';
import { orderLineWorkbook, orderWorkbook } from '../../../lib/workbook.js';
import {
	printValueKind,
	orderedPrintValues,
	samePrintValues,
	validPrintValues
} from '../../../lib/print-details.js';
const snapshotShape = {
	kind: 'object',
	fields: {
		title: { kind: 'text', optional: true },
		document_title: { kind: 'text', optional: true },
		document_template_id: { kind: 'text', optional: true },
		print_values: printValueKind,
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
		shipping_terms: { kind: 'text', optional: true },
		place_of_loading: { kind: 'text', optional: true },
		place_of_delivery: { kind: 'text', optional: true },
		packaging: { kind: 'text', optional: true },
		shipping_mark: { kind: 'text', optional: true },
		time_of_shipment: { kind: 'text', optional: true },
		other_terms: { kind: 'text', optional: true },
		payment_method: { kind: 'text', optional: true },
		buyer_contact: { kind: 'text', optional: true },
		buyer_mobile: { kind: 'text', optional: true },
		delivery_address: { kind: 'text', optional: true },
		delivery_date: { kind: 'text', optional: true },
		contract_version: {
			kind: 'text'
		},
		lines: {
			kind: 'object',
			fields: {
				id: {
					kind: 'text'
				},
				product: { kind: 'text', optional: true },
				source_entry_id: { kind: 'text', optional: true },
				product_code: {
					kind: 'text'
				},
				product_name: {
					kind: 'text'
				},
				product_spec: { kind: 'text', optional: true },
				print_values: printValueKind,
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
			},
			many: true
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
const supportingDocuments = {
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
} as const;
const contractVersionShape = {
	kind: 'object',
	fields: {
		version: { kind: 'int' },
		seal_hash: { kind: 'text' },
		basis_seal: { kind: 'text', optional: true },
		contract: { kind: 'text' },
		approved_at: { kind: 'instant' },
		approved_by: { kind: 'text' },
		ordered_on: { kind: 'date' },
		freight_treatment: { kind: 'enum', values: ['deduct', 'include'] },
		snapshot: snapshotShape,
		commission: { ...commissionShape, optional: true },
		supporting_documents: supportingDocuments,
		signature_version: { kind: 'ref', to: 'salesperson_signatures', optional: true },
		origin: { kind: 'enum', values: ['local', 'kingdee'], optional: true },
		lifecycle: { kind: 'enum', values: ['pending', 'current', 'superseded'], optional: true },
		write_target: {
			kind: 'object',
			optional: true,
			fields: { account: { kind: 'text' }, branch: { kind: 'text' } }
		},
		kingdee: {
			kind: 'object',
			optional: true,
			fields: {
				branch: { kind: 'text' },
				binding_id: { kind: 'text', optional: true },
				source_id: { kind: 'text' },
				live_source_id: { kind: 'text' },
				source_version: { kind: 'text' },
				source_uuid: { kind: 'text' },
				source_changed_at: { kind: 'text', optional: true },
				source_changed_by: { kind: 'text', optional: true },
				observed_at: { kind: 'instant' },
				content_hash: { kind: 'text' },
				exchange_rate: { kind: 'text', optional: true },
				archived: { kind: 'bool' },
				status: { kind: 'enum', values: ['draft', 'issued', 'void'], optional: true },
				closed: { kind: 'bool', optional: true },
				entries: {
					kind: 'object',
					fields: {
						local_line_id: { kind: 'text' },
						entry_id: { kind: 'text' },
						detail_id: { kind: 'text' }
					},
					optional: true,
					many: true
				}
			}
		},
		events: {
			kind: 'object',
			fields: {
				key: { kind: 'text' },
				at: { kind: 'instant' },
				kind: { kind: 'text' },
				actor: { kind: 'text', optional: true },
				status: { kind: 'text' },
				source_version: { kind: 'text' },
				source_id: { kind: 'text' },
				source_changed_at: { kind: 'text', optional: true },
				source_changed_by: { kind: 'text', optional: true }
			},
			optional: true,
			many: true
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
	'supporting_documents',
	'draft_document_ids'
] as const;
const contractProof = (version: ContractVersion) => ({
	version: version.version,
	seal_hash: version.seal_hash,
	basis_seal: version.basis_seal ?? null,
	snapshot: version.snapshot,
	contract: version.contract,
	commission: version.commission ?? null,
	approved_at: version.approved_at,
	approved_by: version.approved_by,
	ordered_on: version.ordered_on,
	freight_treatment: version.freight_treatment,
	supporting_documents: version.supporting_documents ?? [],
	signature_version: version.signature_version ?? null,
	write_target: version.write_target ?? null,
	origin: version.origin ?? null
});
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
/** What the ledger receives for a confirmed order: its sealed agreement, or `null` when there is nothing to submit. */
function orderPayload(
	row: Row<'orders'>,
	contract: ContractVersion,
	writeTarget: NonNullable<ContractVersion['write_target']>,
	previous?: ContractVersion
): OrderPayload {
	const snapshot = contract.snapshot;
	const previousSource = previous?.kingdee;
	const lines = (basis: ContractVersion) =>
		basis.snapshot.lines.map(
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
				total,
				source_entry_id
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
				total,
				...(source_entry_id ? { source_entry_id } : {})
			})
		);
	return {
		order_id: String(row.id),
		reference: row.number,
		direction: snapshot.direction,
		agreement_hash: contract.seal_hash,
		version: contract.version,
		owner_id: String(row.owner),
		ordered_on: contract.ordered_on,
		currency: snapshot.currency,
		tax_inclusive: snapshot.tax_inclusive,
		party_code: snapshot.party_code,
		payment_terms: snapshot.payment_terms,
		lines: lines(contract),
		write_target: writeTarget,
		...(previous && previousSource?.binding_id
			? {
					previous: {
						binding_id: previousSource.binding_id,
						source_id: previousSource.live_source_id,
						source_uuid: previousSource.source_uuid,
						source_version: previousSource.source_version,
						source_exchange_rate: previousSource.exchange_rate ?? '',
						agreement_hash: previous.seal_hash,
						tax_inclusive: previous.snapshot.tax_inclusive,
						lines: lines(previous).map((line) => ({
							...line,
							source_entry_id:
								line.source_entry_id ??
								previousSource.entries?.find((entry) => entry.local_line_id === line.id)
									?.entry_id ??
								''
						}))
					}
				}
			: {})
	};
}

export default model({
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
		owner: { kind: 'ref', to: 'sys_user', default: { var: 'requestor.id' } },
		warehouse: { kind: 'ref', to: 'warehouses', optional: true },
		document_template: {
			kind: 'ref',
			to: 'document_templates',
			optional: true,
			where: { status: { eq: 'published' } }
		},
		ledger: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		source_order_key: { kind: 'text', optional: true, hidden: true },
		draft_setup: { kind: 'text', optional: true, hidden: true },
		draft_basis: { kind: 'text', optional: true, hidden: true },
		archived: { kind: 'bool', default: false },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['confirmed'] },
				confirmed: {
					to: ['draft']
				}
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
		supporting_documents: supportingDocuments,
		draft_document_ids: { kind: 'text', optional: true, hidden: true, many: true },
		check_hash: {
			kind: 'text',
			optional: true,
			hidden: true
		},
		// Price-free projection of the approved contracts for scoped stock reads.
		operational_contracts: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				fields: {
					seal_hash: { kind: 'text' },
					current: { kind: 'bool', optional: true },
					lines: {
						kind: 'object',
						fields: {
							id: { kind: 'text' },
							product: { kind: 'text', optional: true },
							unit: { kind: 'text' },
							quantity: { kind: 'text' }
						},
						many: true
					}
				},
				many: true
			}
		},
		contract_version: { kind: 'int', default: 1, min: 1 },
		contract_versions: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: { ...contractVersionShape, many: true }
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
			hidden: true,
			kind: 'json',
			shape: snapshotShape,
			optional: true
		},
		closure_snapshot: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				fields: {
					order_line: { kind: 'text' },
					product_name: { kind: 'text' },
					unit: { kind: 'text' },
					ordered: { kind: 'text' },
					fulfilled: { kind: 'text' },
					released: { kind: 'text' }
				},
				many: true
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
		// the current contract's total, kept with its versions
		agreed_total: { kind: 'money', currency: 'currency', optional: true },
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
	outputs: {
		default: {
			fields: 'all',
			party: { fields: 'all' },
			ledger: { fields: ['active', 'status'] },
			lines: { fields: 'all' },
			transactions: { fields: 'all' },
			ext_sales_orders: { fields: 'all' }
		},
		logistics: {
			fields: logisticsOrder,
			party: { fields: 'all' },
			lines: { fields: logisticsLine },
			transactions: { fields: logisticsDocument },
			ext_sales_orders: { fields: logisticsReceipt },
			warehouse: { fields: ['name'] }
		}
	},
	constraints: {
		natural_key: { unique: ['source_order_key'], import_key: true },
		// a confirmed order keeps its sealed terms; these stay editable for metadata, sealing and a replacement draft
		confirmed: {
			locked: { status: { eq: 'confirmed' } },
			except: [
				'status',
				'title',
				'notes',
				'archived',
				'contract_versions',
				'agreed_total',
				'source_order_key',
				'draft_setup',
				'draft_basis',
				'operational_contracts',
				'check_hash',
				'contract_version',
				'sealed_at',
				'sealed_by',
				'sealed_snapshot',
				'sealed_commission',
				'sealed_contract',
				'sealed_contract_version',
				'seal_hash',
				'freight_treatment',
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
				'supporting_documents',
				'draft_document_ids'
			]
		}
	},
	indexes: { search: { text: ['number', 'title', 'party_name'] } },
	// the layers the document, confirmation and stock reads walk (their policies narrow them per team)
	create: {
		// each line prices itself in its own `create.transform`, after this one
		columns: {
			fields: [...terms, 'source_order_key'],
			lines: {
				fields: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate', 'print_values']
			}
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
			const defaultLayout = (direction: CreatedRow<'orders'>['direction']) => {
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
				if (row.draft_setup !== undefined) return yield* ctx.refuse('errors.evidence_sealed');
				if (
					row.document_template &&
					!layouts.rows.some((layout) => layout.id === row.document_template)
				)
					return yield* ctx.refuse('errors.document_layout_unpublished', {
						field: 'document_template'
					});
				if (row.print_values && !validPrintValues(row.print_values))
					return yield* ctx.refuse('errors.print_values_invalid', { field: 'print_values' });
				if (row.closure_snapshot !== undefined) return yield* ctx.refuse('errors.order_sealed');
				if (row.valid_from && row.valid_until && row.valid_until < row.valid_from)
					return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
				const party = yield* admitParty(
					ctx,
					parties.rows.find((p) => p.id === row.party),
					row.direction,
					warehouses.rows.find((w) => w.id === row.warehouse)
				);
				const files = row.supporting_documents ?? [];
				const selection = row.draft_document_ids ?? files.map((file) => file.id);
				if (selection.some((id) => !files.some((file) => file.id === id)))
					return yield* ctx.refuse('errors.evidence_sealed');
				out.push({
					...set,
					document_template: row.document_template ?? defaultLayout(row.direction) ?? null,
					...(row.print_values ? { print_values: orderedPrintValues(row.print_values) } : {}),
					source_order_key: row.source_order_key ?? crypto.randomUUID(),
					draft_document_ids: selection,
					ledger: party.source,
					party_name: party.name
				});
			}
			return out;
		}
	},
	update: {
		columns: {
			fields: [
				...terms,
				'status',
				'check_hash',
				'archived',
				'draft_setup',
				'source_order_key',
				'contract_versions'
			],
			lines: {
				fields: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate', 'print_values']
			}
		},
		transform: function* (changes, ctx) {
			const ids = changes.map((c) => c.before.id);
			const {
				parties,
				order_lines: lines,
				commercial_settings: settings,
				document_templates: templates,
				commission_rules: rules,
				warehouses,
				orders: references
			} = yield* ctx.query({
				orders: { where: { id: { in: ids } }, fields: ['number'] },
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
			const transformed = [];
			for (const { before: old, set: input, after } of changes) {
				if (
					input.source_order_key !== undefined &&
					input.source_order_key !== old.source_order_key &&
					ctx.actor.kind !== 'system'
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
				if (input.closure_snapshot !== undefined) return yield* ctx.refuse('errors.order_sealed');
				if (input.direction !== undefined && input.direction !== old.direction)
					return yield* ctx.refuse('errors.line_basis_locked', { field: 'direction' });
				const validFrom = after.valid_from;
				const validUntil = after.valid_until;
				if (validFrom && validUntil && validUntil < validFrom)
					return yield* ctx.refuse('errors.contract_validity', { field: 'valid_until' });
				const party = parties.rows.find((p) => p.id === after.party);
				const warehouse = warehouses.rows.find((w) => w.id === after.warehouse);
				const next = after.status;
				const storedVersions = agreements(old);
				if (input.contract_versions !== undefined) {
					if (ctx.actor.kind !== 'system' || !input.contract_versions)
						return yield* ctx.refuse('errors.evidence_sealed');
					const imported = input.contract_versions;
					const sourceKey = old.source_order_key ?? storedVersions[0]?.seal_hash;
					if (input.source_order_key !== undefined && input.source_order_key !== sourceKey)
						return yield* ctx.refuse('errors.evidence_sealed');
					const acceptedFields = [
						'contract_versions',
						// recomputed below from the versions
						'agreed_total',
						'contract_version',
						'sealed_at',
						'sealed_by',
						'sealed_snapshot',
						'sealed_commission',
						'sealed_contract',
						'sealed_contract_version',
						'seal_hash',
						'freight_treatment',
						'operational_contracts',
						'status',
						'check_hash',
						'ledger',
						'source_order_key'
					];
					if (
						(input.ledger !== undefined && input.ledger !== old.ledger) ||
						Object.keys(input).some((key) => !acceptedFields.includes(key))
					)
						return yield* ctx.refuse('errors.evidence_sealed');
					if (
						new Set(imported.map((version) => version.version)).size !== imported.length ||
						new Set(imported.map((version) => version.seal_hash)).size !== imported.length ||
						imported.filter((version) => version.lifecycle === 'current').length > 1
					)
						return yield* ctx.refuse('errors.evidence_sealed');
					for (const existing of storedVersions) {
						const retained = imported.find((version) => version.seal_hash === existing.seal_hash);
						if (
							!retained ||
							(yield* hash(contractProof(existing))) !== (yield* hash(contractProof(retained)))
						)
							return yield* ctx.refuse('errors.evidence_sealed');
						const events = existing.events ?? [];
						if (
							(yield* hash(events)) !==
							(yield* hash((retained.events ?? []).slice(0, events.length)))
						)
							return yield* ctx.refuse('errors.evidence_sealed');
						if (
							existing.kingdee &&
							(retained.kingdee?.source_version !== existing.kingdee.source_version ||
								(existing.kingdee.binding_id &&
									retained.kingdee?.binding_id !== existing.kingdee.binding_id))
						)
							return yield* ctx.refuse('errors.evidence_sealed');
					}
					const adopted = imported.find(
						(version) =>
							version.lifecycle === 'current' &&
							version.events?.at(-1)?.kind === 'adopted' &&
							version.seal_hash !== currentAgreement(old)?.seal_hash
					);
					if (
						adopted &&
						(old.archived ||
							old.status !== 'confirmed' ||
							adopted.seal_hash !== resolvableKingdee(storedVersions)?.seal_hash ||
							!('automation' in ctx.actor.by) ||
							ctx.actor.by.automation !== 'orders_revise')
					)
						return yield* ctx.refuse('errors.contract_source_changed');
					const currency = adopted?.snapshot.currency ?? old.currency;
					if (!isCurrency(currency)) return yield* ctx.refuse('errors.contract_source_changed');
					const current = executableAgreement({ ...old, contract_versions: imported });
					transformed.push({
						...input,
						...(adopted
							? {
									...agreementState(adopted),
									currency,
									supporting_documents: retainedContractDocuments(
										imported.map((version) => version.supporting_documents),
										old.supporting_documents ?? []
									)
								}
							: {}),
						...(old.status === 'draft'
							? {
									contract_version: Math.max(
										old.contract_version,
										...imported.map((version) => version.version + 1)
									)
								}
							: {}),
						operational_contracts: imported.map((version) => ({
							seal_hash: version.seal_hash,
							current: version.seal_hash === current?.seal_hash,
							lines: operationalLines(version.snapshot, lines.rows)
						}))
					});
					continue;
				}
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
				if (old.archived) return yield* ctx.refuse('errors.order_archived');
				const startContract = function* () {
					const current = input.draft_setup
						? agreement(old, input.draft_setup)
						: currentAgreement(old);
					if (
						current &&
						current.seal_hash !== currentAgreement(old)?.seal_hash &&
						!old.draft_setup &&
						(current.seal_hash !== resolvableKingdee(storedVersions)?.seal_hash ||
							ctx.actor.kind !== 'system' ||
							!('automation' in ctx.actor.by) ||
							ctx.actor.by.automation !== 'orders_revise')
					)
						return yield* ctx.refuse('errors.contract_source_changed');
					if (!current || !storedVersions.length) return yield* ctx.refuse('errors.order_sealed');
					const basis = {
						status: 'draft',
						draft_setup: current.seal_hash,
						document_template: current.snapshot.document_template_id ?? null,
						print_values: current.snapshot.print_values ?? null,
						currency: current.snapshot.currency,
						tax_inclusive: current.snapshot.tax_inclusive,
						ordered_on: current.ordered_on,
						warehouse: current.snapshot.warehouse || null,
						valid_from: current.snapshot.valid_from || null,
						valid_until: current.snapshot.valid_until || null,
						payment_terms: current.snapshot.payment_terms,
						delivery_terms: current.snapshot.delivery_terms || null,
						supporting_documents: current.supporting_documents ?? [],
						draft_document_ids: (current.supporting_documents ?? []).map((file) => file.id)
					};
					if (
						Object.entries(input).some(
							([key, value]) =>
								!Object.entries(basis).some(
									([field, expected]) =>
										field === key && JSON.stringify(value) === JSON.stringify(expected)
								)
						)
					)
						return yield* ctx.refuse('errors.order_sealed');
					return {
						...input,
						draft_setup: current.seal_hash,
						draft_basis: current.seal_hash,
						contract_versions: storedVersions.map((version) =>
							version.lifecycle === 'pending'
								? { ...version, lifecycle: 'superseded' as const }
								: version
						),
						supporting_documents: retainedContractDocuments(
							storedVersions.map((version) => version.supporting_documents ?? []),
							current.supporting_documents ?? []
						),
						draft_document_ids: (current.supporting_documents ?? []).map((file) => file.id),
						contract_version: Math.max(
							old.contract_version,
							...storedVersions.map((version) => version.version + 1)
						),
						check_hash: null
					};
				};
				const editOrder = function* () {
					if (old.draft_setup) {
						if (input.draft_setup !== null) {
							if (input.draft_setup === old.draft_setup) return yield* startContract();
							return yield* ctx.refuse('errors.contract_setup');
						}
						const current = agreement(old, old.draft_setup);
						const own = lines.rows.filter((line) => line.order === old.id);
						if (
							Object.keys(input).some((key) => key !== 'draft_setup') ||
							!current ||
							old.draft_setup !== current.seal_hash ||
							own.length !== current.snapshot.lines.length ||
							own.some((line) => {
								const target = draftLineTarget(current, line);
								return !target || !draftLineMatches(current, target, line);
							}) ||
							new Set(own.map((line) => draftLineTarget(current, line)?.id)).size !== own.length ||
							(old.document_template ?? null) !== (current.snapshot.document_template_id ?? null) ||
							!samePrintValues(old.print_values, current.snapshot.print_values) ||
							old.currency !== current.snapshot.currency ||
							old.tax_inclusive !== current.snapshot.tax_inclusive ||
							old.ordered_on !== current.ordered_on ||
							(old.warehouse ?? '') !== (current.snapshot.warehouse ?? '') ||
							(old.valid_from ?? '') !== (current.snapshot.valid_from ?? '') ||
							(old.valid_until ?? '') !== (current.snapshot.valid_until ?? '') ||
							old.payment_terms !== current.snapshot.payment_terms ||
							(old.delivery_terms ?? '') !== current.snapshot.delivery_terms ||
							JSON.stringify(
								selectedContractDocuments(old.supporting_documents ?? [], old.draft_document_ids)
									.map((file) => file.id)
									.sort()
							) !==
								JSON.stringify((current.supporting_documents ?? []).map((file) => file.id).sort())
						)
							return yield* ctx.refuse('errors.contract_setup');
						return {
							draft_setup: null,
							check_hash: null,
							document_template:
								old.document_template ??
								(old.direction === 'purchasing'
									? (config?.default_purchase_document_layout ?? config?.default_document_layout)
									: config?.default_document_layout) ??
								null
						};
					}
					if (input.draft_setup !== undefined) return yield* ctx.refuse('errors.contract_setup');
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
					const files = after.supporting_documents ?? [];
					const selection =
						input.draft_document_ids ??
						(input.supporting_documents !== undefined
							? files.map((file) => file.id)
							: old.draft_document_ids);
					const registry = retainedContractDocuments(
						storedVersions.map((version) => version.supporting_documents ?? []),
						files
					);
					if (selection?.some((id) => !registry.some((file) => file.id === id)))
						return yield* ctx.refuse('errors.evidence_sealed');
					return {
						...input,
						ledger: admitted.source,
						check_hash: null,
						...(input.print_values ? { print_values: orderedPrintValues(input.print_values) } : {}),
						...(input.supporting_documents !== undefined || input.draft_document_ids !== undefined
							? {
									supporting_documents: registry,
									draft_document_ids: selection ?? files.map((file) => file.id)
								}
							: {})
					};
				};
				const confirmOrder = function* () {
					if (old.draft_setup || input.draft_setup !== undefined)
						return yield* ctx.refuse('errors.contract_setup');
					const admitted = yield* admitParty(ctx, party, old.direction, warehouse);
					const own = lines.rows.filter((l) => l.order === old.id);
					if (terms.some((k) => input[k] !== undefined && input[k] !== old[k]))
						return yield* ctx.refuse('errors.save_before_confirm');
					const template = agreementTemplate(templates.rows, old.document_template);
					if (!config) return yield* ctx.refuse('errors.configuration_missing');
					if (!template)
						return yield* ctx.refuse('errors.document_layout_unpublished', {
							field: 'document_template'
						});
					if (!own.length) return yield* ctx.refuse('errors.lines_required');
					if (old.warehouse && !warehouses.rows.find((w) => w.id === old.warehouse)?.active)
						return yield* ctx.refuse('errors.warehouse_inactive');
					if (old.direction === 'sales' && !old.payment_terms.trim())
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
						...sealDocument(template)
					};
					const check_hash = yield* hash(confirmationBasis(old.revision, sealed, config, template));
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
								fixed_rate: text(rule.fixed_rate),
								spread_pct: text(rule.spread_pct)
							}
						: null;
					const reference = references.rows.find((o) => o.id === old.id)?.number;
					if (!reference) return yield* ctx.refuse('errors.order_reference_missing');
					const contract_version = old.contract_version;
					const documents = selectedContractDocuments(
						old.supporting_documents ?? [],
						old.draft_document_ids
					);
					const writeTarget =
						old.direction === 'sales' && old.ledger && !storedVersions.length
							? kingdeeWriteTarget(
									(yield* ctx.query({
										sys_integration: {
											where: { id: { eq: old.ledger }, integration: { eq: 'kingdee' } },
											fields: ['configuration'],
											limit: 1
										}
									})).sys_integration.rows[0]?.configuration
								)
							: null;
					const sealed_contract = agreementText(template, sealed, reference, old.ordered_on);
					const seal_hash = yield* hash({
						sealed,
						contract: sealed_contract,
						version: contract_version,
						documents
					});
					const contract: ContractVersion = {
						version: contract_version,
						seal_hash,
						basis_seal: old.draft_basis ?? null,
						snapshot: sealed,
						contract: sealed_contract,
						commission: sealed_commission,
						approved_at: ctx.now,
						approved_by: ctx.actor.kind === 'member' ? ctx.actor.id : ctx.actor.kind,
						ordered_on: old.ordered_on,
						freight_treatment: config.freight_treatment,
						supporting_documents: documents,
						...(writeTarget ? { write_target: writeTarget } : {}),
						origin: 'local',
						lifecycle: 'current'
					};
					const versions: ContractVersion[] = [
						...storedVersions.map((version) => ({ ...version, lifecycle: 'superseded' as const })),
						contract
					];
					const current = executableAgreement({ ...old, contract_versions: versions });
					return {
						...input,
						contract_versions: versions,
						source_order_key: old.source_order_key ?? storedVersions[0]?.seal_hash ?? seal_hash,
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
						operational_contracts: versions.map((version) => ({
							seal_hash: version.seal_hash,
							current: version.seal_hash === current?.seal_hash,
							lines: operationalLines(version.snapshot, lines.rows)
						}))
					};
				};
				const sealed = function* () {
					return yield* ctx.refuse('errors.order_sealed');
				};
				const TRANSITIONS = {
					'draft->draft': editOrder,
					'draft->confirmed': confirmOrder,
					'confirmed->draft': startContract,
					'confirmed->confirmed': sealed
				};
				transformed.push(yield* TRANSITIONS[`${old.status}->${next}`]());
			}
			return transformed.map((set) =>
				'contract_versions' in set && set.contract_versions
					? { ...set, agreed_total: agreedTotal(set.contract_versions) }
					: set
			);
		}
	},
	// an own draft's delete is judged by its holders' policies; its lines go with it
	delete: {},
	syncs: {
		// The line workbook: one row per line, matched by order number and the stable line key.
		lines: {
			with: 'file',
			parser: ['xlsx', 'csv'],
			schema: orderLineWorkbook,
			read: function* ({ records }, ctx) {
				const numbers = [...new Set(records.map((record) => record.order_number))];
				const { orders } = yield* ctx.query({
					orders: { where: { number: { in: numbers } }, fields: ['id', 'number', 'ledger'] }
				});
				const byNumber = new Map(orders.rows.map((order) => [order.number, order]));
				const orderIds = orders.rows.map((order) => order.id);
				const codes = [...new Set(records.map((record) => record.product_code))];
				const { products, order_lines: lines } = yield* ctx.query({
					products: {
						where: {
							or: [{ external_code: { in: codes } }, { source_number: { in: codes } }]
						},
						fields: ['id', 'source', 'external_code', 'source_number', 'name']
					},
					order_lines: {
						where: { order: { in: orderIds } },
						fields: ['id', 'order', 'line_key', 'product']
					}
				});
				const lineAt = (order: string, key: string | undefined) =>
					key
						? lines.rows.find((line) => line.order === order && line.line_key === key)
						: undefined;
				const findings: Finding[] = [];
				const rows: Record<string, string | number>[] = [];
				for (const record of records) {
					const at = Number(record.$at ?? 0);
					const order = byNumber.get(record.order_number);
					if (!order) {
						findings.push({
							at,
							field: 'Order number',
							severity: 'refuse',
							message: 'No visible order has this number.'
						});
						continue;
					}
					const matches = products.rows.filter(
						(product) =>
							product.source === order.ledger &&
							(product.external_code === record.product_code ||
								product.source_number === record.product_code)
					);
					if (matches.length !== 1) {
						findings.push({
							at,
							field: 'Product code',
							severity: 'refuse',
							message:
								matches.length === 0
									? 'No product in this order’s ledger has this code.'
									: 'More than one product matches this code; use its unique source number.'
						});
						continue;
					}
					const product = matches[0]!;
					const existing = lineAt(order.id, record.line_key ?? undefined);
					if (existing && existing.product !== product.id) {
						findings.push({
							at,
							field: 'Product code',
							severity: 'refuse',
							message: 'A line keeps its product; add a new line instead.'
						});
						continue;
					}
					const row: Record<string, string | number> = {
						order: order.id,
						product: product.id,
						quantity: record.quantity
					};
					if (record.line_key) row.line_key = record.line_key;
					if (record.unit_price != null) row.unit_price = record.unit_price;
					if (record.discount_pct != null) row.discount_pct = record.discount_pct;
					if (record.tax_rate != null) row.tax_rate = record.tax_rate;
					rows.push(row);
				}
				return { rows: [], related: { order_lines: rows }, findings };
			},
			write: function* (_input, ctx) {
				const { order_lines: lines } = yield* ctx.query({
					order_lines: {
						fields: [
							'id',
							'order',
							'line_key',
							'product',
							'quantity',
							'unit_price',
							'discount_pct',
							'tax_rate'
						] as const,
						limit: 10000
					}
				});
				const orderIds = [...new Set(lines.rows.map((line) => line.order))];
				const productIds = [...new Set(lines.rows.map((line) => line.product))];
				const { orders, products } = yield* ctx.query({
					orders: { where: { id: { in: orderIds } }, fields: ['id', 'number'] },
					products: {
						where: { id: { in: productIds } },
						fields: ['id', 'external_code', 'source_number']
					}
				});
				const orderNumber = new Map(orders.rows.map((order) => [order.id, order.number]));
				const productCode = new Map(
					products.rows.map((product) => [
						product.id,
						product.source_number ?? product.external_code
					])
				);
				return lines.rows
					.map((line) => ({
						order_number: orderNumber.get(line.order) ?? '',
						line_key: line.line_key ?? line.id,
						product_code: productCode.get(line.product) ?? '',
						quantity: Number(String(line.quantity)),
						unit_price: Number(String(line.unit_price)),
						discount_pct: Number(String(line.discount_pct)),
						tax_rate: Number(String(line.tax_rate))
					}))
					.sort(
						(a, b) =>
							a.order_number.localeCompare(b.order_number) || a.line_key.localeCompare(b.line_key)
					);
			}
		},
		// The table workbook: one header row per order, matched by its sequential number.
		sheet: {
			with: 'file',
			parser: ['xlsx', 'csv'],
			schema: orderWorkbook,
			read: function* ({ records }, ctx) {
				const numbers = [...new Set(records.flatMap((r) => (r.number ? [r.number] : [])))];
				const codes = [...new Set(records.map((r) => r.party_code))];
				const warehouseCodes = [
					...new Set(records.flatMap((r) => (r.warehouse_code ? [r.warehouse_code] : [])))
				];
				const { orders, parties, warehouses } = yield* ctx.query({
					orders: {
						where: { number: { in: numbers } },
						fields: [
							'id',
							'number',
							'ledger',
							'source_order_key',
							'party',
							'owner',
							'warehouse',
							'title',
							'direction',
							'ordered_on',
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
							'notes'
						]
					},
					parties: {
						where: {
							or: [{ external_code: { in: codes } }, { source_number: { in: codes } }]
						},
						fields: ['id', 'source', 'external_code', 'source_number', 'name', 'kind', 'active']
					},
					warehouses: {
						where: {
							or: [
								{ external_code: { in: warehouseCodes } },
								{ source_number: { in: warehouseCodes } }
							]
						},
						fields: ['id', 'source', 'external_code', 'source_number', 'name', 'active']
					}
				});
				const byNumber = new Map(orders.rows.map((order) => [order.number, order]));
				const findings: Finding[] = [];
				const rows: Record<string, string | boolean>[] = [];
				const text = (value: string | null | undefined) =>
					value != null && value.trim() !== '' ? value : undefined;
				for (const record of records) {
					const at = Number(record.$at ?? 0);
					const existing = record.number ? byNumber.get(record.number) : undefined;
					if (record.number && !existing) {
						findings.push({
							at,
							field: 'Order number',
							severity: 'refuse',
							message: 'No order has this number. Clear it to create a new order.'
						});
						continue;
					}
					const matches = parties.rows.filter(
						(party) =>
							party.external_code === record.party_code || party.source_number === record.party_code
					);
					const scoped = existing ? matches.filter((p) => p.source === existing.ledger) : matches;
					if (scoped.length !== 1) {
						findings.push({
							at,
							field: 'Party code',
							severity: 'refuse',
							message:
								scoped.length === 0
									? 'No party has this code in the order’s ledger.'
									: 'More than one ledger has this party code. Choose a code unique to one ledger.'
						});
						continue;
					}
					const party = scoped[0]!;
					const kind = record.direction === 'sales' ? 'customer' : 'supplier';
					if (!party.active || (party.kind !== kind && party.kind !== 'both')) {
						findings.push({
							at,
							field: 'Party code',
							severity: 'refuse',
							message: `Use an active ${kind} for a ${record.direction} order.`
						});
						continue;
					}
					const warehouse = record.warehouse_code
						? warehouses.rows.find(
								(row) =>
									row.source === party.source &&
									(row.external_code === record.warehouse_code ||
										row.source_number === record.warehouse_code)
							)
						: undefined;
					if (record.warehouse_code && (!warehouse || !warehouse.active)) {
						findings.push({
							at,
							field: 'Warehouse code',
							severity: 'refuse',
							message: 'No active warehouse has this code in the party’s ledger.'
						});
						continue;
					}
					if (!existing && !record.currency) {
						findings.push({
							at,
							field: 'Currency',
							severity: 'refuse',
							message: 'A new order needs its currency.'
						});
						continue;
					}
					const row: Record<string, string | boolean> = {
						party: party.id,
						direction: record.direction,
						title: record.title,
						payment_terms: record.payment_terms
					};
					if (record.currency) row.currency = record.currency;
					if (existing) {
						if (existing.source_order_key == null) {
							findings.push({
								at,
								field: 'Order number',
								severity: 'refuse',
								message: 'This order has no import key yet. Save it once in the app, then retry.'
							});
							continue;
						}
						row.source_order_key = existing.source_order_key;
					}
					if (warehouse) row.warehouse = warehouse.id;
					if (text(record.owner)) row.owner = text(record.owner)!;
					if (text(record.logistics_handler))
						row.logistics_handler = text(record.logistics_handler)!;
					for (const field of [
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
						'notes'
					] as const) {
						const value = text(record[field]);
						if (value !== undefined) row[field] = value;
					}
					for (const field of [
						'ordered_on',
						'valid_from',
						'valid_until',
						'delivery_date'
					] as const) {
						const value = record[field] == null ? undefined : String(record[field]);
						if (value !== undefined) row[field] = value;
					}
					if (record.tax_inclusive != null) row.tax_inclusive = record.tax_inclusive;
					const changed =
						existing === undefined ||
						Object.entries(row).some(
							([field, value]) =>
								field !== 'source_order_key' &&
								String(existing[field as keyof typeof existing] ?? '') !== String(value ?? '')
						);
					if (changed) rows.push(row);
				}
				return { rows, findings };
			},
			write: function* (_input, ctx) {
				const { orders } = yield* ctx.query({
					orders: {
						fields: [
							'number',
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
							'title',
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
							'notes'
						],
						order_by: { number: 'asc' },
						limit: 10000
					}
				});
				const { parties, warehouses } = yield* ctx.query({
					parties: {
						where: {
							id: { in: [...new Set(orders.rows.map((order) => order.party))] }
						},
						fields: ['external_code']
					},
					warehouses: {
						where: {
							id: {
								in: [
									...new Set(
										orders.rows.flatMap((order) => (order.warehouse ? [order.warehouse] : []))
									)
								]
							}
						},
						fields: ['external_code']
					}
				});
				const partyCode = new Map(parties.rows.map((party) => [party.id, party.external_code]));
				const warehouseCode = new Map(
					warehouses.rows.map((warehouse) => [warehouse.id, warehouse.external_code])
				);
				const date = <T>(value: T | null | undefined) => value ?? null;
				return orders.rows.map((order) => ({
					number: order.number,
					direction: order.direction,
					party_code: partyCode.get(order.party) ?? '',
					title: order.title,
					owner: order.owner,
					warehouse_code: order.warehouse ? (warehouseCode.get(order.warehouse) ?? '') : '',
					ordered_on: date(order.ordered_on),
					currency: order.currency,
					tax_inclusive: order.tax_inclusive,
					valid_from: date(order.valid_from),
					valid_until: date(order.valid_until),
					payment_terms: order.payment_terms,
					delivery_terms: date(order.delivery_terms),
					shipping_terms: date(order.shipping_terms),
					place_of_loading: date(order.place_of_loading),
					place_of_delivery: date(order.place_of_delivery),
					packaging: date(order.packaging),
					shipping_mark: date(order.shipping_mark),
					time_of_shipment: date(order.time_of_shipment),
					other_terms: date(order.other_terms),
					payment_method: date(order.payment_method),
					buyer_contact: date(order.buyer_contact),
					buyer_mobile: date(order.buyer_mobile),
					delivery_address: date(order.delivery_address),
					delivery_date: date(order.delivery_date),
					logistics_handler: date(order.logistics_handler),
					notes: date(order.notes)
				}));
			}
		},
		// Each contract keeps its source version observations; the outbox writes approved local replacements.
		kingdee: {
			with: 'kingdee',
			every: '1min',
			read: function* ({ cursor, instance }, ctx) {
				return yield* readContractVersions(instance, cursor, ctx);
			},
			write: function* ({ op, row, $id, $version, instance }, ctx) {
				// every kingdee account receives each change; an order is written only to its own ledger
				if (op === 'delete' || row.direction !== 'sales' || row.ledger !== instance) return null;
				const sealed = agreements(row);
				const initial = sealed[0];
				const contract =
					sealed.find(
						(version) => version.seal_hash === row.seal_hash && version.lifecycle === 'pending'
					) ?? currentAgreement(row);
				const writeTarget = initial?.write_target;
				if (!writeTarget || !contract || contract.origin === 'kingdee') return null;
				if ($version === contract.seal_hash) return null;

				// Keep the queued terms frozen. A previous delivery can gain its source proof
				// after these terms were approved, so take that proof from the current mirror.
				const [latest] = (yield* ctx.query({
					orders: { where: { id: { eq: row.id } }, limit: 1 }
				})).orders.rows;
				if (!latest) return null;
				const observed = agreements(latest);
				const accepted = kingdeeAgreement(observed);
				const receipt = observed.find((version) => version.seal_hash === $version);
				const delivered = observed.find((version) => version.seal_hash === contract.seal_hash);
				const defer = (message: string) => new FacilityFailure({ kind: 'upstream', message });
				const send = (version: ContractVersion, previous?: ContractVersion) => {
					const payload = orderPayload(row, version, writeTarget, previous);
					return submitOrder(payload, `${payload.order_id}:${payload.agreement_hash}`, ctx).pipe(
						Effect.mapError((cause) =>
							cause._tag === 'FacilityFailure'
								? cause
								: new FacilityFailure({
										kind: 'invalid',
										message: `Kingdee SO sync needs attention. ${cause._tag === 'SourceRowInvalid' ? cause.message : String(cause)}`
									})
						),
						Effect.map(($id) => ({ $id, $version: version.seal_hash }))
					);
				};
				if (delivered?.kingdee) {
					return delivered === accepted && delivered.kingdee.binding_id
						? { $id: delivered.kingdee.binding_id, $version: delivered.seal_hash }
						: null;
				}
				if (accepted && locallyAccepted(accepted) && accepted.version > contract.version)
					return null;
				if (!accepted && !$id && !observed.some((version) => version.kingdee)) {
					const result = yield* send(initial);
					if (initial.seal_hash === contract.seal_hash) return result;
					// A coalesced job still creates the original SO exactly once.
					return yield* defer(
						'The original Kingdee SO must be observed before replicating revised terms.'
					);
				}
				if (receipt && !receipt.kingdee)
					return yield* defer(
						'Waiting for the prior Kingdee write to appear in the source mirror.'
					);
				if (!accepted?.kingdee?.binding_id)
					return yield* defer('Waiting for a verified Kingdee SO binding.');
				if (accepted.origin === 'kingdee' && contract.basis_seal !== accepted.seal_hash)
					return yield* new FacilityFailure({
						kind: 'invalid',
						message:
							'Kingdee terms changed independently. Adopt those terms or revise from them, then retire this rejected write.'
					});
				if (!kingdeeTermsChanged(accepted, contract.snapshot)) return null;
				if (accepted.kingdee.status !== 'issued' || accepted.kingdee.closed)
					return yield* defer(
						'The source SO must be open and audited before syncing revised terms.'
					);
				return yield* send(contract, accepted);
			}
		}
	}
});

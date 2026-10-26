import { Decimal, sum } from '@norbital-ai/std/decimal';
import { averageLotCost } from '../../../lib/lot-cost.js';
import {
	agreements,
	currentAgreement,
	executableAgreement,
	type ContractVersion,
	agreementSelect,
	confirmationBasis,
	operationalLines
} from '../../../lib/agreements.js';
import { agreementText, publishedTemplate, orderDocument } from '../../../lib/order-document.js';
import { COMMISSION_ENGINE } from '../../../lib/commission-expressions.js';
import { submitOrder, type OrderPayload } from '../../../integration/kingdee/submission.js';
import { readContractVersions } from '../../../integration/kingdee/contract-versions.js';
import {
	retainedContractDocuments,
	selectedContractDocuments
} from '../../../lib/contract-files.js';
import { draftLineMatches, draftLineTarget } from '../../../lib/contract-draft.js';
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
					source_entry_id: { kind: 'text', optional: true },
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
	multiple: true,
	optional: true
} as const;
const contractVersionShape = {
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
		commission: { ...commissionShape, optional: true },
		supporting_documents: supportingDocuments,
		origin: { kind: 'enum', values: ['local', 'kingdee'], optional: true },
		lifecycle: { kind: 'enum', values: ['pending', 'current', 'superseded'], optional: true },
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
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							local_line_id: { kind: 'text' },
							entry_id: { kind: 'text' },
							detail_id: { kind: 'text' }
						}
					}
				}
			}
		},
		events: {
			kind: 'list',
			optional: true,
			of: {
				kind: 'object',
				fields: {
					key: { kind: 'text' },
					at: { kind: 'instant' },
					kind: { kind: 'text' },
					status: { kind: 'text' },
					source_version: { kind: 'text' },
					source_id: { kind: 'text' },
					source_changed_at: { kind: 'text', optional: true },
					source_changed_by: { kind: 'text', optional: true }
				}
			}
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
	'supporting_documents',
	'draft_document_ids'
] as const;
const contractProof = (version: ContractVersion) => ({
	version: version.version,
	seal_hash: version.seal_hash,
	snapshot: version.snapshot,
	contract: version.contract,
	commission: version.commission ?? null,
	approved_at: version.approved_at,
	approved_by: version.approved_by,
	ordered_on: version.ordered_on,
	freight_treatment: version.freight_treatment,
	supporting_documents: version.supporting_documents ?? []
});
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
	const versions = agreements(row);
	const pending = versions.find(
		(version) => version.seal_hash === row.seal_hash && version.lifecycle === 'pending'
	);
	const contract = row.status === 'confirmed' && pending ? pending : currentAgreement(row);
	if (!contract || contract.origin === 'kingdee' || contract.lifecycle === 'superseded')
		return null;
	const snapshot = contract.snapshot;
	const previous = versions
		.filter((version) => version.version < contract.version && version.kingdee)
		.sort((a, b) => b.version - a.version)[0];
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
		source_order_key: { kind: 'text', optional: true, hidden: true },
		draft_setup: { kind: 'text', optional: true, hidden: true },
		archived: { kind: 'bool', default: false },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['confirmed'] },
				confirmed: {
					to: ['draft'],
					edit: [
						'title',
						'notes',
						'archived',
						'contract_versions',
						'source_order_key',
						'draft_setup',
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
						'currency',
						'tax_inclusive',
						'valid_from',
						'valid_until',
						'payment_terms',
						'delivery_terms',
						'supporting_documents',
						'draft_document_ids'
					]
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
		supporting_documents: supportingDocuments,
		draft_document_ids: { kind: 'list', of: { kind: 'text' }, optional: true, hidden: true },
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
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						seal_hash: { kind: 'text' },
						current: { kind: 'bool', optional: true },
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
			shape: { kind: 'list', of: contractVersionShape }
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
			hidden: true,
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
	key: ['ledger', 'source_order_key'],
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
				if (row.source_order_key !== undefined || row.draft_setup !== undefined)
					return yield* ctx.refuse('errors.evidence_sealed');
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
					...row,
					source_order_key: crypto.randomUUID(),
					draft_document_ids: selection,
					ledger: party.source,
					party_name: party.name
				});
			}
			return out;
		}
	},
	update: {
		columns: [...terms, 'status', 'check_hash', 'archived', 'draft_setup'],
		with: {
			lines: {
				upsert: { columns: ['product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate'] },
				delete: true
			}
		},
		transform: function* (changes, ctx) {
			const ids = changes.map((c) => c.before.id);
			const {
				parties,
				lines,
				settings,
				templates,
				products,
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
				}
			});
			const config = settings.rows[0];
			const template = publishedTemplate(templates.rows, 'contract');
			const transformed: UpdateSet<'orders'>[] = [];
			for (const { before: old, set: input } of changes) {
				if (input.source_order_key !== undefined && ctx.actor.kind !== 'system')
					return yield* ctx.refuse('errors.evidence_sealed');
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
					const current = executableAgreement({ ...old, contract_versions: imported });
					transformed.push({
						...input,
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
					const current = currentAgreement(old);
					if (current?.kingdee?.status === 'void' || current?.kingdee?.closed)
						return yield* ctx.refuse('errors.contract_source_closed');
					if (!current || !storedVersions.length) return yield* ctx.refuse('errors.order_sealed');
					if (!current.kingdee?.binding_id || current.kingdee.status !== 'issued')
						return yield* ctx.refuse('errors.contract_pending');
					if (
						storedVersions.some(
							(version) => version.lifecycle === 'pending' && version.version > current.version
						)
					)
						return yield* ctx.refuse('errors.contract_pending');
					const basis = {
						status: 'draft',
						draft_setup: current.seal_hash,
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
							if (input.draft_setup === currentAgreement(old)?.seal_hash)
								return yield* startContract();
							return yield* ctx.refuse('errors.contract_setup');
						}
						const current = currentAgreement(old);
						const own = lines.rows.filter((line) => line.order === old.id);
						if (
							Object.keys(input).some((key) => key !== 'draft_setup') ||
							!current ||
							old.draft_setup !== current.seal_hash ||
							current.kingdee?.status !== 'issued' ||
							current.kingdee.closed ||
							own.length !== current.snapshot.lines.length ||
							own.some((line) => {
								const target = draftLineTarget(current, line);
								return !target || !draftLineMatches(current, target, line);
							}) ||
							new Set(own.map((line) => draftLineTarget(current, line)?.id)).size !== own.length ||
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
						return { draft_setup: null, check_hash: null };
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
					const files = input.supporting_documents ?? old.supporting_documents ?? [];
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
					const contract_version = old.contract_version;
					const documents = selectedContractDocuments(
						old.supporting_documents ?? [],
						old.draft_document_ids
					);
					const sealed_contract = agreementText(template, sealed, reference);
					const seal_hash = yield* hash({
						sealed,
						contract: sealed_contract,
						version: contract_version,
						documents
					});
					const contract: ContractVersion = {
						version: contract_version,
						seal_hash,
						snapshot: sealed,
						contract: sealed_contract,
						commission: sealed_commission,
						approved_at: ctx.now,
						approved_by: ctx.actor.kind === 'member' ? ctx.actor.id : ctx.actor.kind,
						ordered_on: old.ordered_on,
						freight_treatment: config.freight_treatment,
						supporting_documents: documents,
						origin: 'local',
						lifecycle: currentAgreement(old) ? 'pending' : 'current'
					};
					const versions = [...storedVersions, contract];
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
							status: { in: ['draft', 'confirmed'] }
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
				if (doc.draft_setup) return yield* ctx.refuse('errors.contract_setup');
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
				if (!doc) return yield* ctx.refuse('errors.order_not_confirmed');
				if (
					isMasked(doc.contract_versions) ||
					isMasked(doc.sealed_contract) ||
					isMasked(doc.sealed_snapshot)
				)
					return yield* ctx.refuse('errors.agreement_access');
				const current = currentAgreement(doc);
				if (!current) return yield* ctx.refuse('errors.order_not_confirmed');
				return { number: doc.number, contract: current.contract, seal_hash: current.seal_hash };
			}
		}
	},
	syncs: {
		// Each contract keeps its source version observations; the outbox writes approved local replacements.
		kingdee: {
			with: 'kingdee',
			every: '1min',
			read: function* ({ cursor, instance }, ctx) {
				return yield* readContractVersions(instance, cursor, ctx);
			},
			write: function* ({ op, row, $version }, ctx) {
				const payload = op === 'delete' ? null : orderPayload(row);
				// Metadata and imported source versions do not write back to Kingdee.
				if (payload === null || $version === payload.agreement_hash) return null;
				// Outbox rows are frozen; a proven newer source version retires an obsolete submission.
				const latest = yield* ctx.db.query('orders', { id: row.id });
				const accepted = latest ? currentAgreement(latest) : undefined;
				if (
					accepted?.kingdee?.binding_id &&
					accepted.version > payload.version &&
					accepted.seal_hash !== payload.agreement_hash
				)
					return { $id: accepted.kingdee.binding_id, $version: accepted.seal_hash };
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

import { model, type Id } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import {
	resolveCatalogLines,
	type BimTakeoffBucketRef,
	type CatalogItemRef
} from '../../../../lib/catalog-lines.js';
import {
	computeDocumentTotals,
	evaluateThreeWayMatch,
	toDecimal
} from '../../../../lib/commercial.js';
import { addCalendarDays } from '../../../../lib/dates.js';

const columns = [
	'project_id',
	'doc_type',
	'direction',
	'status',
	'external_reference',
	'contract_id',
	'contact_id',
	'parent_document_id',
	'currency',
	'tax_rate',
	'lines',
	'subtotal',
	'retention_amount',
	'certified_amount',
	'issue_date',
	'delivery_date',
	'due_date',
	'paid_date',
	'description',
	'attachments',
	'source_message_id'
] as const;

export default model('commercial_documents', {
	description:
		'Unified cashflow and procurement ledger covering Purchase Orders (PO), Delivery Orders (DO), Invoices, Progress Claims, and Credit Notes with 3-way PO/DO/Invoice matching and execution locks.',
	icon: 'lucide:banknote',
	record_label:
		"record.external_reference != null ? record.document_number + ' · ' + record.external_reference : record.document_number",
	fields: {
		document_number: { kind: 'seq', pattern: 'DOC-{yyyy}-{000}', per: ['project_id'] },
		external_reference: { kind: 'text', optional: true },
		doc_type: {
			kind: 'enum',
			values: ['purchase_order', 'delivery_order', 'invoice', 'progress_claim', 'credit_note'],
			default: 'invoice'
		},
		/** `inflow` = client/upstream PO, claim or invoice; `outflow` = subcontractor/supplier PO, DO or invoice. */
		direction: {
			kind: 'enum',
			values: ['inflow', 'outflow'],
			default: 'outflow'
		},
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['issued', 'cancelled'] },
				issued: { to: ['verified', 'certified', 'paid', 'disputed', 'cancelled'] },
				verified: { to: ['certified', 'paid', 'disputed'] },
				certified: { to: ['paid', 'disputed'] },
				paid: { to: [] },
				disputed: { to: ['draft', 'issued', 'verified', 'cancelled'] },
				cancelled: { to: [] }
			}
		},
		currency: { kind: 'currency', default: 'SGD' },
		tax_rate: { kind: 'decimal', scale: 2, default: 9 },
		lines: { kind: 'custom', of: 'priced_lines', optional: true },
		subtotal: { kind: 'money', currency: 'currency', default: 0 },
		tax_amount: { kind: 'money', currency: 'currency', default: 0 },
		total_amount: { kind: 'money', currency: 'currency', default: 0 },
		retention_amount: { kind: 'money', currency: 'currency', default: 0 },
		certified_amount: { kind: 'money', currency: 'currency', optional: true },
		net_amount: { kind: 'money', currency: 'currency', default: 0 },
		issue_date: { kind: 'date', optional: true, default: { var: 'today' } },
		delivery_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		paid_date: { kind: 'date', optional: true },
		match_status: {
			kind: 'enum',
			values: ['unmatched', 'partial', 'matched', 'variance'],
			default: 'unmatched'
		},
		match_notes: { kind: 'text', optional: true },
		description: { kind: 'text', format: 'markdown', optional: true },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'commercial_documents', owned: true },
		contract_id: {
			kind: 'ref',
			to: 'contracts',
			inverse: 'commercial_documents',
			optional: true,
			on_delete: 'set_null'
		},
		contact_id: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'commercial_documents',
			optional: true,
			on_delete: 'set_null'
		},
		/** Links a DO to its PO, an Invoice to its PO/DO, or a Credit Note to its Invoice for 3-way matching. */
		parent_document_id: {
			kind: 'ref',
			to: 'commercial_documents',
			inverse: 'linked_documents',
			optional: true,
			on_delete: 'set_null'
		},
		source_message_id: {
			kind: 'ref',
			to: 'project_messages',
			inverse: 'commercial_documents',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		valid_tax_rate: { check: { tax_rate: { gte: 0, lte: 100 } } },
		non_negative_subtotal: {
			check: {
				or: [{ doc_type: { eq: 'credit_note' } }, { subtotal: { gte: 0 } }]
			}
		},
		non_negative_retention: { check: { retention_amount: { gte: 0 } } },
		/** Issued/verified docs lock commercial lines and subtotal; only verification, certification, and settlement proceed. */
		issued_locked: {
			locked: { status: { in: ['issued', 'verified'] } },
			except: [
				'status',
				'certified_amount',
				'net_amount',
				'delivery_date',
				'paid_date',
				'match_status',
				'match_notes',
				'attachments'
			]
		},
		/** Certified docs freeze certified_amount; only payment settlement may proceed. */
		certified_locked: {
			locked: { status: { eq: 'certified' } },
			except: ['status', 'paid_date', 'attachments']
		},
		settled_locked: {
			locked: { status: { in: ['paid', 'cancelled'] } },
			except: ['attachments']
		}
	},
	indexes: {
		by_project_type: { on: ['project_id', 'doc_type', 'direction', 'status'] },
		find: { text: ['document_number', 'external_reference', 'description'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			contract_id: { fields: ['contract_number', 'title'] },
			contact_id: { fields: ['full_name', 'company_name', 'trade_specialty'] },
			parent_document_id: {
				fields: ['document_number', 'external_reference', 'doc_type', 'total_amount']
			},
			source_message_id: { fields: ['subject', 'transport'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			const projectIds = [...new Set(changes.map(({ after }) => after.project_id))];
			const contractIds = [
				...new Set(changes.flatMap(({ after }) => (after.contract_id ? [after.contract_id] : [])))
			];
			const parentIds = [
				...new Set(
					changes.flatMap(({ after }) =>
						after.parent_document_id ? [after.parent_document_id] : []
					)
				)
			];
			const lineCodes = [
				...new Set(
					changes.flatMap(({ after }) =>
						(after.lines ?? []).map((l) => l.code.trim()).filter((c) => c.length > 0)
					)
				)
			];
			const lookup = yield* ctx.query({
				projects: {
					where: { id: { in: projectIds } },
					fields: ['payment_terms_days'],
					limit: projectIds.length + 10,
					as_of: 'act'
				},
				...(contractIds.length > 0
					? {
							contracts: {
								where: { id: { in: contractIds } },
								fields: ['payment_terms_days'],
								limit: contractIds.length + 10,
								as_of: 'act'
							}
						}
					: {}),
				...(parentIds.length > 0
					? {
							commercial_documents: {
								where: {
									or: [{ id: { in: parentIds } }, { parent_document_id: { in: parentIds } }]
								},
								fields: ['doc_type', 'status', 'total_amount', 'parent_document_id'],
								limit: 500,
								as_of: 'act'
							}
						}
					: {}),
				...(lineCodes.length > 0
					? {
							cost_matrix: {
								where: { code: { in: lineCodes } },
								fields: ['code', 'name', 'category', 'unit', 'currency', 'unit_rate', 'active'],
								limit: lineCodes.length + 10,
								as_of: 'act'
							},
							cost_estimates: {
								where: { project_id: { in: projectIds } },
								fields: ['project_id', 'bim_assets'],
								limit: projectIds.length + 10,
								as_of: 'act'
							}
						}
					: {})
			});

			const matrixByCode = new Map<string, CatalogItemRef>(
				('cost_matrix' in lookup ? lookup.cost_matrix.rows : []).map((m) => [m.code, m] as const)
			);
			const bimByProject = new Map<string, readonly BimTakeoffBucketRef[]>(
				('cost_estimates' in lookup ? lookup.cost_estimates.rows : []).map(
					(est) => [est.project_id, est.bim_assets ?? []] as const
				)
			);
			const projectTerms = new Map(lookup.projects.rows.map((p) => [p.id, p.payment_terms_days]));
			const contractTerms = new Map(
				('contracts' in lookup ? lookup.contracts.rows : []).map((c) => [
					c.id,
					c.payment_terms_days
				])
			);
			const relatedDocs = 'commercial_documents' in lookup ? lookup.commercial_documents.rows : [];
			const parentTotals = new Map<Id<'commercial_documents'>, string>();
			const siblingSums = new Map<string, BigDecimal.BigDecimal>();
			for (const d of relatedDocs) {
				if (parentIds.includes(d.id)) parentTotals.set(d.id, d.total_amount);
				if (d.parent_document_id && d.status !== 'cancelled') {
					const k = `${d.parent_document_id}:${d.doc_type}`;
					siblingSums.set(
						k,
						BigDecimal.sum(
							siblingSums.get(k) ?? BigDecimal.fromBigInt(0n),
							toDecimal(d.total_amount)
						)
					);
				}
			}

			const out = [];
			for (const [row, { set, after }] of changes.entries()) {
				let normalizedLines = after.lines;
				if (after.lines != null && after.lines.length > 0) {
					const resolved = resolveCatalogLines({
						lines: after.lines,
						matrixByCode,
						bimBuckets: bimByProject.get(after.project_id)
					});
					if (!resolved.ok) {
						return yield* ctx.refuse('errors.line_requires_catalog', {
							field: 'lines',
							row,
							values: { code: resolved.missingCode }
						});
					}
					normalizedLines = [...resolved.lines];
				}
				const totals = computeDocumentTotals({
					lines: normalizedLines,
					subtotal: after.subtotal,
					tax_rate: after.tax_rate,
					retention_amount: after.retention_amount,
					certified_amount: after.certified_amount
				});
				const baseDate = after.issue_date ?? ctx.today;
				const terms =
					(after.contract_id ? contractTerms.get(after.contract_id) : undefined) ??
					projectTerms.get(after.project_id) ??
					30;
				const dueDate = after.due_date ?? addCalendarDays(baseDate, terms);

				let matchPatch: {
					match_status?: 'unmatched' | 'partial' | 'matched' | 'variance';
					match_notes?: string;
				} = {};
				if (after.parent_document_id != null) {
					const docType = after.doc_type ?? 'invoice';
					const parentAmt = parentTotals.get(after.parent_document_id);
					const k = `${after.parent_document_id}:${docType}`;
					const prevSib = siblingSums.get(k) ?? BigDecimal.fromBigInt(0n);
					matchPatch = evaluateThreeWayMatch({
						doc_type: docType,
						total_amount: totals.total_amount,
						parent_total: parentAmt,
						sibling_total: BigDecimal.format(prevSib)
					});
					siblingSums.set(k, BigDecimal.sum(prevSib, toDecimal(totals.total_amount)));
				}

				out.push({
					...set,
					...(totals.lines ? { lines: totals.lines } : {}),
					subtotal: totals.subtotal,
					tax_amount: totals.tax_amount,
					total_amount: totals.total_amount,
					net_amount: totals.net_amount,
					due_date: dueDate,
					...matchPatch
				});
			}
			return out;
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			const parentIds = [
				...new Set(
					changes.flatMap(({ after }) =>
						after.parent_document_id ? [after.parent_document_id] : []
					)
				)
			];
			const changedWithLines = changes.filter(
				(c) => c.changed('lines') && (c.after.lines ?? []).length > 0
			);
			const lineCodes = [
				...new Set(
					changedWithLines.flatMap((c) =>
						(c.after.lines ?? []).map((l) => l.code.trim()).filter((x) => x.length > 0)
					)
				)
			];
			const lineProjectIds = [...new Set(changedWithLines.map((c) => c.before.project_id))];

			const relatedDocs =
				parentIds.length === 0
					? []
					: (yield* ctx.query({
							commercial_documents: {
								where: {
									or: [{ id: { in: parentIds } }, { parent_document_id: { in: parentIds } }]
								},
								fields: ['doc_type', 'status', 'total_amount', 'parent_document_id'],
								limit: 500,
								as_of: 'act'
							}
						})).commercial_documents.rows;
			const catalogLookup =
				lineCodes.length === 0
					? null
					: yield* ctx.query({
							cost_matrix: {
								where: { code: { in: lineCodes } },
								fields: ['code', 'name', 'category', 'unit', 'currency', 'unit_rate', 'active'],
								limit: lineCodes.length + 10,
								as_of: 'act'
							},
							cost_estimates: {
								where: { project_id: { in: lineProjectIds } },
								fields: ['project_id', 'bim_assets'],
								limit: lineProjectIds.length + 10,
								as_of: 'act'
							}
						});
			const matrixByCode = new Map<string, CatalogItemRef>(
				(catalogLookup?.cost_matrix.rows ?? []).map((m) => [m.code, m] as const)
			);
			const bimByProject = new Map<string, readonly BimTakeoffBucketRef[]>(
				(catalogLookup?.cost_estimates.rows ?? []).map(
					(est) => [est.project_id, est.bim_assets ?? []] as const
				)
			);
			const parentTotals = new Map<Id<'commercial_documents'>, string>();
			for (const d of relatedDocs) {
				if (parentIds.includes(d.id)) parentTotals.set(d.id, d.total_amount);
			}

			const out = [];
			for (const [row, c] of changes.entries()) {
				let normalizedLines = c.after.lines;
				if (c.changed('lines') && c.after.lines != null && c.after.lines.length > 0) {
					const resolved = resolveCatalogLines({
						lines: c.after.lines,
						matrixByCode,
						bimBuckets: bimByProject.get(c.before.project_id)
					});
					if (!resolved.ok) {
						return yield* ctx.refuse('errors.line_requires_catalog', {
							field: 'lines',
							row,
							values: { code: resolved.missingCode }
						});
					}
					normalizedLines = [...resolved.lines];
				}
				const recompute = c.changed(
					'lines',
					'subtotal',
					'tax_rate',
					'retention_amount',
					'certified_amount'
				);
				const totals = recompute
					? computeDocumentTotals({
							lines: normalizedLines,
							subtotal: c.after.subtotal,
							tax_rate: c.after.tax_rate,
							retention_amount: c.after.retention_amount,
							certified_amount: c.after.certified_amount
						})
					: null;

				let matchPatch: {
					match_status?: 'unmatched' | 'partial' | 'matched' | 'variance';
					match_notes?: string | null;
				} = {};
				if (c.after.parent_document_id == null && c.changed('parent_document_id')) {
					matchPatch = { match_status: 'unmatched', match_notes: null };
				} else if (
					c.after.parent_document_id != null &&
					(recompute || c.changed('parent_document_id'))
				) {
					let siblingSum = BigDecimal.fromBigInt(0n);
					for (const d of relatedDocs) {
						if (
							d.id !== c.before.id &&
							d.parent_document_id === c.after.parent_document_id &&
							d.doc_type === c.after.doc_type &&
							d.status !== 'cancelled'
						) {
							siblingSum = BigDecimal.sum(siblingSum, toDecimal(d.total_amount));
						}
					}
					matchPatch = evaluateThreeWayMatch({
						doc_type: c.after.doc_type,
						total_amount: totals ? totals.total_amount : c.after.total_amount,
						parent_total: parentTotals.get(c.after.parent_document_id),
						sibling_total: BigDecimal.format(siblingSum)
					});
				}

				out.push({
					...c.set,
					...(totals
						? {
								...(totals.lines ? { lines: totals.lines } : {}),
								subtotal: totals.subtotal,
								tax_amount: totals.tax_amount,
								total_amount: totals.total_amount,
								net_amount: totals.net_amount
							}
						: {}),
					...matchPatch,
					...(c.changed('status') && c.after.status === 'paid' && c.after.paid_date == null
						? { paid_date: ctx.today }
						: {})
				});
			}
			return out;
		}
	}
});

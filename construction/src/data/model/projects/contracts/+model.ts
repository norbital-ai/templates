import { model } from '@norbital-ai/bolt';
import {
	resolveCatalogLines,
	type BimTakeoffBucketRef,
	type CatalogItemRef
} from '../../../../lib/catalog-lines.js';
import { computeLinesTotals, moneyStr, toDecimal } from '../../../../lib/commercial.js';
import { TRADE_SPECIALTIES } from '../../../../lib/trades.js';

const editableColumns = [
	'title',
	'project_id',
	'direction',
	'contract_type',
	'trade_specialty',
	'contact_id',
	'parent_contract_id',
	'status',
	'currency',
	'tax_rate',
	'lines',
	'contract_value',
	'retention_rate',
	'retention_cap_rate',
	'payment_terms_days',
	'contract_period',
	'dlp_months',
	'bond_amount',
	'insurance_expiry',
	'schedule_impact_days',
	'signed_date',
	'bim_pin',
	'scope_notes',
	'attachments',
	'source_message_id'
] as const;

export default model('contracts', {
	description:
		'Upstream client/main-contractor agreements, downstream trade subcontracts and supply contracts, and variation orders (VOs/EOTs) with priced schedules of values and execution locks. Retention, tax and payment terms are agreed here.',
	icon: 'lucide:file-signature',
	record_label:
		"record.contract_number != null ? record.contract_number + ' · ' + record.title : record.title",
	fields: {
		contract_number: { kind: 'seq', pattern: 'CTR-{yyyy}-{000}', per: ['project_id'] },
		title: { kind: 'text' },
		/** `upstream` = agreement with client or main contractor; `downstream` = subcontract or supply contract. */
		direction: {
			kind: 'enum',
			values: ['upstream', 'downstream'],
			default: 'downstream'
		},
		contract_type: {
			kind: 'enum',
			values: [
				'main_contract',
				'subcontract',
				'supply_agreement',
				'consultancy',
				'variation_order'
			],
			default: 'subcontract'
		},
		trade_specialty: {
			kind: 'enum',
			values: [...TRADE_SPECIALTIES],
			default: 'general'
		},
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['under_review', 'active', 'rejected'] },
				under_review: { to: ['active', 'draft', 'rejected'] },
				active: { to: ['completed', 'terminated'] },
				completed: { to: [] },
				terminated: { to: [] },
				rejected: { to: ['draft'] }
			}
		},
		currency: { kind: 'currency', default: 'SGD' },
		tax_rate: { kind: 'decimal', scale: 2, default: 9 },
		/** Schedule of values / priced line items; when provided, `contract_value` auto-sums from them. */
		lines: { kind: 'custom', of: 'priced_lines', optional: true },
		contract_value: { kind: 'money', currency: 'currency', default: 0 },
		retention_rate: { kind: 'decimal', scale: 2, default: 10 },
		retention_cap_rate: { kind: 'decimal', scale: 2, default: 5 },
		payment_terms_days: { kind: 'int', min: 0, max: 180, default: 30 },
		contract_period: { kind: 'period', of: 'date', optional: true },
		dlp_months: { kind: 'int', min: 0, max: 60, default: 12 },
		bond_amount: { kind: 'money', currency: 'currency', optional: true },
		insurance_expiry: { kind: 'date', optional: true },
		/** Approved/claimed EOT impact in calendar days (used by variation orders on the 4D timeline). */
		schedule_impact_days: { kind: 'int', default: 0 },
		signed_date: { kind: 'date', optional: true },
		bim_pin: { kind: 'custom', of: 'bim_pin', optional: true },
		scope_notes: { kind: 'text', format: 'markdown', optional: true },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'contracts', owned: true },
		contact_id: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'contracts',
			optional: true,
			on_delete: 'set_null'
		},
		parent_contract_id: {
			kind: 'ref',
			to: 'contracts',
			inverse: 'variations',
			optional: true,
			on_delete: 'set_null'
		},
		source_message_id: {
			kind: 'ref',
			to: 'project_messages',
			inverse: 'contracts',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		valid_tax_rate: { check: { tax_rate: { gte: 0, lte: 100 } } },
		valid_retention_rate: { check: { retention_rate: { gte: 0, lte: 100 } } },
		valid_retention_cap: { check: { retention_cap_rate: { gte: 0, lte: 100 } } },
		/** Under-review contracts lock pricing until returned to draft; record history keeps each priced version. */
		review_locked: {
			locked: { status: { eq: 'under_review' } },
			except: ['status', 'signed_date', 'attachments', 'scope_notes']
		},
		/** Active executed contracts lock pricing and core terms permanently; use variation orders for changes. */
		active_locked: {
			locked: { status: { eq: 'active' } },
			except: ['status', 'insurance_expiry', 'attachments', 'scope_notes']
		},
		settled_locked: {
			locked: { status: { in: ['completed', 'terminated'] } },
			except: ['attachments']
		}
	},
	indexes: {
		by_project_direction: { on: ['project_id', 'direction', 'status'] },
		find: { text: ['contract_number', 'title', 'scope_notes'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			contact_id: { fields: ['full_name', 'company_name', 'trade_specialty'] },
			parent_contract_id: { fields: ['contract_number', 'title'] },
			source_message_id: { fields: ['subject', 'transport'] }
		}
	},
	create: {
		fields: editableColumns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			const codes = [
				...new Set(
					changes.flatMap(({ after }) =>
						(after.lines ?? []).map((l) => l.code.trim()).filter((c) => c.length > 0)
					)
				)
			];
			const projectIds = [
				...new Set(
					changes
						.filter(({ after }) => (after.lines ?? []).length > 0)
						.map(({ after }) => after.project_id)
				)
			];
			const matrixByCode = new Map<string, CatalogItemRef>();
			const bimByProject = new Map<string, readonly BimTakeoffBucketRef[]>();
			if (codes.length > 0) {
				const lookup = yield* ctx.query({
					cost_matrix: {
						where: { code: { in: codes } },
						fields: ['code', 'name', 'category', 'unit', 'currency', 'unit_rate', 'active'],
						limit: codes.length + 10,
						as_of: 'act'
					},
					...(projectIds.length > 0
						? {
								cost_estimates: {
									where: { project_id: { in: projectIds } },
									fields: ['project_id', 'bim_assets'],
									limit: projectIds.length + 10,
									as_of: 'act'
								}
							}
						: {})
				});
				for (const m of lookup.cost_matrix.rows) matrixByCode.set(m.code, m);
				if ('cost_estimates' in lookup) {
					for (const est of lookup.cost_estimates.rows) {
						bimByProject.set(est.project_id, est.bim_assets ?? []);
					}
				}
			}

			const out = [];
			for (const [row, { set, after }] of changes.entries()) {
				if (after.lines && after.lines.length > 0) {
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
					const computed = computeLinesTotals(resolved.lines, '0');
					out.push({ ...set, lines: computed.lines, contract_value: computed.subtotal });
				} else {
					out.push({ ...set, contract_value: moneyStr(toDecimal(after.contract_value)) });
				}
			}
			return out;
		}
	},
	update: {
		fields: editableColumns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			const changedWithLines = changes.filter(
				(c) => c.changed('lines') && (c.after.lines ?? []).length > 0
			);
			const codes = [
				...new Set(
					changedWithLines.flatMap((c) =>
						(c.after.lines ?? []).map((l) => l.code.trim()).filter((x) => x.length > 0)
					)
				)
			];
			const projectIds = [...new Set(changedWithLines.map((c) => c.before.project_id))];
			const matrixByCode = new Map<string, CatalogItemRef>();
			const bimByProject = new Map<string, readonly BimTakeoffBucketRef[]>();
			if (codes.length > 0) {
				const lookup = yield* ctx.query({
					cost_matrix: {
						where: { code: { in: codes } },
						fields: ['code', 'name', 'category', 'unit', 'currency', 'unit_rate', 'active'],
						limit: codes.length + 10,
						as_of: 'act'
					},
					...(projectIds.length > 0
						? {
								cost_estimates: {
									where: { project_id: { in: projectIds } },
									fields: ['project_id', 'bim_assets'],
									limit: projectIds.length + 10,
									as_of: 'act'
								}
							}
						: {})
				});
				for (const m of lookup.cost_matrix.rows) matrixByCode.set(m.code, m);
				if ('cost_estimates' in lookup) {
					for (const est of lookup.cost_estimates.rows) {
						bimByProject.set(est.project_id, est.bim_assets ?? []);
					}
				}
			}

			const out = [];
			for (const [row, c] of changes.entries()) {
				if (
					c.changed('contract_value') &&
					!c.changed('lines') &&
					c.after.lines != null &&
					c.after.lines.length > 0 &&
					c.before.status === 'draft'
				) {
					return yield* ctx.refuse('errors.contract_value_managed_by_lines', {
						field: 'contract_value',
						row
					});
				}
				let computed = null;
				if (c.changed('lines') && c.after.lines && c.after.lines.length > 0) {
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
					computed = computeLinesTotals(resolved.lines, '0');
				}
				out.push({
					...c.set,
					...(computed ? { lines: computed.lines, contract_value: computed.subtotal } : {}),
					...(c.changed('status') && c.after.status === 'active' && c.after.signed_date == null
						? { signed_date: ctx.today }
						: {})
				});
			}
			return out;
		}
	}
});

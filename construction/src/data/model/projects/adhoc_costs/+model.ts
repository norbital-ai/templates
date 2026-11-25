import { model } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import { formatTrimmed, moneyStr, toDecimal } from '../../../../lib/commercial.js';

const columns = [
	'catalog_item_id',
	'title',
	'project_id',
	'status',
	'currency',
	'unit',
	'qty',
	'unit_rate',
	'incurred_date',
	'contact_id',
	'notes',
	'attachments'
] as const;

function computeAmount(
	qtyLike: string | number | null | undefined,
	rateLike: string | number | null | undefined
) {
	const qty = BigDecimal.max(BigDecimal.fromBigInt(0n), toDecimal(qtyLike));
	const rate = BigDecimal.max(BigDecimal.fromBigInt(0n), toDecimal(rateLike));
	const amount = BigDecimal.round(BigDecimal.multiply(qty, rate), {
		scale: 2,
		mode: 'half-from-zero'
	});
	return {
		qty: formatTrimmed(qty, 3),
		unit_rate: moneyStr(rate),
		amount: moneyStr(amount)
	};
}

export default model('adhoc_costs', {
	description:
		'Catalog-backed non-BIM project ad-hoc and preliminary costs (mobilisation, craneage, hoarding, permits, testing & commissioning, temporary works, overheads). Every entry references an active non-BIM Costing Matrix catalog item so units and cashflow stay measurable.',
	icon: 'lucide:receipt-text',
	record_label:
		"record.cost_number != null ? record.cost_number + ' · ' + record.title : record.title",
	fields: {
		cost_number: { kind: 'seq', pattern: 'ADH-{yyyy}-{000}', per: ['project_id'] },
		/** Mandatory Costing Matrix catalog item (category = additional_cost) governing unit and currency. */
		catalog_item_id: {
			kind: 'ref',
			to: 'cost_matrix',
			inverse: 'adhoc_costs',
			on_delete: 'restrict'
		},
		title: { kind: 'text' },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['approved', 'cancelled'] },
				approved: { to: ['incurred', 'draft', 'cancelled'] },
				incurred: { to: [] },
				cancelled: { to: ['draft'] }
			}
		},
		currency: { kind: 'currency', default: 'SGD' },
		unit: { kind: 'text', default: 'ls' },
		qty: { kind: 'decimal', scale: 3, default: 1 },
		unit_rate: { kind: 'money', currency: 'currency', default: 0 },
		amount: { kind: 'money', currency: 'currency', default: 0 },
		incurred_date: { kind: 'date', optional: true },
		notes: { kind: 'text', format: 'markdown', optional: true },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'adhoc_costs', owned: true },
		contact_id: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'adhoc_costs',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		non_negative_qty: { check: { qty: { gte: 0 } } },
		non_negative_rate: { check: { unit_rate: { gte: 0 } } },
		settled_locked: {
			locked: { status: { in: ['incurred', 'cancelled'] } },
			except: ['status', 'attachments', 'notes']
		}
	},
	indexes: {
		by_project_status: { on: ['project_id', 'status'] },
		find: { text: ['cost_number', 'title', 'notes'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			catalog_item_id: { fields: ['code', 'name', 'unit', 'currency', 'unit_rate'] },
			contact_id: { fields: ['full_name', 'company_name'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			const catalogIds = [...new Set(changes.map(({ after }) => after.catalog_item_id))];
			const catalogs = (yield* ctx.query({
				cost_matrix: {
					where: { id: { in: catalogIds } },
					fields: ['code', 'name', 'category', 'unit', 'currency', 'unit_rate', 'active'],
					limit: catalogIds.length + 10,
					as_of: 'act'
				}
			})).cost_matrix.rows;
			const catalogById = new Map(catalogs.map((c) => [c.id, c] as const));

			const out = [];
			for (const [row, { set, after }] of changes.entries()) {
				const cat = catalogById.get(after.catalog_item_id);
				if (cat === undefined || !cat.active || cat.category !== 'additional_cost') {
					return yield* ctx.refuse('errors.adhoc_requires_catalog', {
						field: 'catalog_item_id',
						row
					});
				}
				const rateInput =
					set.unit_rate !== undefined && BigDecimal.isPositive(toDecimal(after.unit_rate))
						? after.unit_rate
						: cat.unit_rate;
				const computed = computeAmount(after.qty, rateInput);
				out.push({
					...set,
					title: after.title.trim() || cat.name,
					currency: cat.currency,
					unit: cat.unit,
					...computed
				});
			}
			return out;
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			const catalogIds = [
				...new Set(
					changes
						.filter((c) => c.changed('catalog_item_id', 'unit', 'currency'))
						.map((c) => c.after.catalog_item_id)
				)
			];
			const catalogs =
				catalogIds.length === 0
					? []
					: (yield* ctx.query({
							cost_matrix: {
								where: { id: { in: catalogIds } },
								fields: ['code', 'name', 'category', 'unit', 'currency', 'unit_rate', 'active'],
								limit: catalogIds.length + 10,
								as_of: 'act'
							}
						})).cost_matrix.rows;
			const catalogById = new Map(catalogs.map((c) => [c.id, c] as const));

			const out = [];
			for (const [row, c] of changes.entries()) {
				const cat = catalogById.get(c.after.catalog_item_id);
				if (c.changed('catalog_item_id', 'unit', 'currency')) {
					if (cat === undefined || !cat.active || cat.category !== 'additional_cost') {
						return yield* ctx.refuse('errors.adhoc_requires_catalog', {
							field: 'catalog_item_id',
							row
						});
					}
				}
				const nextRate =
					c.changed('catalog_item_id') && !c.changed('unit_rate') && cat !== undefined
						? cat.unit_rate
						: c.after.unit_rate;
				const recompute = c.changed('qty', 'unit_rate', 'catalog_item_id');
				const computed = recompute ? computeAmount(c.after.qty, nextRate) : {};
				out.push({
					...c.set,
					...(cat !== undefined ? { currency: cat.currency, unit: cat.unit } : {}),
					...computed,
					...(c.changed('status') && c.after.status === 'incurred' && c.after.incurred_date == null
						? { incurred_date: ctx.today }
						: {})
				});
			}
			return out;
		}
	},
	delete: {}
});

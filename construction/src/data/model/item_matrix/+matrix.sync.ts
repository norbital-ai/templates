import { sync } from '@norbital-ai/bolt';
import { TRADE_SPECIALTIES, type TradeSpecialty } from '../../../lib/trades.js';

const TRADE_SET = new Set<string>(TRADE_SPECIALTIES);
const asTrade = (v: string | null | undefined): TradeSpecialty => {
	const k = v?.trim().toLowerCase() ?? '';
	return TRADE_SET.has(k) ? (TRADE_SPECIALTIES.find((t) => t === k) ?? 'general') : 'general';
};

const CATEGORIES = ['bim_asset', 'additional_cost'] as const;
const DISCIPLINES = [
	'architecture',
	'structural',
	'mep',
	'civil',
	'preliminaries',
	'general'
] as const;
const UNITS = ['ea', 'm', 'm2', 'm3', 'kg', 'ls', 'month', 'pct'] as const;
const BASES = ['count', 'length', 'area', 'volume', 'weight', 'lump_sum', 'pct_of_bim'] as const;

const pick = <T extends string>(
	list: readonly T[],
	raw: string | null | undefined,
	fallback: T
): T => {
	const k = raw?.trim().toLowerCase() ?? '';
	return list.find((item) => item === k) ?? fallback;
};

const splitTokens = (raw: string | null | undefined): string[] =>
	(raw ?? '')
		.split(/[;,]/)
		.map((s) => s.trim())
		.filter(Boolean);

/**
 * Bulk XLSX / CSV import and export for the Item Matrix.
 */
export default sync('item_matrix', 'matrix', {
	with: 'file',
	parser: ['xlsx', 'csv'],
	schema: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		category: { kind: 'text', optional: true },
		discipline: { kind: 'text', optional: true },
		trade_specialty: { kind: 'text', optional: true },
		ifc_classes: { kind: 'text', optional: true },
		match_keywords: { kind: 'text', optional: true },
		unit: { kind: 'text', optional: true },
		quantity_basis: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		unit_rate: { kind: 'text' },
		waste_factor_pct: { kind: 'text', optional: true },
		carbon_factor: { kind: 'text', optional: true },
		active: { kind: 'bool', optional: true }
	},
	read: function* ({ records }) {
		return {
			rows: records
				.filter((r) => r.code.trim() && r.name.trim())
				.map((r) => ({
					code: r.code.trim(),
					name: r.name.trim(),
					category: pick(CATEGORIES, r.category, 'bim_asset'),
					discipline: pick(DISCIPLINES, r.discipline, 'mep'),
					trade_specialty: asTrade(r.trade_specialty),
					ifc_classes: splitTokens(r.ifc_classes),
					match_keywords: splitTokens(r.match_keywords),
					unit: pick(UNITS, r.unit, 'ea'),
					quantity_basis: pick(BASES, r.quantity_basis, 'count'),
					currency: r.currency ?? ('SGD' as const),
					unit_rate: r.unit_rate.trim() || '0',
					waste_factor_pct: r.waste_factor_pct?.trim() || '0',
					carbon_factor: r.carbon_factor?.trim() || '0',
					active: r.active ?? true
				}))
		};
	},
	write: function* (_input, ctx) {
		const { item_matrix } = yield* ctx.query({
			item_matrix: {
				fields: [
					'code',
					'name',
					'category',
					'discipline',
					'trade_specialty',
					'ifc_classes',
					'match_keywords',
					'unit',
					'quantity_basis',
					'currency',
					'unit_rate',
					'waste_factor_pct',
					'carbon_factor',
					'active'
				],
				order_by: { code: 'asc' },
				limit: 10000
			}
		});
		return item_matrix.rows.map((r) => ({
			code: r.code,
			name: r.name,
			category: r.category,
			discipline: r.discipline,
			trade_specialty: r.trade_specialty,
			ifc_classes: (r.ifc_classes ?? []).join('; '),
			match_keywords: (r.match_keywords ?? []).join('; '),
			unit: r.unit,
			quantity_basis: r.quantity_basis,
			currency: r.currency,
			unit_rate: r.unit_rate,
			waste_factor_pct: r.waste_factor_pct,
			carbon_factor: r.carbon_factor,
			active: r.active
		}));
	}
});

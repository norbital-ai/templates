import { model } from '@norbital-ai/bolt';
import { TRADE_SPECIALTIES } from '../../../lib/trades.js';

const columns = [
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
	'rate_basis',
	'validity',
	'active',
	'notes'
] as const;

export default model('item_matrix', {
	description:
		'Item Matrix mapping IFC building/MEP asset classifications and non-BIM allowances to exact unit rates, measurement bases, wastage factors, and embodied carbon factors.',
	icon: 'lucide:table-2',
	record_label: "record.code + ' · ' + record.name",
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		/** `bim_asset` matches elements extracted from IFC models; `additional_cost` seeds non-BIM cost allowances. */
		category: {
			kind: 'enum',
			values: ['bim_asset', 'additional_cost'],
			default: 'bim_asset'
		},
		discipline: {
			kind: 'enum',
			values: ['architecture', 'structural', 'mep', 'civil', 'preliminaries', 'general'],
			default: 'mep'
		},
		trade_specialty: {
			kind: 'enum',
			values: [...TRADE_SPECIALTIES],
			default: 'general'
		},
		/** IFC entity types matched by this rate (e.g. `IFCFLOWTERMINAL`, `IFCWALLSTANDARDCASE`). */
		ifc_classes: { kind: 'text', many: true, optional: true },
		/** Optional case-insensitive family/property/classification tokens that narrow matching within an IFC class. */
		match_keywords: { kind: 'text', many: true, optional: true },
		unit: {
			kind: 'enum',
			values: ['ea', 'm', 'm2', 'm3', 'kg', 'ls', 'month', 'pct'],
			default: 'ea'
		},
		quantity_basis: {
			kind: 'enum',
			values: ['count', 'length', 'area', 'volume', 'weight', 'lump_sum', 'pct_of_bim'],
			default: 'count'
		},
		currency: { kind: 'currency', default: 'SGD' },
		unit_rate: { kind: 'money', currency: 'currency', default: 0 },
		waste_factor_pct: { kind: 'decimal', scale: 1, default: 0 },
		/** Embodied carbon per one `unit` of the item, in kgCO2e. */
		carbon_factor: { kind: 'decimal', scale: 3, default: 0 },
		rate_basis: {
			kind: 'enum',
			values: ['tender', 'benchmark', 'subcon_quote', 'assumption'],
			default: 'benchmark'
		},
		validity: { kind: 'period', of: 'date', optional: true },
		active: { kind: 'bool', default: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		code: { unique: ['code'], import_key: true },
		valid_rate: { check: { unit_rate: { gte: 0 } } },
		valid_carbon: { check: { carbon_factor: { gte: 0 } } },
		valid_waste: { check: { waste_factor_pct: { gte: 0, lte: 100 } } }
	},
	indexes: {
		by_category_active: { on: ['category', 'active'] },
		find: { text: ['code', 'name', 'notes'] }
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: columns },
	update: { fields: columns },
	delete: {}
});

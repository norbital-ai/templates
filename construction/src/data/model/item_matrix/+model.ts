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
	'system_services',
	'min_size_mm',
	'max_size_mm',
	'insulated',
	'topology_mode',
	'unit',
	'quantity_basis',
	'currency',
	'unit_rate',
	'waste_factor_pct',
	'carbon_factor',
	'rate_basis',
	'derived_from',
	'ratio',
	'stands_in_for',
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
		/** Canonical MEP / trade service tags matched by this item (e.g. `hydronic_hvac`, `domestic_cold_water`, `sanitary_dwv`). */
		system_services: { kind: 'text', many: true, optional: true },
		/** Optional minimum nominal cross-section diameter or thickness (mm) covered by this rate. */
		min_size_mm: { kind: 'decimal', scale: 1, optional: true },
		/** Optional maximum nominal cross-section diameter or thickness (mm) covered by this rate. */
		max_size_mm: { kind: 'decimal', scale: 1, optional: true },
		/** Whether this rate applies to insulated, uninsulated, or any piping/ductwork. */
		insulated: { kind: 'enum', values: ['any', 'insulated', 'uninsulated'], default: 'any' },
		/** Expected geometric continuity of elements priced by this item (`auto` infers from IFC class/basis). */
		topology_mode: {
			kind: 'enum',
			values: ['auto', 'discontiguous', 'contiguous_linear', 'contiguous_planar'],
			default: 'auto'
		},
		unit: {
			kind: 'enum',
			values: ['ea', 'm', 'm2', 'm3', 'kg', 'ls', 'month', 'pct'],
			default: 'ea'
		},
		/**
		 * What one `unit` measures. `derived`: a quantity the model does not carry (unmodelled rebar, formwork, paint),
		 * `ratio` units per unit of item `derived_from` as the estimate priced it, storey by storey.
		 */
		quantity_basis: {
			kind: 'enum',
			values: ['count', 'length', 'area', 'volume', 'weight', 'lump_sum', 'pct_of_bim', 'derived'],
			default: 'count'
		},
		/** For `derived`: the code of the item whose priced quantity this one follows (e.g. a slab's concrete m³). */
		derived_from: { kind: 'text', optional: true },
		/** For `derived`: units of this item per one unit of `derived_from` (e.g. 100 kg of rebar per m³ of slab). */
		ratio: { kind: 'decimal', scale: 4, optional: true },
		/**
		 * For `derived`: the modelled item this one stands in for (e.g. modelled rebar); on a storey where the model
		 * carries that item, the derived quantity is left out so nothing is counted twice.
		 */
		stands_in_for: { kind: 'text', optional: true },
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
		valid_waste: { check: { waste_factor_pct: { gte: 0, lte: 100 } } },
		derived_needs_source: {
			check: {
				or: [
					{ quantity_basis: { ne: 'derived' } },
					{ derived_from: { is_null: false }, ratio: { gt: 0 } }
				]
			}
		}
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

import { model } from '@norbital-ai/bolt';
import {
	DEFAULT_BIM_CONFIG,
	DEFAULT_EXCLUDE_IFC_CLASSES,
	DEFAULT_MATERIAL_DENSITIES,
	DEFAULT_SERVICE_ALIASES,
	DEFAULT_SIZE_BANDS_MM
} from '../../../services/bim/config.js';

const columns = [
	'code',
	'name',
	'min_confidence',
	'duplicate_center_tol_m',
	'shape_tolerance_pct',
	'size_band_step_mm',
	'connection_gap_tol_m',
	'variance_flag_pct',
	'auto_reclassify_generic',
	'auto_split_multi_storey',
	'auto_deduplicate',
	'exclude_ifc_classes',
	'size_bands_mm',
	'material_densities',
	'service_aliases',
	'extra_property_keys',
	'max_visual_archetypes',
	'max_proposals',
	'max_candidates',
	'notes'
] as const;

/**
 * Workspace-level BIM takeoff, cleanup, metrology, and classification rules.
 * Eliminates hardcoded tolerances, size bands, material densities, and service aliases so commercial teams can
 * tune BIM accuracy and human-in-the-loop review thresholds per workspace.
 */
export default model('bim_settings', {
	description:
		'Configurable BIM takeoff, cleanup, topology, metrology, and AI classification settings for the workspace.',
	icon: 'lucide:sliders-horizontal',
	record_label: 'record.name',
	fields: {
		/** Singleton key (`default`) for the active workspace configuration. */
		code: { kind: 'text', default: 'default' },
		name: { kind: 'text', default: 'Default BIM Takeoff & Cleanup Policy' },
		/** Minimum System 1 confidence (0.10–0.99) required to accept an automatic catalog match. */
		min_confidence: { kind: 'decimal', scale: 2, default: DEFAULT_BIM_CONFIG.min_confidence },
		/** Center-distance tolerance (metres) used to detect duplicate elements in federated models. */
		duplicate_center_tol_m: {
			kind: 'decimal',
			scale: 3,
			default: DEFAULT_BIM_CONFIG.duplicate_center_tol_m
		},
		/** Geometry shape similarity tolerance (%) for deduplication and identical-archetype merging. */
		shape_tolerance_pct: {
			kind: 'decimal',
			scale: 1,
			default: DEFAULT_BIM_CONFIG.shape_tolerance_pct
		},
		/** Cross-section / dimension rounding step (mm) for cross-project asset signatures. */
		size_band_step_mm: {
			kind: 'decimal',
			scale: 1,
			default: DEFAULT_BIM_CONFIG.size_band_step_mm
		},
		/** Maximum gap (metres) when stitching contiguous MEP runs without explicit IFC ports. */
		connection_gap_tol_m: {
			kind: 'decimal',
			scale: 3,
			default: DEFAULT_BIM_CONFIG.connection_gap_tol_m
		},
		/** Quantity divergence (%) between IFC properties and mesh metrology that flags a line for QS review. */
		variance_flag_pct: {
			kind: 'decimal',
			scale: 1,
			default: DEFAULT_BIM_CONFIG.variance_flag_pct
		},
		/** Automatically upgrade generic IFC2x3/proxy classes to canonical classes and continuity modes. */
		auto_reclassify_generic: { kind: 'bool', default: true },
		/** Proportionally split multi-storey risers and walls across storey elevation bands. */
		auto_split_multi_storey: { kind: 'bool', default: true },
		/** Drop federated duplicate elements occupying the same 3D space. */
		auto_deduplicate: { kind: 'bool', default: true },
		/** IFC classes excluded from takeoff and 3D fragment conversion (e.g. IFCSPACE, IFCOPENINGELEMENT). */
		exclude_ifc_classes: { kind: 'text', many: true, default: [...DEFAULT_EXCLUDE_IFC_CLASSES] },
		/** Upper-bound nominal diameter / thickness bands (mm) used to separate linear/planar sizes. */
		size_bands_mm: { kind: 'int', many: true, default: [...DEFAULT_SIZE_BANDS_MM] },
		/** Material family → density in kg/m³ for automatic weight takeoff. */
		material_densities: {
			kind: 'json',
			optional: true,
			default: { ...DEFAULT_MATERIAL_DENSITIES, concrete: 2400 }
		},
		/** Canonical MEP service tag → keyword phrases matched against systems, properties, and connected plant. */
		service_aliases: {
			kind: 'json',
			optional: true,
			default: Object.fromEntries(
				Object.entries(DEFAULT_SERVICE_ALIASES).map(([k, v]) => [k, [...v]])
			)
		},
		/** Extra IFC property names (e.g. firm shared parameters, Uniclass/CORENET tags) to retain during parsing. */
		extra_property_keys: { kind: 'text', many: true, optional: true },
		/** Maximum unique assets pictured in WebGL per takeoff. */
		max_visual_archetypes: { kind: 'int', min: 1, max: 2000, default: 200 },
		/** Maximum System 2 Item Matrix proposals generated per run. */
		max_proposals: { kind: 'int', min: 0, max: 200, default: 30 },
		/** Maximum ranked Item Matrix candidates offered per System 1 decision. */
		max_candidates: { kind: 'int', min: 10, max: 250, default: 80 },
		notes: { kind: 'text', format: 'markdown', optional: true }
	},
	constraints: {
		unique_code: { unique: ['code'], import_key: true },
		valid_confidence: { check: { min_confidence: { gte: 0.1, lte: 0.99 } } },
		valid_variance: { check: { variance_flag_pct: { gte: 1, lte: 100 } } }
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: columns },
	update: { fields: columns }
});

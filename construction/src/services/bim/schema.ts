/**
 * Single-source Effect Schemas and derived domain types for BIM parsing, geometry cleanup,
 * pricing, compliance evaluation, and IFC organization.
 */
import { Schema } from 'effect';
import type { DecimalLike } from '../commercial/decimal.js';

export const ContinuityModeSchema = Schema.Literals([
	'discontiguous',
	'contiguous_linear',
	'contiguous_planar'
]);
export type ContinuityMode = typeof ContinuityModeSchema.Type;

export const BimConfigSchema = Schema.Struct({
	min_confidence: Schema.Number,
	duplicate_center_tol_m: Schema.Number,
	shape_tolerance_pct: Schema.Number,
	size_band_step_mm: Schema.Number,
	connection_gap_tol_m: Schema.Number,
	variance_flag_pct: Schema.Number,
	auto_reclassify_generic: Schema.Boolean,
	auto_split_multi_storey: Schema.Boolean,
	auto_deduplicate: Schema.Boolean,
	exclude_ifc_classes: Schema.Array(Schema.String),
	size_bands_mm: Schema.Array(Schema.Number),
	material_densities: Schema.Record(Schema.String, Schema.Number),
	service_aliases: Schema.Record(Schema.String, Schema.Array(Schema.String)),
	extra_property_keys: Schema.Array(Schema.String),
	max_visual_archetypes: Schema.Number,
	max_proposals: Schema.Number,
	max_candidates: Schema.Number
});
export type BimConfig = typeof BimConfigSchema.Type;

export type BimSettingsRow = {
	readonly min_confidence?: string | number | null;
	readonly duplicate_center_tol_m?: string | number | null;
	readonly shape_tolerance_pct?: string | number | null;
	readonly size_band_step_mm?: string | number | null;
	readonly connection_gap_tol_m?: string | number | null;
	readonly variance_flag_pct?: string | number | null;
	readonly auto_reclassify_generic?: boolean | null;
	readonly auto_split_multi_storey?: boolean | null;
	readonly auto_deduplicate?: boolean | null;
	readonly exclude_ifc_classes?: readonly string[] | null;
	readonly size_bands_mm?: unknown;
	readonly material_densities?: unknown;
	readonly service_aliases?: unknown;
	readonly extra_property_keys?: readonly string[] | null;
	readonly max_visual_archetypes?: number | null;
	readonly max_proposals?: number | null;
	readonly max_candidates?: number | null;
};

export const BimCleanupReportSchema = Schema.Struct({
	upgraded_classes: Schema.Number,
	propagated_services: Schema.Number,
	split_mixed_archetypes: Schema.Number,
	multi_storey_splits: Schema.Number,
	dropped_duplicates: Schema.Number,
	variance_warnings: Schema.Number,
	dropped_duplicate_ids: Schema.optionalKey(Schema.Array(Schema.Number))
});
export type BimCleanupReport = typeof BimCleanupReportSchema.Type;

export const BimAssetRecordSchema = Schema.Struct({
	express_id: Schema.Number,
	global_id: Schema.NullOr(Schema.String),
	ifc_class: Schema.String,
	original_ifc_class: Schema.NullOr(Schema.String),
	continuity: ContinuityModeSchema,
	name: Schema.String,
	family: Schema.String,
	type_id: Schema.NullOr(Schema.Number),
	type_entity: Schema.NullOr(Schema.String),
	type_name: Schema.NullOr(Schema.String),
	object_type: Schema.NullOr(Schema.String),
	predefined_type: Schema.NullOr(Schema.String),
	operation_type: Schema.NullOr(Schema.String),
	storey: Schema.String,
	system_name: Schema.NullOr(Schema.String),
	system_type: Schema.NullOr(Schema.String),
	service: Schema.NullOr(Schema.String),
	nominal_size_mm: Schema.NullOr(Schema.Number),
	size_label: Schema.NullOr(Schema.String),
	insulated: Schema.Boolean,
	insulation_mm: Schema.NullOr(Schema.Number),
	fire_rating: Schema.NullOr(Schema.String),
	is_external: Schema.NullOr(Schema.Boolean),
	load_bearing: Schema.NullOr(Schema.Boolean),
	has_openings: Schema.Boolean,
	classification_code: Schema.NullOr(Schema.String),
	classification_name: Schema.NullOr(Schema.String),
	materials: Schema.Array(Schema.String),
	material_layers: Schema.Array(Schema.String),
	layer_count: Schema.Number,
	properties: Schema.Array(Schema.String),
	part_ids: Schema.Array(Schema.Number),
	length_m: Schema.NullOr(Schema.Number),
	area_m2: Schema.NullOr(Schema.Number),
	volume_m3: Schema.NullOr(Schema.Number),
	weight_kg: Schema.NullOr(Schema.Number),
	width_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	height_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	thickness_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	riser_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	tread_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	slope_pct: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	has_sgpset: Schema.optionalKey(Schema.Boolean),
	cleanup_note: Schema.NullOr(Schema.String)
});
export type BimAssetRecord = typeof BimAssetRecordSchema.Type;

export const BimArchetypeSchema = Schema.Struct({
	archetype_id: Schema.String,
	representative_express_id: Schema.Number,
	representative_part_ids: Schema.Array(Schema.Number),
	ifc_class: Schema.String,
	original_ifc_class: Schema.optionalKey(Schema.NullOr(Schema.String)),
	continuity: Schema.optionalKey(ContinuityModeSchema),
	service: Schema.optionalKey(Schema.NullOr(Schema.String)),
	nominal_size_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	size_band: Schema.optionalKey(Schema.NullOr(Schema.String)),
	min_width_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	min_height_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	min_thickness_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	max_thickness_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	max_riser_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	min_tread_mm: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	max_slope_pct: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	has_sgpset: Schema.optionalKey(Schema.Boolean),
	dim_outlier_ids: Schema.optionalKey(Schema.Array(Schema.Number)),
	insulated: Schema.optionalKey(Schema.Boolean),
	connected_equipment: Schema.optionalKey(Schema.Array(Schema.String)),
	cleanup_note: Schema.optionalKey(Schema.NullOr(Schema.String)),
	family: Schema.String,
	type_name: Schema.NullOr(Schema.String),
	object_type: Schema.NullOr(Schema.String),
	predefined_type: Schema.NullOr(Schema.String),
	operation_type: Schema.NullOr(Schema.String),
	classification_code: Schema.NullOr(Schema.String),
	classification_name: Schema.NullOr(Schema.String),
	materials: Schema.Array(Schema.String),
	material_layers: Schema.Array(Schema.String),
	layer_count: Schema.Number,
	properties: Schema.Array(Schema.String),
	sample_names: Schema.Array(Schema.String),
	total_count: Schema.Number,
	has_length: Schema.Boolean,
	has_area: Schema.Boolean,
	has_volume: Schema.Boolean,
	has_weight: Schema.Boolean,
	visual_file: Schema.optionalKey(Schema.String),
	signature: Schema.optionalKey(Schema.String),
	context_neighbor_ids: Schema.optionalKey(Schema.Array(Schema.Number)),
	nearby_archetypes: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				archetype_id: Schema.String,
				min_dist_m: Schema.Number
			})
		)
	)
});
export type BimArchetype = typeof BimArchetypeSchema.Type;

export const BimStoreyBucketSchema = Schema.Struct({
	archetype_id: Schema.String,
	storey: Schema.String,
	element_count: Schema.Number,
	length_m: Schema.Number,
	length_measured_count: Schema.Number,
	area_m2: Schema.Number,
	area_measured_count: Schema.Number,
	volume_m3: Schema.Number,
	volume_measured_count: Schema.Number,
	weight_kg: Schema.Number,
	weight_measured_count: Schema.Number,
	sample_express_ids: Schema.Array(Schema.Number),
	quantity_warning: Schema.optionalKey(Schema.NullOr(Schema.String)),
	element_ids: Schema.optionalKey(Schema.Array(Schema.Number))
});
export type BimStoreyBucket = typeof BimStoreyBucketSchema.Type;

/** Stored (or worker-transferred) takeoff as written by browser and read by pricing automation. */
export const ExtractedBimModelSchema = Schema.Struct({
	schema: Schema.String,
	project_name: Schema.NullOr(Schema.String),
	crs_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
	sgpset_count: Schema.optionalKey(Schema.Number),
	storeys: Schema.Array(Schema.String),
	storey_elevations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
	total_asset_count: Schema.Number,
	archetypes: Schema.Array(BimArchetypeSchema),
	buckets: Schema.Array(BimStoreyBucketSchema),
	overview_views: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				label: Schema.String,
				kind: Schema.Literals(['building', 'storey']),
				storey: Schema.optionalKey(Schema.String),
				visual_file: Schema.String
			})
		)
	),
	cleanup: Schema.optionalKey(BimCleanupReportSchema),
	elements: Schema.optionalKey(Schema.Array(BimAssetRecordSchema)),
	topology_edges: Schema.optionalKey(Schema.Array(Schema.Tuple([Schema.Number, Schema.Number]))),
	assemblies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Number)))
});
export type ExtractedBimModel = typeof ExtractedBimModelSchema.Type;

export type ParsedIfcModel = {
	readonly schema: string;
	readonly project_name: string | null;
	readonly storeys: readonly string[];
	readonly storey_elevations: Readonly<Record<string, number>>;
	readonly assets: readonly BimAssetRecord[];
	readonly topology_edges: readonly (readonly [number, number])[];
	readonly class_counts: Readonly<Record<string, number>>;
};

export type IfcStreamStats = {
	readonly statements_scanned: number;
	readonly relevant_statements: number;
	readonly raw_assets: number;
};

export type MatrixItem = {
	readonly code: string;
	readonly name: string;
	readonly category: 'bim_asset' | 'additional_cost';
	readonly discipline: string;
	readonly trade_specialty: string | null;
	readonly ifc_classes: readonly string[];
	readonly match_keywords: readonly string[];
	readonly system_services?: readonly string[] | null;
	readonly min_size_mm?: number | null;
	readonly max_size_mm?: number | null;
	readonly insulated?: 'any' | 'insulated' | 'uninsulated' | null;
	readonly topology_mode?:
		'auto' | 'discontiguous' | 'contiguous_linear' | 'contiguous_planar' | null;
	readonly unit: string;
	readonly quantity_basis:
		'count' | 'length' | 'area' | 'volume' | 'weight' | 'lump_sum' | 'pct_of_bim' | 'derived';
	readonly derived_from?: string | null;
	readonly ratio?: DecimalLike | null;
	readonly stands_in_for?: string | null;
	readonly currency: string;
	readonly unit_rate: DecimalLike;
	readonly waste_factor_pct: DecimalLike;
	readonly carbon_factor: DecimalLike;
	readonly active: boolean;
	readonly notes?: string | null;
};

export type MatchMethod = 'rule' | 'ai_sys1' | 'ai_sys2' | 'override';
export const UNKNOWN_CATALOG_CHOICE = 'unknown_unseen_catalog' as const;

export type ArchetypeDecision = {
	readonly matrix_code: string | null;
	readonly method: MatchMethod;
	readonly confidence: number;
	readonly reason: string;
};

export type BimTakeoffLine = {
	readonly asset_key: string;
	readonly ifc_class: string;
	readonly classification: string;
	readonly discipline: string;
	readonly storey: string;
	readonly element_count: number;
	readonly measured_qty: string;
	readonly unit: string;
	readonly quantity_basis: string;
	readonly matrix_code?: string | null;
	readonly unit_rate: string;
	readonly waste_factor_pct: string;
	readonly priced_qty: string;
	readonly amount: string;
	readonly carbon_factor: string;
	readonly carbon: string;
	readonly status: 'matched' | 'unmatched' | 'rate_missing' | 'override';
	readonly match_method?: MatchMethod | null;
	readonly match_confidence?: number | null;
	readonly match_reason?: string | null;
	readonly sample_express_ids?: readonly number[] | null;
};

export type BimCostEstimateResult = {
	readonly bim_asset_count: number;
	readonly archetype_count: number;
	readonly classified_asset_count: number;
	readonly ai_classified_count: number;
	readonly unmatched_asset_count: number;
	readonly bim_assets: readonly BimTakeoffLine[];
	readonly bim_subtotal: string;
	readonly contingency_amount: string;
	readonly total_estimate: string;
};

export type SopAuthority = 'corenet_x' | 'bca' | 'scdf' | 'pub' | 'ura' | 'company_sop';
export type SopSeverity = 'error' | 'warning' | 'info';
export type SopScope = 'model' | 'element' | 'estimate';
export type SopOperator = 'gte' | 'lte' | 'eq' | 'contains' | 'present';
export type SopMetric =
	| 'schema_version'
	| 'georef_crs'
	| 'sgpset_coverage_pct'
	| 'unassigned_storey_pct'
	| 'proxy_ratio_pct'
	| 'duplicate_count'
	| 'mep_untagged_pct'
	| 'min_width_mm'
	| 'min_height_mm'
	| 'min_thickness_mm'
	| 'max_thickness_mm'
	| 'max_riser_mm'
	| 'min_tread_mm'
	| 'max_slope_pct'
	| 'required_property'
	| 'required_material'
	| 'required_service'
	| 'min_classified_pct'
	| 'max_unmatched_count'
	| 'max_variance_warnings'
	| 'semantic_check';

export type SopRule = {
	readonly code: string;
	readonly name: string;
	readonly authority: SopAuthority;
	readonly severity: SopSeverity;
	readonly scope: SopScope;
	readonly metric: SopMetric;
	readonly operator: SopOperator;
	readonly threshold_num?: string | number | null;
	readonly threshold_text?: string | null;
	readonly ifc_classes?: readonly string[] | null;
	readonly name_contains?: readonly string[] | null;
	readonly service_filter?: readonly string[] | null;
	readonly clause_ref?: string | null;
	readonly remediation?: string | null;
	readonly active: boolean;
};

export type BimComplianceFinding = {
	readonly rule_code: string;
	readonly rule_name: string;
	readonly authority: SopAuthority;
	readonly severity: SopSeverity;
	readonly status: 'pass' | 'warning' | 'fail';
	readonly actual: string;
	readonly expected: string;
	readonly affected_count: number;
	readonly clause_ref?: string | null;
	readonly remediation?: string | null;
	readonly sample_express_ids?: readonly number[];
};

export type BimComplianceReport = {
	readonly checked_at: string;
	readonly total_rules: number;
	readonly pass_count: number;
	readonly warn_count: number;
	readonly fail_count: number;
	readonly score_pct: number;
	readonly findings: readonly BimComplianceFinding[];
};

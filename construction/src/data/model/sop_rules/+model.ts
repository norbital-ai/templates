import { model } from '@norbital-ai/bolt';

const columns = [
	'code',
	'name',
	'authority',
	'severity',
	'scope',
	'metric',
	'operator',
	'threshold_num',
	'threshold_text',
	'ifc_classes',
	'name_contains',
	'service_filter',
	'clause_ref',
	'remediation',
	'active'
] as const;

/**
 * Dynamic, configurable BCA / SCDF / PUB / CORENET X statutory and company tender SOP rules
 * automatically checked against every BIM takeoff and cost estimate.
 */
export default model('sop_rules', {
	description:
		'Configurable BCA, SCDF, PUB, CORENET X, and company tender SOP compliance rules evaluated automatically against uploaded BIM IFC models and cost estimates.',
	icon: 'lucide:shield-check',
	record_label: "record.code + ' · ' + record.name",
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		authority: {
			kind: 'enum',
			values: ['corenet_x', 'bca', 'scdf', 'pub', 'ura', 'company_sop'],
			default: 'bca'
		},
		severity: {
			kind: 'enum',
			values: ['error', 'warning', 'info'],
			default: 'error'
		},
		scope: {
			kind: 'enum',
			values: ['model', 'element', 'estimate'],
			default: 'element'
		},
		metric: {
			kind: 'enum',
			values: [
				'schema_version',
				'georef_crs',
				'sgpset_coverage_pct',
				'unassigned_storey_pct',
				'proxy_ratio_pct',
				'duplicate_count',
				'mep_untagged_pct',
				'min_width_mm',
				'min_height_mm',
				'min_thickness_mm',
				'max_thickness_mm',
				'max_riser_mm',
				'min_tread_mm',
				'max_slope_pct',
				'required_property',
				'required_material',
				'required_service',
				'min_classified_pct',
				'max_unmatched_count',
				'max_variance_warnings',
				'semantic_check'
			],
			default: 'min_width_mm'
		},
		operator: {
			kind: 'enum',
			values: ['gte', 'lte', 'eq', 'contains', 'present'],
			default: 'gte'
		},
		/** Numeric threshold (e.g. `850` mm, `95` %, `0` count). */
		threshold_num: { kind: 'decimal', scale: 2, optional: true },
		/** Text threshold (e.g. `IFC4`, `FireRating`, `FD60`). */
		threshold_text: { kind: 'text', optional: true },
		/** IFC classes this element rule applies to (empty = all elements). */
		ifc_classes: { kind: 'text', many: true, optional: true },
		/** Optional case-insensitive keywords narrowing which element names/types are checked (e.g. `fire`, `exit`). */
		name_contains: { kind: 'text', many: true, optional: true },
		/** Optional MEP service filter (e.g. `fire_protection`, `domestic_cold_water`). */
		service_filter: { kind: 'text', many: true, optional: true },
		/** Statutory code or internal SOP clause reference (e.g. `BCA Accessibility Code 2019 Cl. 4.4.2`). */
		clause_ref: { kind: 'text', optional: true },
		/** Actionable fix instruction shown when this rule fails. */
		remediation: { kind: 'text', optional: true },
		active: { kind: 'bool', default: true }
	},
	constraints: {
		unique_code: { unique: ['code'], import_key: true }
	},
	indexes: {
		by_authority: { on: ['authority', 'active'] },
		find: { text: ['code', 'name', 'clause_ref', 'remediation'] }
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: columns },
	update: { fields: columns },
	delete: {}
});

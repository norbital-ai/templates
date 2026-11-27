/**
 * Pure classification of Compliance & SOP lints (`bim_compliance` + `sop_rules`):
 * Clean BIM only performs classification and metadata/label/hygiene cleanup — never physical
 * geometry or dimension edits. Every non-passing lint is therefore classified as either:
 * - `cleanup`: resolved by adopting Proposed Clean BIM metadata/class/system/dedup cleanup,
 * - `classification`: resolved by approving Item Matrix proposals / assigning items, or
 * - `bim_revision`: requires modifying the source BIM/CAD model (dimensions, geometry, clashes,
 *   schema/CRS, missing materials, etc.) and cannot be auto-corrected by cleanup.
 */
import type { SopMetric, SopRule } from './schema.js';

export type StoredComplianceFinding = {
	readonly rule_code: string;
	readonly rule_name: string;
	readonly status: string;
	readonly actual: string;
	readonly expected: string;
	readonly sample_express_ids?: readonly number[] | null | undefined;
};

export type LintResolutionKind = 'cleanup' | 'classification' | 'bim_revision';

export type FindingResolution = {
	readonly kind: LintResolutionKind;
	readonly requiresBimRevision: boolean;
	readonly metric: SopMetric | null;
	readonly ifcClasses: readonly string[];
};

export type AssetCleanupFlag = {
	readonly kind: 'class_cleanup' | 'system_tag' | 'dedup';
	readonly label: string;
	readonly detail: string;
};

export type AssetRevisionAlert = {
	readonly rule_code: string;
	readonly rule_name: string;
	readonly expected: string;
};

const CLEANUP_METRICS = new Set<SopMetric>([
	'proxy_ratio_pct',
	'duplicate_count',
	'mep_untagged_pct',
	'required_service',
	'sgpset_coverage_pct',
	'required_property'
]);

const CLASSIFICATION_METRICS = new Set<SopMetric>(['min_classified_pct', 'max_unmatched_count']);

/** Classifies whether a lint is resolved by cleanup/classification or requires a BIM model revision. */
export function classifyFindingResolution(
	finding: StoredComplianceFinding,
	rule?: Pick<SopRule, 'metric' | 'threshold_num' | 'ifc_classes'> | null
): FindingResolution {
	const metric = rule?.metric ?? null;
	const ifcClasses = (rule?.ifc_classes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean);

	if (
		(metric !== null && CLEANUP_METRICS.has(metric)) ||
		(metric === null &&
			/proxy|duplicate|service|untagged/i.test(`${finding.rule_name} ${finding.actual}`))
	) {
		return { kind: 'cleanup', requiresBimRevision: false, metric, ifcClasses };
	}

	if (
		(metric !== null && CLASSIFICATION_METRICS.has(metric)) ||
		(metric === null && /unmatched|classified/i.test(`${finding.rule_name} ${finding.actual}`))
	) {
		return { kind: 'classification', requiresBimRevision: false, metric, ifcClasses };
	}

	return { kind: 'bim_revision', requiresBimRevision: true, metric, ifcClasses };
}

/** Summarizes cleanup tags on an asset plus any read-only lints that require an upstream BIM revision. */
export function assetDiagnosticsFor(input: {
	readonly ifc_class: string;
	readonly cleanup_note: string | null;
	readonly expressIds: readonly number[];
	readonly findings: readonly StoredComplianceFinding[];
	readonly ruleByCode: ReadonlyMap<
		string,
		Pick<SopRule, 'metric' | 'threshold_num' | 'ifc_classes'>
	>;
}): {
	readonly cleanupFlags: readonly AssetCleanupFlag[];
	readonly revisionAlerts: readonly AssetRevisionAlert[];
} {
	const cleanupFlags: AssetCleanupFlag[] = [];
	const revisionAlerts: AssetRevisionAlert[] = [];
	const idSet = new Set(input.expressIds);
	const upperClass = input.ifc_class.trim().toUpperCase();

	for (const f of input.findings) {
		if (f.status === 'pass') continue;
		const rule = input.ruleByCode.get(f.rule_code) ?? null;
		const res = classifyFindingResolution(f, rule);
		if (!res.requiresBimRevision) continue;
		const idHit = (f.sample_express_ids ?? []).some((id) => idSet.has(id));
		const classHit =
			idSet.size === 0 &&
			res.ifcClasses.length > 0 &&
			res.ifcClasses.some((c) => c === upperClass || upperClass.startsWith(c));
		if (idHit || classHit) {
			revisionAlerts.push({
				rule_code: f.rule_code,
				rule_name: f.rule_name,
				expected: f.expected
			});
		}
	}

	const note = input.cleanup_note?.trim() ?? '';
	if (note) {
		for (const part of note
			.split(/[;,]/)
			.map((s) => s.trim())
			.filter(Boolean)) {
			if (/duplicate|split/i.test(part)) {
				cleanupFlags.push({ kind: 'dedup', label: 'Hygiene', detail: part });
			} else if (/upgraded|promoted|reclassified/i.test(part)) {
				cleanupFlags.push({ kind: 'class_cleanup', label: 'Class cleanup', detail: part });
			} else {
				cleanupFlags.push({ kind: 'system_tag', label: 'Metadata', detail: part });
			}
		}
	}

	return { cleanupFlags, revisionAlerts };
}

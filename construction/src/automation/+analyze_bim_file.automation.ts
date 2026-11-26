/**
 * Thin orchestrator automation pricing a project's stored BIM takeoff via `src/services/bim/*`:
 * recall memory → System 1 classify unseen → persist memory → exact BigDecimal BOQ →
 * CORENET X / BCA / SOP compliance → commit estimate → System 2 proposals.
 */
import { Effect, Schema } from 'effect';
import { automation, type FileRef, type Id } from '@norbital-ai/bolt';
import { cap } from '../lib/ai.js';
import {
	classifyWithSystem1,
	persistAssetMappings,
	proposeUnseenItems,
	recallAssetMappings,
	RECALLED_LABEL
} from '../services/bim/classifier.js';
import {
	evaluateComplianceRules,
	evaluateSemanticComplianceRules
} from '../services/bim/compliance.js';
import { resolveBimConfig } from '../services/bim/config.js';
import { buildBimCostEstimateFromExtracted } from '../services/bim/pricing.js';
import {
	ExtractedBimModelSchema,
	type ArchetypeDecision,
	type BimArchetype,
	type ExtractedBimModel,
	type MatrixItem,
	type SopRule
} from '../services/bim/schema.js';

const decodeTakeoff = Schema.decodeUnknownEffect(Schema.fromJsonString(ExtractedBimModelSchema));
const optNum = (raw: string | number | null | undefined): number | null => {
	if (raw == null) return null;
	const n = typeof raw === 'number' ? raw : Number(raw);
	return Number.isFinite(n) ? n : null;
};

export default automation({
	description:
		"Prices a project's BIM model whenever its takeoff is stored, or when it has a takeoff and no current estimate. Uses workspace-configurable BIM rules (`bim_settings`), respects QS overrides and human-in-the-loop verification (`asset_mappings`), classifies only unseen assets in parallel with System 1 against enriched Item Matrix criteria (service, size band, insulation, continuity), flags uncertain or auto-reclassified assets for QS review, writes exact BigDecimal takeoff lines, and proposes new Item Matrix entries via System 2 for unseen assets.",
	on: [{ model: 'projects', verbs: ['create', 'update'] }],
	input: {
		project_id: { kind: 'ref', to: 'projects', optional: true },
		contingency_pct: { kind: 'number', optional: true }
	},
	output: { kind: 'object', fields: { priced: { kind: 'ref', to: 'cost_estimates', many: true } } },
	policies: ['construction_automation'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		const asked = input.project_id ?? null;
		const ids: readonly Id<'projects'>[] =
			asked !== null
				? [asked]
				: ctx.trigger.kind === 'system' && ctx.trigger.cause === 'event'
					? ctx.trigger.records
					: [];
		if (ids.length === 0) return { priced: [] };

		const loaded = yield* ctx.query({
			projects: {
				where: { id: { in: [...ids] }, bim_takeoff: { is_null: false } },
				fields: [
					'revision',
					'project_name',
					'currency',
					'bim_file',
					'bim_version',
					'bim_takeoff',
					'bim_takeoff_views',
					'bim_costing_dirty',
					'bim_costing_error'
				],
				limit: ids.length
			},
			cost_estimates: {
				where: { project_id: { in: [...ids] } },
				fields: ['revision', 'project_id', 'status', 'contingency_pct'],
				limit: ids.length
			},
			bim_settings: {
				fields: [
					'code',
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
					'max_candidates'
				],
				limit: 10
			},
			sop_rules: {
				where: { active: { eq: true } },
				fields: [
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
				],
				limit: 200
			},
			item_matrix: {
				where: { active: { eq: true }, category: { eq: 'bim_asset' } },
				fields: [
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
					'derived_from',
					'ratio',
					'stands_in_for',
					'validity',
					'active',
					'notes'
				],
				limit: 2000
			}
		});
		if (asked !== null && loaded.projects.rows.length === 0)
			return yield* ctx.refuse('errors.bim_takeoff_missing', {});

		const config = resolveBimConfig(
			loaded.bim_settings.rows.find((r) => r.code === 'default') ?? loaded.bim_settings.rows[0]
		);
		const activeSopRules: readonly SopRule[] = loaded.sop_rules.rows;
		const today = ctx.today;
		const matrix: MatrixItem[] = loaded.item_matrix.rows
			.filter(
				(r) =>
					r.validity == null ||
					(r.validity.from <= today && (r.validity.to == null || r.validity.to >= today))
			)
			.map((r) => ({
				...r,
				ifc_classes: r.ifc_classes ?? [],
				match_keywords: r.match_keywords ?? [],
				system_services: r.system_services ?? [],
				min_size_mm: optNum(r.min_size_mm),
				max_size_mm: optNum(r.max_size_mm)
			}));
		const itemIdByCode = new Map(loaded.item_matrix.rows.map((r) => [r.code, r.id] as const));

		const priced: Id<'cost_estimates'>[] = [];
		for (const project of loaded.projects.rows) {
			const estimate = loaded.cost_estimates.rows.find((e) => e.project_id === project.id);
			const waiting = project.bim_costing_dirty || !estimate || estimate.status === 'void';
			if (asked === null && (!waiting || project.bim_costing_error != null)) continue;
			if (estimate && estimate.status !== 'draft' && estimate.status !== 'void') {
				if (asked !== null) return yield* ctx.refuse('errors.bim_estimate_locked');
				continue;
			}
			if (!project.bim_takeoff) continue;

			yield* ctx.progress({
				text: `Reading the BIM takeoff of ${project.project_name}`,
				ratio: 0.08
			});
			const extractedRaw = yield* ctx.files.get(project.bim_takeoff, { max: '16MiB' }).pipe(
				Effect.map((bytes) => new TextDecoder().decode(bytes)),
				Effect.flatMap(decodeTakeoff),
				Effect.catch(() => ctx.refuse('errors.bim_takeoff_unreadable', {}))
			);
			const currency = project.currency.trim().toUpperCase();
			const rules = matrix.filter((r) => r.currency.trim().toUpperCase() === currency);
			yield* ctx.progress({
				text: `${extractedRaw.total_asset_count} elements are ${extractedRaw.archetypes.length} unique assets across ${extractedRaw.storeys.length} storeys`,
				ratio: 0.15
			});
			const pictures = new Map<string, FileRef>(
				(project.bim_takeoff_views ?? []).map((ref) => [ref.id, ref] as const)
			);
			const signatures = [
				...new Set(extractedRaw.archetypes.flatMap((a) => (a.signature ? [a.signature] : [])))
			];

			// 1. Recall remembered decisions, screenshots & apply QS overrides
			const known = yield* recallAssetMappings(signatures, ctx);
			for (const m of known.values()) {
				if (m.picture && !pictures.has(m.picture.id)) pictures.set(m.picture.id, m.picture);
			}
			const extracted: ExtractedBimModel = {
				...extractedRaw,
				archetypes: extractedRaw.archetypes.map((a) => {
					const m = a.signature ? known.get(a.signature) : undefined;
					const visual = a.visual_file ?? m?.picture?.id;
					const base =
						visual !== undefined && a.visual_file === undefined ? { ...a, visual_file: visual } : a;
					return m?.source === 'qs'
						? {
								...base,
								ifc_class: m.ifc_class || base.ifc_class,
								continuity: m.continuity,
								service: m.service ?? base.service ?? null
							}
						: base;
				})
			};

			const settled: Record<string, ArchetypeDecision> = {};
			const fresh: BimArchetype[] = [];
			for (const a of extracted.archetypes) {
				const m = a.signature ? known.get(a.signature) : undefined;
				const item = m?.item ?? null;
				if (m && item?.usable && rules.some((r) => r.code === item.code)) {
					settled[a.archetype_id] = {
						matrix_code: item.code,
						method:
							m.source === 'qs' ? 'override' : m.source === 'proposal' ? 'ai_sys2' : 'ai_sys1',
						confidence: 1,
						reason: `${RECALLED_LABEL[m.source]} → ${item.code}`
					};
				} else if (item?.pending) {
					settled[a.archetype_id] = {
						matrix_code: null,
						method: 'ai_sys2',
						confidence: 0,
						reason: `Item Matrix proposal ${item.code} awaiting commercial approval`
					};
				} else if (m?.source === 'qs' && item === null) {
					settled[a.archetype_id] = {
						matrix_code: null,
						method: 'override',
						confidence: 1,
						reason: 'Left unpriced by a QS'
					};
				} else {
					fresh.push(a);
				}
			}

			// 2. Classify unseen archetypes via System 1
			const { decisions, unavailable } = yield* classifyWithSystem1(
				{ ...extracted, archetypes: fresh },
				pictures,
				rules.filter((r) => r.quantity_basis !== 'derived'),
				currency,
				config,
				ctx,
				extracted.archetypes
			);
			if (unavailable !== null) {
				yield* ctx.act({
					'projects.update': [
						{
							target: { id: project.id, revision: project.revision },
							set: { bim_costing_error: cap(unavailable, 500) }
						}
					]
				});
				return yield* ctx.refuse('errors.bim_ai_unavailable', { values: { reason: unavailable } });
			}

			// 3. Persist fresh decisions to asset_mappings memory
			const warnedArchetypes = new Set(
				extracted.buckets.flatMap((b) => (b.quantity_warning ? [b.archetype_id] : []))
			);
			yield* persistAssetMappings({
				fresh,
				known,
				decisions,
				pictures,
				itemIdByCode,
				warnedArchetypes,
				config,
				idempotencyKey: `bim-memory:${project.id}:${project.bim_takeoff.id}:${project.revision}`,
				ctx
			});

			// 4. Price BOQ + evaluate compliance + commit atomically
			const result = buildBimCostEstimateFromExtracted({
				extracted,
				matrix: rules,
				currency: project.currency,
				ai_decisions: { ...settled, ...decisions },
				contingency_pct: input.contingency_pct ?? estimate?.contingency_pct ?? '5'
			});
			const semanticFindings = yield* evaluateSemanticComplianceRules({
				extracted,
				rules: activeSopRules,
				pictures,
				progress: ctx.progress,
				infer: (req) => ctx.ai.sys_2.infer(req)
			});
			const compliance = evaluateComplianceRules({
				extracted,
				estimate: result,
				rules: activeSopRules,
				semanticFindings,
				checkedAt: ctx.now
			});

			yield* ctx.progress({
				text: 'Saving the BIM cost estimate & compliance checks',
				ratio: 0.92
			});
			const version = project.bim_version?.trim() ? ` (${project.bim_version.trim()})` : '';
			const lines = result.bim_assets.map((line) => ({
				...line,
				...(line.sample_express_ids ? { sample_express_ids: [...line.sample_express_ids] } : {})
			}));
			const projectWrite = {
				target: { id: project.id, revision: project.revision },
				set: {
					bim_summary: {
						schema: extracted.schema,
						asset_count: extracted.total_asset_count,
						storey_count: extracted.storeys.length,
						storeys: [...extracted.storeys],
						...(extracted.cleanup
							? {
									upgraded_classes: extracted.cleanup.upgraded_classes,
									propagated_services: extracted.cleanup.propagated_services,
									multi_storey_splits: extracted.cleanup.multi_storey_splits,
									dropped_duplicates: extracted.cleanup.dropped_duplicates
								}
							: {}),
						analyzed_at: ctx.now
					},
					bim_compliance: {
						...compliance,
						findings: compliance.findings.map((f) => ({
							rule_code: f.rule_code,
							rule_name: f.rule_name,
							authority: f.authority,
							severity: f.severity,
							status: f.status,
							actual: f.actual,
							expected: f.expected,
							affected_count: f.affected_count,
							...(f.clause_ref ? { clause_ref: f.clause_ref } : {}),
							...(f.remediation ? { remediation: f.remediation } : {}),
							...(f.sample_express_ids?.length
								? { sample_express_ids: [...f.sample_express_ids] }
								: {})
						}))
					},
					bim_costing_dirty: false,
					bim_costing_error: null
				}
			};
			const committed = yield* ctx.act(
				estimate
					? {
							'projects.update': [projectWrite],
							'cost_estimates.update': [
								{
									target: { id: estimate.id, revision: estimate.revision },
									set: {
										title: `${project.project_name}${version} — BIM Cost Estimate`,
										...(estimate.status === 'void' ? { status: 'draft' as const } : {}),
										bim_assets: lines,
										asset_signatures: signatures,
										analyzed_at: ctx.now
									}
								}
							]
						}
					: {
							'projects.update': [projectWrite],
							'cost_estimates.create': [
								{
									project_id: project.id,
									title: `${project.project_name}${version} — BIM Cost Estimate`,
									currency: project.currency,
									bim_assets: lines,
									asset_signatures: signatures,
									contingency_pct: String(input.contingency_pct ?? 5),
									analyzed_at: ctx.now
								}
							]
						},
				{ key: `bim-estimate:${project.id}:${project.bim_takeoff.id}:${project.revision}` }
			);
			if (committed.kind !== 'committed')
				return yield* ctx.refuse('errors.bim_estimate_write_failed');
			const saved = committed.records.find((r) => r.model === 'cost_estimates')?.id ?? estimate?.id;
			if (saved !== undefined) priced.push(saved);

			// 5. Propose Item Matrix entries via System 2 for unseen assets
			const unknown = fresh.filter(
				(a) => a.signature !== undefined && decisions[a.archetype_id]?.matrix_code == null
			);
			if (unknown.length > 0 && config.max_proposals > 0) {
				yield* proposeUnseenItems(
					unknown,
					pictures,
					yield* recallAssetMappings(
						unknown.flatMap((a) => (a.signature ? [a.signature] : [])),
						ctx
					),
					rules,
					project.currency,
					config.max_proposals,
					ctx
				);
			}
			yield* ctx.progress({
				text: `System 1 classified ${result.classified_asset_count}/${result.bim_asset_count} BIM elements (${result.unmatched_asset_count} unknown / unseen catalog)`,
				ratio: 1
			});
		}
		return { priced };
	}
});

/**
 * Sustainability (BCA Green Mark 2021 WLC CN1.1 / EN 15978 / SGX GRI 301–306) and
 * Compliance (BCA CORENET X IFC+SG / ISO 19650-2 / BCA CONQUAS / ISO 9001/14001/45001)
 * report builder, HTML print-layout renderer, and fallback A4 stylesheet.
 */
import type { FileRef, Id, ReadAnswer, Row } from '@norbital-ai/bolt';
import { BigDecimal, Effect, Schema } from 'effect';
import * as Base64 from 'effect/encoding/Base64';
import { computeProjectCarbon } from '../commercial/analytics.js';
import {
	divSafe,
	formatTrimmed,
	HUNDRED,
	toDecimal,
	toNumber,
	ZERO
} from '../commercial/decimal.js';
import { classifyFindingResolution } from '../bim/remediation.js';
import { validateReportTemplateBody } from './template-validation.js';

export type ReportKind = Row<'report_templates'>['kind'];
export type ReportLocale = Row<'report_templates'>['locale'];
type ReportTemplate = Row<'report_templates'>;

export class ReportUnavailable extends Schema.TaggedError<ReportUnavailable>()(
	'ReportUnavailable',
	{
		message: Schema.String
	}
) {}

/** BCA Green Mark 2021 Whole Life Carbon (CN1.1) reference embodied carbon baselines (kgCO₂e/m²). */
export const BCA_CARBON_BASELINES: Readonly<Record<string, number>> = {
	residential: 1500,
	non_residential: 1000,
	industrial: 2500
};

/** Singapore EMA grid emission factor (kgCO₂e per kWh) & diesel combustion factor (kgCO₂e per L). */
const SG_GRID_FACTOR_KG_PER_KWH = BigDecimal.fromStringUnsafe('0.4057');
const DIESEL_FACTOR_KG_PER_LITRE = BigDecimal.fromStringUnsafe('2.68');
const THOUSAND = BigDecimal.fromBigInt(1000n);

export const newestReportTemplateFirst = (
	a: Pick<ReportTemplate, 'id' | 'version'>,
	b: Pick<ReportTemplate, 'id' | 'version'>
) => Number(b.version) - Number(a.version) || b.id.localeCompare(a.id);

export function currentReportTemplate<
	T extends Pick<ReportTemplate, 'id' | 'kind' | 'locale' | 'status' | 'version'>
>(rows: readonly T[], kind: ReportKind, locale: ReportLocale): T | undefined {
	return rows
		.filter((row) => row.status === 'published' && row.kind === kind && row.locale === locale)
		.sort(newestReportTemplateFirst)[0];
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;');
}

export type PrintFields = Readonly<Record<string, string>>;
export type PrintSections = Readonly<Record<string, readonly PrintFields[]>>;

/**
 * Renders a customizable HTML print layout supporting `{{field}}` placeholders and named
 * repeating section blocks `{{#section}}...{{/section}}` (HTML-escaped).
 */
export function renderReportLayout(
	source: string,
	fields: PrintFields,
	sections: PrintSections
): string {
	const fill = (html: string, values: PrintFields) =>
		html.replace(/\{\{([a-z_][a-z0-9_]*)\}\}/g, (_, key: string) => {
			if (!Object.hasOwn(values, key)) throw new Error(`Unknown print field: ${key}`);
			return escapeHtml(values[key] ?? '');
		});
	let rendered = source.replace(
		/\{\{#([a-z_][a-z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
		(_, name: string, block: string) => {
			const rows = sections[name];
			if (rows === undefined) throw new Error(`Unknown print section: ${name}`);
			return rows.map((row) => fill(block, { ...fields, ...row })).join('');
		}
	);
	if (/\{\{[#/]/.test(rendered)) throw new Error('Unmatched or malformed print section block');
	rendered = fill(rendered, fields);
	return rendered;
}

const paragraphs = (text: string): string =>
	text
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
		.join('');

const BASE_STYLES = `
	@page { size: A4; margin: 16mm; }
	body { font: 9.5pt/1.45 -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Arial, sans-serif; color: #18181b; margin: 0; }
	h1 { font-size: 16pt; margin: 0 0 2mm; color: #0f172a; }
	h2 { font-size: 11pt; margin: 5mm 0 2mm; padding-bottom: 1mm; border-bottom: 1.5px solid #d97706; color: #0f172a; }
	p { margin: 0 0 2mm; overflow-wrap: anywhere; }
	.subtitle { color: #52525b; font-size: 8.5pt; margin-bottom: 4mm; }
	.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 6mm; margin-bottom: 4mm; font-size: 8.5pt; padding: 3mm; background: #fafaf9; border: 1px solid #e4e4e7; }
	.meta div strong { color: #52525b; font-weight: 600; }
	.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.5mm; margin: 3mm 0 4mm; }
	.kpi { border: 1px solid #e4e4e7; padding: 2.5mm; background: #fff; break-inside: avoid; }
	.kpi-label { font-size: 7.5pt; color: #71717a; text-transform: uppercase; letter-spacing: 0.03em; }
	.kpi-value { font-size: 11.5pt; font-weight: 700; margin-top: 1mm; color: #0f172a; }
	table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 2mm 0 4mm; }
	thead { display: table-header-group; }
	tr { break-inside: avoid; }
	th, td { border: 1px solid #d4d4d8; padding: 1.5mm 2mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
	thead th { background: #f4f4f5; font-weight: 600; color: #3f3f46; }
	.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.badge-pass { color: #15803d; font-weight: 600; }
	.badge-warn { color: #b45309; font-weight: 600; }
	.badge-fail { color: #b91c1c; font-weight: 600; }
	.signoff { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin-top: 6mm; break-inside: avoid; font-size: 8.5pt; }
	.signbox { border-top: 1px solid #a1a1aa; padding-top: 2mm; }
`;

function wrapFallbackPage(
	title: string,
	standard: string,
	content: string,
	locale: ReportLocale
): string {
	return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BASE_STYLES}</style></head><body><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(standard)}</p>${content}</body></html>`;
}

export const projectReportRead = (projectId: Id<'projects'>) =>
	({
		projects: {
			where: { id: { eq: projectId } },
			fields: [
				'project_name',
				'project_number',
				'project_role',
				'status',
				'schedule_range',
				'currency',
				'address',
				'bim_version',
				'bim_file',
				'bim_summary',
				'bim_compliance',
				'gfa_m2',
				'building_typology',
				'green_mark_target',
				'sustainability_assessor',
				'bca_project_ref',
				'submission_gateway',
				'qualified_person',
				'bim_manager',
				'bep_version',
				'conquas_band_target'
			],
			client_id: { fields: ['company_name', 'full_name'] },
			project_manager: { fields: ['name'] },
			limit: 1
		},
		cost_estimates: {
			where: { project_id: { eq: projectId } },
			fields: ['estimate_number', 'status', 'bim_assets', 'analyzed_at', 'carbon_total'],
			limit: 1
		},
		adhoc_costs: {
			where: { project_id: { eq: projectId } },
			fields: ['status', 'qty', 'catalog_item_id'],
			limit: 500
		},
		item_matrix: {
			fields: [
				'code',
				'name',
				'discipline',
				'unit',
				'carbon_factor',
				'carbon_stage',
				'epd_reference',
				'recycled_content_pct'
			],
			limit: 1000
		},
		sustainability_logs: {
			where: { project_id: { eq: projectId } },
			fields: [
				'reporting_period',
				'electricity_kwh',
				'diesel_litres',
				'transport_tco2e',
				'water_m3',
				'newater_m3',
				'waste_generated_t',
				'waste_diverted_t',
				'waste_hazardous_t',
				'notes'
			],
			limit: 500
		},
		compliance_records: {
			where: { project_id: { eq: projectId } },
			fields: [
				'record_code',
				'recorded_on',
				'standard',
				'category',
				'clause_ref',
				'title',
				'severity',
				'status',
				'metric_value',
				'corrective_action',
				'closed_on'
			],
			owner: { fields: ['name'] },
			order_by: { recorded_on: 'desc' },
			limit: 500
		},
		sop_rules: {
			where: { active: { eq: true } },
			fields: ['code', 'metric', 'threshold_num', 'ifc_classes'],
			limit: 200
		},
		report_templates: {
			where: { status: { eq: 'published' } },
			limit: 100
		}
	}) as const;

export type ProjectReportAnswer = ReadAnswer<ReturnType<typeof projectReportRead>>;

export type BuiltReportDocument = {
	readonly kind: ReportKind;
	readonly locale: ReportLocale;
	readonly title: string;
	readonly filename: string;
	readonly reference: string;
	readonly template_id: Id<'report_templates'>;
	readonly template_version: string;
	readonly fallback_html: string;
	readonly print_layout: FileRef | null;
	readonly letterhead: FileRef | null;
	readonly stamp: FileRef | null;
	readonly fields: PrintFields;
	readonly sections: PrintSections;
};

const TYPOLOGY_LABELS: Readonly<Record<string, { en: string; zh: string }>> = {
	residential: { en: 'Residential', zh: '住宅建筑' },
	non_residential: { en: 'Non-Residential / Commercial', zh: '非住宅 / 商业建筑' },
	industrial: { en: 'Industrial', zh: '工业建筑' }
};

const GREEN_MARK_LABELS: Readonly<Record<string, { en: string; zh: string }>> = {
	certified: { en: 'BCA Green Mark Certified', zh: 'BCA 绿色建筑认证' },
	gold_plus: { en: 'BCA Green Mark GoldPLUS', zh: 'BCA 绿色建筑超金奖 (GoldPLUS)' },
	platinum: { en: 'BCA Green Mark Platinum', zh: 'BCA 绿色建筑白金奖 (Platinum)' },
	sle: { en: 'BCA Green Mark Platinum SLE', zh: 'BCA 绿色建筑超低能耗 (SLE)' },
	ze: { en: 'BCA Green Mark Zero Energy (ZE)', zh: 'BCA 绿色建筑零能耗 (ZE)' }
};

const GATEWAY_LABELS: Readonly<Record<string, { en: string; zh: string }>> = {
	design: { en: 'Design Gateway (DG)', zh: '设计审查关口 (DG)' },
	piling: { en: 'Piling Gateway (PG)', zh: '桩基审查关口 (PG)' },
	construction: { en: 'Construction Gateway (CG)', zh: '施工审查关口 (CG)' },
	completion: { en: 'Completion Gateway (TOP/CSC)', zh: '竣工审查关口 (TOP/CSC)' }
};

const STAGE_LABELS: Readonly<Record<string, string>> = {
	a1_a3: 'A1–A3',
	a1_a5: 'A1–A5',
	a4_a5: 'A4–A5'
};

const STANDARD_LABELS: Readonly<Record<string, string>> = {
	bca_conquas: 'BCA CONQUAS',
	bca_corenet_x: 'BCA CORENET X',
	iso_9001: 'ISO 9001',
	iso_14001: 'ISO 14001',
	iso_45001: 'ISO 45001',
	iso_19650: 'ISO 19650'
};

const AUTHORITY_LABELS: Readonly<Record<string, string>> = {
	corenet_x: 'CORENET X',
	bca: 'BCA',
	scdf: 'SCDF',
	pub: 'PUB',
	ura: 'URA',
	company_sop: 'Company SOP'
};

export function summarizeSiteSustainability(
	logs: ProjectReportAnswer['sustainability_logs']['rows']
) {
	let electricityKwh = ZERO;
	let dieselLitres = ZERO;
	let transportT = ZERO;
	let waterM3 = ZERO;
	let newaterM3 = ZERO;
	let wasteGenT = ZERO;
	let wasteDivT = ZERO;
	let wasteHazT = ZERO;

	for (const log of logs) {
		electricityKwh = BigDecimal.sum(electricityKwh, toDecimal(log.electricity_kwh));
		dieselLitres = BigDecimal.sum(dieselLitres, toDecimal(log.diesel_litres));
		transportT = BigDecimal.sum(transportT, toDecimal(log.transport_tco2e));
		waterM3 = BigDecimal.sum(waterM3, toDecimal(log.water_m3));
		newaterM3 = BigDecimal.sum(newaterM3, toDecimal(log.newater_m3));
		wasteGenT = BigDecimal.sum(wasteGenT, toDecimal(log.waste_generated_t));
		wasteDivT = BigDecimal.sum(wasteDivT, toDecimal(log.waste_diverted_t));
		wasteHazT = BigDecimal.sum(wasteHazT, toDecimal(log.waste_hazardous_t));
	}

	const scope1Kg = BigDecimal.multiply(dieselLitres, DIESEL_FACTOR_KG_PER_LITRE);
	const scope2Kg = BigDecimal.multiply(electricityKwh, SG_GRID_FACTOR_KG_PER_KWH);
	const scope1T = divSafe(scope1Kg, THOUSAND);
	const scope2T = divSafe(scope2Kg, THOUSAND);
	const a4a5T = BigDecimal.sum(BigDecimal.sum(scope1T, scope2T), transportT);
	const diversionPct = BigDecimal.isPositive(wasteGenT)
		? BigDecimal.multiply(divSafe(wasteDivT, wasteGenT), HUNDRED)
		: ZERO;
	const newaterPct = BigDecimal.isPositive(waterM3)
		? BigDecimal.multiply(divSafe(newaterM3, waterM3), HUNDRED)
		: ZERO;

	return {
		electricity_kwh: formatTrimmed(electricityKwh, 1),
		diesel_litres: formatTrimmed(dieselLitres, 1),
		scope1_tco2e: formatTrimmed(scope1T, 2),
		scope2_tco2e: formatTrimmed(scope2T, 2),
		transport_tco2e: formatTrimmed(transportT, 2),
		a4_a5_tco2e: formatTrimmed(a4a5T, 2),
		water_m3: formatTrimmed(waterM3, 1),
		newater_m3: formatTrimmed(newaterM3, 1),
		newater_pct: formatTrimmed(newaterPct, 1),
		waste_generated_t: formatTrimmed(wasteGenT, 2),
		waste_diverted_t: formatTrimmed(wasteDivT, 2),
		waste_hazardous_t: formatTrimmed(wasteHazT, 2),
		waste_diversion_pct: formatTrimmed(diversionPct, 1)
	};
}

function renderTemplateNotes(
	template: Pick<ReportTemplate, 'body' | 'title' | 'version' | 'standard_ref'>,
	reference: string
): { readonly intro: string; readonly closing: string } {
	const raw = validateReportTemplateBody(template.body) ? template.body : '{report}';
	const values: Record<string, string> = {
		reference,
		title: template.title,
		version: template.version,
		standard: template.standard_ref ?? ''
	};
	const [before = '', ...rest] = raw.split('{report}');
	const fillVars = (chunk: string) =>
		chunk.replace(/\{([^{}]+)\}/g, (_, k: string) => values[k] ?? '').trim();
	return { intro: fillVars(before), closing: fillVars(rest.join('\n')) };
}

export const buildProjectReport = Effect.fnUntraced(function* (
	answer: ProjectReportAnswer,
	kind: ReportKind,
	locale: ReportLocale,
	generatedOn: string
) {
	const project = answer.projects.rows[0];
	if (!project) return yield* new ReportUnavailable({ message: 'errors.project_not_found' });

	const template = currentReportTemplate(answer.report_templates.rows, kind, locale);
	if (!template) {
		return yield* new ReportUnavailable({ message: 'errors.report_template_unpublished' });
	}

	const reference = project.project_number?.trim() || project.project_name;
	const clientName =
		project.client_id?.company_name?.trim() || project.client_id?.full_name?.trim() || '—';
	const pmName = project.project_manager?.name?.trim() || '—';
	const standardRef =
		template.standard_ref?.trim() ||
		(kind === 'sustainability_report'
			? 'BCA Green Mark 2021 (CN1.1) · EN 15978 · ISO 21930 · SGX / GRI 301–306'
			: 'BCA CORENET X (IFC+SG) · ISO 19650-2 · BCA CONQUAS · ISO 9001 / 14001 / 45001');
	const { intro, closing } = renderTemplateNotes(template, reference);

	const zh = locale === 'zh';

	if (kind === 'sustainability_report') {
		const estimate = answer.cost_estimates.rows[0];
		const bimAssets = estimate && estimate.status !== 'void' ? (estimate.bim_assets ?? []) : [];
		const matrixById = new Map(answer.item_matrix.rows.map((m) => [m.id, m] as const));
		const matrixByCode = new Map(answer.item_matrix.rows.map((m) => [m.code, m] as const));
		const carbon = computeProjectCarbon({
			bim_assets: bimAssets,
			adhoc_costs: answer.adhoc_costs.rows.map((c) => ({
				status: c.status,
				qty: c.qty,
				item: matrixById.get(c.catalog_item_id) ?? null
			}))
		});
		const site = summarizeSiteSustainability(answer.sustainability_logs.rows);

		const embodiedKg = toDecimal(carbon.total);
		const embodiedT = divSafe(embodiedKg, THOUSAND);
		const totalWlcT = BigDecimal.sum(embodiedT, toDecimal(site.a4_a5_tco2e));

		const gfaNum = project.gfa_m2 != null ? toNumber(project.gfa_m2) : 0;
		const embodiedKgNum = toNumber(carbon.total);
		const intensity = gfaNum > 0 ? Math.round((embodiedKgNum / gfaNum) * 10) / 10 : null;
		const baseline = project.building_typology
			? (BCA_CARBON_BASELINES[project.building_typology] ?? null)
			: null;
		const reductionPct =
			intensity !== null && baseline !== null && baseline > 0
				? Math.round(((baseline - intensity) / baseline) * 1000) / 10
				: null;

		const disciplineTotals = new Map<string, number>();
		for (const row of carbon.rows) {
			disciplineTotals.set(
				row.discipline,
				(disciplineTotals.get(row.discipline) ?? 0) + toNumber(row.carbon)
			);
		}
		const disciplines: PrintFields[] = [...disciplineTotals.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([disc, kg]) => ({
				discipline: disc.toUpperCase(),
				carbon_kg: kg.toFixed(1),
				carbon_t: (kg / 1000).toFixed(2),
				share_pct: embodiedKgNum > 0 ? `${((kg / embodiedKgNum) * 100).toFixed(1)}%` : '0%'
			}));

		const items: PrintFields[] = carbon.rows.map((r, idx) => {
			const meta = matrixByCode.get(r.code);
			return {
				index: String(idx + 1),
				code: r.code,
				name: r.name,
				discipline: r.discipline.toUpperCase(),
				stage: STAGE_LABELS[meta?.carbon_stage ?? 'a1_a3'] ?? 'A1–A3',
				quantity: `${r.quantity} ${r.unit}`,
				carbon_factor: r.carbon_factor,
				carbon_kg: r.carbon,
				carbon_t: (toNumber(r.carbon) / 1000).toFixed(2),
				epd_reference:
					meta?.epd_reference?.trim() || (zh ? 'SGBC / SBCC 默认因子' : 'SGBC / SBCC Default'),
				recycled_pct: meta?.recycled_content_pct != null ? `${meta.recycled_content_pct}%` : '—'
			};
		});

		const logs: PrintFields[] = answer.sustainability_logs.rows.map((log) => ({
			period: `${log.reporting_period.from}${log.reporting_period.to ? ` – ${log.reporting_period.to}` : ''}`,
			electricity_kwh: String(log.electricity_kwh),
			diesel_litres: String(log.diesel_litres),
			transport_tco2e: String(log.transport_tco2e),
			water_m3: String(log.water_m3),
			newater_m3: String(log.newater_m3),
			waste_generated_t: String(log.waste_generated_t),
			waste_diverted_t: String(log.waste_diverted_t),
			waste_hazardous_t: String(log.waste_hazardous_t),
			notes: log.notes ?? '—'
		}));

		const typologyText = project.building_typology
			? (TYPOLOGY_LABELS[project.building_typology]?.[locale] ?? project.building_typology)
			: '—';
		const gmTargetText = project.green_mark_target
			? (GREEN_MARK_LABELS[project.green_mark_target]?.[locale] ?? project.green_mark_target)
			: '—';

		const fields: PrintFields = {
			title: template.title,
			version: template.version,
			standard_ref: standardRef,
			generated_on: generatedOn,
			reference,
			project_name: project.project_name,
			project_number: project.project_number ?? '—',
			client_name: clientName,
			project_manager: pmName,
			address: project.address ?? '—',
			bca_project_ref: project.bca_project_ref ?? '—',
			bim_version: project.bim_version ?? '—',
			gfa_m2: project.gfa_m2 != null ? `${project.gfa_m2} m²` : '—',
			building_typology: typologyText,
			green_mark_target: gmTargetText,
			sustainability_assessor: project.sustainability_assessor ?? '—',
			embodied_tco2e: formatTrimmed(embodiedT, 2),
			embodied_model_tco2e: formatTrimmed(divSafe(toDecimal(carbon.model), THOUSAND), 2),
			embodied_other_tco2e: formatTrimmed(divSafe(toDecimal(carbon.other), THOUSAND), 2),
			uncounted_lines: String(carbon.uncounted),
			carbon_intensity: intensity !== null ? `${intensity} kgCO₂e/m²` : '—',
			bca_baseline: baseline !== null ? `${baseline} kgCO₂e/m²` : '—',
			baseline_reduction:
				reductionPct !== null ? `${reductionPct >= 0 ? '−' : '+'}${Math.abs(reductionPct)}%` : '—',
			total_wlc_tco2e: formatTrimmed(totalWlcT, 2),
			...site,
			intro,
			closing
		};

		const sections: PrintSections = { disciplines, items, logs };

		const fallbackBody = `
			${intro ? paragraphs(intro) : ''}
			<div class="meta">
				<div><strong>${zh ? '项目名称' : 'Project'}:</strong> ${escapeHtml(project.project_name)} (${escapeHtml(reference)})</div>
				<div><strong>${zh ? '报告日期' : 'Report Date'}:</strong> ${escapeHtml(generatedOn)}</div>
				<div><strong>${zh ? '业主 / 客户' : 'Client'}:</strong> ${escapeHtml(clientName)}</div>
				<div><strong>${zh ? '绿色建筑目标' : 'Green Mark Target'}:</strong> ${escapeHtml(gmTargetText)}</div>
				<div><strong>${zh ? '总建筑面积 (GFA)' : 'Gross Floor Area (GFA)'}:</strong> ${escapeHtml(fields.gfa_m2 ?? '—')}</div>
				<div><strong>${zh ? '建筑类型' : 'Typology'}:</strong> ${escapeHtml(typologyText)}</div>
				<div><strong>${zh ? 'GMAP / 评估师' : 'GMAP / Assessor'}:</strong> ${escapeHtml(fields.sustainability_assessor ?? '—')}</div>
				<div><strong>${zh ? 'BCA 项目编号' : 'BCA Project Ref'}:</strong> ${escapeHtml(fields.bca_project_ref ?? '—')}</div>
			</div>
			<h2>${zh ? '1. 全生命周期碳排摘要 (BCA Green Mark WLC / EN 15978)' : '1. Whole Life Carbon Executive Summary (BCA Green Mark CN1.1 / EN 15978)'}</h2>
			<div class="kpis">
				<div class="kpi"><div class="kpi-label">${zh ? 'A1–A3 隐含碳排' : 'Upfront Embodied (A1–A3)'}</div><div class="kpi-value">${escapeHtml(fields.embodied_tco2e ?? '0')} tCO₂e</div></div>
				<div class="kpi"><div class="kpi-label">${zh ? '碳排强度 vs BCA 基准' : 'Intensity vs BCA Baseline'}</div><div class="kpi-value">${escapeHtml(fields.carbon_intensity ?? '—')} (${escapeHtml(fields.baseline_reduction ?? '—')})</div></div>
				<div class="kpi"><div class="kpi-label">${zh ? 'A4–A5 施工阶段 (Scope 1+2)' : 'Site A4–A5 (Scope 1 & 2)'}</div><div class="kpi-value">${escapeHtml(site.a4_a5_tco2e)} tCO₂e</div></div>
				<div class="kpi"><div class="kpi-label">${zh ? '建筑垃圾回收率 (GRI 306)' : 'C&D Waste Diverted (GRI 306)'}</div><div class="kpi-value">${escapeHtml(site.waste_diversion_pct)}%</div></div>
			</div>
			<h2>${zh ? '2. 按专业汇总 (Embodied Carbon by Discipline)' : '2. Embodied Carbon by Discipline'}</h2>
			<table><thead><tr><th>${zh ? '专业' : 'Discipline'}</th><th class="num">kgCO₂e</th><th class="num">tCO₂e</th><th class="num">${zh ? '占比' : 'Share'}</th></tr></thead><tbody>
				${disciplines.map((d) => `<tr><td>${escapeHtml(d.discipline ?? '')}</td><td class="num">${escapeHtml(d.carbon_kg ?? '')}</td><td class="num">${escapeHtml(d.carbon_t ?? '')}</td><td class="num">${escapeHtml(d.share_pct ?? '')}</td></tr>`).join('') || `<tr><td colspan="4">—</td></tr>`}
			</tbody></table>
			<h2>${zh ? '3. 材料清单与 EPD 依据 (GRI 301 / ISO 21930)' : '3. Material Carbon Inventory & EPD Provenance (GRI 301 / ISO 21930)'}</h2>
			<table><thead><tr><th>#</th><th>${zh ? '编码' : 'Code'}</th><th>${zh ? '材料 / 构件' : 'Material / Element'}</th><th>${zh ? '阶段' : 'Stage'}</th><th class="num">${zh ? '工程量' : 'Qty'}</th><th class="num">tCO₂e</th><th>${zh ? 'EPD / 因子来源' : 'EPD / Factor Source'}</th><th class="num">${zh ? '再生比例' : 'Recycled'}</th></tr></thead><tbody>
				${items.map((r) => `<tr><td class="num">${escapeHtml(r.index ?? '')}</td><td>${escapeHtml(r.code ?? '')}</td><td>${escapeHtml(r.name ?? '')}</td><td>${escapeHtml(r.stage ?? '')}</td><td class="num">${escapeHtml(r.quantity ?? '')}</td><td class="num">${escapeHtml(r.carbon_t ?? '')}</td><td>${escapeHtml(r.epd_reference ?? '')}</td><td class="num">${escapeHtml(r.recycled_pct ?? '')}</td></tr>`).join('') || `<tr><td colspan="8">—</td></tr>`}
			</tbody></table>
			<h2>${zh ? '4. 施工现场能耗、水资源与废弃物 (GRI 302 / 303 / 305 / 306)' : '4. Site Energy, Scope 1 & 2, Water & Waste Logs (GRI 302 / 303 / 305 / 306)'}</h2>
			<table><thead><tr><th>${zh ? '统计周期' : 'Period'}</th><th class="num">${zh ? '用电 (kWh)' : 'Electricity (kWh)'}</th><th class="num">${zh ? '柴油 (L)' : 'Diesel (L)'}</th><th class="num">${zh ? 'A4 运输 (tCO₂e)' : 'A4 Transport (tCO₂e)'}</th><th class="num">${zh ? '用水 / 新生水 (m³)' : 'Water / NEWater (m³)'}</th><th class="num">${zh ? '产生 / 回收废弃物 (t)' : 'Waste Gen / Diverted (t)'}</th></tr></thead><tbody>
				${logs.map((l) => `<tr><td>${escapeHtml(l.period ?? '')}</td><td class="num">${escapeHtml(l.electricity_kwh ?? '')}</td><td class="num">${escapeHtml(l.diesel_litres ?? '')}</td><td class="num">${escapeHtml(l.transport_tco2e ?? '')}</td><td class="num">${escapeHtml(l.water_m3 ?? '')} / ${escapeHtml(l.newater_m3 ?? '')}</td><td class="num">${escapeHtml(l.waste_generated_t ?? '')} / ${escapeHtml(l.waste_diverted_t ?? '')}</td></tr>`).join('') || `<tr><td colspan="6">—</td></tr>`}
			</tbody></table>
			${closing ? paragraphs(closing) : ''}
			<div class="signoff">
				<div class="signbox"><strong>${zh ? '编制人 (GMAP / 可持续发展经理)' : 'Prepared by (GMAP / Sustainability Lead)'}</strong><br>${escapeHtml(fields.sustainability_assessor ?? '—')}</div>
				<div class="signbox"><strong>${zh ? '审核人 (项目经理)' : 'Reviewed by (Project Manager)'}</strong><br>${escapeHtml(pmName)}</div>
				<div class="signbox"><strong>${zh ? '批准人 (业主 / 管理代表)' : 'Approved by (Management / Client)'}</strong><br>${escapeHtml(generatedOn)}</div>
			</div>
		`;

		return {
			kind,
			locale,
			title: template.title,
			filename: `${reference}-sustainability-report-${locale}.pdf`,
			reference,
			template_id: template.id,
			template_version: template.version,
			fallback_html: wrapFallbackPage(template.title, standardRef, fallbackBody, locale),
			print_layout: template.print_layout ?? null,
			letterhead: template.letterhead ?? null,
			stamp: template.company_stamp ?? null,
			fields,
			sections
		} satisfies BuiltReportDocument;
	}

	// Compliance Report: BCA CORENET X (IFC+SG) + ISO 19650-2 + BCA CONQUAS + ISO 9001 / 14001 / 45001
	const compliance = project.bim_compliance ?? null;
	const summary = project.bim_summary ?? null;
	const ruleByCode = new Map(answer.sop_rules.rows.map((r) => [r.code, r] as const));

	const findings: PrintFields[] = (compliance?.findings ?? []).map((f, idx) => {
		const res = classifyFindingResolution(f, ruleByCode.get(f.rule_code) ?? null);
		return {
			index: String(idx + 1),
			status: f.status.toUpperCase(),
			authority: AUTHORITY_LABELS[f.authority] ?? f.authority.toUpperCase(),
			rule_code: f.rule_code,
			rule_name: f.rule_name,
			clause_ref: f.clause_ref ?? '—',
			actual: f.actual,
			expected: f.expected,
			affected_count: String(f.affected_count),
			resolution:
				f.status === 'pass'
					? zh
						? '已符合'
						: 'Compliant'
					: res.requiresBimRevision
						? zh
							? '需修改 BIM 源文件'
							: 'Requires BIM Revision'
						: zh
							? '元数据清理/分类可解决'
							: 'Resolved by Cleanup',
			remediation: f.remediation ?? '—'
		};
	});

	const audits: PrintFields[] = answer.compliance_records.rows.map((rec, idx) => ({
		index: String(idx + 1),
		record_code: rec.record_code,
		recorded_on: rec.recorded_on,
		standard: STANDARD_LABELS[rec.standard] ?? rec.standard,
		category: rec.category.replace(/_/g, ' ').toUpperCase(),
		clause_ref: rec.clause_ref ?? '—',
		title: rec.title,
		severity: rec.severity.toUpperCase(),
		status: rec.status.replace(/_/g, ' ').toUpperCase(),
		metric_value: rec.metric_value ?? '—',
		corrective_action: rec.corrective_action ?? '—',
		owner: rec.owner?.name ?? '—',
		closed_on: rec.closed_on ?? '—'
	}));

	const openAuditCount = answer.compliance_records.rows.filter(
		(r) => r.status === 'open' || r.status === 'in_progress'
	).length;
	const closedAuditCount = answer.compliance_records.rows.length - openAuditCount;
	const gatewayText = project.submission_gateway
		? (GATEWAY_LABELS[project.submission_gateway]?.[locale] ?? project.submission_gateway)
		: '—';

	const fields: PrintFields = {
		title: template.title,
		version: template.version,
		standard_ref: standardRef,
		generated_on: generatedOn,
		reference,
		project_name: project.project_name,
		project_number: project.project_number ?? '—',
		client_name: clientName,
		project_manager: pmName,
		address: project.address ?? '—',
		bca_project_ref: project.bca_project_ref ?? '—',
		submission_gateway: gatewayText,
		qualified_person: project.qualified_person ?? '—',
		bim_manager: project.bim_manager ?? '—',
		bep_version: project.bep_version ?? '—',
		conquas_band_target: project.conquas_band_target ?? '—',
		bim_file_name: project.bim_file?.name ?? '—',
		bim_version: project.bim_version ?? '—',
		ifc_schema: summary?.schema ?? '—',
		asset_count: summary ? String(summary.asset_count) : '0',
		storey_count: summary ? String(summary.storey_count) : '0',
		storeys: summary?.storeys?.join(', ') || '—',
		compliance_score: compliance ? `${compliance.score_pct}%` : '—',
		rules_passed: compliance ? `${compliance.pass_count} / ${compliance.total_rules}` : '0 / 0',
		rules_warn: compliance ? String(compliance.warn_count) : '0',
		rules_fail: compliance ? String(compliance.fail_count) : '0',
		checked_at: compliance?.checked_at ?? '—',
		audits_total: String(answer.compliance_records.rows.length),
		audits_open: String(openAuditCount),
		audits_closed: String(closedAuditCount),
		intro,
		closing
	};

	const sections: PrintSections = { findings, audits };

	const fallbackBody = `
		${intro ? paragraphs(intro) : ''}
		<div class="meta">
			<div><strong>${zh ? '项目名称' : 'Project'}:</strong> ${escapeHtml(project.project_name)} (${escapeHtml(reference)})</div>
			<div><strong>${zh ? '报告日期' : 'Report Date'}:</strong> ${escapeHtml(generatedOn)}</div>
			<div><strong>${zh ? 'BCA / CORENET X 编号' : 'BCA / CORENET X Ref'}:</strong> ${escapeHtml(fields.bca_project_ref ?? '—')}</div>
			<div><strong>${zh ? '申报关口' : 'Submission Gateway'}:</strong> ${escapeHtml(gatewayText)}</div>
			<div><strong>${zh ? '合格人士 (QP / PE)' : 'Lead Qualified Person (QP / PE)'}:</strong> ${escapeHtml(fields.qualified_person ?? '—')}</div>
			<div><strong>${zh ? 'ISO 19650 BIM 经理' : 'ISO 19650 BIM Manager'}:</strong> ${escapeHtml(fields.bim_manager ?? '—')}</div>
			<div><strong>${zh ? 'BEP / EIR 版本' : 'BEP / EIR Reference'}:</strong> ${escapeHtml(fields.bep_version ?? '—')}</div>
			<div><strong>${zh ? 'CONQUAS 目标' : 'CONQUAS Target'}:</strong> ${escapeHtml(fields.conquas_band_target ?? '—')}</div>
		</div>
		<h2>${zh ? '1. 合规总览 (CORENET X / ISO 19650 / IMS)' : '1. Compliance Executive Dashboard (CORENET X / ISO 19650 / IMS)'}</h2>
		<div class="kpis">
			<div class="kpi"><div class="kpi-label">${zh ? 'BIM 合规评分' : 'BIM Compliance Score'}</div><div class="kpi-value">${escapeHtml(fields.compliance_score ?? '—')}</div></div>
			<div class="kpi"><div class="kpi-label">${zh ? '通过规则' : 'Rules Passed'}</div><div class="kpi-value">${escapeHtml(fields.rules_passed ?? '0 / 0')}</div></div>
			<div class="kpi"><div class="kpi-label">${zh ? '不合规 / 预警' : 'Failures / Warnings'}</div><div class="kpi-value">${escapeHtml(fields.rules_fail ?? '0')} / ${escapeHtml(fields.rules_warn ?? '0')}</div></div>
			<div class="kpi"><div class="kpi-label">${zh ? '现场审核 / NCR (未结/已结)' : 'Site Audits & NCRs (Open/Closed)'}</div><div class="kpi-value">${escapeHtml(fields.audits_open ?? '0')} / ${escapeHtml(fields.audits_closed ?? '0')}</div></div>
		</div>
		<h2>${zh ? '2. BIM 模型与 CORENET X / BCA / SCDF / PUB 自动核验明细' : '2. Automated CORENET X, BCA, SCDF, PUB & SOP Verification Findings'}</h2>
		<table><thead><tr><th>${zh ? '状态' : 'Status'}</th><th>${zh ? '机构' : 'Authority'}</th><th>${zh ? '规则与条款' : 'Rule & Clause'}</th><th>${zh ? '现状' : 'Actual'}</th><th>${zh ? '规范要求' : 'Required'}</th><th>${zh ? '整改结论' : 'Resolution'}</th></tr></thead><tbody>
			${findings.map((f) => `<tr><td class="${f.status === 'PASS' ? 'badge-pass' : f.status === 'WARNING' ? 'badge-warn' : 'badge-fail'}">${escapeHtml(f.status ?? '')}</td><td>${escapeHtml(f.authority ?? '')}</td><td>${escapeHtml(f.rule_code ?? '')} · ${escapeHtml(f.rule_name ?? '')}<br><small>${escapeHtml(f.clause_ref ?? '')}</small></td><td>${escapeHtml(f.actual ?? '')}</td><td>${escapeHtml(f.expected ?? '')}</td><td>${escapeHtml(f.resolution ?? '')}</td></tr>`).join('') || `<tr><td colspan="6">—</td></tr>`}
		</tbody></table>
		<h2>${zh ? '3. CONQUAS 与 ISO 9001 / 14001 / 45001 / 19650 现场合规台账' : '3. BCA CONQUAS & ISO 9001 / 14001 / 45001 / 19650 Audit & NCR Register'}</h2>
		<table><thead><tr><th>${zh ? '编号' : 'Code'}</th><th>${zh ? '标准' : 'Standard'}</th><th>${zh ? '条款 / 事项' : 'Clause & Item'}</th><th>${zh ? '实测值 / 指标' : 'Measured / Metric'}</th><th>${zh ? '整改措施' : 'Corrective Action'}</th><th>${zh ? '状态' : 'Status'}</th></tr></thead><tbody>
			${audits.map((a) => `<tr><td>${escapeHtml(a.record_code ?? '')}</td><td>${escapeHtml(a.standard ?? '')}</td><td>${escapeHtml(a.title ?? '')}<br><small>${escapeHtml(a.clause_ref ?? '')}</small></td><td>${escapeHtml(a.metric_value ?? '')}</td><td>${escapeHtml(a.corrective_action ?? '')}</td><td>${escapeHtml(a.status ?? '')}</td></tr>`).join('') || `<tr><td colspan="6">—</td></tr>`}
		</tbody></table>
		${closing ? paragraphs(closing) : ''}
		<div class="signoff">
			<div class="signbox"><strong>${zh ? '编制人 (BIM / 质量安全经理)' : 'Prepared by (BIM / QA-HSE Manager)'}</strong><br>${escapeHtml(fields.bim_manager ?? '—')}</div>
			<div class="signbox"><strong>${zh ? '审核人 (项目经理)' : 'Reviewed by (Project Manager)'}</strong><br>${escapeHtml(pmName)}</div>
			<div class="signbox"><strong>${zh ? '批准人 (合格人士 QP / PE)' : 'Approved by (Qualified Person QP / PE)'}</strong><br>${escapeHtml(fields.qualified_person ?? '—')}</div>
		</div>
	`;

	return {
		kind,
		locale,
		title: template.title,
		filename: `${reference}-compliance-report-${locale}.pdf`,
		reference,
		template_id: template.id,
		template_version: template.version,
		fallback_html: wrapFallbackPage(template.title, standardRef, fallbackBody, locale),
		print_layout: template.print_layout ?? null,
		letterhead: template.letterhead ?? null,
		stamp: template.company_stamp ?? null,
		fields,
		sections
	} satisfies BuiltReportDocument;
});

function imageUri(png: Uint8Array) {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (png.length > 512 * 1024 || !signature.every((byte, index) => byte === png[index])) {
		return Effect.fail(new ReportUnavailable({ message: 'errors.report_artwork_png' }));
	}
	return Effect.succeed(`data:image/png;base64,${Base64.encode(png)}`);
}

export function reportConvertSource<E>(
	document: BuiltReportDocument,
	includeStamp: boolean,
	read: (file: FileRef, max: '512KiB' | '3MiB') => Effect.Effect<Uint8Array, E>
) {
	return Effect.gen(function* () {
		const letterhead = document.letterhead
			? yield* imageUri(yield* read(document.letterhead, '512KiB'))
			: '';
		const stamp =
			includeStamp && document.stamp ? yield* imageUri(yield* read(document.stamp, '512KiB')) : '';

		if (document.print_layout) {
			const bytes = yield* read(document.print_layout, '3MiB');
			const layout_html = yield* Effect.try({
				try: () => {
					const layout = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
					return renderReportLayout(
						layout,
						{ ...document.fields, letterhead, stamp },
						document.sections
					);
				},
				catch: (error) =>
					new ReportUnavailable({
						message: error instanceof Error ? error.message : 'errors.report_layout_unavailable'
					})
			});
			return { layout_html };
		}

		let html = document.fallback_html;
		if (letterhead) {
			const img = `<p style="margin-bottom:5mm;break-inside:avoid"><img alt="Company letterhead" style="max-height:22mm;width:auto" src="${letterhead}"></p>`;
			html = html.replace('<body>', `<body>${img}`);
		}
		if (stamp) {
			const img = `<p style="text-align:right;margin-top:8mm;break-inside:avoid"><img alt="Company stamp" style="width:32mm;height:auto" src="${stamp}"></p>`;
			html = html.replace('</body></html>', `${img}</body></html>`);
		}
		return { html };
	});
}

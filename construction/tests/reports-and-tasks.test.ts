import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { fileURLToPath } from 'node:url';
import {
	buildProjectReport,
	projectReportRead,
	renderReportLayout,
	summarizeSiteSustainability
} from '../src/services/reports/report-document.js';
import { validateReportTemplateBody } from '../src/services/reports/template-validation.js';
import {
	fixtureId,
	queryTyped,
	recordOf,
	rowsOf,
	workspace as acquireWorkspace
} from './test-runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));

it('validates report template bodies, computes site sustainability KPIs, and escapes custom HTML layouts', () => {
	expect(validateReportTemplateBody('{report}')).toBe(true);
	expect(
		validateReportTemplateBody('Intro {reference}\n{report}\n{title} v{version} {standard}')
	).toBe(true);
	expect(validateReportTemplateBody('Missing placeholder')).toBe(false);
	expect(validateReportTemplateBody('{report}\n{report}')).toBe(false);
	expect(validateReportTemplateBody('{report} {unknown_var}')).toBe(false);

	const site = summarizeSiteSustainability([
		{
			id: fixtureId('sustainability_logs', '019f0100-0001-7000-8000-000000000101'),
			reporting_period: { from: '2026-05-01', to: '2026-05-31' },
			electricity_kwh: '10000.00',
			diesel_litres: '1000.00',
			transport_tco2e: '3.500',
			water_m3: '200.00',
			newater_m3: '50.00',
			waste_generated_t: '40.00',
			waste_diverted_t: '32.00',
			waste_hazardous_t: '0.20',
			notes: null
		}
	]);
	// Scope 1: 1000 L * 2.68 / 1000 = 2.68 tCO2e; Scope 2: 10000 kWh * 0.4057 / 1000 = 4.06 tCO2e
	expect(site.scope1_tco2e).toBe('2.68');
	expect(site.scope2_tco2e).toBe('4.06');
	expect(site.a4_a5_tco2e).toBe('10.24');
	expect(site.newater_pct).toBe('25');
	expect(site.waste_diversion_pct).toBe('80');

	const html = renderReportLayout(
		'<h1>{{title}}</h1><ul>{{#items}}<li>{{code}}: {{name}}</li>{{/items}}</ul>',
		{ title: 'Report <script>alert(1)</script>' },
		{ items: [{ code: 'C-1', name: 'Concrete & Steel' }] }
	);
	expect(html).toBe(
		'<h1>Report &lt;script&gt;alert(1)&lt;/script&gt;</h1><ul><li>C-1: Concrete &amp; Steel</li></ul>'
	);
	expect(() => renderReportLayout('<p>{{missing}}</p>', {}, {})).toThrow('Unknown print field');
	expect(() => renderReportLayout('{{#unknown}}{{x}}{{/unknown}}', {}, {})).toThrow(
		'Unknown print section'
	);
});

it.effect(
	'auto-allocates task codes, governs report templates, tracks sustainability & compliance records, and builds EN/ZH reports',
	() =>
		Effect.gen(function* () {
			const t = yield* acquireWorkspace({ root, now: '2026-06-15T06:00:00.000Z' });
			const viewer = yield* t.as(t.member(['construction_read']));
			const delivery = yield* t.as(t.member(['construction_read', 'construction_delivery']));
			const qs = yield* t.as(t.member(['construction_read', 'construction_commercial']));

			const createdProject = yield* delivery.act({
				'projects.create': [
					{
						project_name: 'Synthetic Civic Centre',
						project_number: 'SCC-100',
						project_role: 'main_contractor',
						currency: 'SGD',
						gfa_m2: '1000.00',
						building_typology: 'non_residential',
						green_mark_target: 'platinum',
						sustainability_assessor: 'Assessor A (GMAP-001)',
						bca_project_ref: 'A2026-9999-0001',
						submission_gateway: 'construction',
						qualified_person: 'QP Alpha (PE 1001)',
						bim_manager: 'BIM Lead Beta',
						bep_version: 'BEP-Rev-02',
						conquas_band_target: 'Band 1 (>=95)'
					}
				]
			});
			if (createdProject.kind !== 'committed') throw new Error('Project create failed');
			const project = recordOf(createdProject.records, 'projects');

			// 1. Polymorphic BIM & Ad-hoc tasks auto-allocate sequential task_code when omitted, preserving explicit codes
			const createdTasks = yield* delivery.act({
				'tasks.create': [
					{
						project_id: project.id,
						title: 'Pour L1 slab',
						kind: 'bim',
						bim_express_ids: [101, 102]
					},
					{
						project_id: project.id,
						title: 'Mobilize mobile crane',
						kind: 'adhoc'
					},
					{
						project_id: project.id,
						task_code: 'P6-400',
						title: 'External Primavera milestone',
						kind: 'adhoc',
						is_milestone: true
					}
				]
			});
			if (createdTasks.kind !== 'committed') throw new Error('Task create failed');
			const taskRows = rowsOf(
				yield* delivery.query({
					tasks: {
						where: { project_id: { eq: project.id } },
						fields: ['task_code', 'kind', 'bim_express_ids'],
						order_by: { task_code: 'asc' },
						limit: 10
					}
				}),
				'tasks'
			);
			expect(taskRows.map((r) => r.task_code)).toEqual(['P6-400', 'T-001', 'T-002']);

			// 2. Item matrix carbon provenance + adhoc cost for embodied carbon
			const createdItem = yield* qs.act({
				'item_matrix.create': [
					{
						code: 'STR-CONC-TEST',
						name: 'Low-Carbon Structural Concrete',
						category: 'additional_cost',
						discipline: 'structural',
						unit: 'm3',
						quantity_basis: 'volume',
						currency: 'SGD',
						unit_rate: '220.00',
						carbon_factor: '250.000',
						carbon_stage: 'a1_a3',
						epd_reference: 'ISO-21930-EPD-TEST-01',
						recycled_content_pct: '30.0'
					}
				]
			});
			if (createdItem.kind !== 'committed') throw new Error('Item matrix create failed');
			const itemId = recordOf(createdItem.records, 'item_matrix').id;

			const createdAdhoc = yield* qs.act({
				'adhoc_costs.create': [
					{
						project_id: project.id,
						catalog_item_id: itemId,
						title: 'Concrete batch A',
						qty: '2000',
						currency: 'SGD',
						unit_rate: '220.00'
					}
				]
			});
			if (createdAdhoc.kind !== 'committed') throw new Error('Adhoc cost create failed');

			// 3. Sustainability logs reject negatives and accept valid site metrics
			const badLog = yield* delivery
				.act({
					'sustainability_logs.create': [
						{
							project_id: project.id,
							reporting_period: { from: '2026-05-01', to: '2026-05-31' },
							electricity_kwh: '-10.00'
						}
					]
				})
				.pipe(Effect.flip);
			expect(badLog._tag).toBe('ActRefused');

			const viewerLogDenied = yield* viewer
				.act({
					'sustainability_logs.create': [
						{
							project_id: project.id,
							reporting_period: { from: '2026-05-01', to: '2026-05-31' },
							electricity_kwh: '100.00'
						}
					]
				})
				.pipe(Effect.flip);
			expect(viewerLogDenied._tag).toBe('ActRefused');

			const createdLog = yield* delivery.act({
				'sustainability_logs.create': [
					{
						project_id: project.id,
						reporting_period: { from: '2026-05-01', to: '2026-05-31' },
						electricity_kwh: '20000.00',
						diesel_litres: '1500.00',
						transport_tco2e: '4.500',
						water_m3: '300.00',
						newater_m3: '120.00',
						waste_generated_t: '50.00',
						waste_diverted_t: '42.50',
						waste_hazardous_t: '0.25'
					}
				]
			});
			if (createdLog.kind !== 'committed') throw new Error('Sustainability log create failed');

			// 4. Compliance records sequence + closed_on auto-stamp + BIM compliance scorecard
			const updatedBim = yield* delivery.act({
				'projects.update': [
					{
						target: project,
						set: {
							bim_compliance: {
								checked_at: '2026-06-15T05:00:00.000Z',
								total_rules: 2,
								pass_count: 1,
								warn_count: 0,
								fail_count: 1,
								score_pct: 50,
								findings: [
									{
										rule_code: 'CX-STOREY-02',
										rule_name: 'Spatial containment',
										authority: 'corenet_x',
										severity: 'error',
										status: 'pass',
										actual: '0%',
										expected: '<= 1%',
										affected_count: 0
									},
									{
										rule_code: 'BCA-ACC-DOOR-W',
										rule_name: 'Accessible door width',
										authority: 'bca',
										severity: 'error',
										status: 'fail',
										actual: '780 mm',
										expected: '>= 850 mm',
										affected_count: 2,
										clause_ref: 'BCA Cl. 4.4.2'
									}
								]
							}
						}
					}
				]
			});
			if (updatedBim.kind !== 'committed') throw new Error('Project compliance update failed');

			const createdComp = yield* delivery.act({
				'compliance_records.create': [
					{
						project_id: project.id,
						recorded_on: '2026-06-10',
						standard: 'bca_conquas',
						category: 'inspection',
						clause_ref: 'CONQUAS Cl. 2.1',
						title: 'Cube strength verification',
						severity: 'medium',
						metric_value: '52 MPa'
					},
					{
						project_id: project.id,
						recorded_on: '2026-06-12',
						standard: 'iso_9001',
						category: 'ncr',
						clause_ref: 'ISO 9001 Cl. 10.2',
						title: 'Penetration collar NCR',
						severity: 'high'
					}
				]
			});
			if (createdComp.kind !== 'committed') throw new Error('Compliance create failed');
			const firstComp = recordOf(createdComp.records, 'compliance_records', 0);

			const closedComp = yield* delivery.act({
				'compliance_records.update': [{ target: firstComp, set: { status: 'verified' } }]
			});
			if (closedComp.kind !== 'committed') throw new Error('Compliance close failed');

			const compRows = rowsOf(
				yield* delivery.query({
					compliance_records: {
						where: { project_id: { eq: project.id } },
						fields: ['record_code', 'status', 'closed_on'],
						order_by: { record_code: 'asc' },
						limit: 10
					}
				}),
				'compliance_records'
			);
			expect(compRows[0]?.record_code).toBe('CMP-2026-001');
			expect(compRows[0]?.closed_on).toBe('2026-06-15');
			expect(compRows[1]?.record_code).toBe('CMP-2026-002');

			// 5. Report templates validation, auto-versioning, publish stamp & immutable lock
			const invalidTemplate = yield* qs
				.act({
					'report_templates.create': [
						{
							kind: 'sustainability_report',
							locale: 'en',
							title: 'Broken template',
							body: 'No placeholder here'
						}
					]
				})
				.pipe(Effect.flip);
			expect(invalidTemplate._tag).toBe('ActRefused');

			const createdTemplates = yield* qs.act({
				'report_templates.create': [
					{
						kind: 'sustainability_report',
						locale: 'en',
						title: 'WLC Sustainability Report',
						body: '{report}\nSigned for {reference}.'
					},
					{
						kind: 'compliance_report',
						locale: 'zh',
						title: '合规报告',
						body: '{report}\n申报编号 {reference}'
					}
				]
			});
			if (createdTemplates.kind !== 'committed') throw new Error('Template create failed');
			const susTpl = recordOf(createdTemplates.records, 'report_templates', 0);
			const cmpTpl = recordOf(createdTemplates.records, 'report_templates', 1);

			const published = yield* qs.act({
				'report_templates.update': [
					{ target: susTpl, set: { status: 'published' } },
					{ target: cmpTpl, set: { status: 'published' } }
				]
			});
			if (published.kind !== 'committed') throw new Error('Template publish failed');
			const publishedSus = recordOf(published.records, 'report_templates', 0);

			// Published template is locked against edits
			const editPublishedDenied = yield* qs
				.act({
					'report_templates.update': [{ target: publishedSus, set: { title: 'Tampered' } }]
				})
				.pipe(Effect.flip);
			expect(editPublishedDenied._tag).toBe('ActRefused');

			// Creating a revision auto-increments version
			const revised = yield* qs.act({
				'report_templates.create': [
					{
						kind: 'sustainability_report',
						locale: 'en',
						title: 'WLC Sustainability Report Rev 2',
						body: '{report}'
					}
				]
			});
			if (revised.kind !== 'committed') throw new Error('Template revise failed');
			const tplRows = rowsOf(
				yield* qs.query({
					report_templates: {
						where: { kind: { eq: 'sustainability_report' }, locale: { eq: 'en' } },
						fields: ['version', 'status', 'published_at'],
						order_by: { version: 'asc' },
						limit: 10
					}
				}),
				'report_templates'
			);
			expect(tplRows.map((r) => r.version)).toEqual(['1', '2']);
			expect(tplRows[0]?.published_at).toBeTruthy();

			// 6. Build Sustainability (EN) & Compliance (ZH) reports from live workspace answer
			const answer = yield* queryTyped(viewer, t.manifest, projectReportRead(project.id));
			const susDoc = yield* buildProjectReport(answer, 'sustainability_report', 'en', '2026-06-15');
			// 2000 m3 * 250 kgCO2e/m3 = 500,000 kgCO2e = 500 tCO2e; GFA 1000 m2 -> 500 kgCO2e/m2 vs 1000 baseline (-50%)
			expect(susDoc.fields.embodied_tco2e).toBe('500');
			expect(susDoc.fields.carbon_intensity).toBe('500 kgCO₂e/m²');
			expect(susDoc.fields.bca_baseline).toBe('1000 kgCO₂e/m²');
			expect(susDoc.fields.baseline_reduction).toBe('−50%');
			expect(susDoc.fields.waste_diversion_pct).toBe('85');
			expect(susDoc.sections.items?.[0]?.epd_reference).toBe('ISO-21930-EPD-TEST-01');
			expect(susDoc.sections.items?.[0]?.recycled_pct).toBe('30.0%');
			expect(susDoc.fallback_html).toContain('Signed for SCC-100.');

			const cmpDoc = yield* buildProjectReport(answer, 'compliance_report', 'zh', '2026-06-15');
			expect(cmpDoc.fields.compliance_score).toBe('50%');
			expect(cmpDoc.fields.rules_passed).toBe('1 / 2');
			expect(cmpDoc.fields.audits_open).toBe('1');
			expect(cmpDoc.fields.audits_closed).toBe('1');
			expect(cmpDoc.fields.qualified_person).toBe('QP Alpha (PE 1001)');
			expect(cmpDoc.sections.findings).toHaveLength(2);
			expect(cmpDoc.sections.audits).toHaveLength(2);
		})
);

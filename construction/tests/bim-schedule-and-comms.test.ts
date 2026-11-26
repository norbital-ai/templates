import { Effect, Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { JobResult, runAutomation, type TestOptions } from '@norbital-ai/bolt-cli/test';
import type { Ai } from '@norbital-ai/bolt/engine';
import {
	buildBimCostEstimate,
	createIfcStepStreamParser,
	extractFromParsedModel,
	parseIfcStep,
	rankCandidateMatrixRules,
	UNKNOWN_CATALOG_CHOICE,
	type ArchetypeDecision
} from '../src/lib/bim-pipeline.js';
import { parseMsProjectXml, parsePrimaveraXer } from '../src/lib/schedule-parsers.js';
import { fixtureId, recordOf, rowsOf, workspace as acquireWorkspace } from './test-runtime.js';
import sys_team from '../seed/public/sys_team.json' with { type: 'json' };

const root = fileURLToPath(new URL('..', import.meta.url));

const SAMPLE_IFC = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#10= IFCPROJECT('0Proj',#1,'PRJ',$,$,'Synthetic Block',$,$,$);
#20= IFCBUILDINGSTOREY('0St1',#1,'Level 1',$,$,$,$,'Level 1',.ELEMENT.,0.);
#21= IFCBUILDINGSTOREY('0St2',#1,'Roof',$,$,$,$,'Roof',.ELEMENT.,10.);
#30= IFCFLOWCONTROLLER('0Pan1',#1,'M_Panelboard:400A',$,'400A',$,$,'101');
#31= IFCFLOWTERMINAL('0Rec1',#1,'M_Duplex Receptacle:Standard',$,'Standard',$,$,'102');
#32= IFCFLOWTERMINAL('0Rec2',#1,'M_Duplex Receptacle:Standard',$,'Standard',$,$,'103');
#33= IFCFLOWTERMINAL('0App1',#1,'M_CoffeeMachine:Countertop',$,'Countertop',$,$,'104');
#34= IFCROOF('0Roof1',#1,'Metal Standing Seam Roof',$,'Roof',$,$,'105');
#40= IFCQUANTITYAREA('NetArea',$,$,250.0);
#41= IFCELEMENTQUANTITY('0Qty1',#1,'Qto_RoofBaseQuantities',$,$,(#40));
#42= IFCRELDEFINESBYPROPERTIES('0RelQ',#1,$,$,(#34),#41);
#50= IFCRELCONTAINEDINSPATIALSTRUCTURE('0Rel1',#1,$,$,(#30,#31,#32,#33),#20);
#51= IFCRELCONTAINEDINSPATIALSTRUCTURE('0Rel2',#1,$,$,(#34),#21);
ENDSEC;
END-ISO-10303-21;`;

const SAMPLE_XER = [
	'%T\tPROJWBS',
	'%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name',
	'%R\t10\t\tP1\tTower',
	'%R\t11\t10\tMEP\tMEP Works',
	'%T\tTASK',
	'%F\ttask_id\twbs_id\ttask_code\ttask_name\ttask_type\ttarget_start_date\ttarget_end_date\tphys_complete_pct',
	'%R\t100\t11\tA1010\tMain Switchgear Install\tTT_Task\t2026-06-01 08:00\t2026-06-30 17:00\t45',
	'%R\t101\t11\tM1020\tEnergisation\tTT_FinMile\t2026-07-01 08:00\t2026-07-01 08:00\t0'
].join('\n');

const routeSystem1: Ai['Service']['ask'] = (request) =>
	Effect.sync(() => ({
		cost_usd: 0,
		provider: 'test',
		answers: Object.fromEntries(
			Object.entries(request.questions).map(([id, question]) => {
				if (question.type === 'score') {
					return [
						id,
						{
							type: 'score' as const,
							score: 2,
							level: 2,
							confidence: 0.95,
							probabilities: {},
							legend: {}
						}
					];
				}
				if (question.type === 'choice') {
					const keys = Object.keys(question.criteria);
					if (keys.includes(UNKNOWN_CATALOG_CHOICE)) {
						const instr =
							`${String(question.instructions ?? '')} ${JSON.stringify(request.state ?? {})}`.toLowerCase();
						const choice =
							instr.includes('panelboard') && keys.includes('ELEC-PANEL')
								? 'ELEC-PANEL'
								: UNKNOWN_CATALOG_CHOICE;
						return [id, { type: 'choice' as const, choice, confidence: 0.95, probabilities: {} }];
					}
					const choice =
						id === 'relevance'
							? 'useful'
							: id === 'project'
								? (keys.find((k) => k !== 'none') ?? 'none')
								: (keys[0] ?? '');
					return [id, { type: 'choice' as const, choice, confidence: 0.95, probabilities: {} }];
				}
				return [id, { type: 'noul' as const, noul: 0 }];
			})
		)
	}));

it('parses IFC STEP assets, enforces currency-matched Item Matrix pricing on System 1 decisions, and parses P6/MSP schedules', () => {
	const parsed = parseIfcStep(SAMPLE_IFC);
	expect(parsed.schema).toBe('IFC2X3');
	expect(parsed.storeys).toEqual(['Level 1', 'Roof']);
	expect(parsed.assets.length).toBe(5);

	const extracted = extractFromParsedModel(parsed);
	const aiDecisions: Record<string, ArchetypeDecision> = {};
	for (const arch of extracted.archetypes) {
		if (arch.ifc_class === 'IFCFLOWCONTROLLER') {
			aiDecisions[arch.archetype_id] = {
				matrix_code: 'ELEC-PANEL',
				method: 'ai_sys1',
				confidence: 0.96,
				reason: 'System 1 matched panelboard'
			};
		} else if (arch.family.toLowerCase().includes('receptacle')) {
			aiDecisions[arch.archetype_id] = {
				matrix_code: 'ELEC-RECEP',
				method: 'ai_sys1',
				confidence: 0.93,
				reason: 'System 1 matched receptacle'
			};
		} else if (arch.ifc_class === 'IFCROOF') {
			aiDecisions[arch.archetype_id] = {
				matrix_code: 'ROOF-SEAM',
				method: 'ai_sys1',
				confidence: 0.94,
				reason: 'System 1 matched metal standing seam roof'
			};
		} else {
			// Explicitly test that wrong-currency code is rejected by currency enforcement
			aiDecisions[arch.archetype_id] = {
				matrix_code: 'ELEC-RECEP-USD',
				method: 'ai_sys1',
				confidence: 0.91,
				reason: 'Wrong-currency code must stay unmatched'
			};
		}
	}

	const estimate = buildBimCostEstimate({
		parsed,
		currency: 'SGD',
		contingency_pct: '5',
		ai_decisions: aiDecisions,
		matrix: [
			{
				code: 'ELEC-PANEL',
				name: '400A Panelboard',
				category: 'bim_asset',
				discipline: 'mep',
				trade_specialty: 'electrical',
				ifc_classes: ['IFCFLOWCONTROLLER'],
				match_keywords: ['panelboard'],
				unit: 'ea',
				quantity_basis: 'count',
				currency: 'SGD',
				unit_rate: '10000.00',
				waste_factor_pct: '0',
				carbon_factor: '0',
				active: true
			},
			{
				code: 'ELEC-RECEP-USD',
				name: 'Duplex Receptacle (USD wrong currency)',
				category: 'bim_asset',
				discipline: 'mep',
				trade_specialty: 'electrical',
				ifc_classes: ['IFCFLOWTERMINAL'],
				match_keywords: ['receptacle'],
				unit: 'ea',
				quantity_basis: 'count',
				currency: 'USD',
				unit_rate: '9999.00',
				waste_factor_pct: '0',
				carbon_factor: '0',
				active: true
			},
			{
				code: 'ELEC-RECEP',
				name: 'Duplex Receptacle',
				category: 'bim_asset',
				discipline: 'mep',
				trade_specialty: 'electrical',
				ifc_classes: ['IFCFLOWTERMINAL'],
				match_keywords: ['receptacle'],
				unit: 'ea',
				quantity_basis: 'count',
				currency: 'SGD',
				unit_rate: '100.00',
				waste_factor_pct: '10',
				carbon_factor: '0',
				active: true
			},
			{
				code: 'ROOF-SEAM',
				name: 'Standing Seam Metal Roof',
				category: 'bim_asset',
				discipline: 'architecture',
				trade_specialty: 'roofing',
				ifc_classes: ['IFCROOF'],
				match_keywords: [],
				unit: 'm2',
				quantity_basis: 'area',
				currency: 'SGD',
				unit_rate: '200.00',
				waste_factor_pct: '0',
				carbon_factor: '0',
				active: true
			},
			{
				code: 'ADD-PRELIM',
				name: 'Site Preliminaries',
				category: 'additional_cost',
				discipline: 'preliminaries',
				trade_specialty: 'general',
				ifc_classes: [],
				match_keywords: [],
				unit: 'pct',
				quantity_basis: 'pct_of_bim',
				currency: 'SGD',
				unit_rate: '10',
				waste_factor_pct: '0',
				carbon_factor: '0',
				active: true
			},
			{
				code: 'ADD-HOIST',
				name: 'Hoist & Logistics',
				category: 'additional_cost',
				discipline: 'preliminaries',
				trade_specialty: 'general',
				ifc_classes: [],
				match_keywords: [],
				unit: 'ls',
				quantity_basis: 'lump_sum',
				currency: 'SGD',
				unit_rate: '5000.00',
				waste_factor_pct: '0',
				carbon_factor: '0',
				active: true
			}
		]
	});

	expect(estimate.bim_asset_count).toBe(5);
	expect(estimate.classified_asset_count).toBe(4);
	expect(estimate.unmatched_asset_count).toBe(1);
	// USD rule ignored; Panel 10000 + Receptacles 220 + Roof 50000 = 60220.00; 5% contingency = 3011.00
	expect(estimate.bim_subtotal).toBe('60220.00');
	expect(estimate.contingency_amount).toBe('3011.00');
	expect(estimate.total_estimate).toBe('63231.00');

	const xerTasks = parsePrimaveraXer(SAMPLE_XER);
	expect(xerTasks).toHaveLength(2);
	expect(xerTasks[0]?.wbs_path).toBe('P1.MEP');
	expect(xerTasks[0]?.progress_pct).toBe('45');
	expect(xerTasks[1]?.is_milestone).toBe(true);

	const msp = `<Project><Tasks>
		<Task><UID>1</UID><OutlineNumber>1</OutlineNumber><Name>Summary</Name><Summary>1</Summary></Task>
		<Task><UID>2</UID><OutlineNumber>1.1</OutlineNumber><Name>Roof Trusses</Name><Summary>0</Summary><Milestone>0</Milestone><Start>2026-07-01T08:00:00</Start><Finish>2026-07-20T17:00:00</Finish><PercentComplete>25</PercentComplete></Task>
	</Tasks></Project>`;
	const mspTasks = parseMsProjectXml(msp);
	expect(mspTasks).toHaveLength(1);
	expect(mspTasks[0]?.task_code).toBe('WBS-1.1');
	expect(mspTasks[0]?.progress_pct).toBe('25');
});

it.effect(
	'prices a stored BIM takeoff on its write, locks baselined estimates, exercises all 4 syncs, and files WhatsApp messages as they arrive',
	() =>
		Effect.gen(function* () {
			const extractionTurn = {
				content: JSON.stringify({
					summary: 'Structured WhatsApp update into task progression, BIM issue, VO, and invoice.',
					task_updates: [
						{
							task_code: 'WBS-E1',
							title: 'Main switchboard termination',
							trade_specialty: 'electrical',
							zone: 'L01-MAIN',
							progress_pct: 60,
							status: 'in_progress',
							latest_update: '60% terminated; feeder tray aligned.',
							comment: 'Main switchboard 60% terminated; feeder tray aligned per the site photo.',
							file_attachments: true
						}
					],
					issues: [
						{
							title: 'Chilled water sleeve clash at switchroom',
							kind: 'clash',
							trade_specialty: 'mne',
							severity: 'critical',
							zone: 'L01-MAIN',
							description: 'Sleeve encroaches 120mm on panelboard top entry.'
						}
					],
					variation_orders: [
						{
							title: 'Offset chilled water sleeve 250mm east',
							direction: 'upstream',
							trade_specialty: 'mne',
							contract_value: 18500,
							schedule_impact_days: 3,
							scope_notes: 'Relocate sleeve to clear panelboard top entry.'
						}
					],
					commercial_documents: [
						{
							doc_type: 'invoice',
							direction: 'outflow',
							external_reference: 'INV-SUB-778',
							subtotal: 24000,
							description: 'Progress invoice for Level 1 electrical rough-in.'
						}
					]
				}),
				tool_calls: [],
				finish: 'stop' as const,
				usage: { input: 0, output: 0 }
			};

			const fakeHttp: NonNullable<TestOptions['providers']>[number] = {
				driver: 'http',
				id: 'fake-http',
				label: 'Fake HTTP',
				setup: { kind: 'form', steps: [], fields: [] },
				async open(ctx) {
					return {
						async pair() {
							await ctx.credentials.write(
								new Map([['credential', { access_token: 'syn-acc-token' }]])
							);
							await ctx.status({ state: 'connected' });
						},
						async close() {}
					};
				}
			};

			const noOpExtractionTurn = {
				content: JSON.stringify({
					summary: 'Confirmed cable tray clearance; no new records required.',
					task_updates: [],
					issues: [],
					variation_orders: [],
					commercial_documents: []
				}),
				tool_calls: [],
				finish: 'stop' as const,
				usage: { input: 0, output: 0 }
			};

			const t = yield* acquireWorkspace({
				root,
				now: '2026-06-15T06:00:00.000Z',
				providers: [fakeHttp],
				fakes: {
					ai: {
						sys_1: routeSystem1,
						cassette: {
							default: [extractionTurn, noOpExtractionTurn]
						}
					}
				}
			});
			const admin = yield* t.as(t.admin);
			const delivery = yield* t.as(
				t.member(['construction_read', 'construction_delivery', 'construction_connections'], {
					teams: ['project_delivery']
				})
			);

			const setup = yield* admin.act({
				'projects.create': [
					{
						project_name: 'Synthetic Tech Park',
						project_number: 'STP-001',
						project_role: 'main_contractor',
						autodesk_project_id: 'acc-proj-1',
						currency: 'SGD',
						zones: [
							{ code: 'L01-MAIN', name: 'Level 1 Switchroom', elevation_m: 0, grid_axis: 'A-D' }
						]
					}
				],
				'item_matrix.create': [
					{
						code: 'ELEC-PANEL',
						name: '400A Panelboard',
						category: 'bim_asset',
						discipline: 'mep',
						trade_specialty: 'electrical',
						ifc_classes: ['IFCFLOWCONTROLLER'],
						match_keywords: ['panelboard'],
						unit: 'ea',
						quantity_basis: 'count',
						currency: 'SGD',
						unit_rate: '12000.00',
						waste_factor_pct: '0.0',
						active: true
					},
					{
						code: 'ADD-PRELIM',
						name: 'Preliminaries',
						category: 'additional_cost',
						discipline: 'preliminaries',
						trade_specialty: 'general',
						unit: 'ls',
						quantity_basis: 'lump_sum',
						currency: 'SGD',
						unit_rate: '8000.00',
						waste_factor_pct: '0.0',
						active: true
					}
				]
			});
			if (setup.kind !== 'committed') throw new Error('Setup failed');
			const projectRef = recordOf(setup.records, 'projects');
			const projectId = projectRef.id;

			// 1. Upload IFC onto projects.bim_file -> marks bim_costing_dirty=true; nothing is priced until the browser's
			// takeoff is stored, and storing it prices the model (analyze_bim_file, triggered by the write)
			const takeoffBytes = () => {
				const taken = extractFromParsedModel(parseIfcStep(SAMPLE_IFC));
				return new TextEncoder().encode(
					JSON.stringify({
						...taken,
						buckets: taken.buckets.map(({ element_ids: _ids, ...bucket }) => bucket)
					})
				);
			};
			const uploadedIfc = yield* delivery.upload('projects.bim_file', {
				name: 'synthetic.ifc',
				mime: 'application/octet-stream',
				bytes: new TextEncoder().encode(SAMPLE_IFC)
			});
			if (uploadedIfc.kind !== 'committed') throw new Error('IFC upload failed');
			const bimAttach = yield* delivery.act({
				'projects.update': [
					{
						target: projectRef,
						set: {
							bim_file: uploadedIfc.output,
							bim_version: 'P01'
						}
					}
				]
			});
			if (bimAttach.kind !== 'committed') throw new Error('Project BIM attach failed');
			const attachedProjectRef = recordOf(bimAttach.records, 'projects');
			yield* t.run_due();

			const dirtyProject = rowsOf(
				yield* delivery.query({
					projects: {
						where: { id: { eq: projectId } },
						fields: ['bim_costing_dirty', 'bim_version'],
						limit: 1
					}
				}),
				'projects'
			)[0];
			expect(dirtyProject?.['bim_costing_dirty']).toBe(true);
			expect(dirtyProject?.['bim_version']).toBe('P01');
			expect(
				rowsOf(
					yield* delivery.query({
						cost_estimates: {
							where: { project_id: { eq: projectId } },
							fields: ['status'],
							limit: 5
						}
					}),
					'cost_estimates'
				)
			).toHaveLength(0);

			const takeoff = yield* delivery.upload('projects.bim_takeoff', {
				name: 'bim-takeoff.json',
				mime: 'application/json',
				bytes: takeoffBytes()
			});
			if (takeoff.kind !== 'committed') throw new Error('Takeoff upload failed');
			const stored = yield* delivery.act({
				'projects.update': [{ target: attachedProjectRef, set: { bim_takeoff: takeoff.output } }]
			});
			expect(stored.kind).toBe('committed');
			yield* t.run_due();

			const autoEstimates = rowsOf(
				yield* delivery.query({
					cost_estimates: {
						where: { project_id: { eq: projectId } },
						fields: [
							'revision',
							'bim_asset_count',
							'classified_asset_count',
							'unmatched_asset_count',
							'bim_subtotal',
							'contingency_amount',
							'total_estimate',
							'contingency_pct',
							'status'
						],
						limit: 10
					}
				}),
				'cost_estimates'
			);
			expect(autoEstimates).toHaveLength(1);
			const estRow = autoEstimates[0];
			if (!estRow) throw new Error('Expected cost estimate once the takeoff was stored');
			expect(estRow['bim_asset_count']).toBe(5);
			expect(estRow['classified_asset_count']).toBe(1);
			expect(estRow['unmatched_asset_count']).toBe(4);
			expect(estRow['bim_subtotal']).toBe('12000.00');
			expect(estRow['contingency_amount']).toBe('600.00');
			expect(estRow['total_estimate']).toBe('12600.00');

			// 1:1 unique constraint refuses a second cost estimate on the same project
			const dupEstimate = yield* admin
				.act({
					'cost_estimates.create': [
						{
							project_id: projectId,
							title: 'Duplicate Estimate',
							currency: 'SGD'
						}
					]
				})
				.pipe(Effect.flip);
			expect(['ActConflict', 'ActRefused']).toContain(dupEstimate._tag);

			const projectAfter = rowsOf(
				yield* delivery.query({
					projects: {
						where: { id: { eq: projectId } },
						fields: ['revision', 'bim_summary', 'bim_costing_dirty'],
						limit: 1
					}
				}),
				'projects'
			)[0];
			expect(projectAfter?.['bim_summary']).not.toBeNull();
			expect(projectAfter?.['bim_costing_dirty']).toBe(false);

			// Any other edit of a priced project prices nothing again
			const projectRevAfter = Schema.decodeUnknownSync(Schema.Number)(projectAfter?.['revision']);
			yield* delivery.act({
				'projects.update': [
					{
						target: { id: projectId, revision: projectRevAfter },
						set: { description: 'Edited after pricing.' }
					}
				]
			});
			yield* t.run_due();
			expect(
				rowsOf(
					yield* delivery.query({
						cost_estimates: {
							where: { project_id: { eq: projectId } },
							fields: ['revision'],
							limit: 1
						}
					}),
					'cost_estimates'
				)[0]?.['revision']
			).toBe(estRow['revision']);

			// Baseline estimate -> verify lock refuses pricing edits AND leaves persisted value unchanged
			const estId = fixtureId('cost_estimates', String(estRow['id']));
			const estRevision = Schema.decodeUnknownSync(Schema.Number)(estRow['revision']);
			const baselined = yield* admin.act({
				'cost_estimates.update': [
					{ target: { id: estId, revision: estRevision }, set: { status: 'baselined' } }
				]
			});
			if (baselined.kind !== 'committed') throw new Error('Baseline failed');
			const baselinedRef = recordOf(baselined.records, 'cost_estimates');

			const lockedEstEdit = yield* admin
				.act({
					'cost_estimates.update': [{ target: baselinedRef, set: { contingency_pct: '10.00' } }]
				})
				.pipe(Effect.flip);
			expect(lockedEstEdit._tag).toBe('ActRefused');
			const estAfterRefusal = rowsOf(
				yield* admin.query({
					cost_estimates: { where: { id: { eq: estId } }, fields: ['contingency_pct'], limit: 1 }
				}),
				'cost_estimates'
			)[0];
			expect(estAfterRefusal?.['contingency_pct']).toBe('5');

			// Pricing a locked baselined estimate again refuses cleanly AND leaves persisted estimate untouched
			const lockedRerun = yield* runAutomation(
				t,
				admin.run('analyze_bim_file', { project_id: projectId }, JobResult)
			);
			expect(lockedRerun.state).toBe('failed');
			const estAfterLockedRerun = rowsOf(
				yield* admin.query({
					cost_estimates: {
						where: { project_id: { eq: projectId } },
						fields: ['revision', 'total_estimate', 'status'],
						limit: 10
					}
				}),
				'cost_estimates'
			);
			expect(estAfterLockedRerun).toHaveLength(1);
			expect(estAfterLockedRerun[0]?.['revision']).toBe(baselinedRef.revision);
			expect(estAfterLockedRerun[0]?.['total_estimate']).toBe('12600.00');

			// Replacing projects.bim_file clears its takeoff, marks bim_costing_dirty=true AND voids the baselined estimate;
			// the new takeoff, once stored, prices it back to draft and clears dirty
			const uploadedIfcV2 = yield* delivery.upload('projects.bim_file', {
				name: 'synthetic_v2.ifc',
				mime: 'application/octet-stream',
				bytes: new TextEncoder().encode(SAMPLE_IFC)
			});
			if (uploadedIfcV2.kind !== 'committed') throw new Error('IFC v2 upload failed');
			const projectRevForReplace = Schema.decodeUnknownSync(Schema.Number)(
				rowsOf(
					yield* delivery.query({
						projects: { where: { id: { eq: projectId } }, fields: ['revision'], limit: 1 }
					}),
					'projects'
				)[0]?.['revision'] ?? attachedProjectRef.revision
			);
			const bimReplace = yield* delivery.act({
				'projects.update': [
					{
						target: { id: projectId, revision: projectRevForReplace },
						set: { bim_file: uploadedIfcV2.output }
					}
				]
			});
			expect(bimReplace.kind).toBe('committed');
			if (bimReplace.kind !== 'committed') throw new Error('BIM replace failed');
			yield* t.run_due();

			const voidedEst = rowsOf(
				yield* admin.query({
					cost_estimates: { where: { id: { eq: estId } }, fields: ['status'], limit: 1 }
				}),
				'cost_estimates'
			)[0];
			expect(voidedEst?.['status']).toBe('void');
			expect(
				rowsOf(
					yield* admin.query({
						projects: { where: { id: { eq: projectId } }, fields: ['bim_takeoff'], limit: 1 }
					}),
					'projects'
				)[0]?.['bim_takeoff']
			).toBeNull();

			const takeoffV2 = yield* delivery.upload('projects.bim_takeoff', {
				name: 'bim-takeoff-v2.json',
				mime: 'application/json',
				bytes: takeoffBytes()
			});
			if (takeoffV2.kind !== 'committed') throw new Error('Takeoff v2 upload failed');
			yield* delivery.act({
				'projects.update': [
					{
						target: recordOf(bimReplace.records, 'projects'),
						set: { bim_takeoff: takeoffV2.output }
					}
				]
			});
			yield* t.run_due();
			const regenEst = rowsOf(
				yield* admin.query({
					cost_estimates: {
						where: { id: { eq: estId } },
						fields: ['status', 'total_estimate'],
						limit: 1
					}
				}),
				'cost_estimates'
			)[0];
			expect(regenEst?.['status']).toBe('draft');
			expect(regenEst?.['total_estimate']).toBe('12600.00');

			// 2. Zone validation refuses undeclared zone AND persists zero rows
			const badZone = yield* delivery
				.act({
					'tasks.create': [
						{
							project_id: projectId,
							task_code: 'BAD-Z',
							title: 'Bad zone task',
							zone: 'UNKNOWN-ZONE'
						}
					]
				})
				.pipe(Effect.flip);
			expect(badZone._tag).toBe('ActRefused');
			expect(
				rowsOf(
					yield* delivery.query({
						tasks: { where: { task_code: { eq: 'BAD-Z' } }, fields: ['task_code'], limit: 5 }
					}),
					'tasks'
				)
			).toHaveLength(0);

			// 3. File syncs: item_matrix.matrix CSV + tasks.schedule_file Primavera P6 (.xer)
			const matrixCsv = [
				'code,name,category,discipline,trade_specialty,unit,quantity_basis,currency,unit_rate,waste_factor_pct,ifc_classes,match_keywords,active',
				'ROOF-SYN,Standing Seam Roof,bim_asset,architecture,roofing,m2,area,SGD,220.00,5.0,IFCROOF,roof,true'
			].join('\n');
			const matrixUpload = yield* admin.upload('item_matrix.$import.matrix', {
				name: 'matrix.csv',
				mime: 'text/csv',
				bytes: new TextEncoder().encode(matrixCsv)
			});
			if (matrixUpload.kind !== 'committed') throw new Error('Matrix CSV upload failed');
			const matrixSync = yield* admin.sync_control('item_matrix', 'matrix', {
				mode: 'import',
				file: matrixUpload.output.id
			});
			expect(matrixSync.kind).toBe('committed');

			const xerUpload = yield* delivery.upload('tasks.$import.schedule_file', {
				name: 'master.xer',
				mime: 'text/plain',
				bytes: new TextEncoder().encode(SAMPLE_XER)
			});
			if (xerUpload.kind !== 'committed') throw new Error('XER upload failed');
			const xerSync = yield* delivery.sync_control('tasks', 'schedule_file', {
				mode: 'import',
				file: xerUpload.output.id,
				context: { project_id: projectId }
			});
			expect(xerSync.kind).toBe('committed');
			yield* t.run_due();

			const importedMatrix = rowsOf(
				yield* admin.query({
					item_matrix: {
						where: { code: { eq: 'ROOF-SYN' } },
						fields: ['code', 'currency', 'unit_rate', 'trade_specialty'],
						limit: 5
					}
				}),
				'item_matrix'
			);
			expect(importedMatrix).toHaveLength(1);
			expect(importedMatrix[0]?.['currency']).toBe('SGD');
			expect(importedMatrix[0]?.['unit_rate']).toBe('220.00');
			expect(importedMatrix[0]?.['trade_specialty']).toBe('roofing');
			const xerImported = rowsOf(
				yield* delivery.query({
					tasks: {
						where: { task_code: { in: ['A1010', 'M1020'] } },
						fields: ['task_code', 'is_milestone'],
						limit: 10
					}
				}),
				'tasks'
			);
			expect(xerImported).toHaveLength(2);
			expect(
				xerImported.some((r) => r['task_code'] === 'M1020' && r['is_milestone'] === true)
			).toBe(true);

			// 4. Remote Autodesk ACC syncs (tasks.autodesk_schedule & project_files.autodesk_files)
			const accCreate = yield* admin.act({
				'sys_integration.create': [
					{ integration: 'autodesk_acc', name: 'Autodesk ACC', owner: null }
				]
			});
			if (accCreate.kind !== 'committed') throw new Error('Autodesk integration create failed');
			const accId = recordOf(accCreate.records, 'sys_integration').id;

			let accVersion = 'ACC-R2';
			let accUpdatedAt = '2026-06-15T05:00:00Z';
			t.fakes.links.answer = (_instance, req) => {
				const path =
					req !== null && typeof req === 'object' && 'path' in req && typeof req.path === 'string'
						? req.path
						: '';
				if (path.includes('/construction/schedule/v1/')) {
					return Effect.succeed({
						status: 200,
						body: {
							results: [
								{
									id: 'acc-act-99',
									code: 'ACC-100',
									name: 'ACC Structural Steel Erection',
									wbsPath: 'STR.1',
									plannedStart: '2026-06-20T08:00:00Z',
									plannedFinish: '2026-07-10T17:00:00Z',
									percentComplete: 35,
									updatedAt: accUpdatedAt
								}
							]
						}
					});
				}
				if (path.includes('/construction/sheets/v1/')) {
					return Effect.succeed({
						status: 200,
						body: {
							results: [
								{
									urn: 'urn:adsk.wipprod:fs.file:vf.acc01',
									number: 'ACC-A-101',
									title: 'Level 1 Coordination Model.rvt',
									versionSetName: accVersion,
									updatedAt: accUpdatedAt
								}
							]
						}
					});
				}
				if (path.includes('/project/v1/hubs')) {
					return Effect.succeed({ status: 200, body: { data: [] } });
				}
				return Effect.die(new Error(`Unexpected Autodesk link request: ${path}`));
			};
			yield* t.integrations.pair(accId, { access_token: 'syn-acc-token' });

			yield* t.syncs.read('tasks.sync.autodesk_schedule', { instance: accId });
			yield* t.syncs.read('project_files.sync.autodesk_files', { instance: accId });
			yield* t.run_due();

			const accTask = rowsOf(
				yield* delivery.query({
					tasks: {
						where: { task_code: { eq: 'ACC-100' } },
						fields: ['revision', 'progress_pct', 'schedule_range', 'baseline_range'],
						limit: 1
					}
				}),
				'tasks'
			)[0];
			expect(accTask?.['progress_pct']).toBe('35');
			expect(accTask?.['schedule_range']).toEqual({ from: '2026-06-20', to: '2026-07-10' });

			// Capture a local baseline on the ACC task, then run a 2nd ACC sync and verify local baseline is preserved
			const accTaskId = fixtureId('tasks', String(accTask?.['id']));
			const accTaskRev = Schema.decodeUnknownSync(Schema.Number)(accTask?.['revision']);
			const baselineSet = yield* delivery.act({
				'tasks.update': [
					{
						target: { id: accTaskId, revision: accTaskRev },
						set: { baseline_range: { from: '2026-06-18', to: '2026-07-08' } }
					}
				]
			});
			expect(baselineSet.kind).toBe('committed');

			accVersion = 'ACC-R3';
			accUpdatedAt = '2026-06-15T05:30:00Z';
			yield* t.syncs.read('tasks.sync.autodesk_schedule', { instance: accId });
			yield* t.syncs.read('project_files.sync.autodesk_files', { instance: accId });
			yield* t.run_due();

			const accTaskAfterRefresh = rowsOf(
				yield* delivery.query({
					tasks: {
						where: { task_code: { eq: 'ACC-100' } },
						fields: ['schedule_range', 'baseline_range'],
						limit: 1
					}
				}),
				'tasks'
			)[0];
			expect(accTaskAfterRefresh?.['baseline_range']).toEqual({
				from: '2026-06-18',
				to: '2026-07-08'
			});

			const accFile = rowsOf(
				yield* delivery.query({
					project_files: {
						where: { document_number: { eq: 'ACC-A-101' } },
						fields: ['kind', 'current_version'],
						limit: 1
					}
				}),
				'project_files'
			)[0];
			expect(accFile?.['kind']).toBe('autodesk_model');
			expect(accFile?.['current_version']).toBe('ACC-R3');

			// 5. WhatsApp sync -> System 1 classify -> cassette extract into tasks, issues, VOs & invoices
			const waCreate = yield* admin.act({
				'contacts.create': [
					{
						full_name: 'Sam Lee',
						company_name: 'Synthetic Electrical Pte Ltd',
						role: 'subcontractor',
						trade_specialty: 'electrical',
						phone: '+65 9222 3333',
						email: 'sam@syntheticelec.test'
					}
				],
				'sys_integration.create': [{ integration: 'whatsapp', name: 'Site WhatsApp', owner: null }]
			});
			if (waCreate.kind !== 'committed') throw new Error('WhatsApp integration failed');
			const waId = recordOf(waCreate.records, 'sys_integration').id;

			yield* t.receive(waId, {
				id: 'wa-syn-1001',
				thread: 'stp-site-group',
				sent_at: t.clock.now(),
				from: { handle: '6592223333@s.whatsapp.net', name: 'Sam Lee' },
				text: 'STP-001 update: switchboard at 60%, chilled water sleeve clash on L01-MAIN, attaching INV-SUB-778 for SGD 24,000.',
				attachments: []
			});

			// the arrival files it: the mirror's write runs the message model's effect, which routes and extracts it
			const syncRes = yield* runAutomation(t, admin.run('sync_messages', {}, JobResult));
			expect(syncRes.state).toBe('succeeded');
			yield* t.run_due();
			expect(t.fakes.ai?.remaining()).toEqual({ default: 1 });

			const afterExtract = yield* admin.query({
				project_messages: {
					where: { project_id: { eq: projectId } },
					fields: ['classification', 'classified_by', 'extraction_status'],
					limit: 10
				},
				tasks: {
					where: { project_id: { eq: projectId } },
					fields: ['task_code', 'progress_pct'],
					limit: 20
				},
				activities: { where: { kind: { eq: 'issue' } }, fields: ['severity'], limit: 20 },
				contracts: {
					where: { project_id: { eq: projectId } },
					fields: ['contract_type', 'contract_value'],
					limit: 20
				},
				commercial_documents: {
					where: { project_id: { eq: projectId } },
					fields: ['doc_type', 'external_reference', 'subtotal'],
					limit: 20
				}
			});
			expect(rowsOf(afterExtract, 'project_messages')[0]?.['classified_by']).toBe('model');
			expect(rowsOf(afterExtract, 'project_messages')[0]?.['extraction_status']).toBe('extracted');
			expect(rowsOf(afterExtract, 'tasks').some((r) => r['task_code'] === 'WBS-E1')).toBe(true);
			expect(rowsOf(afterExtract, 'activities')).toHaveLength(1);
			// the clash no task covers is filed under an ad hoc task of its own, which counts it as open
			const filed = yield* admin.query({
				activities: { where: { kind: { eq: 'issue' } }, fields: ['task_id', 'body'], limit: 1 },
				tasks: {
					where: { project_id: { eq: projectId }, kind: { eq: 'adhoc' } },
					fields: ['title', 'open_issue_count'],
					limit: 10
				}
			});
			const clashTask = rowsOf(filed, 'tasks').find(
				(r) => r['title'] === 'Chilled water sleeve clash at switchroom'
			);
			expect(clashTask?.['open_issue_count']).toBe(1);
			const clash = rowsOf(filed, 'activities')[0];
			expect(clash?.['task_id']).toBe(clashTask?.['id']);
			expect(clash?.['body']).toBe('Sleeve encroaches 120mm on panelboard top entry.');
			// the task update is filed under its task as a comment from the message
			const comments = rowsOf(
				yield* admin.query({
					activities: {
						where: { kind: { eq: 'comment' } },
						fields: ['body', 'source_message_id'],
						limit: 10
					}
				}),
				'activities'
			);
			expect(comments.map((c) => c['body'])).toEqual([
				'Main switchboard 60% terminated; feeder tray aligned per the site photo.'
			]);
			expect(comments.every((c) => c['source_message_id'] != null)).toBe(true);
			expect(rowsOf(afterExtract, 'contracts')[0]?.['contract_type']).toBe('variation_order');
			expect(rowsOf(afterExtract, 'commercial_documents')[0]?.['external_reference']).toBe(
				'INV-SUB-778'
			);

			// 6. A contact's new phone routes non-manual ignored messages again while preserving manual classifications
			const reclassifySetup = yield* admin.act({
				'project_messages.create': [
					{
						transport: 'email',
						direction: 'inbound',
						subject: 'STP-001 RFI follow-up',
						detail: 'Confirming L01-MAIN cable tray clearance.',
						occurred_at: '2026-06-15T06:00:00.000Z',
						classification: 'ignored',
						classified_by: 'hard_filter',
						classified_at: t.clock.now(),
						extraction_status: 'none'
					},
					{
						transport: 'email',
						direction: 'inbound',
						subject: 'STP-001 Manual archive',
						detail: 'Manually dismissed notice.',
						occurred_at: '2026-06-15T06:01:00.000Z',
						classification: 'ignored',
						classified_by: 'manual',
						classified_at: t.clock.now(),
						extraction_status: 'none'
					}
				]
			});
			if (reclassifySetup.kind !== 'committed') throw new Error('Reclassify setup failed');
			const seededMsgs = reclassifySetup.records.filter((r) => r.model === 'project_messages');
			const autoIgnoredId = seededMsgs[0]?.id;
			const manualIgnoredId = seededMsgs[1]?.id;
			if (!autoIgnoredId || !manualIgnoredId) throw new Error('Missing seeded messages');
			const autoIgnoredRef = fixtureId('project_messages', autoIgnoredId);
			const manualIgnoredRef = fixtureId('project_messages', manualIgnoredId);

			// Drain any create effects first: neither ignored row is touched before the directory changes
			yield* t.run_due();
			const beforeReclassify = rowsOf(
				yield* admin.query({
					project_messages: {
						where: { id: { in: [autoIgnoredRef, manualIgnoredRef] } },
						fields: ['classification', 'classified_by'],
						limit: 5
					}
				}),
				'project_messages'
			);
			expect(beforeReclassify.every((r) => r['classification'] === 'ignored')).toBe(true);

			const directoryChange = yield* admin.act({
				'contacts.update': [
					{ target: recordOf(waCreate.records, 'contacts'), set: { phone: '+65 9222 3334' } }
				]
			});
			expect(directoryChange.kind).toBe('committed');
			yield* t.run_due();
			const afterReclassify = rowsOf(
				yield* admin.query({
					project_messages: {
						where: { id: { in: [autoIgnoredRef, manualIgnoredRef] } },
						fields: [
							'classification',
							'classified_by',
							'project_id',
							'extraction_status',
							'extraction_summary',
							'extracted_at'
						],
						limit: 5
					}
				}),
				'project_messages'
			);
			const autoRow = afterReclassify.find((r) => r['id'] === autoIgnoredRef);
			const manualRow = afterReclassify.find((r) => r['id'] === manualIgnoredRef);
			expect(autoRow?.['classification']).toBe('useful');
			expect(autoRow?.['project_id']).toBe(projectId);
			expect(autoRow?.['extraction_status']).toBe('none');
			expect(autoRow?.['extraction_summary']).toBe(
				'Confirmed cable tray clearance; no new records required.'
			);
			expect(autoRow?.['extracted_at']).not.toBeNull();
			expect(manualRow?.['classification']).toBe('ignored');
			expect(manualRow?.['classified_by']).toBe('manual');
			expect(t.fakes.ai?.remaining()).toEqual({ default: 0 });
		}).pipe(Effect.scoped)
);

it('streams a multi-storey 18-floor HDB + playground IFC across arbitrary chunk boundaries, skipping geometry and collapsing 10k+ elements into compact archetypes', () => {
	// 18-storey HDB + playground + 2-layer double sliding door + strict deduplication test
	const lines: string[] = [
		'ISO-10303-21;',
		'HEADER;',
		"FILE_SCHEMA(('IFC4'));",
		'ENDSEC;',
		'DATA;',
		"#1= IFCPROJECT('0HDB',$,'HDB18',$,$,'Block 888B 18-Storey HDB & Playground',$,$,$);",
		'#2= IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);',
		'#3= IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);',
		'#4= IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);',
		"#5= IFCSITE('0Site',$,'Precinct Playground & External Works',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);",
		"#10= IFCMATERIAL('Concrete C40');",
		"#11= IFCMATERIAL('EPDM Pour-in-Place Rubber');",
		"#12= IFCMATERIAL('Galvanised Steel 304');",
		"#13= IFCMATERIAL('Tempered Glass');",
		"#14= IFCMATERIAL('Anodised Aluminium');",
		'#15= IFCMATERIALLAYER(#13,12.,$,$,$,$,$);',
		'#16= IFCMATERIALLAYER(#14,50.,$,$,$,$,$);',
		"#17= IFCMATERIALLAYERSET((#15,#16),'2-Layer Sliding Door Assembly',$);",
		"#20= IFCWALLTYPE('0WT1',$,'Basic Wall: RC Shear Wall 200mm G40',$,$,(#30),$,$,$,.SHEAR.);",
		"#21= IFCDOORTYPE('0DT1',$,'Balcony Double Sliding Door',$,$,(#31),$,$,$,.DOOR.,.DOUBLE_DOOR_SLIDING.);",
		"#30= IFCPROPERTYSET('0PS1',$,'Pset_WallCommon',$,(#32,#33));",
		"#31= IFCPROPERTYSET('0PS2',$,'Pset_DoorCommon',$,(#34));",
		"#32= IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.T.),$);",
		"#33= IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);",
		"#34= IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('2HR'),$);"
	];

	// 18 residential storeys + Ground/Playground + Roof = 20 storeys
	const storeyIds: number[] = [];
	let nextId = 100;
	for (let s = 1; s <= 18; s++) {
		const sid = nextId++;
		storeyIds.push(sid);
		lines.push(
			`#${sid}= IFCBUILDINGSTOREY('0St${s}',$,'Level ${s}',$,$,$,$,'Level ${s}',.ELEMENT.,${s * 3000}.);`
		);
	}
	const roofId = nextId++;
	lines.push(`#${roofId}= IFCBUILDINGSTOREY('0StRoof',$,'Roof',$,$,$,$,'Roof',.ELEMENT.,57000.);`);

	// Shared area/volume quantity definitions (reused across identical precast elements)
	const wallQtyAreaId = nextId++;
	const wallQtoId = nextId++;
	lines.push(`#${wallQtyAreaId}= IFCQUANTITYAREA('NetSideArea',$,$,12.5);`);
	lines.push(
		`#${wallQtoId}= IFCELEMENTQUANTITY('0QtoW',$,'Qto_WallBaseQuantities',$,$,(#${wallQtyAreaId}));`
	);

	const epdmQtyAreaId = nextId++;
	const epdmQtoId = nextId++;
	lines.push(`#${epdmQtyAreaId}= IFCQUANTITYAREA('NetArea',$,$,320.0);`);
	lines.push(
		`#${epdmQtoId}= IFCELEMENTQUANTITY('0QtoE',$,'Qto_SiteBaseQuantities',$,$,(#${epdmQtyAreaId}));`
	);

	// Inject 40,000 realistic geometry lines (IFCCARTESIANPOINT / IFCDIRECTION) that must be skipped fast
	for (let g = 0; g < 40_000; g++) {
		const gid = nextId++;
		lines.push(`#${gid}= IFCCARTESIANPOINT((${g}.0,${g % 18}.0,0.0));`);
	}

	const wallIds: number[] = [];
	const doorIds: number[] = [];
	const sprinklerIds: number[] = [];

	// 18 storeys × (400 RC walls + 80 individually named balcony sliding doors + 80 sprinklers) = 10,080 elements
	for (const sid of storeyIds) {
		const floorEls: number[] = [];
		for (let i = 0; i < 400; i++) {
			const eid = nextId++;
			wallIds.push(eid);
			floorEls.push(eid);
			lines.push(
				`#${eid}= IFCWALLSTANDARDCASE('W${eid}',$,'Basic Wall:RC-200:${eid}',$,$,$,$,'${eid}');`
			);
		}
		for (let i = 0; i < 80; i++) {
			const eid = nextId++;
			doorIds.push(eid);
			floorEls.push(eid);
			// Distinct per-instance names without colons (`Door-L01-001` .. `Door-L18-1440`) sharing IFCDOORTYPE #21 MUST dedupe to 1 archetype!
			lines.push(
				`#${eid}= IFCDOOR('D${eid}',$,'Door-L${sid}-${i + 1}',$,'Sliding Door',$,$,'${eid}');`
			);
		}
		for (let i = 0; i < 80; i++) {
			const eid = nextId++;
			sprinklerIds.push(eid);
			floorEls.push(eid);
			lines.push(
				`#${eid}= IFCFIRESUPPRESSIONTERMINAL('S${eid}',$,'Concealed Pendent Head-${i + 1}',$,$,$,$,'${eid}',.SPRINKLER.);`
			);
		}
		const relId = nextId++;
		lines.push(
			`#${relId}= IFCRELCONTAINEDINSPATIALSTRUCTURE('R${relId}',$,$,$,(${floorEls.map((id) => `#${id}`).join(',')}),#${sid});`
		);
	}

	// Vertical transport (2 lifts), playground EPDM & slide on Site, and 1 unpriced appliance
	const lift1 = nextId++;
	const lift2 = nextId++;
	const epdmId = nextId++;
	const slideId = nextId++;
	const coffeeId = nextId++;
	lines.push(
		`#${lift1}= IFCTRANSPORTELEMENT('L1',$,'KONE MonoSpace 1000kg:L1',$,'MRL Lift',$,$,'L1',.ELEVATOR.);`,
		`#${lift2}= IFCTRANSPORTELEMENT('L2',$,'KONE MonoSpace 1000kg:L2',$,'MRL Lift',$,$,'L2',.ELEVATOR.);`,
		`#${epdmId}= IFCGEOGRAPHICELEMENT('PG1',$,'Playground Safety Matting:Zone A',$,'EPDM Cushion',$,$,'PG1');`,
		`#${slideId}= IFCBUILDINGELEMENTPROXY('PG2',$,'Modular Playground Slide Tower',$,'Play Equipment',$,$,'PG2');`,
		`#${coffeeId}= IFCELECTRICAPPLIANCE('APP1',$,'Portable Coffee Machine:Pantry',$,'Countertop',$,$,'APP1');`
	);
	const siteRel = nextId++;
	lines.push(
		`#${siteRel}= IFCRELCONTAINEDINSPATIALSTRUCTURE('RS',$,$,$,(#${epdmId},#${slideId}),#5);`
	);
	const liftRel = nextId++;
	lines.push(
		`#${liftRel}= IFCRELCONTAINEDINSPATIALSTRUCTURE('RL',$,$,$,(#${lift1},#${lift2},#${coffeeId}),#${roofId});`
	);

	// Type, material layer set, and quantity relations
	lines.push(
		`#${nextId++}= IFCRELDEFINESBYTYPE('RTW',$,$,$,(${wallIds.map((id) => `#${id}`).join(',')}),#20);`,
		`#${nextId++}= IFCRELDEFINESBYTYPE('RTD',$,$,$,(${doorIds.map((id) => `#${id}`).join(',')}),#21);`,
		`#${nextId++}= IFCRELASSOCIATESMATERIAL('RMW',$,$,$,(#20),#10);`,
		`#${nextId++}= IFCRELASSOCIATESMATERIAL('RMD',$,$,$,(#21),#17);`,
		`#${nextId++}= IFCRELASSOCIATESMATERIAL('RME',$,$,$,(#${epdmId}),#11);`,
		`#${nextId++}= IFCRELASSOCIATESMATERIAL('RMS',$,$,$,(#${slideId}),#12);`,
		`#${nextId++}= IFCRELDEFINESBYPROPERTIES('RQW',$,$,$,(${wallIds.map((id) => `#${id}`).join(',')}),#${wallQtoId});`,
		`#${nextId++}= IFCRELDEFINESBYPROPERTIES('RQE',$,$,$,(#${epdmId}),#${epdmQtoId});`,
		'ENDSEC;',
		'END-ISO-10303-21;'
	);

	const fullBytes = new TextEncoder().encode(lines.join('\n'));
	const started = performance.now();
	const parser = createIfcStepStreamParser();
	// Stream in odd 131,071-byte slices to force splits mid-line, mid-entity, and mid-string
	const sliceSize = 131_071;
	for (let offset = 0; offset < fullBytes.byteLength; offset += sliceSize) {
		parser.push(fullBytes.subarray(offset, Math.min(fullBytes.byteLength, offset + sliceSize)));
	}
	const extracted = parser.finish();
	const elapsedMs = performance.now() - started;
	const stats = parser.stats();

	// 10,080 storey elements + 2 lifts + 2 playground items + 1 coffee machine = 10,085 elements
	expect(extracted.schema).toBe('IFC4');
	expect(extracted.total_asset_count).toBe(10_085);
	expect(extracted.storeys).toHaveLength(19); // 18 levels + Roof
	// Collapsed 10,085 elements (including 1,440 individually-named sliding doors & 1,440 numbered sprinklers) into 7 unique archetypes!
	expect(extracted.archetypes).toHaveLength(7);
	// Skipped > 75% geometry statements cleanly
	expect(stats.statements_scanned).toBeGreaterThan(50_000);
	expect(stats.relevant_statements).toBeLessThan(stats.statements_scanned / 4);
	// Fast even for 50k+ STEP statements
	expect(elapsedMs).toBeLessThan(3_000);

	// Verify rich Type + OperationType + 2-Layer MaterialLayerSet + representative_express_id extraction
	const doorArch = extracted.archetypes.find((a) => a.ifc_class === 'IFCDOOR');
	expect(doorArch?.total_count).toBe(1_440);
	expect(doorArch?.operation_type).toBe('DOUBLE_DOOR_SLIDING');
	expect(doorArch?.layer_count).toBe(2);
	expect(doorArch?.material_layers).toEqual(['Tempered Glass (12mm)', 'Anodised Aluminium (50mm)']);
	expect(doorArch?.representative_express_id).toBe(doorIds[0]);

	const wallArch = extracted.archetypes.find((a) => a.ifc_class === 'IFCWALLSTANDARDCASE');
	expect(wallArch?.type_name).toBe('Basic Wall: RC Shear Wall 200mm G40');
	expect(wallArch?.predefined_type).toBe('SHEAR');
	expect(wallArch?.materials).toContain('Concrete C40');
	expect(wallArch?.properties.some((p) => p.includes('LoadBearing=true'))).toBe(true);
	expect(wallArch?.has_area).toBe(true);
	expect(wallArch?.total_count).toBe(7_200);

	const epdmArch = extracted.archetypes.find((a) => a.ifc_class === 'IFCGEOGRAPHICELEMENT');
	expect(epdmArch?.materials).toContain('EPDM Pour-in-Place Rubber');
	expect(epdmArch?.has_area).toBe(true);
	const epdmBucket = extracted.buckets.find((b) => b.archetype_id === epdmArch?.archetype_id);
	expect(epdmBucket?.storey).toBe('Precinct Playground & External Works');
	expect(epdmBucket?.area_m2).toBe(320);

	// Candidate ranker bounds large matrix catalogs deterministically
	const ranked = rankCandidateMatrixRules(
		extracted.archetypes,
		[
			{
				code: 'STR-RC-WALL',
				name: 'Reinforced Concrete Shear Wall 200mm',
				category: 'bim_asset',
				discipline: 'structural',
				trade_specialty: 'structural',
				ifc_classes: ['IFCWALLSTANDARDCASE'],
				match_keywords: ['shear wall'],
				unit: 'm2',
				quantity_basis: 'area',
				currency: 'SGD',
				unit_rate: '240.00',
				waste_factor_pct: '5',
				carbon_factor: '0',
				active: true
			},
			{
				code: 'CIV-PLAY-EPDM',
				name: 'Playground EPDM Safety Surfacing',
				category: 'bim_asset',
				discipline: 'civil',
				trade_specialty: 'landscaping',
				ifc_classes: ['IFCGEOGRAPHICELEMENT'],
				match_keywords: ['epdm'],
				unit: 'm2',
				quantity_basis: 'area',
				currency: 'SGD',
				unit_rate: '165.00',
				waste_factor_pct: '3',
				carbon_factor: '0',
				active: true
			},
			{
				code: 'MISC-UNRELATED',
				name: 'Unrelated Specialty Item',
				category: 'bim_asset',
				discipline: 'general',
				trade_specialty: 'general',
				ifc_classes: ['IFCCHIMNEY'],
				match_keywords: ['flue'],
				unit: 'ea',
				quantity_basis: 'count',
				currency: 'SGD',
				unit_rate: '50.00',
				waste_factor_pct: '0',
				carbon_factor: '0',
				active: true
			}
		],
		2
	);
	expect(ranked.map((r) => r.code)).toEqual(['STR-RC-WALL', 'CIV-PLAY-EPDM']);
});

it.effect(
	'classifies each unique asset of a stored takeoff once, by its four-angle picture, through System 1 (no keyword bypass), remembers each decision, and proposes what nothing prices for approval',
	() =>
		Effect.gen(function* () {
			const TINY_JPEG_DATA_URL =
				'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

			const recordedCalls: Array<{
				readonly ifcClass: string;
				readonly imageCount: number;
				readonly angles: readonly string[];
				readonly firstCriterion: string;
			}> = [];
			const tinyJpeg = Uint8Array.from(
				Buffer.from(TINY_JPEG_DATA_URL.split(',')[1] ?? '', 'base64')
			);

			const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
				value !== null && typeof value === 'object' && !Array.isArray(value)
					? Object.fromEntries(Object.entries(value))
					: {};

			const bimSys1: Ai['Service']['ask'] = (request) =>
				Effect.sync(() => {
					const stateObj = asRecord(request.state);
					const assetObj = asRecord(stateObj['asset']);
					const viewsArr = Array.isArray(stateObj['asset_views']) ? stateObj['asset_views'] : [];
					const angles: string[] = [];
					let imageCount = 0;
					for (const item of viewsArr) {
						const viewObj = asRecord(item);
						if (typeof viewObj['angles'] === 'string') angles.push(viewObj['angles']);
						const imgObj = asRecord(viewObj['image']);
						if (imgObj['type'] === 'image_url') {
							imageCount++;
						}
					}
					const classifyQ = request.questions['classify'];
					const firstCriterion =
						classifyQ?.type === 'choice' ? (Object.keys(classifyQ.criteria)[0] ?? '') : '';
					const ifcClass = String(assetObj['ifc_class'] ?? '');
					const opType = String(assetObj['operation_type'] ?? '');
					const family = String(assetObj['family'] ?? '').toLowerCase();
					recordedCalls.push({ ifcClass, imageCount, angles, firstCriterion });

					let choice: string = UNKNOWN_CATALOG_CHOICE;
					let confidence = 0.94;
					if (ifcClass === 'IFCWALLSTANDARDCASE') {
						choice = 'STR-RC-WALL';
						confidence = 0.95;
					} else if (ifcClass === 'IFCTRANSPORTELEMENT') {
						choice = 'MEP-LIFT-PASS';
						confidence = 0.93;
					} else if (ifcClass === 'IFCDOOR' && opType === 'DOUBLE_DOOR_SLIDING') {
						choice = 'ARC-DOOR-SLIDE';
						confidence = 0.92;
					} else if (ifcClass === 'IFCGEOGRAPHICELEMENT' || family.includes('epdm')) {
						choice = 'CIV-PLAY-EPDM';
						confidence = 0.89;
					}

					return {
						cost_usd: 0,
						provider: 'test',
						answers: {
							classify: {
								type: 'choice' as const,
								choice,
								confidence,
								probabilities: {}
							}
						}
					};
				});

			const t = yield* acquireWorkspace({
				root,
				now: '2026-06-15T06:00:00.000Z',
				// the Item Matrix proposal's reviewers are the seeded teams holding commercial authority
				seed: { sys_team },
				fakes: {
					ai: {
						sys_1: bimSys1,
						cassette: {
							default: [
								{
									content: JSON.stringify({
										proposals: [
											{
												assets: [0],
												code: 'art kinetic',
												name: 'Kinetic art feature',
												discipline: 'architecture',
												trade_specialty: 'general',
												quantity_basis: 'count',
												unit_rate: 45000,
												carbon_factor: 120,
												rationale: 'A one-off feature priced as an installed item.'
											}
										]
									}),
									tool_calls: [],
									finish: 'stop' as const,
									usage: { input: 0, output: 0 }
								}
							]
						}
					}
				}
			});
			const admin = yield* t.as(t.admin);

			const setup = yield* admin.act({
				'projects.create': [
					{
						project_name: 'HDB Block 888B & Precinct Playground',
						project_number: 'HDB-888B',
						project_role: 'main_contractor',
						currency: 'SGD'
					}
				],
				'item_matrix.create': [
					{
						code: 'STR-RC-WALL',
						name: 'Reinforced Concrete Shear Wall 200mm',
						category: 'bim_asset',
						discipline: 'structural',
						trade_specialty: 'structural',
						ifc_classes: ['IFCWALLSTANDARDCASE'],
						match_keywords: ['shear wall'],
						unit: 'm2',
						quantity_basis: 'area',
						currency: 'SGD',
						unit_rate: '200.00',
						waste_factor_pct: '0.0',
						active: true
					},
					{
						code: 'MEP-LIFT-PASS',
						name: 'Passenger Lift (1000kg MRL)',
						category: 'bim_asset',
						discipline: 'mep',
						trade_specialty: 'mne',
						ifc_classes: ['IFCTRANSPORTELEMENT'],
						match_keywords: ['passenger lift'],
						unit: 'ea',
						quantity_basis: 'count',
						currency: 'SGD',
						unit_rate: '180000.00',
						waste_factor_pct: '0.0',
						active: true
					},
					{
						code: 'CIV-PLAY-EPDM',
						name: 'Playground EPDM Safety Surfacing',
						category: 'bim_asset',
						discipline: 'civil',
						trade_specialty: 'landscaping',
						ifc_classes: ['IFCGEOGRAPHICELEMENT'],
						match_keywords: ['playground surfacing'],
						unit: 'm2',
						quantity_basis: 'area',
						currency: 'SGD',
						unit_rate: '150.00',
						waste_factor_pct: '0.0',
						active: true
					},
					{
						code: 'ARC-DOOR-SLIDE',
						name: '2-Layer Double Sliding Balcony Door',
						category: 'bim_asset',
						discipline: 'architecture',
						trade_specialty: 'general',
						ifc_classes: ['IFCDOOR'],
						match_keywords: ['sliding door'],
						unit: 'ea',
						quantity_basis: 'count',
						currency: 'SGD',
						unit_rate: '2500.00',
						waste_factor_pct: '0.0',
						active: true
					}
				]
			});
			if (setup.kind !== 'committed') throw new Error('Setup failed');
			const projectId = recordOf(setup.records, 'projects').id;

			// The browser's takeoff, stored: each unique asset with its four-angle picture as a file of the project
			const viewOf = new Map<string, string>();
			const views = [];
			for (const archetype of ['A1', 'A2', 'A3', 'A4', 'A5']) {
				const view = yield* admin.upload('projects.bim_takeoff_views', {
					name: `${archetype}.jpg`,
					mime: 'image/jpeg',
					bytes: tinyJpeg
				});
				if (view.kind !== 'committed') throw new Error('View upload failed');
				viewOf.set(archetype, view.output.id);
				views.push(view.output);
			}
			const takeoff = yield* admin.upload('projects.bim_takeoff', {
				name: 'bim-takeoff.json',
				mime: 'application/json',
				bytes: new TextEncoder().encode(
					JSON.stringify({
						schema: 'IFC4',
						project_name: 'HDB 888B',
						storeys: ['Level 1', 'Level 18', 'Precinct Playground'],
						total_asset_count: 105,
						archetypes: [
							{
								archetype_id: 'A1',
								representative_express_id: 101,
								representative_part_ids: [],
								ifc_class: 'IFCWALLSTANDARDCASE',
								family: 'Basic Wall',
								type_name: 'RC Shear Wall 200mm G40',
								object_type: null,
								predefined_type: 'SHEAR',
								operation_type: null,
								classification_code: null,
								classification_name: null,
								materials: ['Concrete C40'],
								material_layers: ['Concrete C40 (200mm)'],
								layer_count: 1,
								properties: ['LoadBearing=true'],
								sample_names: ['Basic Wall:RC-200'],
								total_count: 100,
								has_length: false,
								has_area: true,
								has_volume: false,
								has_weight: false,
								visual_file: viewOf.get('A1'),
								signature: 'sig-A1'
							},
							{
								archetype_id: 'A2',
								representative_express_id: 201,
								representative_part_ids: [],
								ifc_class: 'IFCTRANSPORTELEMENT',
								family: 'KONE MonoSpace 1000kg',
								type_name: null,
								object_type: 'MRL Car',
								predefined_type: 'ELEVATOR',
								operation_type: null,
								classification_code: null,
								classification_name: null,
								materials: [],
								material_layers: [],
								layer_count: 0,
								properties: [],
								sample_names: ['KONE MonoSpace 1000kg:L1'],
								total_count: 2,
								has_length: false,
								has_area: false,
								has_volume: false,
								has_weight: false,
								visual_file: viewOf.get('A2'),
								signature: 'sig-A2'
							},
							{
								archetype_id: 'A3',
								representative_express_id: 301,
								representative_part_ids: [],
								ifc_class: 'IFCDOOR',
								family: 'Generic Door',
								type_name: 'D-09',
								object_type: null,
								predefined_type: 'DOOR',
								operation_type: 'DOUBLE_DOOR_SLIDING',
								classification_code: null,
								classification_name: null,
								materials: ['Tempered Glass', 'Anodised Aluminium'],
								material_layers: ['Tempered Glass (12mm)', 'Anodised Aluminium (50mm)'],
								layer_count: 2,
								properties: [],
								sample_names: ['Door-L01-01'],
								total_count: 1,
								has_length: false,
								has_area: false,
								has_volume: false,
								has_weight: false,
								visual_file: viewOf.get('A3'),
								signature: 'sig-A3'
							},
							{
								archetype_id: 'A4',
								representative_express_id: 401,
								representative_part_ids: [],
								ifc_class: 'IFCGEOGRAPHICELEMENT',
								family: 'EPDM Pour-in-Place Cushion',
								type_name: null,
								object_type: 'Outdoor Play Mat',
								predefined_type: null,
								operation_type: null,
								classification_code: null,
								classification_name: null,
								materials: ['EPDM Rubber'],
								material_layers: [],
								layer_count: 0,
								properties: [],
								sample_names: ['EPDM Pour-in-Place Cushion:ZoneA'],
								total_count: 1,
								has_length: false,
								has_area: true,
								has_volume: false,
								has_weight: false,
								visual_file: viewOf.get('A4'),
								signature: 'sig-A4'
							},
							{
								archetype_id: 'A5',
								representative_express_id: 501,
								representative_part_ids: [],
								ifc_class: 'IFCELECTRICAPPLIANCE',
								family: 'Bespoke Kinetic Sculpture',
								type_name: null,
								object_type: 'Art Feature',
								predefined_type: null,
								operation_type: null,
								classification_code: null,
								classification_name: null,
								materials: [],
								material_layers: [],
								layer_count: 0,
								properties: [],
								sample_names: ['Sculpture-01'],
								total_count: 1,
								has_length: false,
								has_area: false,
								has_volume: false,
								has_weight: false,
								visual_file: viewOf.get('A5'),
								signature: 'sig-A5'
							}
						],
						buckets: [
							{
								archetype_id: 'A1',
								storey: 'Level 1',
								element_count: 100,
								length_m: 0,
								length_measured_count: 0,
								area_m2: 1000,
								area_measured_count: 100,
								volume_m3: 0,
								volume_measured_count: 0,
								weight_kg: 0,
								weight_measured_count: 0,
								sample_express_ids: [101, 102]
							},
							{
								archetype_id: 'A2',
								storey: 'Level 18',
								element_count: 2,
								length_m: 0,
								length_measured_count: 0,
								area_m2: 0,
								area_measured_count: 0,
								volume_m3: 0,
								volume_measured_count: 0,
								weight_kg: 0,
								weight_measured_count: 0,
								sample_express_ids: [201, 202]
							},
							{
								archetype_id: 'A3',
								storey: 'Level 1',
								element_count: 1,
								length_m: 0,
								length_measured_count: 0,
								area_m2: 0,
								area_measured_count: 0,
								volume_m3: 0,
								volume_measured_count: 0,
								weight_kg: 0,
								weight_measured_count: 0,
								sample_express_ids: [301]
							},
							{
								archetype_id: 'A4',
								storey: 'Precinct Playground',
								element_count: 1,
								length_m: 0,
								length_measured_count: 0,
								area_m2: 300,
								area_measured_count: 1,
								volume_m3: 0,
								volume_measured_count: 0,
								weight_kg: 0,
								weight_measured_count: 0,
								sample_express_ids: [401]
							},
							{
								archetype_id: 'A5',
								storey: 'Level 1',
								element_count: 1,
								length_m: 0,
								length_measured_count: 0,
								area_m2: 0,
								area_measured_count: 0,
								volume_m3: 0,
								volume_measured_count: 0,
								weight_kg: 0,
								weight_measured_count: 0,
								sample_express_ids: [501]
							}
						]
					})
				)
			});
			if (takeoff.kind !== 'committed') throw new Error('Takeoff upload failed');
			const stored = yield* admin.act({
				'projects.update': [
					{
						target: recordOf(setup.records, 'projects'),
						set: { bim_takeoff: takeoff.output, bim_takeoff_views: views }
					}
				]
			});
			expect(stored.kind).toBe('committed');
			yield* t.run_due();
			const est = rowsOf(
				yield* admin.query({
					cost_estimates: {
						where: { project_id: { eq: projectId } },
						fields: [
							'bim_assets',
							'bim_asset_count',
							'classified_asset_count',
							'unmatched_asset_count',
							'bim_subtotal',
							'total_estimate'
						],
						limit: 1
					}
				}),
				'cost_estimates'
			)[0];
			const out = Schema.decodeUnknownSync(
				Schema.Struct({
					bim_asset_count: Schema.Number,
					classified_asset_count: Schema.Number,
					unmatched_asset_count: Schema.Number,
					bim_subtotal: Schema.String,
					total_estimate: Schema.String
				})
			)(est);

			// EXACTLY 5 System 1 calls for 5 deduplicated archetypes (ALL went through System 1 — even RC Shear Wall! Never 105!)
			expect(recordedCalls).toHaveLength(5);
			for (const call of recordedCalls) {
				expect(call.imageCount).toBe(1);
				expect(call.angles).toEqual([
					'front_three_quarter, front_elevation / side_rear_three_quarter, plan'
				]);
				expect(call.firstCriterion).toBe(UNKNOWN_CATALOG_CHOICE);
			}

			// 100 walls + 2 lifts + 1 double sliding door + 1 EPDM = 104 classified (ALL 104 via ai_sys1), 1 unknown_unseen_catalog
			expect(out.bim_asset_count).toBe(105);
			expect(out.classified_asset_count).toBe(104);
			expect(out.unmatched_asset_count).toBe(1);
			// 1000*200 (200,000) + 2*180,000 (360,000) + 1*2,500 (2,500) + 300*150 (45,000) = 607,500.00; +5% = 637,875.00
			expect(out.bim_subtotal).toBe('607500.00');
			expect(out.total_estimate).toBe('637875.00');

			// Verify ALL matched lines carry `ai_sys1` visual provenance and the unseen item carries Unknown / Unseen Catalog reason
			const lines = Schema.decodeUnknownSync(
				Schema.Array(
					Schema.Struct({
						matrix_code: Schema.optionalKey(Schema.NullOr(Schema.String)),
						status: Schema.String,
						match_method: Schema.optionalKey(Schema.NullOr(Schema.String)),
						match_reason: Schema.optionalKey(Schema.NullOr(Schema.String))
					})
				)
			)(est?.['bim_assets']);

			expect(lines.find((l) => l.matrix_code === 'STR-RC-WALL')?.match_method).toBe('ai_sys1');
			expect(lines.find((l) => l.matrix_code === 'MEP-LIFT-PASS')?.match_method).toBe('ai_sys1');
			expect(lines.find((l) => l.matrix_code === 'CIV-PLAY-EPDM')?.match_method).toBe('ai_sys1');
			const doorLine = lines.find((l) => l.matrix_code === 'ARC-DOOR-SLIDE');
			expect(doorLine?.match_method).toBe('ai_sys1');
			expect(doorLine?.match_reason).toContain('Visual AI (System 1)');
			const unknownLine = lines.find((l) => l.status === 'unmatched');
			expect(unknownLine?.matrix_code ?? null).toBeNull();
			expect(unknownLine?.match_method).toBe('ai_sys1');
			expect(unknownLine?.match_reason).toContain('Unknown / Unseen Catalog');

			// each decision is remembered by its asset's signature, picture included
			const mappingsOf = () =>
				admin.query({
					asset_mappings: {
						fields: ['revision', 'signature', 'source', 'item_id', 'picture'],
						order_by: { signature: 'asc' },
						limit: 10
					}
				});
			const remembered = rowsOf(yield* mappingsOf(), 'asset_mappings');
			expect(remembered.map((r) => r['signature'])).toEqual([
				'sig-A1',
				'sig-A2',
				'sig-A3',
				'sig-A4',
				'sig-A5'
			]);
			expect(remembered.every((r) => r['source'] !== 'qs' && r['picture'] != null)).toBe(true);

			// System 2's proposal for the unpriced sculpture waits for commercial review, linked to its asset
			const proposed = rowsOf(
				yield* admin.query({
					item_matrix: {
						where: { code: { eq: 'ART-KINETIC' } },
						fields: ['unit_rate', 'rate_basis'],
						limit: 1
					}
				}),
				'item_matrix'
			)[0];
			const approval = Schema.decodeUnknownSync(Schema.Struct({ request_id: Schema.String }))(
				proposed?.['$approval']
			);
			const qs = yield* t.as(
				t.member(['construction_read', 'construction_commercial', 'construction_connections'], {
					teams: ['commercial_qs']
				})
			);
			yield* qs.approvals.decide(approval.request_id, { decision: 'approve' });

			// a QS correction wins from then on: the door is priced as the QS chose
			const items = rowsOf(
				yield* admin.query({ item_matrix: { fields: ['code'], limit: 10 } }),
				'item_matrix'
			);
			const liftId = fixtureId(
				'item_matrix',
				String(items.find((r) => r['code'] === 'MEP-LIFT-PASS')?.['id'])
			);
			const door = rowsOf(yield* mappingsOf(), 'asset_mappings').find(
				(r) => r['signature'] === 'sig-A3'
			);
			yield* qs.act({
				'asset_mappings.update': [
					{
						target: {
							id: fixtureId('asset_mappings', String(door?.['id'])),
							revision: Number(door?.['revision'])
						},
						set: { item_id: liftId }
					}
				]
			});

			// pricing again asks System 1 nothing: every asset is remembered
			const again = yield* runAutomation(
				t,
				admin.run('analyze_bim_file', { project_id: projectId }, JobResult)
			);
			expect(again.state).toBe('succeeded');
			expect(recordedCalls).toHaveLength(5);
			const repriced = Schema.decodeUnknownSync(
				Schema.Array(
					Schema.Struct({
						matrix_code: Schema.optionalKey(Schema.NullOr(Schema.String)),
						match_method: Schema.optionalKey(Schema.NullOr(Schema.String))
					})
				)
			)(
				rowsOf(
					yield* admin.query({
						cost_estimates: {
							where: { project_id: { eq: projectId } },
							fields: ['bim_assets'],
							limit: 1
						}
					}),
					'cost_estimates'
				)[0]?.['bim_assets']
			);
			expect(repriced.find((l) => l.matrix_code === 'ART-KINETIC')?.match_method).toBe('ai_sys2');
			expect(
				repriced.filter((l) => l.matrix_code === 'MEP-LIFT-PASS').map((l) => l.match_method)
			).toContain('override');
			expect(repriced.some((l) => l.matrix_code === 'ARC-DOOR-SLIDE')).toBe(false);
		}).pipe(Effect.scoped)
);

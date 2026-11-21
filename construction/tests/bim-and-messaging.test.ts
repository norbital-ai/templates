import { Effect, Layer, Schema, Stream } from 'effect';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { id_of } from '@norbital-ai/bolt';
import { JobResult } from '@norbital-ai/bolt-cli/test';
import { Ai, Port, type Json } from '@norbital-ai/bolt/engine';
import { recordOf, rowsOf, workspace as acquireWorkspace } from './test-runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const RunRow = Schema.Struct({ state: Schema.String, output: Schema.Json });

type AiEvent = Stream.Success<ReturnType<Ai['Service']['infer']>>;

function scriptedExtractionAi(answer: Json) {
	return Layer.succeed(Ai, {
		maxChoices: undefined,
		models: ['default'],
		catalog: Effect.succeed({ models: [{ id: 'default', label: 'Test' }], default: 'default' }),
		deciders: Effect.succeed({ models: [{ id: 'default', label: 'Test' }], default: 'default' }),
		ask: () => Port.unavailable('ai.sys_1', 'Test falls back to deterministic matching.'),
		infer: () => {
			const event: AiEvent = {
				_tag: 'Response',
				response: {
					content: answer,
					tool_calls: [],
					finish: 'stop',
					usage: { input: 0, output: 0 }
				}
			};
			return Stream.succeed(event);
		},
		embed: () => Port.unavailable('ai.embed')
	});
}

it.live(
	'tracks project_files revisions, pins BIM issues via bim_pin, syncs WhatsApp, extracts updates, and runs digest',
	() =>
		Effect.gen(function* () {
			const scripted = scriptedExtractionAi({
				summary: 'Extracted site clash, progress update, draft VO, and follow-up task.',
				progress_updates: [
					{
						title: 'Panelboard wall framing completed',
						category: 'progress',
						zone: 'L01-MAIN',
						summary: 'Level 1 switchroom wall ready for feeders.',
						headcount: 12,
						weather: 'clear'
					}
				],
				issues: [
					{
						title: 'Sleeve clash above Unit A panelboard',
						kind: 'clash',
						severity: 'critical',
						zone: 'L01-MAIN',
						description: 'Chilled water sleeve 120mm too close to cable gland plate.'
					}
				],
				change_orders: [
					{
						title: 'Relocate chilled water sleeve offset',
						change_type: 'site_instruction',
						zone: 'L01-MAIN',
						description: 'Offset sleeve 250mm east to clear panelboard top entry.',
						cost_impact: 18500,
						schedule_impact_days: 3
					}
				],
				tasks: [
					{
						title: 'Issue revised switchroom shop drawing',
						zone: 'L01-MAIN',
						trade: 'MEP',
						priority: 'high',
						due_date: '2026-06-10'
					}
				]
			});

			const t = yield* acquireWorkspace({
				root,
				now: '2026-06-15T06:00:00.000Z',
				ports: scripted
			});
			const admin = yield* t.as(t.admin);

			const setup = yield* admin.act({
				'projects.create': [
					{
						project_name: 'Sample Commercial Tower',
						project_number: 'SCT-001',
						currency: 'SGD',
						contract_value: '42000000.00',
						zones: [
							{ code: 'L01-MAIN', name: 'Level 1 Switchroom', elevation_m: 0, grid_axis: 'A-D' }
						]
					}
				]
			});
			if (setup.kind !== 'committed') throw new Error('Project create failed');
			const projectId = recordOf(setup.records, 'projects').id;

			// 1. project_files auto-records initial revision and appends on version update
			const children = yield* admin.act({
				'project_files.create': [
					{
						title: 'Electrical Coordination Model',
						document_number: 'BIM-001',
						project_id: projectId,
						kind: 'ifc_model',
						discipline: 'mep',
						zone: 'L01-MAIN',
						current_version: 'P01'
					}
				],
				'contacts.create': [
					{
						full_name: 'Site Supervisor',
						company_name: 'Test MEP Contractor',
						role: 'subcontractor',
						project_id: projectId,
						phone: '+65 8123 4567'
					}
				]
			});
			if (children.kind !== 'committed') throw new Error('Children setup failed');
			const bimFileRec = recordOf(children.records, 'project_files');
			const contactId = recordOf(children.records, 'contacts').id;

			const bumped = yield* admin.act({
				'project_files.update': [
					{
						target: { id: bimFileRec.id, revision: bimFileRec.revision },
						set: { status: 'issued', current_version: 'P02' }
					}
				]
			});
			expect(bumped.kind).toBe('committed');
			const fileRow = rowsOf(
				yield* admin.query({ project_files: { where: { id: { eq: bimFileRec.id } } } }),
				'project_files'
			)[0];
			expect(Array.isArray(fileRow?.['revisions']) ? fileRow?.['revisions'] : []).toHaveLength(2);

			// 2. BIM-pinned issue using seq issue_number & co-located bim_pin
			const pinned = yield* admin.act({
				'issues.create': [
					{
						title: 'Panelboard earthing lug missing',
						kind: 'defect',
						severity: 'high',
						project_id: projectId,
						zone: 'L01-MAIN',
						bim_file_id: bimFileRec.id,
						party: contactId,
						bim_pin: {
							express_id: 36166,
							element_name: 'IfcFlowController · Unit A Panelboard',
							global_id: '1K7eM1Qof1dOc9$mY9I4DL',
							x: 3.4,
							y: 1.6,
							z: -5.2,
							camera_x: 6.0,
							camera_y: 3.0,
							camera_z: -1.0
						}
					}
				]
			});
			if (pinned.kind !== 'committed') throw new Error('Pinned issue failed');
			const pinnedId = recordOf(pinned.records, 'issues').id;
			const pinnedRow = rowsOf(
				yield* admin.query({ issues: { where: { id: { eq: pinnedId } } } }),
				'issues'
			)[0];
			expect(pinnedRow?.['issue_number']).toBe('ISS-2026-001');
			expect(pinnedRow?.['bim_pin']).toMatchObject({ express_id: 36166 });

			// 3. WhatsApp intake, deduplication, routing & AI extraction
			const accountRes = yield* admin.act({
				'sys_integration.create': [{ integration: 'whatsapp', name: 'Site WhatsApp', owner: null }]
			});
			if (accountRes.kind !== 'committed') throw new Error('Integration create failed');
			const accountId = recordOf(accountRes.records, 'sys_integration').id;

			const inbound = {
				id: 'wa-msg-1001',
				thread: 'sct-site-group',
				sent_at: t.clock.now(),
				from: { handle: '6581234567@s.whatsapp.net', name: 'Site Supervisor' },
				text: 'SCT-001 update: Level 1 switchroom wall framing done (12 pax). Chilled water sleeve clashes with Unit A panelboard — need offset instruction (+$18.5k, 3d) and revised shop drawing.',
				attachments: []
			};
			yield* t.receive(accountId, inbound);
			yield* admin.run('sync_messages', {}, JobResult);
			yield* t.run_due();

			// Re-receiving identical message must deduplicate
			yield* t.receive(accountId, inbound);
			yield* admin.run('sync_messages', {}, JobResult);
			yield* t.run_due();

			const synced = yield* admin.query({
				project_messages: { where: { project_id: { eq: projectId } } },
				progress_updates: { where: { project_id: { eq: projectId } } },
				issues: { where: { project_id: { eq: projectId } } },
				change_orders: { where: { project_id: { eq: projectId } } },
				tasks: { where: { project_id: { eq: projectId } } }
			});

			const messages = rowsOf(synced, 'project_messages');
			expect(messages).toHaveLength(1);
			const msg = messages[0];
			expect(msg).toMatchObject({
				transport: 'whatsapp',
				classification: 'useful',
				extraction_status: 'extracted'
			});
			const msgId = Schema.decodeUnknownSync(id_of('project_messages'))(msg?.['id']);

			expect(rowsOf(synced, 'progress_updates')).toHaveLength(1);
			expect(rowsOf(synced, 'issues')).toHaveLength(2);
			expect(rowsOf(synced, 'change_orders')[0]).toMatchObject({
				status: 'draft',
				cost_impact: '18500.00',
				schedule_impact_days: 3,
				source_message_id: msgId
			});
			expect(rowsOf(synced, 'tasks')).toHaveLength(1);

			// Re-extracting an already-extracted message via explicit message_ids must run (not silent no-op)
			const reExtract = yield* admin.run(
				'extract_project_updates',
				{ message_ids: [msgId] },
				JobResult
			);
			expect(reExtract.kind).toBe('committed');
			yield* t.run_due();
			const afterReExtract = rowsOf(
				yield* admin.query({ progress_updates: { where: { project_id: { eq: projectId } } } }),
				'progress_updates'
			);
			expect(afterReExtract).toHaveLength(2);

			// 4. Daily project digest filters critical/high issues & blocked/overdue tasks and notifies
			const started = yield* admin.run('daily_project_digest', {}, JobResult);
			if (started.kind !== 'committed') throw new Error('Digest did not start');
			yield* t.run_due();
			const [run] = yield* t.db.rows(RunRow, {
				text: 'select state, output from sys_run where id = $1',
				params: [started.output.id]
			});
			expect(run).toMatchObject({
				state: 'succeeded',
				output: {
					critical_high_issues_count: 3,
					blocked_or_overdue_tasks_count: 2,
					pending_changes_count: 2,
					pending_claims_count: 0
				}
			});
		}).pipe(Effect.scoped)
);

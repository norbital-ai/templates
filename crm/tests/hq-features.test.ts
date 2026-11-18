import { expect, it } from '@effect/vitest';
import { Effect, Layer, Schema } from 'effect';
import { Convert, Port } from '@norbital-ai/bolt/engine';
import { JobResult } from '@norbital-ai/bolt-cli/test';
import { createActivityDraft } from '../src/lib/activity-create.js';
import { linkCitations, parseResearch, parseUseCase } from '../src/lib/research.js';
import { answeringModel, scriptedModel } from './model.js';
import { pageOf, recordOf, runRows, targetOf, workspace } from './workspace.js';

it('parses cited company research into clean markdown, references, and linked citations', () => {
	const raw = [
		'## Overview',
		'',
		'What it does. Acme regulates construction safety [1][2].',
		'',
		'## References',
		'',
		'[1] [Acme Charter](https://acme.example.org/charter)',
		'[2] [Annual Report](https://reports.example.com/2026)'
	].join('\n');

	const parsed = parseResearch(raw);
	expect(parsed.references).toHaveLength(2);
	expect(parsed.references[0]).toMatchObject({
		n: 1,
		title: 'Acme Charter',
		url: 'https://acme.example.org/charter',
		host: 'acme.example.org'
	});
	expect(parsed.markdown).toContain('**What it does.**');
	expect(parsed.markdown).toContain('[[1]](#hq-ref-1)');
	expect(parsed.markdown).toContain('[[2]](#hq-ref-2)');
	expect(parsed.markdown).not.toContain('Acme Charter');
});

it('parses use cases into title + body and links shared citations', () => {
	const parsed = parseResearch('[1] [Official Notice](https://notice.example.org/1)');
	const uc = parseUseCase('Field inspection: Mobile checklists with timestamped photos [1].');
	expect(uc.title).toBe('Field inspection');
	expect(linkCitations(uc.body, parsed.byNumber)).toBe(
		'Mobile checklists with timestamped photos [[1]](#hq-ref-1).'
	);
});

it('builds the discriminated union activity drafts cleanly', () => {
	const now = '2026-11-17T10:00:00.000Z';
	const rec = createActivityDraft('recording', now);
	expect(rec.type).toBe('recording');
	const note = createActivityDraft('note', now);
	expect(note.type).toBe('note');
	const mtg = createActivityDraft('meeting', now);
	expect(mtg.type).toBe('meeting');
	if (mtg.type === 'meeting') {
		expect(mtg.scheduled_start_at).toBe('2026-11-17T10:00:00.000Z');
		expect(mtg.scheduled_end_at).toBe('2026-11-17T11:00:00.000Z');
	}
});

it.live(
	'supports multiple recordings per meeting with isolated speakers and auto-writes minutes',
	() =>
		Effect.gen(function* () {
			const model = scriptedModel([
				{
					summary: '- Covered FX volume and onboarding timeline.',
					decisions: ['Proceed with FX account review'],
					actions: []
				}
			]);
			let call = 0;
			const convert = Layer.succeed(Convert, {
				targets: [],
				convert: () => Port.unavailable('convert'),
				ingest: () =>
					Effect.sync(() => {
						call += 1;
						const text =
							call === 1
								? 'Part one covers wholesale shipping.'
								: 'Part two covers USD and EUR FX settlements.';
						return {
							kind: 'document' as const,
							html: `<section data-speaker="S1" data-start="0" data-end="4"><time>00:00:00</time> ${text}</section>`,
							images: [],
							meta: { stats: { pages: null, bytes: 3, cpuMs: 0, wallMs: 0 } }
						};
					})
			});
			const t = yield* workspace({
				now: '2026-10-01T02:00:00Z',
				ports: Layer.merge(model.ports, convert)
			});
			const admin = yield* t.as(t.admin);
			const [u1, u2] = yield* Effect.all([
				admin.upload('meeting_recordings.audio', {
					name: 'part1.m4a',
					mime: 'audio/mp4',
					bytes: new Uint8Array([1, 2])
				}),
				admin.upload('meeting_recordings.audio', {
					name: 'part2.m4a',
					mime: 'audio/mp4',
					bytes: new Uint8Array([3, 4])
				})
			]);
			if (u1.kind !== 'committed' || u2.kind !== 'committed') throw new Error('upload failed');
			const created = yield* admin.act({
				'activities.create': [
					{
						kind: 'meeting',
						subject: 'Multi-part call',
						occurred_at: '2026-10-01T02:00:00Z'
					}
				]
			});
			if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
			const meetingId = recordOf(created.records, 'activities', 0).id;

			const recs = yield* admin.act({
				'meeting_recordings.create': [
					{ meeting: meetingId, title: 'Part 1', audio: u1.output },
					{ meeting: meetingId, title: 'Part 2', audio: u2.output }
				]
			});
			expect(recs.kind).toBe('committed');
			yield* t.run_due();

			const recRows = pageOf(
				yield* admin.query({
					meeting_recordings: {
						where: { meeting: { eq: meetingId } },
						speakers: { fields: ['label'] }
					}
				}),
				'meeting_recordings'
			).rows;
			expect(recRows).toHaveLength(2);
			expect(recRows.every((r) => r['transcription'] === 'done')).toBe(true);
			const speakersShape = Schema.Array(Schema.Struct({ label: Schema.String }));
			for (const row of recRows) {
				const parsedSpeakers = Schema.decodeUnknownSync(speakersShape)(row['speakers']);
				expect(parsedSpeakers).toHaveLength(1);
				expect(parsedSpeakers[0]?.label).toBe('S1');
			}

			// Minutes were auto-generated from both recordings' transcriptions.
			const notesRuns = yield* runRows(t, 'meeting_notes');
			expect(notesRuns.length).toBeGreaterThanOrEqual(1);
			expect(model.prompts.at(-1)).toContain('wholesale shipping');
			expect(model.prompts.at(-1)).toContain('USD and EUR FX settlements');
			const actRow = pageOf(
				yield* admin.query({ activities: { where: { id: { eq: meetingId } }, fields: ['notes'] } }),
				'activities'
			).rows[0];
			expect(String(actRow?.['notes'] ?? '')).toContain('Proceed with FX account review');
		}).pipe(Effect.scoped)
);

it.live(
	'research_lead runs with zero document templates and evaluates runtime products + offering_settings',
	() =>
		Effect.gen(function* () {
			const model = scriptedModel([
				{
					findings: 'Pacific Wholesale moves bulk goods across borders [1].',
					use_cases: ['FX & Cross-Border Payments: Large USD/CNY supplier settlements [1].'],
					angle: 'Focus on FX spread savings.',
					sources: [{ url: 'https://pacific.example.com', title: 'Pacific Wholesale' }]
				}
			]);
			const t = yield* workspace({
				now: '2026-10-01T02:00:00Z',
				ports: model.ports,
				host: {
					agent: {
						host_tools: [
							{
								name: 'web_search',
								description: 'Stub search tool for test workspace.',
								input: { type: 'object' },
								behavior: {},
								call: async () => []
							}
						]
					}
				}
			});
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'offering_settings.create': [
					{
						seller_name: 'Airwallex AE',
						offering_summary: 'Global business accounts, FX and cross-border payments.',
						research_focus: 'Check cross-border trade volume and foreign currency exposure.'
					}
				],
				'products.create': [
					{
						name: 'FX & Cross-Border Payments',
						category: 'Treasury & FX',
						summary: 'Multi-currency conversions and international wires.',
						fit_criteria:
							'Ideal for wholesale trading companies moving large quantities of goods across borders.'
					}
				]
			});
			const comp = yield* admin.act({ 'companies.create': [{ name: 'Pacific Wholesale' }] });
			if (comp.kind !== 'committed') throw new Error(JSON.stringify(comp));
			const companyId = recordOf(comp.records, 'companies', 0).id;

			yield* t.run_due();

			const updated = pageOf(
				yield* admin.query({
					companies: {
						where: { id: { eq: companyId } },
						fields: ['research', 'research_error', 'use_cases']
					}
				}),
				'companies'
			).rows[0];
			expect(updated?.['research_error']).toBeNull();
			expect(model.prompts[0]).toContain('Airwallex AE');
			expect(model.prompts[0]).toContain('FX & Cross-Border Payments');
			expect(model.prompts[0]).toContain('wholesale trading companies');
			expect(String(updated?.['research'] ?? '')).toContain('Pacific Wholesale moves bulk goods');
			expect(updated?.['use_cases']).toEqual([
				'FX & Cross-Border Payments: Large USD/CNY supplier settlements [1].'
			]);
		}).pipe(Effect.scoped)
);

it.live(
	'sweeps unresearched companies in batches and extracts profile from company documents in the same automation',
	() =>
		Effect.gen(function* () {
			const model = answeringModel((prompt) => {
				if (prompt.includes('Unresearched Co') && prompt.includes('Offering summary')) {
					return {
						findings: 'Unresearched Co imports electronics across ASEAN [1].',
						use_cases: ['FX & Cross-Border Payments: Multi-currency supplier wires [1].'],
						angle: 'Focus on FX savings.',
						sources: [{ url: 'https://delta.example.com', title: 'Unresearched Co' }]
					};
				}
				if (prompt.includes('business nature or industry')) {
					return {
						industry: 'Electronics wholesale',
						description: 'Imports and distributes electronics across ASEAN.',
						preferences: [{ topic: 'Currency', preference: 'Settles in USD and SGD', sources: [] }]
					};
				}
				return {
					findings: 'Researched [1].',
					use_cases: [],
					angle: '',
					sources: [{ url: 'https://example.com', title: 'Example' }]
				};
			});
			const t = yield* workspace({
				now: '2026-10-01T02:00:00Z',
				ports: model.ports,
				host: {
					agent: {
						host_tools: [
							{
								name: 'web_search',
								description: 'Stub search tool for test workspace.',
								input: { type: 'object' },
								behavior: {},
								call: async () => []
							}
						]
					}
				}
			});
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'offering_settings.create': [
					{
						seller_name: 'Airwallex AE',
						offering_summary: 'Global accounts and FX.',
						research_focus: 'Cross-border trade flows.'
					}
				]
			});
			const two = yield* admin.act({
				'companies.create': [{ name: 'Already Researched Co' }, { name: 'Unresearched Co' }]
			});
			if (two.kind !== 'committed') throw new Error('create failed');
			const alreadyId = recordOf(two.records, 'companies', 0).id;
			const unresearchedId = recordOf(two.records, 'companies', 1).id;
			yield* t.run_due();
			// Reset Unresearched Co to unresearched and add an activity, while keeping Already Researched Co researched.
			const unresearched = yield* targetOf(t, 'companies', unresearchedId);
			const already = yield* targetOf(t, 'companies', alreadyId);
			yield* admin.act({
				'companies.update': [
					{
						target: already,
						set: { research: 'Existing', researched_at: '2026-09-01T00:00:00Z' }
					},
					{
						target: unresearched,
						set: { research: null, researched_at: null, profiled_at: null, industry: null }
					}
				],
				'activities.create': [
					{
						kind: 'note',
						subject: 'FX needs',
						company: unresearchedId,
						detail: 'Settles in USD and SGD.'
					}
				]
			});
			yield* t.run_due();
			const refreshed = pageOf(
				yield* admin.query({
					companies: {
						where: { id: { eq: unresearchedId } },
						fields: ['research', 'industry', 'description', 'researched_at', 'profiled_at']
					}
				}),
				'companies'
			).rows[0];
			expect(refreshed?.['researched_at']).not.toBeNull();
			expect(refreshed?.['profiled_at']).not.toBeNull();
			expect(refreshed?.['industry']).toBe('Electronics wholesale');

			// Running sweep `{}` when all companies already have `researched_at` triggers zero new research calls.
			const beforeSweep = model.prompts.length;
			yield* admin.run('research_lead', {}, JobResult);
			yield* t.run_due();
			expect(model.prompts.length).toBe(beforeSweep);
		}).pipe(Effect.scoped)
);

import {
	recordOf,
	required,
	runRows,
	sharedWorkspace,
	pageOf,
	targetOf,
	nativeId
} from './workspace.js';
import { DateTime, Effect, Layer, Schema } from 'effect';
import { Convert, Port } from '@norbital-ai/bolt/engine';
import { FacilityFailure, type Unavailable } from '@norbital-ai/bolt/errors';
import { TestWorkspace, type Kit, JobResult } from '@norbital-ai/bolt-cli/test';
/**
 * A meeting's recording is transcribed by the host's ingest (Norbital Convert; a fake here), each separated voice becomes a speaker to
 * name, and the notes turn action items into follow-ups. A failed transcription retries when set back to pending.
 */
import { expect, layer } from '@effect/vitest';
import { scriptedModel } from './model.js';
const meeting = Effect.fnUntraced(function* (t: Kit) {
	const admin = yield* t.as(t.admin);
	const upload = yield* admin.upload('activities.recording', {
		name: 'kickoff.m4a',
		mime: 'audio/mp4',
		bytes: new Uint8Array([1, 2, 3])
	});
	if (upload.kind !== 'committed') throw new Error(JSON.stringify(upload));
	const created = yield* admin.act({
		'activities.create': [
			{
				kind: 'meeting',
				subject: 'Kickoff',
				happened_on: '2026-10-01',
				recording: upload.output
			}
		]
	});
	if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
	return recordOf(created.records, 'activities', 0).id;
});

type TranscriptSegment = { speaker: string; start: number; end: number; text: string };
type Ingest = NonNullable<Convert['Service']['ingest']>;
/** Each test sets the segments the host's ingest answers, as Convert's speaker sections. */
let transcribe: (
	audio: Parameters<Ingest>[0],
	options: Parameters<Ingest>[1]
) => Effect.Effect<readonly TranscriptSegment[], FacilityFailure | Unavailable> = () =>
	Port.unavailable('convert.ingest');
const model = scriptedModel([
	{
		summary: '- Pilot scope agreed.',
		decisions: ['Sign the SOW next week'],
		actions: [{ title: 'Send the timetable', owner: 'Aaron Lim', due_in_days: 3 }]
	}
]);
const ports = Layer.merge(
	model.ports,
	Layer.succeed(Convert, {
		targets: [],
		convert: () => Port.unavailable('convert'),
		ingest: (audio, options) =>
			transcribe(audio, options).pipe(
				Effect.map((segments) => ({
					kind: 'document' as const,
					html: segments
						.map(
							(s) =>
								`<section data-speaker="${s.speaker}" data-start="${s.start}" data-end="${s.end}"><time>00:00:00</time> ${s.text}</section>`
						)
						.join('\n'),
					images: [],
					meta: { stats: { pages: null, bytes: 3, cpuMs: 0, wallMs: 0 } }
				}))
			)
	})
);
// One workspace: each test reads only its own meeting.
layer(sharedWorkspace({ now: '2026-10-01T02:00:00Z', ports }), { excludeTestServices: true })(
	'meetings',
	(it) => {
		it.effect(
			'transcribes the recording with speakers separated, then writes notes and action items',
			() =>
				Effect.gen(function* () {
					const heard: {
						mime: string;
						options: unknown;
					}[] = [];
					const t = yield* TestWorkspace;
					transcribe = (audio, options) =>
						Effect.sync(() => {
							heard.push({ mime: audio.mime, options });
							if (heard.length > 1)
								return [{ speaker: 'S1', start: 0, end: 3, text: 'A different meeting voice.' }];
							return [
								{
									speaker: 'S1',
									start: 0,
									end: 3,
									text: 'Welcome. Shall we agree the pilot scope?'
								},
								{
									speaker: 'S2',
									start: 3,
									end: 6,
									text: 'Yes. I will send the timetable by Friday.'
								},
								{ speaker: 'S1', start: 6, end: 9, text: 'Then we sign the SOW next week.' }
							];
						});
					const admin = yield* t.as(t.admin);
					const id = yield* meeting(t);
					yield* t.run_due();
					expect(
						(yield* runRows(t, 'transcribe_meeting')).map((run) => [run.state, run.error])
					).toEqual([['succeeded', null]]);
					expect(heard).toEqual([{ mime: 'audio/mp4', options: { diarize: true } }]);
					const row =
						pageOf(
							yield* admin.query({
								activities: {
									where: { id: { eq: id } },
									fields: ['transcription', 'segments'],
									limit: 1
								}
							}),
							'activities'
						).rows[0] ?? null;
					expect(row).toMatchObject({ transcription: 'done' });
					expect(required(row).segments).toHaveLength(3);
					const speakers = pageOf(
						yield* admin.query({
							meeting_speakers: { where: { meeting: { eq: id } }, order_by: { label: 'asc' } }
						}),
						'meeting_speakers'
					);
					expect(speakers.rows.map((s) => s['label'])).toEqual(['S1', 'S2']);
					// the attendee behind S2 is named, and the notes use the name
					const s2 = required(speakers.rows.find((s) => s['label'] === 'S2'));
					const person = yield* admin.act({ 'contacts.create': [{ full_name: 'Aaron Lim' }] });
					if (person.kind !== 'committed') throw new Error(JSON.stringify(person));
					const contact = recordOf(person.records, 'contacts').id;
					const voice = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
					yield* admin.act({
						'contacts.update': [
							{
								target: yield* targetOf(t, 'contacts', contact),
								set: {
									voice_embedding: voice,
									voice_samples: 1,
									voice_consent_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-01T02:00:00Z'))
								}
							}
						]
					});
					expect(
						(yield* admin.act({
							'meeting_speakers.update': [
								{
									target: yield* targetOf(
										t,
										'meeting_speakers',
										nativeId('meeting_speakers', s2.id)
									),
									set: {
										name: 'Aaron Lim',
										contact,
										voice_enrolled_at: DateTime.formatIso(
											DateTime.makeUnsafe('2026-10-01T02:00:00Z')
										)
									}
								}
							]
						})).kind
					).toBe('committed');
					yield* admin.run('meeting_notes', { meeting: id }, JobResult);
					yield* t.run_due();
					const runs = yield* runRows(t, 'meeting_notes');
					expect(runs.map((r) => [r['state'], r['error']])).toEqual([['succeeded', null]]);
					expect(model.prompts[0]).toContain('Aaron Lim: Yes. I will send');
					const noted =
						pageOf(
							yield* admin.query({
								activities: { where: { id: { eq: id } }, fields: ['notes'], limit: 1 }
							}),
							'activities'
						).rows[0] ?? null;
					expect(String(noted?.['notes'])).toContain('## Decisions\n\n- Sign the SOW next week');
					const actions = pageOf(
						yield* admin.query({ tasks: { where: { meeting: { eq: id } } } }),
						'tasks'
					);
					expect(actions.rows.map((f) => [f['subject'], f['due_on']])).toEqual([
						['Send the timetable', '2026-10-04']
					]);
					// whoever asked for the notes owns their follow-ups
					const starter = t.admin.actor;
					expect(actions.rows.map((f) => f['owner'])).toEqual([
						starter.kind === 'member' ? starter.id : null
					]);
					const replacement = yield* admin.upload('activities.recording', {
						name: 'replacement.m4a',
						mime: 'audio/mp4',
						bytes: new Uint8Array([4, 5, 6])
					});
					if (replacement.kind !== 'committed') throw new Error(JSON.stringify(replacement));
					yield* admin.act({
						'activities.update': [
							{
								target: yield* targetOf(t, 'activities', id),
								set: { recording: replacement.output, transcription: 'none' }
							}
						]
					});
					yield* t.run_due();
					const replaced =
						pageOf(
							yield* admin.query({
								activities: {
									where: { id: { eq: id } },
									fields: ['transcription', 'notes'],
									limit: 1,
									speakers: { fields: ['label', 'name', 'contact', 'voice_enrolled_at'] }
								}
							}),
							'activities'
						).rows[0] ?? null;
					const replacedSpeakers = Schema.decodeUnknownSync(
						Schema.Array(Schema.Struct({ id: Schema.String }))
					)(replaced?.['speakers']);
					expect(replaced).toMatchObject({ transcription: 'done', notes: null });
					expect(replacedSpeakers).toHaveLength(1);
					expect(replaced?.['speakers']).toMatchObject([
						{
							label: 'S1',
							name: null,
							contact: null,
							voice_enrolled_at: null
						}
					]);
					expect(replacedSpeakers[0]?.id).not.toBe(speakers.rows[0]?.id);
					expect(
						pageOf(
							yield* admin.query({ contacts: { where: { id: { eq: contact } }, limit: 1 } }),
							'contacts'
						).rows[0] ?? null
					).toMatchObject({
						voice_samples: 1,
						voice_embedding: voice
					});
				})
		);
		it.effect('a failed transcription retries on the same recording when set back to pending', () =>
			Effect.gen(function* () {
				let calls = 0;
				const t = yield* TestWorkspace;
				transcribe = () =>
					++calls === 1
						? Effect.fail(
								new FacilityFailure({
									kind: 'upstream',
									message: 'the transcription model answered something that is not JSON'
								})
							)
						: Effect.succeed([{ speaker: 'S1', start: 0, end: 1, text: 'Second time lucky.' }]);
				const admin = yield* t.as(t.admin);
				const id = yield* meeting(t);
				yield* t.run_due();
				expect(
					pageOf(
						yield* admin.query({ activities: { where: { id: { eq: id } }, limit: 1 } }),
						'activities'
					).rows[0] ?? null
				).toMatchObject({ transcription: 'failed' });
				yield* admin.act({
					'activities.update': [
						{
							target: yield* targetOf(t, 'activities', id),
							set: { transcription: 'pending', transcription_error: null }
						}
					]
				});
				yield* t.run_due();
				expect(
					pageOf(
						yield* admin.query({ activities: { where: { id: { eq: id } }, limit: 1 } }),
						'activities'
					).rows[0] ?? null
				).toMatchObject({
					transcription: 'done',
					transcription_error: null,
					recording: { name: 'kickoff.m4a' },
					segments: [{ speaker: 'S1', start: 0, end: 1, text: 'Second time lucky.' }]
				});
			})
		);
	}
);

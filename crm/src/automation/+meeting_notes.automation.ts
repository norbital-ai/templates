import { automation } from '@norbital-ai/bolt';
import { DateTime, Effect } from 'effect';
import { cap, PROMPT_MAX, transcriptPrompt, type Segment } from '../lib/ai.js';
import { salesStarter } from '../lib/customer.js';

/**
 * Meeting notes from the transcript(s) of all recordings on a meeting (with each speaker under the name
 * a person gave it): a summary and decisions go on the meeting, and each action item becomes a follow-up.
 * Triggered automatically after recording transcription completes, or re-run manually after naming speakers.
 */
export default automation({
	description: 'Writes a meeting’s notes, decisions and action items from its transcripts.',
	input: { meeting: { kind: 'ref', to: 'activities' } },
	policies: ['crm'],
	run: function* ({ meeting }, ctx) {
		if (ctx.trigger.kind !== 'system' && !(yield* salesStarter(ctx.trigger, ctx)))
			return yield* ctx.refuse('errors.sales_only');
		const [activityAnswer, recordingsAnswer] = yield* Effect.all([
			ctx.query({
				activities: {
					where: { id: { eq: meeting } },
					fields: [
						'subject',
						'occurred_at',
						'segments',
						'project_id',
						'company',
						'owner',
						'revision'
					],
					limit: 1,
					speakers: { fields: ['label', 'name', 'recording'], contact: { fields: ['full_name'] } },
					action_items: { fields: ['subject'] }
				}
			}),
			ctx.query({
				meeting_recordings: {
					where: { meeting: { eq: meeting } },
					fields: ['title', 'segments'],
					order_by: { created_at: 'asc' },
					speakers: { fields: ['label', 'name'], contact: { fields: ['full_name'] } }
				}
			})
		]);
		const row = activityAnswer.activities.rows[0] ?? null;
		if (row === null) return yield* ctx.refuse('errors.meeting_missing');

		const legacySpeakers = Object.fromEntries(
			row.speakers
				.filter((s) => s.recording == null)
				.map((s): [string, string] => [s.label, s.contact?.full_name ?? s.name ?? s.label])
		);
		const parts: string[] = [];
		const legacySegments: readonly Segment[] = row.segments ?? [];
		if (legacySegments.length > 0) {
			parts.push(transcriptPrompt(legacySegments, legacySpeakers));
		}
		const recRows = recordingsAnswer.meeting_recordings.rows.filter(
			(r) => (r.segments?.length ?? 0) > 0
		);
		for (const [idx, rec] of recRows.entries()) {
			const recNames = Object.fromEntries(
				rec.speakers.map((s): [string, string] => [
					s.label,
					s.contact?.full_name ?? s.name ?? s.label
				])
			);
			const text = transcriptPrompt(rec.segments ?? [], recNames);
			if (recRows.length > 1 || legacySegments.length > 0) {
				parts.push(`### ${rec.title ?? `Recording ${idx + 1}`}\n${text}`);
			} else {
				parts.push(text);
			}
		}
		const combinedTranscript = cap(parts.join('\n\n'), PROMPT_MAX);
		if (combinedTranscript.trim() === '') return yield* ctx.refuse('errors.meeting_no_transcript');

		const notes = yield* ctx.ai.sys_2.infer({
			system:
				'You take minutes for the team from a meeting transcript. Report only what was said. Never invent owners, dates or commitments.',
			prompt: `Meeting "${row.subject}" on ${row.occurred_at}. From the transcript below write: a short summary (Markdown, a few bullets), the decisions made, and the action items (each a short imperative title, the person named as responsible if one was, and in how many days it is due if a deadline was said).\n\n${combinedTranscript}`,
			output: {
				kind: 'object',
				fields: {
					summary: { kind: 'text' },
					decisions: { kind: 'text', many: true },
					actions: {
						kind: 'object',
						many: true,
						fields: {
							title: { kind: 'text' },
							owner: { kind: 'text', optional: true },
							due_in_days: { kind: 'int', min: 0, max: 365, optional: true }
						}
					}
				}
			}
		});
		const markdown = [
			'## Summary',
			notes.summary,
			...(notes.decisions.length > 0
				? ['## Decisions', notes.decisions.map((d) => `- ${d}`).join('\n')]
				: []),
			...(notes.actions.length > 0
				? [
						'## Action items',
						notes.actions.map((x) => `- ${x.title}${x.owner ? ` — ${x.owner}` : ''}`).join('\n')
					]
				: [])
		].join('\n\n');
		// whoever asked for the notes owns their follow-ups (or the activity's owner when auto-generated)
		const by = ctx.trigger;
		const owner =
			by.kind === 'person' && by.actor.kind === 'member' ? by.actor.id : (row.owner ?? null);
		const made = new Set(row.action_items.map((f) => f.subject));
		const actions = notes.actions.filter((x) => !made.has(x.title));
		yield* ctx.act({
			'activities.update': [
				{
					target: { id: row.id, revision: row.revision },
					set: { notes: markdown, notes_at: ctx.now }
				}
			],
			...(actions.length === 0
				? {}
				: {
						'tasks.create': actions.map((x) => ({
							subject: x.title,
							due_on: DateTime.formatIsoDate(
								DateTime.add(DateTime.makeUnsafe(ctx.today), { days: x.due_in_days ?? 7 })
							),
							meeting,
							...(owner === null ? {} : { owner }),
							...(x.owner ? { detail: `Named in the meeting: ${x.owner}` } : {}),
							...(row.project_id == null ? {} : { project_id: row.project_id }),
							...(row.company == null ? {} : { company: row.company })
						}))
					})
		});
	}
});

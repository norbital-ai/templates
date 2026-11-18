import { Effect } from 'effect';
import { automation } from '@norbital-ai/bolt';

/**
 * Transcribes meeting recordings via the host's ingest (Norbital Convert) with speakers separated.
 * Supports multi-recording meetings (`meeting_recordings` via `recording_ids`, auto-scheduling `meeting_notes`)
 * as well as legacy single-recording `activities` rows (`ids`).
 */
export default automation({
	description: 'Transcribes a meeting recording with speakers separated.',
	input: {
		ids: { kind: 'ref', to: 'activities', many: true, optional: true },
		recording_ids: { kind: 'ref', to: 'meeting_recordings', many: true, optional: true }
	},
	policies: ['hq_automation'],
	retry: { attempts: 3, backoff: '1min' },
	run: function* ({ ids, recording_ids }, ctx) {
		if (ids != null && ids.length > 0) {
			const { rows } = (yield* ctx.query({
				activities: {
					where: {
						id: { in: ids },
						transcription: { eq: 'pending' },
						recording: { is_null: false }
					},
					fields: ['recording', 'revision'],
					speakers: { fields: ['label', 'revision'] }
				}
			})).activities;
			for (const meeting of rows) {
				const recording = meeting.recording;
				if (recording == null) continue;
				const key = `transcribe:${meeting.id}:${meeting.revision}`;
				const heard = yield* ctx.convert.ingest(recording, { diarize: true }).pipe(
					Effect.map(
						(got) => (got.kind === 'document' ? got.transcript : undefined)?.segments ?? []
					),
					Effect.catchTags({
						Unavailable: (error) =>
							ctx
								.act(
									{
										'activities.update': [
											{
												target: { id: meeting.id, revision: meeting.revision },
												set: { transcription: 'unavailable', transcription_error: error.reason }
											}
										]
									},
									{ key }
								)
								.pipe(Effect.as(null)),
						FacilityFailure: (error) =>
							ctx
								.act(
									{
										'activities.update': [
											{
												target: { id: meeting.id, revision: meeting.revision },
												set: { transcription: 'failed', transcription_error: error.message }
											}
										]
									},
									{ key }
								)
								.pipe(Effect.as(null))
					})
				);
				if (heard === null) continue;
				const segments = heard.map((s) => ({
					speaker: s.speaker,
					start: s.start,
					end: s.end,
					text: s.text
				}));
				const voices = [...new Set(segments.map((s) => s.speaker))];
				yield* ctx.act(
					{
						'meeting_speakers.delete': meeting.speakers.map((s) => ({
							target: { id: s.id, revision: s.revision }
						})),
						'meeting_speakers.create': voices.map((label) => ({ meeting: meeting.id, label })),
						'activities.update': [
							{
								target: { id: meeting.id, revision: meeting.revision },
								set: {
									transcription: 'done',
									transcription_error: null,
									segments
								}
							}
						]
					},
					{ key }
				);
			}
		}

		if (recording_ids != null && recording_ids.length > 0) {
			const { rows } = (yield* ctx.query({
				meeting_recordings: {
					where: {
						id: { in: recording_ids },
						transcription: { eq: 'pending' }
					},
					fields: ['meeting', 'audio', 'revision'],
					speakers: { fields: ['label', 'revision'] }
				}
			})).meeting_recordings;
			const notedMeetings = new Set<(typeof rows)[number]['meeting']>();
			for (const rec of rows) {
				const key = `transcribe-rec:${rec.id}:${rec.revision}`;
				const heard = yield* ctx.convert.ingest(rec.audio, { diarize: true }).pipe(
					Effect.map(
						(got) => (got.kind === 'document' ? got.transcript : undefined)?.segments ?? []
					),
					Effect.catchTags({
						Unavailable: (error) =>
							ctx
								.act(
									{
										'meeting_recordings.update': [
											{
												target: { id: rec.id, revision: rec.revision },
												set: { transcription: 'unavailable', transcription_error: error.reason }
											}
										]
									},
									{ key }
								)
								.pipe(Effect.as(null)),
						FacilityFailure: (error) =>
							ctx
								.act(
									{
										'meeting_recordings.update': [
											{
												target: { id: rec.id, revision: rec.revision },
												set: { transcription: 'failed', transcription_error: error.message }
											}
										]
									},
									{ key }
								)
								.pipe(Effect.as(null))
					})
				);
				if (heard === null) continue;
				const segments = heard.map((s) => ({
					speaker: s.speaker,
					start: s.start,
					end: s.end,
					text: s.text
				}));
				const voices = [...new Set(segments.map((s) => s.speaker))];
				yield* ctx.act(
					{
						'meeting_speakers.delete': rec.speakers.map((s) => ({
							target: { id: s.id, revision: s.revision }
						})),
						'meeting_speakers.create': voices.map((label) => ({
							meeting: rec.meeting,
							recording: rec.id,
							label
						})),
						'meeting_recordings.update': [
							{
								target: { id: rec.id, revision: rec.revision },
								set: {
									transcription: 'done',
									transcription_error: null,
									segments
								}
							}
						]
					},
					{ key }
				);
				notedMeetings.add(rec.meeting);
			}
			for (const meeting of notedMeetings) {
				yield* ctx.schedule(
					'meeting_notes',
					{ meeting },
					{ at: ctx.now, key: `meeting-notes:${meeting}` }
				);
			}
		}
	}
});

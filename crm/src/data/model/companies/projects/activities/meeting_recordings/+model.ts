import { Effect } from 'effect';
import { model } from '@norbital-ai/bolt';
import { deriveFrom } from '../../../../../../lib/derive.js';

/**
 * One audio or video recording on an activity (a meeting can have several). Each recording owns its audio file,
 * its server-transcribed segments and its separated speakers (`meeting_speakers`), so audio + transcript + speakers
 * stay together as one unit.
 */
export default model('meeting_recordings', {
	description: 'One audio recording on an activity with its transcript and speakers.',
	icon: 'lucide:mic',
	record_label:
		'record.title != null ? record.title : record.audio != null ? record.audio.name : "Recording"',
	fields: {
		meeting: { kind: 'ref', to: 'activities', inverse: 'recordings', owned: true },
		title: { kind: 'text', optional: true },
		audio: { kind: 'file', accept: ['audio/*', 'video/*'], max: '20MiB' },
		transcription: {
			kind: 'enum',
			values: ['pending', 'done', 'failed', 'unavailable'],
			default: 'pending'
		},
		transcription_error: { kind: 'text', optional: true },
		language: { kind: 'text', optional: true },
		segments: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				many: true,
				fields: {
					speaker: { kind: 'text' },
					start: { kind: 'number' },
					end: { kind: 'number' },
					text: { kind: 'text' }
				}
			}
		}
	},
	indexes: { by_meeting: { on: ['meeting'] } },
	outputs: {
		default: {
			fields: 'all',
			speakers: {
				fields: ['label', 'name', 'contact', 'voice_enrolled_at'],
				contact: { fields: ['full_name'] }
			}
		}
	},
	create: {
		fields: [
			'meeting',
			'title',
			'audio',
			'transcription',
			'transcription_error',
			'language',
			'segments'
		],
		transform: function* (changes) {
			return changes.map(({ set, after }) => ({
				...set,
				...(after.title == null || after.title.trim() === ''
					? { title: after.audio?.name ?? null }
					: {}),
				...(set.transcription === undefined || set.transcription === 'pending'
					? {
							transcription: 'pending' as const,
							transcription_error: null,
							segments: null,
							language: null
						}
					: {})
			}));
		},
		effect: function* (changes, ctx) {
			const ids = changes.flatMap(({ after }) =>
				after.transcription === 'pending' ? [after.id] : []
			);
			if (ids.length > 0)
				yield* ctx.schedule('transcribe_meeting', { recording_ids: ids }, { at: ctx.now });
		}
	},
	update: {
		fields: ['title', 'audio', 'transcription', 'transcription_error', 'language', 'segments'],
		transform: function* (changes) {
			return changes.map(({ before, set }) =>
				set.audio != null && set.audio.id !== before.audio?.id
					? {
							...set,
							transcription: 'pending' as const,
							transcription_error: null,
							segments: null,
							language: null
						}
					: set
			);
		},
		effect: function* (changes, ctx) {
			const pendingIds = changes.flatMap(({ before, after }) =>
				before.transcription !== after.transcription && after.transcription === 'pending'
					? [after.id]
					: []
			);
			if (pendingIds.length > 0)
				yield* ctx.schedule('transcribe_meeting', { recording_ids: pendingIds }, { at: ctx.now });

			const transcriptMeetings = [
				...new Set(
					changes.flatMap(({ before, after }) =>
						JSON.stringify(before.segments) !== JSON.stringify(after.segments)
							? [after.meeting]
							: []
					)
				)
			];
			if (transcriptMeetings.length > 0) {
				const parents = (yield* ctx.query({
					activities: {
						where: { id: { in: transcriptMeetings } },
						fields: ['project_id', 'company']
					}
				})).activities.rows;
				yield* deriveFrom(parents, ctx);
			}
		}
	},
	delete: {}
});

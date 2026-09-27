import { model } from '@norbital-ai/bolt';

/**
 * An interaction on an engagement: a note, call, email, meeting or milestone.
 *
 * `kind: 'transcript'` rows come from the on-device Transcriber app: `detail` holds the reviewed, speaker-labeled
 * Markdown transcript and `recording` is the source audio, attached only when the person explicitly chose to save it
 * alongside the transcript. Transcription itself runs entirely in the browser; no audio or transcript is ever sent to
 * a remote transcription API or a model provider.
 */
export default model({
	description: 'A logged interaction, note, meeting, milestone or transcript on a project.',
	icon: 'lucide:activity',
	label: 'subject',
	fields: {
		subject: { kind: 'text' },
		kind: {
			kind: 'enum',
			values: ['note', 'call', 'email', 'meeting', 'milestone', 'transcript'],
			optional: true
		},
		happened_on: { kind: 'instant', optional: true },
		detail: { kind: 'text', optional: true },
		// the source audio (or a video's soundtrack)
		recording: { kind: 'file', accept: ['audio/*', 'video/*'], max: '20MiB', optional: true }
	}
});

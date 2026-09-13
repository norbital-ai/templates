import { defineModel, enums, file, instant, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * An interaction on an engagement: a note, call, email, meeting or milestone.
 *
 * `kind: 'transcript'` rows come from the on-device Transcriber app: `detail` holds the
 * reviewed, speaker-labeled Markdown transcript and `recording` is the source audio, attached
 * only when the person explicitly chose to save it alongside the transcript. Transcription
 * itself runs entirely in the browser; no audio or transcript is ever sent to a remote
 * transcription API or a model provider.
 */
export default defineModel(
	{
		subject: text().notNull(),
		kind: enums(['note', 'call', 'email', 'meeting', 'milestone', 'transcript']),
		happened_on: instant(),
		project_id: uuid(),
		contact_id: uuid(),
		detail: text(),
		recording: file()
	},
	{
		description: 'A logged interaction, note, meeting, milestone or transcript on a project.',
		recordLabel: 'subject',
		icon: 'lucide:activity'
	}
);

import { model } from '@norbital-ai/bolt';

/**
 * A voice the transcript separated (`Speaker 1`), and the attendee it turned out to be. `transcribe_meeting` lists
 * them; a person names each one or picks the contact it was.
 */
export default model('meeting_speakers', {
	description: 'A separated speaker in a meeting transcript and the attendee it is.',
	icon: 'lucide:audio-lines',
	record_label:
		'record.contact.full_name != null ? record.contact.full_name : record.name != null ? record.name : record.label',
	fields: {
		label: { kind: 'text' },
		name: { kind: 'text', optional: true },
		/** When this voice was added to the contact's voice profile; a meeting counts once. */
		voice_enrolled_at: { kind: 'instant', optional: true },
		meeting: { kind: 'ref', to: 'activities', inverse: 'speakers', owned: true },
		recording: {
			kind: 'ref',
			to: 'meeting_recordings',
			inverse: 'speakers',
			owned: true,
			optional: true
		},
		contact: { kind: 'ref', to: 'contacts', inverse: 'meeting_voices', optional: true }
	},
	constraints: {
		one_speaker_label_per_recording: {
			unique: ['recording', 'label'],
			where: { recording: { is_null: false } }
		},
		one_speaker_label_per_meeting: {
			unique: ['meeting', 'label'],
			where: { recording: { is_null: true } }
		}
	},
	indexes: { find: { text: ['label', 'name', 'contact'] } },
	outputs: {
		default: {
			fields: 'all',
			contact: {
				fields: ['full_name', 'voice_consent_at'],
				company_id: { fields: ['name', 'uen'] }
			}
		},
		// a speaker's contact by name: the voice profile stays with the Sales policy
		crm: { fields: 'all', contact: { fields: ['full_name'] } }
	},
	create: { fields: ['meeting', 'recording', 'label', 'name', 'contact'] },
	update: {
		fields: ['name', 'contact', 'voice_enrolled_at'],
		// a speaker assigned to another contact is no longer enrolled for this meeting
		transform: function* (changes) {
			return changes.map(({ before, set }) =>
				set.contact !== undefined &&
				set.contact !== before.contact &&
				set.voice_enrolled_at === undefined
					? { ...set, voice_enrolled_at: null }
					: set
			);
		}
	},
	delete: {}
});

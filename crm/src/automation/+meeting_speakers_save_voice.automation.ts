import { automation } from '@norbital-ai/bolt';
import { enrol, recognise } from '../lib/voice.js';
import { salesStarter } from '../lib/customer.js';

export default automation({
	description: 'Saves a tagged speaker to a consenting contact’s voice profile once per meeting.',
	input: {
		meeting_speakers: { kind: 'rows', of: 'meeting_speakers' },
		contact: { kind: 'ref', to: 'contacts' },
		embedding: { kind: 'vector', dim: 512, metric: 'cosine' },
		consent: { kind: 'bool', default: false },
		automatic: { kind: 'bool', default: false }
	},
	policies: ['crm'],
	run: function* (input, ctx) {
		if (!(yield* salesStarter(ctx.trigger, ctx))) return yield* ctx.refuse('errors.sales_only');
		const [target, ...rest] = input.meeting_speakers;
		if (target === undefined || rest.length > 0) return yield* ctx.refuse('errors.one_speaker');
		if (target.voice_enrolled_at != null) return;
		const contact =
			(yield* ctx.query({ contacts: { where: { id: { eq: input.contact } }, limit: 1 } })).contacts
				.rows[0] ?? null;
		if (contact === null) return yield* ctx.refuse('errors.contact_missing');
		if (contact.voice_consent_at == null && !input.consent)
			return yield* ctx.refuse('errors.voice_consent');
		if (target.contact !== contact.id) {
			if (!input.automatic || target.contact != null)
				return yield* ctx.refuse('errors.voice_assign_first');
			const meeting =
				(yield* ctx.query({ activities: { where: { id: { eq: target.meeting } }, limit: 1 } }))
					.activities.rows[0] ?? null;
			if (meeting === null) return yield* ctx.refuse('errors.meeting_unavailable');
			const { meeting_speakers: assigned, contacts: profiles } = yield* ctx.query({
				meeting_speakers: {
					where: { meeting: { eq: meeting.id }, contact: { is_null: false } },
					fields: ['contact']
				},
				contacts: {
					where: {
						voice_samples: { gt: 0 },
						voice_consent_at: { is_null: false },
						...(meeting.company == null ? {} : { company_id: { eq: meeting.company } })
					},
					fields: ['full_name', 'voice_embedding']
				}
			});
			const taken = new Set(assigned.rows.map((speaker) => speaker.contact));
			const match = recognise(
				input.embedding,
				profiles.rows.flatMap((profile) =>
					profile.voice_embedding == null
						? []
						: [{ id: profile.id, name: profile.full_name, embedding: profile.voice_embedding }]
				)
			);
			if (match?.id !== contact.id || taken.has(contact.id))
				return yield* ctx.refuse('errors.voice_confirm');
		}
		if (Math.hypot(...input.embedding) === 0) return yield* ctx.refuse('errors.voice_too_short');
		const { rows: enrolled } = (yield* ctx.query({
			meeting_speakers: {
				where: {
					meeting: { eq: target.meeting },
					contact: { eq: contact.id },
					voice_enrolled_at: { is_null: false }
				},
				fields: ['voice_enrolled_at'],
				limit: 1
			}
		})).meeting_speakers;
		// A diarizer can split one person into several labels; the meeting still counts once.
		if (enrolled.length > 0) {
			yield* ctx.act({
				'meeting_speakers.update': [
					{
						target,
						set: { voice_enrolled_at: enrolled[0]?.voice_enrolled_at ?? ctx.now }
					}
				]
			});
			return;
		}
		// the profile and the speaker commit together, each at the revision this run read
		yield* ctx.act({
			'contacts.update': [
				{
					target: contact,
					set: {
						voice_embedding: enrol(contact.voice_embedding, contact.voice_samples, input.embedding),
						voice_samples: contact.voice_samples + 1,
						voice_enrolled_at: ctx.now,
						...(contact.voice_consent_at == null ? { voice_consent_at: ctx.now } : {}),
						...(input.automatic ? { voice_last_match_at: ctx.now } : {})
					}
				}
			],
			'meeting_speakers.update': [
				{
					target,
					set: { contact: contact.id, voice_enrolled_at: ctx.now }
				}
			]
		});
	}
});

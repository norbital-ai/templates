import { Effect } from 'effect';
import { type EffectCtx, type Id, model, type WriteCtx } from '@norbital-ai/bolt';

/** Every column is the person's to set. */
const columns = [
	'full_name',
	'job_title',
	'email',
	'phone',
	'telegram',
	'slack',
	'discord',
	'company_id',
	'is_primary',
	'company_signatory',
	'seniority',
	'angle',
	'notes'
] as const;
/** The voice profile is written by the meeting page in the browser, never at creation. */
const VOICE_FIELDS = [
	'voice_embedding',
	'voice_consent_at',
	'voice_enrolled_at',
	'voice_samples',
	'voice_last_match_at'
] as const;

type Signing = {
	readonly id: Id<'contacts'> | undefined;
	readonly company: Id<'companies'> | null | undefined;
};
/** A customer has at most one `company_signatory`, and only a contact of a customer can be it. */
const oneSignatory = Effect.fnUntraced(function* (
	signing: readonly Signing[],
	ctx: WriteCtx<'contacts'>
) {
	if (signing.length === 0) return;
	if (signing.some((s) => s.company == null))
		return yield* ctx.refuse('errors.signatory_needs_customer', {
			field: 'company_signatory'
		});
	const companies = [...new Set(signing.flatMap((s) => (s.company == null ? [] : [s.company])))];
	// the stored signatories other than the contacts this batch writes, plus the batch's own
	const { rows } = (yield* ctx.query({
		contacts: {
			where: { company_id: { in: companies }, company_signatory: { eq: true } },
			fields: ['company_id']
		}
	})).contacts;
	const writing = new Set(signing.flatMap((s) => (s.id === undefined ? [] : [s.id])));
	const taken = [
		...rows.filter((row) => !writing.has(row.id)).map((row) => row.company_id),
		...signing.map((s) => s.company)
	];
	if (new Set(taken).size < taken.length)
		return yield* ctx.refuse('errors.signatory_taken', { field: 'company_signatory' });
});

const replayMessages = (ctx: Pick<EffectCtx, 'schedule' | 'now'>) =>
	ctx.schedule('replay_message_routes', {}, { at: ctx.now, key: 'crm-routing-history-all-all' });
const replayCalendar = (ctx: Pick<EffectCtx, 'schedule' | 'now'>) =>
	ctx.schedule('replay_calendar_activities', {}, { at: ctx.now, key: 'hq:replay-calendar' });

/**
 * A PIC (person in charge) at a company: a lead's or a client's. `email_key`, `phone_key`, `telegram_key`, `slack_key`
 * and `discord_key` are what an inbound message's sender is matched on: the address case-folded, the number's digits (a
 * WhatsApp handle compares the same way), the Telegram username or user id case-folded behind one `@`, the Slack or
 * Discord user id behind its platform. One contact per email address: imports join a PIC already on file.
 * `company_signatory` marks the one contact who signs the company's documents by default. `seniority` and `angle` are
 * `research_lead`'s read of what this PIC answers to: an owner's oversight and handover stress, a junior's simpler job
 * and credit with the boss.
 */
export default model('contacts', {
	description: 'A PIC (person in charge) at a lead or client company.',
	icon: 'lucide:user-round',
	record_label: 'record.full_name',
	fields: {
		full_name: { kind: 'text' },
		job_title: { kind: 'text', optional: true },
		email: { kind: 'text', optional: true },
		phone: { kind: 'text', optional: true },
		telegram: { kind: 'text', optional: true },
		slack: { kind: 'text', optional: true },
		discord: { kind: 'text', optional: true },
		company_id: { kind: 'ref', to: 'companies', inverse: 'contacts', optional: true },
		is_primary: { kind: 'bool', optional: true },
		company_signatory: { kind: 'bool', default: false },
		seniority: { kind: 'enum', values: ['owner', 'manager', 'staff'], optional: true },
		angle: { kind: 'text', format: 'markdown', optional: true },
		notes: { kind: 'text', optional: true },
		// Voice profile: biometric. Computed in the browser from tagged meeting speakers, with recorded consent;
		// removing it clears all five.
		voice_embedding: { kind: 'vector', dim: 512, metric: 'cosine', optional: true },
		voice_consent_at: { kind: 'instant', optional: true },
		voice_enrolled_at: { kind: 'instant', optional: true },
		voice_samples: { kind: 'int', min: 0, default: 0 },
		voice_last_match_at: { kind: 'instant', optional: true },
		email_key: { kind: 'text', computed: 'lower(email)' },
		phone_key: { kind: 'text', computed: "regex_replace(phone, r'\\D', '')" },
		telegram_key: {
			kind: 'text',
			computed: "lower(regex_replace(trim(telegram), '^@?', '@'))"
		},
		slack_key: {
			kind: 'text',
			computed: "lower(regex_replace(trim(slack), '^(slack:)?@?', 'slack:'))"
		},
		discord_key: {
			kind: 'text',
			computed: "lower(regex_replace(trim(discord), '^(discord:)?@?', 'discord:'))"
		}
	},
	constraints: { one_contact_per_email: { unique: ['email_key'] } },
	indexes: {
		by_email_key: { on: ['email_key'] },
		by_phone_key: { on: ['phone_key'] },
		by_telegram_key: { on: ['telegram_key'] },
		by_slack_key: { on: ['slack_key'] },
		by_discord_key: { on: ['discord_key'] },
		find: { text: ['full_name', 'email', 'phone', 'company_id'] }
	},
	outputs: {
		default: { fields: 'all', company_id: { fields: ['name', 'uen'] } },
		// the contact without its voice profile, which is biometric and read only under the Sales policy
		crm: {
			fields: [
				'full_name',
				'job_title',
				'email',
				'phone',
				'telegram',
				'slack',
				'discord',
				'company_id',
				'is_primary',
				'company_signatory',
				'seniority',
				'angle',
				'notes',
				'email_key',
				'phone_key',
				'telegram_key',
				'slack_key',
				'discord_key'
			],
			company_id: { fields: ['name', 'uen'] }
		}
	},
	create: {
		fields: columns,
		transform: function* (changes, ctx) {
			yield* oneSignatory(
				changes.flatMap(({ set }) =>
					set.company_signatory === true ? [{ id: undefined, company: set.company_id }] : []
				),
				ctx
			);
			return changes.map(({ set }) => set);
		},
		// a new PIC re-matches captured history and imported appointments (both bounded replays)
		effect: function* (_changes, ctx) {
			yield* replayMessages(ctx);
			yield* replayCalendar(ctx);
		}
	},
	update: {
		fields: [...columns, ...VOICE_FIELDS],
		transform: function* (changes, ctx) {
			yield* oneSignatory(
				changes.flatMap(({ after }) =>
					after.company_signatory === true ? [{ id: after.id, company: after.company_id }] : []
				),
				ctx
			);
			return changes.map(({ set }) => set);
		},
		// a changed PIC re-matches captured history and imported appointments
		effect: function* (changes, ctx) {
			if (
				changes.some((change) =>
					change.changed('phone', 'email', 'telegram', 'slack', 'discord', 'company_id')
				)
			)
				yield* replayMessages(ctx);
			if (changes.some((change) => change.changed('email', 'company_id')))
				yield* replayCalendar(ctx);
		}
	}
});

import { model, type EffectCtx } from '@norbital-ai/bolt';

const columns = [
	'full_name',
	'company_name',
	'role',
	'trade',
	'project_id',
	'phone',
	'email',
	'telegram',
	'slack',
	'discord',
	'notes'
] as const;

const replayMessages = (ctx: Pick<EffectCtx, 'schedule' | 'now'>) =>
	ctx.schedule('reclassify_messages', {}, { at: ctx.now, key: 'construction-reclassify-all' });

/**
 * Project stakeholders, subcontractors, site engineers, QS, consultants and clients.
 * Computed handle keys match incoming WhatsApp, Telegram, email, Slack and Discord senders directly.
 */
export default model('contacts', {
	description:
		'Subcontractors, site engineers, QS, consultants, and client contacts for messaging routing.',
	icon: 'lucide:contact-round',
	record_label:
		"record.company_name != null ? record.full_name + ' · ' + record.company_name : record.full_name",
	fields: {
		full_name: { kind: 'text' },
		company_name: { kind: 'text', optional: true },
		role: {
			kind: 'enum',
			values: [
				'subcontractor',
				'site_engineer',
				'qs',
				'architect',
				'consultant',
				'client',
				'supplier',
				'safety_officer',
				'project_manager'
			],
			default: 'subcontractor'
		},
		trade: { kind: 'text', optional: true },
		project_id: {
			kind: 'ref',
			to: 'projects',
			inverse: 'contacts',
			optional: true,
			on_delete: 'set_null'
		},
		phone: { kind: 'text', format: 'phone', optional: true },
		email: { kind: 'text', format: 'email', optional: true },
		telegram: { kind: 'text', optional: true },
		slack: { kind: 'text', optional: true },
		discord: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true },
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
	indexes: {
		by_email_key: { on: ['email_key'] },
		by_phone_key: { on: ['phone_key'] },
		by_telegram_key: { on: ['telegram_key'] },
		by_slack_key: { on: ['slack_key'] },
		by_discord_key: { on: ['discord_key'] },
		find: { text: ['full_name', 'company_name', 'trade', 'phone', 'email'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] }
		}
	},
	create: {
		fields: columns,
		effect: function* (_changes, ctx) {
			yield* replayMessages(ctx);
		}
	},
	update: {
		fields: columns,
		effect: function* (changes, ctx) {
			if (
				changes.some((c) =>
					c.changed('phone', 'email', 'telegram', 'slack', 'discord', 'project_id')
				)
			) {
				yield* replayMessages(ctx);
			}
		}
	},
	delete: {}
});

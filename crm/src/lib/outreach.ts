/**
 * Cold outreach: a sequence's steps, the per-lead values its `{{variables}}` render with, the potential-project prompt's
 * typed answer, and the Apollo request and answer shapes `launch_cohort` and `sync_cohort` use
 * (https://docs.apollo.io/reference). Browser-safe: the sequence preview renders with the same helpers.
 */
import { Effect, Option, Schema } from 'effect';
import { instance_id, type AutomationCtx } from '@norbital-ai/bolt';
import { render, type Values } from './documents.js';

/** A sequence's steps: days after enrolment, the channel, and the text with its variables. */
export const STEPS_FIELD = {
	kind: 'json',
	shape: {
		kind: 'object',
		many: true,
		fields: {
			day_offset: { kind: 'int', min: 0 },
			channel: { kind: 'enum', values: ['email', 'call'] },
			subject: { kind: 'text', optional: true },
			body: { kind: 'text' }
		}
	}
} as const;
export type Step = {
	readonly day_offset: number;
	readonly channel: 'email' | 'call';
	readonly subject?: string | null | undefined;
	readonly body: string;
};
/** The variables a step may use. */
export const VARIABLES = ['first_name', 'company', 'potential_projects', 'sender_name'] as const;

/** The steps in send order. */
export const ordered = (steps: readonly Step[]) =>
	[...steps].sort((a, b) => a.day_offset - b.day_offset);

/** A company's kept projects, by rank, as the bullets `{{potential_projects}}` renders. */
export const bullets = (projects: readonly { summary: string; rank: number; status: string }[]) =>
	projects
		.filter((project) => project.status === 'kept')
		.sort((a, b) => a.rank - b.rank)
		.map((project) => `- ${project.summary}`)
		.join('\n');

/** One lead's values: the PIC's first name, the company, its kept projects and the sender. */
export const leadValues = (lead: {
	readonly full_name: string;
	readonly company: string;
	readonly projects: string;
	readonly sender_name: string | null;
}): Values => ({
	first_name: lead.full_name.trim().split(/\s+/)[0] ?? '',
	company: lead.company,
	potential_projects: lead.projects,
	sender_name: lead.sender_name ?? ''
});

/** Each step as one lead receives it. */
export const renderSteps = (steps: readonly Step[], values: Values) =>
	ordered(steps).map((step) => ({
		...step,
		subject: step.subject == null ? null : render(step.subject, values),
		body: render(step.body, values)
	}));

/** What the potential-project prompt answers: 3–5 one-sentence app ideas. */
export const PROJECTS_ANSWER = {
	kind: 'object',
	fields: { projects: { kind: 'text', many: true } }
} as const;
/** What the prompt is given about a company: typed, so the prompt reads the same evidence every time. */
export type ProjectsEvidence = {
	readonly company: {
		readonly name: string;
		readonly website: string | null;
		readonly industry: string | null;
		readonly description: string | null;
	};
	readonly research: string;
	readonly kept: readonly string[];
};
export const PROJECTS_RULES = [
	{ expression: 'size(projects) >= 3', message: 'propose at least 3 projects' },
	{ expression: 'size(projects) <= 5', message: 'propose at most 5 projects' }
] as const;

// ── Apollo ──

const ApolloConfiguration = Schema.Struct({
	email_account_id: Schema.optionalKey(Schema.NullOr(Schema.String))
});
/** The one active Apollo account and its mailbox; `null` when none or several are active (ambiguous routing). */
export const apolloAccount = Effect.fnUntraced(function* (ctx: Pick<AutomationCtx, 'query'>) {
	const accounts = (yield* ctx.query({
		sys_integration: {
			where: { integration: { eq: 'apollo' }, active: { eq: true } },
			fields: ['integration', 'configuration'],
			limit: 2
		}
	})).sys_integration.rows;
	const [account] = accounts;
	if (account === undefined || accounts.length > 1) return null;
	return {
		instance: instance_id('apollo', account),
		email_account_id: Option.match(
			Schema.decodeUnknownOption(ApolloConfiguration)(account.configuration),
			{ onNone: () => null, onSome: (configuration) => configuration.email_account_id ?? null }
		)
	};
});

const html = (text: string) =>
	text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('\n', '<br>');

/**
 * The sequence's steps as Apollo's `emailer_steps` (Create/Update a Sequence): Apollo's own `{{first_name}}` and
 * `{{company}}`, the sender filled in, and `{{potential_projects}}` as the custom field's placeholder. Apollo waits
 * `wait_time` days after the previous step.
 */
export const apolloSteps = (
	steps: readonly Step[],
	settings: { readonly sender_name: string | null; readonly projects_variable: string }
) => {
	const values: Values = {
		first_name: '{{first_name}}',
		company: '{{company}}',
		potential_projects: settings.projects_variable,
		sender_name: settings.sender_name ?? ''
	};
	let previous = 0;
	return ordered(steps).map((step, index) => {
		const wait_time = step.day_offset - previous;
		previous = step.day_offset;
		const body = render(step.body, values);
		return step.channel === 'call'
			? { position: index + 1, type: 'call', wait_mode: 'day', wait_time, note: body }
			: {
					position: index + 1,
					type: 'auto_email',
					wait_mode: 'day',
					wait_time,
					emailer_touches: [
						{
							type: index === 0 ? 'new_thread' : 'reply_to_thread',
							status: 'approved',
							emailer_template: {
								subject: render(step.subject ?? '', values),
								body_html: html(body)
							}
						}
					]
				};
	});
};

/** Create a Sequence's answer. */
export const ApolloSequence = Schema.Struct({
	emailer_campaign: Schema.Struct({ id: Schema.String })
});
/** Create a Custom Field's answer. */
export const ApolloField = Schema.Struct({
	typed_custom_fields: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String }))
});
const ApolloContactRow = Schema.Struct({
	id: Schema.String,
	email: Schema.optionalKey(Schema.NullOr(Schema.String))
});
/** Bulk Create Contacts' answer: new contacts and the ones Apollo already had. */
export const ApolloContacts = Schema.Struct({
	created_contacts: Schema.Array(ApolloContactRow),
	existing_contacts: Schema.Array(ApolloContactRow)
});
/** Add Contacts to a Sequence's answer: the contacts Apollo skipped, with why. */
export const ApolloEnrolled = Schema.Struct({
	skipped_contact_ids: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Json)))
});
/** Search for Outreach Emails' page of a sequence's messages. */
export const ApolloMessages = Schema.Struct({
	emailer_messages: Schema.Array(
		Schema.Struct({
			contact_id: Schema.NullOr(Schema.String),
			completed_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
			campaign_position: Schema.optionalKey(Schema.NullOr(Schema.Number)),
			replied: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
			bounce: Schema.optionalKey(Schema.NullOr(Schema.Boolean))
		})
	),
	pagination: Schema.optionalKey(Schema.Struct({ total_pages: Schema.Number }))
});
export type ApolloMessage = (typeof ApolloMessages.Type)['emailer_messages'][number];

/** Each Apollo contact's progress from its sequence messages: the furthest step sent (completed), a reply, a bounce. */
export const progress = (messages: readonly ApolloMessage[], unsubscribed: ReadonlySet<string>) => {
	const by = new Map<
		string,
		{ step: number; replied: boolean; stopped: 'bounced' | 'unsubscribed' | null }
	>();
	for (const message of messages) {
		if (message.contact_id == null) continue;
		const seen = by.get(message.contact_id) ?? { step: 0, replied: false, stopped: null };
		const sent = message.completed_at != null;
		by.set(message.contact_id, {
			step: sent ? Math.max(seen.step, message.campaign_position ?? 0) : seen.step,
			replied: seen.replied || message.replied === true,
			stopped: message.bounce === true ? 'bounced' : seen.stopped
		});
	}
	for (const id of unsubscribed)
		by.set(id, {
			...(by.get(id) ?? { step: 0, replied: false }),
			stopped: 'unsubscribed'
		});
	return by;
};

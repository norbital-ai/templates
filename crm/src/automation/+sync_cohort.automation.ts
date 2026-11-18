import { Effect, Schema } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { apolloAccount, ApolloMessages, type ApolloMessage, progress } from '../lib/outreach.js';

/** Pages of a sequence's messages read per run, 100 each. */
// ponytail: 1000 messages a sync; page by `completed_at` if a cohort outgrows it
const PAGES = 10;

/**
 * Brings a launched cohort's progress back from Apollo: each member's furthest completed step, a reply, a bounce and an
 * unsubscribe, read from the sequence's outreach emails (Search for Outreach Emails, https://docs.apollo.io/reference/
 * search-for-outreach-emails) in one paged read per cohort, never per lead. A call step leaves no email, so `step`
 * counts emails sent. A booked meeting is the person's to record. Started by a person; Norbius asks first.
 */
export default automation({
	description: 'Syncs a cohort’s Apollo progress: step reached, replies, bounces and unsubscribes.',
	input: { cohort: { kind: 'ref', to: 'cohorts' } },
	policies: ['hq_automation'],
	concurrency: { max: 1 },
	agent: 'confirm',
	run: function* (input, ctx) {
		const apollo = yield* apolloAccount(ctx);
		if (apollo === null) return yield* ctx.refuse('errors.apollo_account');
		const read = yield* ctx.query({
			cohorts: {
				where: { id: { eq: input.cohort } },
				fields: ['apollo_sequence_id', 'revision'],
				limit: 1
			},
			cohort_members: {
				where: { cohort: { eq: input.cohort } },
				fields: ['apollo_contact_id', 'step', 'replied', 'stopped', 'revision']
			}
		});
		const cohort = read.cohorts.rows[0];
		if (cohort === undefined) return;
		const sequence = cohort.apollo_sequence_id ?? null;
		if (sequence === null) return yield* ctx.refuse('errors.cohort_not_launched');
		const search = Effect.fnUntraced(function* (filter: Readonly<Record<string, string>>) {
			const messages: ApolloMessage[] = [];
			for (let page = 1; page <= PAGES; page++) {
				const answer = yield* ctx
					.request(apollo.instance, {
						method: 'GET',
						path: '/api/v1/emailer_messages/search',
						query: { 'emailer_campaign_ids[]': sequence, ...filter, page, per_page: 100 },
						output: { kind: 'json' }
					})
					.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ApolloMessages)));
				messages.push(...answer.emailer_messages);
				if (page >= (answer.pagination?.total_pages ?? 1)) break;
			}
			return messages;
		});
		const [messages, unsubscribed] = yield* Effect.all([
			search({}),
			search({ 'emailer_message_stats[]': 'unsubscribed' })
		]);
		const by = progress(
			messages,
			new Set(unsubscribed.flatMap((message) => message.contact_id ?? []))
		);
		const updates = read.cohort_members.rows.flatMap((member) => {
			const seen = member.apollo_contact_id == null ? undefined : by.get(member.apollo_contact_id);
			if (seen === undefined) return [];
			const step = Math.max(member.step ?? 0, seen.step);
			const replied = member.replied || seen.replied;
			const stopped = member.stopped ?? seen.stopped;
			return step === (member.step ?? 0) && replied === member.replied && stopped === member.stopped
				? []
				: [
						{
							target: { id: member.id, revision: member.revision },
							set: { step, replied, stopped }
						}
					];
		});
		yield* ctx.act({
			'cohort_members.update': updates,
			'cohorts.update': [
				{ target: { id: cohort.id, revision: cohort.revision }, set: { synced_at: ctx.now } }
			]
		});
		yield* ctx.progress({ text: `${updates.length} leads updated` });
	}
});

import { Effect, Option, Schema } from 'effect';
import { automation, instance_id, type Json } from '@norbital-ai/bolt';
import {
	ApolloPage,
	companyKey,
	IngestSheets,
	leadsFromApollo,
	leadsFromSheet,
	planLeads,
	type Lead
} from '../lib/leads.js';

/** An Apollo connection's configuration: the labels whose contacts are leads (all saved contacts without one). */
const ApolloConfiguration = Schema.Struct({
	label_ids: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String)))
});
/** Apollo pages read per connection and run. */
// ponytail: re-reads the newest pages each day and relies on dedupe; keep a cursor if a list grows past 500 a day
const APOLLO_PAGES = 5;

/**
 * Leads into the one company table: an uploaded CSV or spreadsheet, or (without a file, and every morning) each active
 * Apollo connection's saved contacts. Every lead goes through the same plan: one company per domain and `company_key`,
 * one PIC per email; new companies are created as leads owned by the starter (or `owner`) with their PICs, and
 * researched by their create effect. A company another write stored meanwhile refuses the act (the companies
 * constraints), and the next run joins it.
 */
export default automation({
	description:
		'Imports leads from a CSV upload or Apollo, deduplicated by company domain and PIC email.',
	on: [{ cron: '0 7 * * *', rest: '7d' }],
	input: {
		file: {
			kind: 'file',
			accept: [
				'text/csv',
				'application/vnd.ms-excel',
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			],
			max: '5MiB',
			optional: true
		},
		owner: { kind: 'ref', to: 'sys_user', optional: true }
	},
	policies: ['hq_automation'],
	concurrency: { max: 1 },
	agent: 'confirm',
	run: function* (input, ctx) {
		const trigger = ctx.trigger;
		const owner =
			input.owner ??
			(trigger.kind === 'person' && trigger.actor.kind === 'member' ? trigger.actor.id : null);
		const leads: Lead[] = [];
		if (input.file != null) {
			const read = yield* ctx.convert.ingest(input.file);
			const sheet =
				read.kind === 'data'
					? Option.getOrUndefined(Schema.decodeUnknownOption(IngestSheets)(read.json))?.sheets[0]
					: undefined;
			if (sheet === undefined) return yield* ctx.refuse('errors.leads_unreadable');
			leads.push(...leadsFromSheet(sheet));
		} else {
			const accounts = (yield* ctx.query({
				sys_integration: {
					where: { integration: { eq: 'apollo' }, active: { eq: true } },
					fields: ['integration', 'configuration']
				}
			})).sys_integration.rows;
			for (const account of accounts) {
				const label_ids = Option.match(
					Schema.decodeUnknownOption(ApolloConfiguration)(account.configuration),
					{
						onNone: () => [],
						onSome: (configuration) => configuration.label_ids ?? []
					}
				);
				for (let page = 1; page <= APOLLO_PAGES; page++) {
					const body: Json = {
						page,
						per_page: 100,
						sort_by_field: 'contact_updated_at',
						sort_ascending: false,
						...(label_ids.length > 0 ? { label_ids } : {})
					};
					const answer = yield* ctx
						.request(instance_id('apollo', account), {
							method: 'POST',
							path: '/api/v1/contacts/search',
							body,
							output: { kind: 'json' }
						})
						.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ApolloPage)));
					leads.push(...leadsFromApollo(answer.contacts));
					if (page >= (answer.pagination?.total_pages ?? 1)) break;
				}
			}
		}
		if (leads.length === 0) return;
		const domains = [
			...new Set(leads.flatMap((lead) => (lead.domain === null ? [] : [lead.domain])))
		];
		const keys = [...new Set(leads.map((lead) => companyKey(lead.company)))];
		const emails = [...new Set(leads.flatMap((lead) => (lead.email === null ? [] : [lead.email])))];
		const stored = yield* ctx.query({
			companies: {
				where: { or: [{ domain: { in: domains } }, { company_key: { in: keys } }] },
				fields: ['company_key', 'domain']
			},
			contacts: { output: 'crm', where: { email_key: { in: emails } }, fields: ['email_key'] }
		});
		const plan = planLeads(
			leads,
			{
				companies: stored.companies.rows,
				emails: new Set(
					stored.contacts.rows.flatMap((row) => (row.email_key == null ? [] : [row.email_key]))
				)
			},
			{ source: input.file != null ? 'csv' : 'apollo', owner }
		);
		if (plan.companies.length > 0 || plan.contacts.length > 0)
			yield* ctx.act({ 'companies.create': plan.companies, 'contacts.create': plan.contacts });
		yield* ctx.progress({
			text: `${plan.companies.length} new leads, ${plan.contacts.length} PICs added to known companies, ${plan.skipped} duplicates skipped`
		});
	}
});

import { Array as Arr, Effect, Schema } from 'effect';
import { automation } from '@norbital-ai/bolt';
import {
	apolloAccount,
	ApolloContacts,
	ApolloEnrolled,
	ApolloField,
	ApolloSequence,
	apolloSteps,
	bullets
} from '../lib/outreach.js';

/** Apollo's bulk contact endpoints take at most 100 contacts a call. */
const BATCH = 100;

/**
 * Sends a cohort its sequence through Apollo (https://docs.apollo.io/reference). While the cohort is a draft, its
 * sequence's steps are pushed to its Apollo sequence (created, and its id stored, when the cohort names none), so
 * The workspace is the only place a template is authored. Every member's PIC becomes (or joins) an Apollo contact whose
 * `potential_projects` custom field holds the bullets of their company's kept projects, and is added to the sequence,
 * sending from the account's mailbox. A cohort already launched only enrols members added since. Started by a person;
 * Norbius asks first.
 */
export default automation({
	description:
		'Launches a cohort: pushes its sequence to Apollo, sets each lead’s potential projects and enrols them.',
	input: { cohort: { kind: 'ref', to: 'cohorts' } },
	policies: ['hq_automation'],
	concurrency: { max: 1 },
	agent: 'confirm',
	run: function* (input, ctx) {
		const apollo = yield* apolloAccount(ctx);
		if (apollo === null) return yield* ctx.refuse('errors.apollo_account');
		const mailbox = apollo.email_account_id;
		if (mailbox === null) return yield* ctx.refuse('errors.apollo_mailbox');
		const read = yield* ctx.query({
			cohorts: {
				where: { id: { eq: input.cohort } },
				fields: ['name', 'status', 'apollo_sequence_id', 'revision'],
				limit: 1,
				sequence: { fields: ['name', 'steps'] }
			},
			cohort_members: {
				where: { cohort: { eq: input.cohort } },
				fields: ['apollo_contact_id', 'enrolled_on', 'revision'],
				contact: { fields: ['full_name', 'email'] },
				company: { fields: ['name'] }
			},
			outreach_settings: {
				fields: ['sender_name', 'apollo_projects_variable', 'apollo_field_id', 'revision'],
				limit: 1
			}
		});
		const cohort = read.cohorts.rows[0];
		const settings = read.outreach_settings.rows[0];
		if (cohort === undefined || cohort.sequence === null) return;
		if (cohort.status === 'done') return yield* ctx.refuse('errors.cohort_done');
		if (settings === undefined) return yield* ctx.refuse('errors.outreach_settings_missing');
		// a member whose PIC or company the run cannot read is left out
		const members = read.cohort_members.rows.flatMap(({ contact, company, ...member }) =>
			contact === null || company === null ? [] : [{ ...member, contact, company }]
		);
		if (members.length === 0) return yield* ctx.refuse('errors.cohort_empty');
		const kept = (yield* ctx.query({
			potential_projects: {
				where: {
					company: { in: [...new Set(members.map((member) => member.company.id))] },
					status: { eq: 'kept' }
				},
				fields: ['company', 'summary', 'rank', 'status']
			}
		})).potential_projects.rows;

		// the custom field the step bodies reference, created once; each id is stored at once, so a rerun reuses it
		let field = settings.apollo_field_id ?? null;
		if (field === null) {
			const created = yield* ctx
				.request(apollo.instance, {
					method: 'POST',
					path: '/api/v1/fields',
					body: { label: 'potential_projects', modality: 'contact', type: 'textarea' },
					output: { kind: 'json' }
				})
				.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ApolloField)));
			field = created.typed_custom_fields[0].id;
			yield* ctx.act({
				'outreach_settings.update': [
					{
						target: { id: settings.id, revision: settings.revision },
						set: { apollo_field_id: field }
					}
				]
			});
		}

		// a draft's steps go to Apollo: the cohort's sequence is created (and named on the cohort) or replaced
		let sequence = cohort.apollo_sequence_id ?? null;
		if (cohort.status === 'draft') {
			const emailer_steps = apolloSteps(cohort.sequence.steps, {
				sender_name: settings.sender_name ?? null,
				projects_variable: settings.apollo_projects_variable
			});
			if (sequence === null) {
				const created = yield* ctx
					.request(apollo.instance, {
						method: 'POST',
						path: '/api/v1/sequences',
						body: { name: cohort.name, active: true, emailer_steps },
						output: { kind: 'json' }
					})
					.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ApolloSequence)));
				sequence = created.emailer_campaign.id;
				yield* ctx.act({
					'cohorts.update': [
						{
							target: { id: cohort.id, revision: cohort.revision },
							set: { apollo_sequence_id: sequence }
						}
					]
				});
			} else
				yield* ctx.request(apollo.instance, {
					method: 'PUT',
					path: `/api/v1/sequences/${encodeURIComponent(sequence)}`,
					body: { active: true, emailer_steps },
					output: { kind: 'json' }
				});
		}
		if (sequence === null) return yield* ctx.refuse('errors.cohort_not_launched');

		// each PIC as an Apollo contact (an existing one is matched by Apollo's dedupe, by email), then its bullets
		const sent = members.map((member) => ({
			member,
			projects: bullets(kept.filter((project) => project.company === member.company.id))
		}));
		const apolloIds = new Map<string, string>();
		for (const batch of Arr.chunksOf(
			sent.filter(({ member }) => member.apollo_contact_id == null && member.contact.email != null),
			BATCH
		)) {
			const answer = yield* ctx
				.request(apollo.instance, {
					method: 'POST',
					path: '/api/v1/contacts/bulk_create',
					body: {
						run_dedupe: true,
						contacts: batch.map(({ member }) => {
							const [first_name = '', ...rest] = member.contact.full_name.trim().split(/\s+/);
							return {
								first_name,
								last_name: rest.join(' '),
								email: member.contact.email,
								organization_name: member.company.name
							};
						})
					},
					output: { kind: 'json' }
				})
				.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ApolloContacts)));
			for (const contact of [...answer.created_contacts, ...answer.existing_contacts])
				if (contact.email != null) apolloIds.set(contact.email.toLowerCase(), contact.id);
		}
		const linked = sent.flatMap(({ member, projects }) => {
			const id =
				member.apollo_contact_id ?? apolloIds.get(member.contact.email?.toLowerCase() ?? '');
			return id === undefined ? [] : [{ member, projects, id }];
		});
		const fieldId = field;
		for (const batch of Arr.chunksOf(linked, BATCH))
			yield* ctx.request(apollo.instance, {
				method: 'POST',
				path: '/api/v1/contacts/bulk_update',
				body: {
					contact_attributes: batch.map(({ id, projects }) => ({
						id,
						typed_custom_fields: { [fieldId]: projects }
					}))
				},
				output: { kind: 'json' }
			});

		// enrol the ones not yet enrolled; Apollo names the contacts it skipped (in another sequence, no email…)
		const enrolling = linked.filter(({ member }) => member.enrolled_on == null);
		const skipped = new Set<string>();
		for (const batch of Arr.chunksOf(enrolling, BATCH)) {
			const answer = yield* ctx
				.request(apollo.instance, {
					method: 'POST',
					path: `/api/v1/emailer_campaigns/${encodeURIComponent(sequence)}/add_contact_ids`,
					body: {
						emailer_campaign_id: sequence,
						contact_ids: batch.map(({ id }) => id),
						send_email_from_email_account_id: mailbox
					},
					output: { kind: 'json' }
				})
				.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ApolloEnrolled)));
			for (const id of Object.keys(answer.skipped_contact_ids ?? {})) skipped.add(id);
		}
		const now = (yield* ctx.query({
			cohorts: { where: { id: { eq: cohort.id } }, fields: ['revision'], limit: 1 }
		})).cohorts.rows[0];
		yield* ctx.act({
			'cohort_members.update': linked.map(({ member, projects, id }) => ({
				target: { id: member.id, revision: member.revision },
				set: {
					apollo_contact_id: id,
					projects_sent: projects || null,
					...(member.enrolled_on == null && !skipped.has(id) ? { enrolled_on: ctx.today } : {})
				}
			})),
			'cohorts.update':
				now === undefined || cohort.status !== 'draft'
					? []
					: [{ target: { id: cohort.id, revision: now.revision }, set: { status: 'launched' } }]
		});
		const enrolled = enrolling.filter(({ id }) => !skipped.has(id)).length;
		yield* ctx.progress({
			text: `${enrolled} leads enrolled, ${skipped.size} skipped by Apollo, ${members.length - linked.length} without an email`
		});
	}
});

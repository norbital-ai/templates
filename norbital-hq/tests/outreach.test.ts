/**
 * Cold outreach through a fake Apollo: research proposes potential projects through the runtime prompt, a sequence
 * renders per lead, launching enrols a cohort and sets each lead's projects on its Apollo contact, the sync brings
 * progress back, and a lead is in at most one active cohort.
 */
import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { JobResult, type Caller } from '@norbital-ai/bolt-cli/test';
import { apolloSteps, bullets, leadValues, renderSteps } from '../src/lib/outreach.js';
import { answeringModel } from './model.js';
import { idOf, pageOf, recordOf, runRows, targetOf, workspace } from './workspace.js';

const PROMPT = 'Propose apps for this logistics lead (test prompt v1).';
const STEPS = [
	{ day_offset: 3, channel: 'call', body: 'Call {{first_name}} about {{company}}.' },
	{
		day_offset: 0,
		channel: 'email',
		subject: 'Ideas for {{company}}',
		body: 'Hi {{first_name}},\n\n{{potential_projects}}\n\n{{sender_name}}'
	}
] as const;

/** An Apollo request as the fake link receives it. */
const ApolloOp = Schema.Struct({
	method: Schema.String,
	path: Schema.String,
	query: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
	body: Schema.optionalKey(Schema.Json)
});
type ApolloOp = typeof ApolloOp.Type;
const BulkUpdate = Schema.Struct({
	contact_attributes: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			typed_custom_fields: Schema.Record(Schema.String, Schema.String)
		})
	)
});
const Enrol = Schema.Struct({
	contact_ids: Schema.Array(Schema.String),
	send_email_from_email_account_id: Schema.String
});
const BulkCreate = Schema.Struct({
	contacts: Schema.Array(Schema.Struct({ email: Schema.String }))
});
const SequenceBody = Schema.Struct({
	emailer_steps: Schema.Array(Schema.Struct({ type: Schema.String, wait_time: Schema.Number }))
});

/** A scripted Apollo: answers each endpoint launch and sync call, recording every request. */
const fakeApollo = (messages: Json[] = []) => {
	const ops: ApolloOp[] = [];
	const answer = (_instance: string, raw: Json) =>
		Effect.gen(function* () {
			const op = Schema.decodeUnknownSync(ApolloOp)(raw);
			ops.push(op);
			const ok = (body: Json) => ({ status: 200, body });
			if (op.path === '/api/v1/fields') return ok({ typed_custom_fields: [{ id: 'field-1' }] });
			if (op.path === '/api/v1/sequences') return ok({ emailer_campaign: { id: 'seq-1' } });
			if (op.path === '/api/v1/contacts/bulk_create') {
				const { contacts } = Schema.decodeUnknownSync(BulkCreate)(op.body);
				return ok({
					created_contacts: contacts.map((c) => ({ id: `apollo:${c.email}`, email: c.email })),
					existing_contacts: []
				});
			}
			if (op.path.endsWith('/add_contact_ids')) return ok({ skipped_contact_ids: {} });
			if (op.path === '/api/v1/emailer_messages/search')
				return ok({
					emailer_messages:
						op.query?.['emailer_message_stats[]'] === 'unsubscribed'
							? messages.filter((m) => m !== null && typeof m === 'object' && 'unsubscribed' in m)
							: messages,
					pagination: { total_pages: 1 }
				});
			// enrichment and the rest: nothing found
			return ok({ organization: null, person: null, contacts: [] });
		});
	return { ops, answer };
};

const setup = Effect.fnUntraced(function* (admin: Caller) {
	const apollo = yield* admin.act({
		'sys_integration.create': [
			{ integration: 'apollo', name: 'Apollo', configuration: { email_account_id: 'mailbox-1' } }
		]
	});
	if (apollo.kind !== 'committed') throw new Error(JSON.stringify(apollo));
	const created = yield* admin.act({
		'outreach_settings.create': [{ projects_prompt: PROMPT, sender_name: 'Wen' }],
		'sequences.create': [{ name: 'Cold', steps: [...STEPS] }],
		'companies.create': [
			{
				name: 'Harbour',
				domain: 'harbour.test',
				contacts: [
					{ full_name: 'Ana Lim', email: 'ana@harbour.test', job_title: 'Director', phone: '1' }
				]
			},
			{
				name: 'Quay',
				domain: 'quay.test',
				contacts: [{ full_name: 'Ben Tan', email: 'ben@quay.test', job_title: 'Owner', phone: '2' }]
			}
		]
	});
	if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
	const harbour = recordOf(created.records, 'companies', 0).id;
	const quay = recordOf(created.records, 'companies', 1).id;
	const sequence = recordOf(created.records, 'sequences').id;
	const [ana, ben] = pageOf(
		yield* admin.query({
			contacts: { output: 'crm', fields: ['email'], order_by: { email: 'asc' } }
		}),
		'contacts'
	).rows.map((row) => Schema.decodeUnknownSync(idOf('contacts'))(row.id));
	if (ana === undefined || ben === undefined) throw new Error('Missing fixture PICs');
	yield* admin.act({
		'potential_projects.create': [
			{ company: harbour, summary: 'Berth booking board', rank: 2, status: 'kept' },
			{ company: harbour, summary: 'Crane maintenance log', rank: 1, status: 'kept' },
			{ company: harbour, summary: 'Discarded idea', rank: 3, status: 'discarded' },
			{ company: quay, summary: 'Driver dispatch board', rank: 1, status: 'kept' }
		]
	});
	return { harbour, quay, sequence, ana, ben };
});

const cohortOf = Effect.fnUntraced(function* (
	admin: Caller,
	name: string,
	sequence: Id<'sequences'>,
	contacts: readonly Id<'contacts'>[]
) {
	const created = yield* admin.act({ 'cohorts.create': [{ name, sequence }] });
	if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
	const cohort = recordOf(created.records, 'cohorts').id;
	if (contacts.length > 0)
		yield* admin.act({
			'cohort_members.create': contacts.map((contact) => ({ cohort, contact }))
		});
	return cohort;
});

const members = (admin: Caller) =>
	Effect.map(
		admin.query({
			cohort_members: {
				fields: ['enrolled_on', 'step', 'replied', 'stopped', 'projects_sent', 'apollo_contact_id'],
				contact: { fields: ['full_name'] }
			}
		}),
		(answer) =>
			Object.fromEntries(
				pageOf(answer, 'cohort_members').rows.map((row) => [
					Schema.decodeUnknownSync(Schema.Struct({ full_name: Schema.String }))(row['contact'])
						.full_name,
					row
				])
			)
	);

describe('a sequence renders per lead', () => {
	it('bullets only the kept projects, by rank', () => {
		expect(
			bullets([
				{ summary: 'B', rank: 2, status: 'kept' },
				{ summary: 'A', rank: 1, status: 'kept' },
				{ summary: 'X', rank: 0, status: 'discarded' }
			])
		).toBe('- A\n- B');
	});
	it('fills each lead’s values, in send order', () => {
		const [email, call] = renderSteps(
			STEPS,
			leadValues({ full_name: 'Ana Lim', company: 'Harbour', projects: '- A', sender_name: 'Wen' })
		);
		expect(email).toMatchObject({ subject: 'Ideas for Harbour', body: 'Hi Ana,\n\n- A\n\nWen' });
		expect(call?.body).toBe('Call Ana about Harbour.');
	});
	it('pushes Apollo’s own placeholders, waits relative to the previous step', () => {
		const steps = apolloSteps(STEPS, {
			sender_name: 'Wen',
			projects_variable: '{{potential_projects}}'
		});
		expect(steps.map((step) => [step.type, step.wait_time])).toEqual([
			['auto_email', 0],
			['call', 3]
		]);
		expect(JSON.stringify(steps[0])).toContain('Hi {{first_name}},<br><br>{{potential_projects}}');
	});
});

it.live('research proposes potential projects through the runtime prompt', () =>
	Effect.gen(function* () {
		let version = 1;
		const model = answeringModel((prompt) =>
			prompt.includes('test prompt')
				? {
						projects: [`Idea one v${version}`, `Idea two v${version}`, `Idea three v${version}`]
					}
				: null
		);
		const t = yield* workspace({ ports: model.ports });
		const admin = yield* t.as(t.admin);
		const settings = yield* admin.act({
			'outreach_settings.create': [{ projects_prompt: PROMPT }]
		});
		if (settings.kind !== 'committed') throw new Error(JSON.stringify(settings));
		const created = yield* admin.act({ 'companies.create': [{ name: 'Harbour' }] });
		if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
		const company = recordOf(created.records, 'companies').id;
		yield* t.run_due();
		const projects = () =>
			Effect.map(
				admin.query({
					potential_projects: {
						fields: ['summary', 'rank', 'status', 'prompt_version'],
						order_by: { rank: 'asc' }
					}
				}),
				(answer) => pageOf(answer, 'potential_projects').rows
			);
		const first = yield* projects();
		expect(first.map((row) => [row['summary'], row['status'], row['prompt_version']])).toEqual([
			['Idea one v1', 'proposed', 1],
			['Idea two v1', 'proposed', 1],
			['Idea three v1', 'proposed', 1]
		]);
		expect(model.prompts.some((prompt) => prompt.includes(PROMPT))).toBe(true);

		// a kept proposal survives re-research; the rest are replaced under the edited prompt's version
		const kept = Schema.decodeUnknownSync(idOf('potential_projects'))(first[0]?.id);
		yield* admin.act({
			'potential_projects.update': [
				{ target: yield* targetOf(t, 'potential_projects', kept), set: { status: 'kept' } }
			]
		});
		const row = Schema.decodeUnknownSync(idOf('outreach_settings'))(
			pageOf(
				yield* admin.query({ outreach_settings: { fields: ['prompt_version'] } }),
				'outreach_settings'
			).rows[0]?.id
		);
		yield* admin.act({
			'outreach_settings.update': [
				{
					target: yield* targetOf(t, 'outreach_settings', row),
					set: { projects_prompt: `${PROMPT} Edited.` }
				}
			]
		});
		version = 2;
		yield* admin.run('research_lead', { company }, JobResult);
		yield* t.run_due();
		expect(
			(yield* projects()).map((p) => [p['summary'], p['status'], p['prompt_version']])
		).toEqual([
			['Idea one v1', 'kept', 1],
			['Idea one v2', 'proposed', 2],
			['Idea two v2', 'proposed', 2],
			['Idea three v2', 'proposed', 2]
		]);
	}).pipe(Effect.scoped)
);

it.live('launching pushes the steps, sets each lead’s projects on Apollo and enrols them', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const apollo = fakeApollo();
		t.fakes.links.answer = apollo.answer;
		const { sequence, ana, ben } = yield* setup(admin);
		const cohort = yield* cohortOf(admin, 'November', sequence, [ana, ben]);
		// The company directory reads both relations needed by a membership's native label.
		expect(
			yield* admin.query({
				companies: {
					fields: ['name'],
					cohort_memberships: {
						fields: ['cohort', 'contact'],
						cohort: { fields: ['name'] },
						contact: { fields: ['full_name'] }
					}
				}
			})
		).toMatchObject({
			companies: {
				rows: expect.arrayContaining([
					expect.objectContaining({
						cohort_memberships: expect.arrayContaining([
							expect.objectContaining({
								cohort: expect.objectContaining({ name: 'November' }),
								contact: expect.objectContaining({ full_name: 'Ana Lim' })
							})
						])
					})
				])
			}
		});

		yield* t.run_due();
		yield* admin.run('launch_cohort', { cohort }, JobResult);
		yield* t.run_due();
		expect((yield* runRows(t, 'launch_cohort')).map((run) => run.state)).toEqual(['succeeded']);

		const pushed = Schema.decodeUnknownSync(SequenceBody)(
			apollo.ops.find((op) => op.path === '/api/v1/sequences')?.body
		);
		expect(pushed.emailer_steps.map((step) => step.type)).toEqual(['auto_email', 'call']);
		expect(apollo.ops.some((op) => op.path === '/api/v1/fields')).toBe(true);
		const updated = Schema.decodeUnknownSync(BulkUpdate)(
			apollo.ops.find((op) => op.path === '/api/v1/contacts/bulk_update')?.body
		);
		expect(
			Object.fromEntries(
				updated.contact_attributes.map((c) => [c.id, c.typed_custom_fields['field-1']])
			)
		).toEqual({
			'apollo:ana@harbour.test': '- Crane maintenance log\n- Berth booking board',
			'apollo:ben@quay.test': '- Driver dispatch board'
		});
		const enrol = apollo.ops.find(
			(op) => op.path === '/api/v1/emailer_campaigns/seq-1/add_contact_ids'
		);
		const enrolled = Schema.decodeUnknownSync(Enrol)(enrol?.body);
		expect([...enrolled.contact_ids].sort()).toEqual([
			'apollo:ana@harbour.test',
			'apollo:ben@quay.test'
		]);
		expect(enrolled.send_email_from_email_account_id).toBe('mailbox-1');

		const rows = yield* members(admin);
		expect(rows['Ana Lim']).toMatchObject({
			apollo_contact_id: 'apollo:ana@harbour.test',
			projects_sent: '- Crane maintenance log\n- Berth booking board'
		});
		expect(rows['Ben Tan']?.['enrolled_on']).not.toBeNull();
		expect(
			pageOf(
				yield* admin.query({
					cohorts: { fields: ['status', 'apollo_sequence_id', 'member_count'] }
				}),
				'cohorts'
			).rows[0]
		).toMatchObject({ status: 'launched', apollo_sequence_id: 'seq-1', member_count: 2 });
	}).pipe(Effect.scoped)
);

it.live('the sync brings back each lead’s step, reply, bounce and unsubscribe', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const apollo = fakeApollo([
			{
				contact_id: 'apollo:ana@harbour.test',
				campaign_position: 1,
				completed_at: '2026-11-10T00:00:00Z',
				replied: true
			},
			{ contact_id: 'apollo:ana@harbour.test', campaign_position: 2, completed_at: null },
			{
				contact_id: 'apollo:ben@quay.test',
				campaign_position: 1,
				completed_at: '2026-11-10T00:00:00Z',
				bounce: true
			}
		]);
		t.fakes.links.answer = apollo.answer;
		const { sequence, ana, ben } = yield* setup(admin);
		const cohort = yield* cohortOf(admin, 'November', sequence, [ana, ben]);
		yield* admin.run('launch_cohort', { cohort }, JobResult);
		yield* t.run_due();
		yield* admin.run('sync_cohort', { cohort }, JobResult);
		yield* t.run_due();
		const rows = yield* members(admin);
		expect(rows['Ana Lim']).toMatchObject({ step: 1, replied: true, stopped: null });
		expect(rows['Ben Tan']).toMatchObject({ step: 1, replied: false, stopped: 'bounced' });
		expect(
			pageOf(
				yield* admin.query({
					cohorts: { fields: ['replied_count', 'stopped_count', 'synced_at'] }
				}),
				'cohorts'
			).rows[0]
		).toMatchObject({ replied_count: 1, stopped_count: 1 });
	}).pipe(Effect.scoped)
);

it.live('a lead is in one active cohort at a time', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const { sequence, ana, ben } = yield* setup(admin);
		const first = yield* cohortOf(admin, 'November', sequence, [ana]);

		// the same lead twice in the active cohort
		expect(
			yield* Effect.flip(admin.act({ 'cohort_members.create': [{ cohort: first, contact: ana }] }))
		).toMatchObject({ _tag: 'ActRefused' });

		// the lead in a second active cohort, while a free lead joins it
		const second = yield* cohortOf(admin, 'December', sequence, [ben]);
		const refused = yield* Effect.flip(
			admin.act({ 'cohort_members.create': [{ cohort: second, contact: ana }] })
		);
		expect(refused).toMatchObject({ _tag: 'ActRefused' });
		expect(refused.message).toContain('active cohort');

		// once the first cohort is done the lead may join another
		yield* admin.act({
			'cohorts.update': [{ target: yield* targetOf(t, 'cohorts', first), set: { status: 'done' } }]
		});
		const joined = yield* admin.act({
			'cohort_members.create': [{ cohort: second, contact: ana }]
		});
		expect(joined.kind).toBe('committed');
	}).pipe(Effect.scoped)
);

import { expect, it } from '@effect/vitest';
import { workspace, previewAs, recordOf, wireAct, targetOf } from './workspace.js';
import { Effect } from 'effect';

it.live('document previews prefer the job signatory and otherwise use the customer signatory', () =>
	Effect.gen(function* () {
		const t = yield* workspace({ now: '2026-09-30T02:00:00Z' });
		const admin = yield* t.as(t.admin);
		const templates = yield* admin.act({
			'template_documents.create': [
				{ title: 'Company terms', key: 'company_terms', body: '{{company}} — {{contact_name}}' },
				{
					title: 'Job terms',
					key: 'job_terms',
					scope: 'project',
					body: '{{company}} — {{contact_name}} — {{project}}'
				}
			]
		});
		if (templates.kind !== 'committed') throw new Error(JSON.stringify(templates));
		const customer = yield* admin.act({ 'companies.create': [{ name: 'Example Customer' }] });
		if (customer.kind !== 'committed') throw new Error(JSON.stringify(customer));
		const company = recordOf(customer.records, 'companies').id;
		const people = yield* admin.act({
			'contacts.create': [
				{ full_name: 'Casey Signer', company_id: company, company_signatory: true },
				{ full_name: 'Jordan Job Signer', company_id: company }
			]
		});
		if (people.kind !== 'committed') throw new Error(JSON.stringify(people));
		const casey = recordOf(people.records, 'contacts', 0).id;
		const jordan = recordOf(people.records, 'contacts', 1).id;
		const job = yield* admin.act({
			'projects.create': [
				{
					name: 'Example Job',
					company_id: company,
					signatory: jordan
				}
			]
		});
		if (job.kind !== 'committed') throw new Error(JSON.stringify(job));
		const project = recordOf(job.records, 'projects').id;
		expect(
			yield* previewAs(admin, { as_of: '2026-09-30', company, key: 'company_terms' })
		).toMatchObject({ contact: { id: casey }, body: 'Example Customer — Casey Signer' });
		expect(
			yield* previewAs(admin, { as_of: '2026-09-30', company, key: 'job_terms', project })
		).toMatchObject({
			contact: { id: jordan },
			body: 'Example Customer — Jordan Job Signer — Example Job'
		});
	}).pipe(Effect.scoped)
);

it.live('a signatory must be a contact of the customer or job it signs for, one per customer', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const customers = yield* admin.act({
			'companies.create': [{ name: 'Mine' }, { name: 'Other' }]
		});
		if (customers.kind !== 'committed') throw new Error(JSON.stringify(customers));
		const mine = recordOf(customers.records, 'companies', 0).id;
		const other = recordOf(customers.records, 'companies', 1).id;
		const outsider = yield* admin.act({
			'contacts.create': [
				{
					full_name: 'Outsider',
					company_id: other
				}
			]
		});
		if (outsider.kind !== 'committed') throw new Error(JSON.stringify(outsider));
		const contact = recordOf(outsider.records, 'contacts').id;
		expect(
			yield* Effect.flip(
				wireAct(t, t.admin, 'contacts.create', [{ full_name: 'Nobody', company_signatory: true }])
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			(yield* admin.act({
				'contacts.update': [
					{ target: yield* targetOf(t, 'contacts', contact), set: { company_signatory: true } }
				]
			})).kind
		).toBe('committed');
		expect(
			yield* Effect.flip(
				wireAct(t, t.admin, 'contacts.create', [
					{
						full_name: 'Second',
						company_id: other,
						company_signatory: true
					}
				])
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* Effect.flip(
				wireAct(t, t.admin, 'projects.create', [
					{
						name: 'Job',
						company_id: mine,
						signatory: contact
					}
				])
			)
		).toMatchObject({ _tag: 'ActRefused' });
	}).pipe(Effect.scoped)
);

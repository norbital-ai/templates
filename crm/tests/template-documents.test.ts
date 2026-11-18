import { JobResult } from '@norbital-ai/bolt-cli/test';
import { runAutomation } from '@norbital-ai/bolt-cli/test';
/**
 * The template catalogue: a document's preview renders the latest version of its key with current values; a signed
 * copy freezes the version and the values it was signed on, and is never edited; a template requires only placeholders
 * it uses; a job-scoped document is signed for a job.
 */
import { expect, it } from '@effect/vitest';
import {
	workspace,
	member,
	previewAs,
	recordOf,
	signedAs,
	wireAct,
	pageOf,
	targetOf
} from './workspace.js';
import { Effect } from 'effect';
import type { Kit } from '@norbital-ai/bolt-cli/test';

const signedCopy = Effect.fnUntraced(function* (t: Kit) {
	const upload = yield* (yield* t.as(t.admin)).upload('signed_documents.signed_copy', {
		name: 'signed.pdf',
		mime: 'application/pdf',
		bytes: new Uint8Array([37, 80, 68, 70])
	});
	if (upload.kind !== 'committed') throw new Error(JSON.stringify(upload));
	return upload.output;
});

it.live(
	'previews from the latest version of a key; a signed copy keeps the version and values it was signed on',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace({ now: '2026-10-01T02:00:00Z' });
			const admin = yield* t.as(t.admin);
			const created = yield* admin.act({ 'companies.create': [{ name: 'Example customer' }] });
			if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
			const company = recordOf(created.records, 'companies', 0).id;
			const configured = yield* admin.act({
				'template_documents.create': [
					{
						title: 'Example agreement',
						key: 'agreement',
						body: '# Agreement\n{{company}} ({{uen}}) on {{today}}',
						required: ['company', 'uen'],
						drafting_instructions: 'Confirm legal identity before sending.'
					}
				]
			});
			if (configured.kind !== 'committed') throw new Error(JSON.stringify(configured));
			const template = recordOf(configured.records, 'template_documents', 0).id;
			const before = yield* previewAs(admin, { as_of: '2026-10-01', key: 'agreement', company });
			expect(before).toMatchObject({
				body: '# Agreement\nExample customer ([uen]) on 2026-10-01',
				missing: ['uen']
			});

			const signed = yield* admin.act({
				'signed_documents.create': [
					{
						template_version: template,
						company,
						signed_on: '2026-09-28',
						signed_copy: yield* signedCopy(t)
					}
				]
			});
			if (signed.kind !== 'committed') throw new Error(JSON.stringify(signed));
			const id = recordOf(signed.records, 'signed_documents', 0).id;
			expect(
				pageOf(
					yield* admin.query({ signed_documents: { where: { id: { eq: id } }, limit: 1 } }),
					'signed_documents'
				).rows[0] ?? null
			).toMatchObject({
				title: 'Example agreement',
				template_version: template,
				terms: { company: 'Example customer', today: '2026-09-28' }
			});
			const frozen = yield* signedAs(admin, id);
			expect(frozen.body).toBe('# Agreement\nExample customer ([uen]) on 2026-09-28');
			// the date alone does not make a copy drift
			expect(frozen.key).toBe(before.key);

			expect(
				(yield* runAutomation(
					t,
					admin.run(
						'template_documents_new_version',
						{
							template_documents: [template],
							title: 'Revised agreement',
							body: '# Revised agreement for {{company}} ({{uen}})'
						},
						JobResult
					)
				)).state
			).toBe('succeeded');
			const after = yield* previewAs(admin, { as_of: '2026-10-01', key: 'agreement', company });
			expect(after.body).toBe('# Revised agreement for Example customer ([uen])');
			expect(after.key).not.toBe(frozen.key);
			// the signed copy still renders the version it was signed on
			expect((yield* signedAs(admin, id)).body).toBe(
				'# Agreement\nExample customer ([uen]) on 2026-09-28'
			);
			const versions = pageOf(
				yield* admin.query({ template_documents: { order_by: { version: 'asc' } } }),
				'template_documents'
			);
			expect(versions.rows.map((r) => [r.key, r.version, r.required])).toEqual([
				['agreement', 1, ['company', 'uen']],
				['agreement', 2, ['company', 'uen']]
			]);
			expect(versions.rows.map((r) => r.drafting_instructions)).toEqual([
				'Confirm legal identity before sending.',
				'Confirm legal identity before sending.'
			]);
			expect(
				yield* Effect.flip(
					wireAct(t, t.admin, 'template_documents.update', [
						{ target: yield* targetOf(t, 'template_documents', template), set: { body: ' ' } }
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					wireAct(t, t.admin, 'signed_documents.update', [
						{ target: yield* targetOf(t, 'signed_documents', id), set: { signed_on: '2026-09-01' } }
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
		}).pipe(Effect.scoped)
);

it.live('a template requires only placeholders it uses', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		expect(
			yield* Effect.flip(
				wireAct(t, t.admin, 'template_documents.create', [
					{
						title: 'Outreach',
						key: 'outreach',
						kind: 'email',
						subject: 'Hi {{contact_name}}',
						body: 'For {{company}}',
						required: ['uen']
					}
				])
			)
		).toMatchObject({ _tag: 'ActRefused' });
		const ok = yield* (yield* t.as(t.admin)).act({
			'template_documents.create': [
				{
					title: 'Outreach',
					key: 'outreach',
					kind: 'email',
					subject: 'Hi {{contact_name}}',
					body: 'For {{company}}',
					required: ['contact_name', 'company']
				}
			]
		});
		expect(ok.kind).toBe('committed');
	}).pipe(Effect.scoped)
);

it.live(
	'a job-scoped document renders the job’s values and is signed for a job of the company, never the company alone',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace({ now: '2026-10-01T02:00:00Z' });
			const admin = yield* t.as(t.admin);
			const company = yield* admin.act({ 'companies.create': [{ name: 'Example customer' }] });
			if (company.kind !== 'committed') throw new Error(JSON.stringify(company));
			const customer = recordOf(company.records, 'companies', 0).id;
			const contact = yield* admin.act({
				'contacts.create': [
					{
						full_name: 'Alex Example',
						job_title: 'Director',
						company_id: customer,
						company_signatory: true
					}
				]
			});
			if (contact.kind !== 'committed') throw new Error(JSON.stringify(contact));
			const job = yield* admin.act({
				'projects.create': [{ name: 'Customer demo', company_id: customer }]
			});
			if (job.kind !== 'committed') throw new Error(JSON.stringify(job));
			const project = recordOf(job.records, 'projects', 0).id;
			const body = '# Terms\n{{company}}: {{contact_name}}, {{contact_title}} — {{project}}';
			const template = yield* admin.act({
				'template_documents.create': [
					{ title: 'Job terms', key: 'job_terms', scope: 'project', body }
				]
			});
			if (template.kind !== 'committed') throw new Error(JSON.stringify(template));
			const version = recordOf(template.records, 'template_documents', 0).id;
			const rendered = yield* previewAs(admin, {
				as_of: '2026-10-01',
				key: 'job_terms',
				company: customer,
				project
			});
			expect(rendered).toMatchObject({
				body: '# Terms\nExample customer: Alex Example, Director — Customer demo',
				contact: { id: recordOf(contact.records, 'contacts', 0).id }
			});
			const signed_copy = yield* signedCopy(t);
			expect(
				yield* Effect.flip(
					admin.act({
						'signed_documents.create': [
							{ template_version: version, company: customer, signed_copy }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const signed = yield* admin.act({
				'signed_documents.create': [
					{ template_version: version, company: customer, project, signed_copy }
				]
			});
			if (signed.kind !== 'committed') throw new Error(JSON.stringify(signed));
			expect(
				pageOf(
					yield* admin.query({
						signed_documents: {
							where: { id: { eq: recordOf(signed.records, 'signed_documents', 0).id } },
							limit: 1
						}
					}),
					'signed_documents'
				).rows[0] ?? null
			).toMatchObject({
				project,
				terms: { project: 'Customer demo', contact_name: 'Alex Example' }
			});
		}).pipe(Effect.scoped)
);

it.live(
	'a signed commitment converts the same company; NDA does not, and mistaken uploads can be removed',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const admin = yield* t.as(t.admin);
			const companyResult = yield* admin.act({
				'companies.create': [{ name: 'Commitment company' }]
			});
			if (companyResult.kind !== 'committed') throw new Error(JSON.stringify(companyResult));
			const company = recordOf(companyResult.records, 'companies').id;
			const templates = yield* admin.act({
				'template_documents.create': [
					{ title: 'NDA', key: 'nda', body: '# NDA' },
					{ title: 'SOW', key: 'sow', body: '# SOW', commitment: true }
				]
			});
			if (templates.kind !== 'committed') throw new Error(JSON.stringify(templates));
			const nda = recordOf(templates.records, 'template_documents', 0).id;
			const sow = recordOf(templates.records, 'template_documents', 1).id;
			const signed_copy = yield* signedCopy(t);
			const stage = () =>
				admin.query({ companies: { where: { id: { eq: company } }, fields: ['stage'] } });
			expect(
				yield* Effect.flip(
					admin.act({
						'companies.update': [
							{ target: yield* targetOf(t, 'companies', company), set: { stage: 'client' } }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				(yield* admin.act({
					'signed_documents.create': [{ company, template_version: nda, signed_copy }]
				})).kind
			).toBe('committed');
			expect(pageOf(yield* stage(), 'companies').rows[0]).toMatchObject({
				id: company,
				stage: 'lead'
			});
			const signed = yield* admin.act({
				'signed_documents.create': [{ company, template_version: sow, signed_copy }]
			});
			if (signed.kind !== 'committed') throw new Error(JSON.stringify(signed));
			expect(pageOf(yield* stage(), 'companies').rows[0]).toMatchObject({
				id: company,
				stage: 'client'
			});
			expect(
				(yield* admin.act({
					'template_documents.update': [
						{
							target: yield* targetOf(t, 'template_documents', sow),
							set: { drafting_instructions: 'Use agreed milestone dates.' }
						}
					]
				})).kind
			).toBe('committed');
			expect(
				pageOf(
					yield* admin.query({ template_documents: { where: { id: { eq: sow } } } }),
					'template_documents'
				).rows[0]
			).toMatchObject({ body: '# SOW', drafting_instructions: 'Use agreed milestone dates.' });
			expect(
				(yield* admin.act({
					'signed_documents.delete': [
						{
							target: yield* targetOf(
								t,
								'signed_documents',
								recordOf(signed.records, 'signed_documents').id
							)
						}
					]
				})).kind
			).toBe('committed');
			expect(pageOf(yield* stage(), 'companies').rows[0]).toMatchObject({
				id: company,
				stage: 'qualified'
			});
		}).pipe(Effect.scoped)
);

it.live(
	'sales can edit drafting instructions while document revision retains its existing author permission',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const admin = yield* t.as(t.admin);
			const sales = yield* t.as(yield* member(t, ['sales', 'crm']));
			const created = yield* admin.act({
				'template_documents.create': [{ title: 'Terms', key: 'terms', body: '# Fixed terms' }]
			});
			if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
			const id = recordOf(created.records, 'template_documents').id;
			expect(
				(yield* sales.act({
					'template_documents.update': [
						{
							target: yield* targetOf(t, 'template_documents', id),
							set: { drafting_instructions: 'Confirm the signatory.' }
						}
					]
				})).kind
			).toBe('committed');
			expect(
				yield* Effect.flip(
					sales.run(
						'template_documents_new_version',
						{ template_documents: [id], title: 'Replaced terms', body: '# Different terms' },
						JobResult
					)
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				pageOf(
					yield* admin.query({ template_documents: { where: { id: { eq: id } } } }),
					'template_documents'
				).rows[0]
			).toMatchObject({ body: '# Fixed terms', drafting_instructions: 'Confirm the signatory.' });
		}).pipe(Effect.scoped)
);

it.live(
	'the provider signature is one native file on agreement settings, readable but not replaceable by sales',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const admin = yield* t.as(t.admin);
			const sales = yield* t.as(yield* member(t, ['sales', 'crm']));
			const uploaded = yield* admin.upload('agreement_settings.provider_signature', {
				name: 'example-signature.png',
				mime: 'image/png',
				bytes: new Uint8Array(
					Buffer.from(
						'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZgAAAABJRU5ErkJggg==',
						'base64'
					)
				)
			});
			if (uploaded.kind !== 'committed') throw new Error(JSON.stringify(uploaded));
			const created = yield* admin.act({
				'agreement_settings.create': [
					{
						provider_signatory_name: 'Sam',
						provider_signature: uploaded.output
					}
				]
			});
			if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
			const id = recordOf(created.records, 'agreement_settings').id;
			expect(
				pageOf(
					yield* sales.query({ agreement_settings: { fields: ['provider_signature'] } }),
					'agreement_settings'
				).rows[0]
			).toMatchObject({
				provider_signature: {
					id: uploaded.output.id,
					name: 'example-signature.png',
					mime: 'image/png'
				}
			});
			expect(
				yield* Effect.flip(
					sales.act({
						'agreement_settings.update': [
							{
								target: yield* targetOf(t, 'agreement_settings', id),
								set: { provider_signature: null }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
		}).pipe(Effect.scoped)
);

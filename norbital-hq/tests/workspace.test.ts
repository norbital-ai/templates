/** The data rules the apps rely on, through the real write pipeline. */
import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { ModelName } from '@norbital-ai/bolt';
import type { Kit, NativeActAnswer } from '@norbital-ai/bolt-cli/test';
import { workspace, wireAct, recordOf, nativeId, previewAs, pageOf } from './workspace.js';
const committedId = <const C extends ModelName>(o: NativeActAnswer, model: C) => {
	if (o.kind !== 'committed') throw new Error(JSON.stringify(o));
	return recordOf(o.records, model).id;
};
const fixture = Effect.fnUntraced(function* () {
	const t = yield* workspace({ now: '2026-10-01T02:00:00Z' });
	const admin = yield* t.as(t.admin);
	const company = committedId(
		yield* admin.act({ 'companies.create': [{ name: 'Harbourline Logistics' }] }),
		'companies'
	);
	const contact = committedId(
		yield* admin.act({
			'contacts.create': [
				{
					full_name: 'Marcus Lee',
					job_title: 'Head of operations',
					email: 'Marcus.Lee@Example.test',
					company_id: company,
					company_signatory: true
				}
			]
		}),
		'contacts'
	);
	const project = committedId(
		yield* admin.act({
			'projects.create': [{ name: 'Warehouse tracking app', company_id: company }]
		}),
		'projects'
	);
	return { t, company, contact, project };
});
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
	'a job-scoped document is signed for a job of the customer; a company-scoped one is not',
	() =>
		Effect.gen(function* () {
			const { t, company, project } = yield* fixture();
			const admin = yield* t.as(t.admin);
			const templates = yield* admin.act({
				'template_documents.create': [
					{ title: 'Scope', key: 'scope', scope: 'project', body: '# Scope of Work — {{project}}' },
					{ title: 'Terms', key: 'terms', body: '# Terms — {{company}}' }
				]
			});
			if (templates.kind !== 'committed') throw new Error(JSON.stringify(templates));
			const sow = recordOf(templates.records, 'template_documents', 0).id;
			const nda = recordOf(templates.records, 'template_documents', 1).id;
			expect(
				(yield* previewAs(admin, { as_of: '2026-10-01', key: 'scope', company, project })).body
			).toBe('# Scope of Work — Warehouse tracking app');
			const signed_copy = yield* signedCopy(t);
			expect(
				yield* Effect.flip(
					admin.act({
						'signed_documents.create': [{ template_version: sow, company, signed_copy }]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					admin.act({
						'signed_documents.create': [{ template_version: nda, company, project, signed_copy }]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const id = committedId(
				yield* admin.act({
					'signed_documents.create': [{ template_version: sow, company, project, signed_copy }]
				}),
				'signed_documents'
			);
			expect(
				pageOf(
					yield* admin.query({ signed_documents: { where: { id: { eq: id } }, limit: 1 } }),
					'signed_documents'
				).rows[0] ?? null
			).toMatchObject({
				project,
				signed_on: '2026-10-01',
				title: 'Scope',
				terms: { project: 'Warehouse tracking app', contact_name: 'Marcus Lee' }
			});
		}).pipe(Effect.scoped)
);
it.live('a follow-up files itself under its contact’s company', () =>
	Effect.gen(function* () {
		const { t, company, contact } = yield* fixture();
		const admin = yield* t.as(t.admin);
		const id = committedId(
			yield* admin.act({
				'tasks.create': [
					{
						kind: 'follow_up',
						subject: 'Send the revised quote',
						due_on: '2026-10-09',
						contact_id: contact
					}
				]
			}),
			'tasks'
		);
		expect(
			(pageOf(yield* admin.query({ tasks: { where: { id: { eq: id } }, limit: 1 } }), 'tasks')
				.rows[0] ?? null)?.['company']
		).toBe(company);
	}).pipe(Effect.scoped)
);
it.live('notes are read-only', () =>
	Effect.gen(function* () {
		const { t } = yield* fixture();
		expect(pageOf(yield* (yield* t.as(t.admin)).query({ notes: {} }), 'notes')).toMatchObject({
			rows: []
		});
		expect(yield* Effect.flip(wireAct(t, t.admin, 'notes.create', [{ title: 'x' }]))).toMatchObject(
			{
				_tag: 'ActRefused'
			}
		);
	}).pipe(Effect.scoped)
);

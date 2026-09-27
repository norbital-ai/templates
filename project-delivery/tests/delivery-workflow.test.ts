/**
 * A client engagement keeps its documents and activity from NDA through signed SOW and submission, through the real
 * write pipeline of every collection (L-TPL-project-delivery-005), and the starter note stays read-only (-007).
 */
import { expect, it } from 'vitest';
import { testWorkspace } from '@norbital-ai/bolt/test';

const root = decodeURIComponent(new URL('..', import.meta.url).pathname);

it('a client engagement retains its documents and activity through signed SOW and submission', async () => {
	const t = await testWorkspace({ root });
	const admin = t.as(t.admin);
	const create = async (collection: string, values: { [field: string]: unknown }) => {
		const out = await admin.act(`${collection}.create`, values as never);
		expect(out.kind, `create ${collection}`).toBe('committed');
		return out.kind === 'committed' ? out.records[0]!.id : '';
	};
	const update = async (collection: string, id: string, set: { [field: string]: unknown }) =>
		expect((await admin.act(`${collection}.update`, { target: id, set } as never)).kind).toBe(
			'committed'
		);

	const company = await create('companies', {
		name: 'Example delivery client',
		status: 'active',
		nda_required: true,
		nda_signed_on: '2026-09-01T00:00:00.000Z'
	});
	const contact = await create('contacts', {
		full_name: 'Avery Tan',
		email: 'avery@example.test',
		company_id: company,
		is_primary: true
	});
	const project = await create('projects', {
		name: 'Client portal',
		company_id: company,
		lead_contact_id: contact,
		status: 'nda',
		budget_currency: 'SGD',
		budget: '12500.00'
	});
	await create('project_documents', {
		title: 'Discovery brief',
		project_id: project,
		kind: 'brief',
		status: 'submitted',
		markdown_body: '# Brief\n\nDeliver a client portal.'
	});
	const markdown = '# Statement of Work\n\n## Acceptance\n\n- Client review on Friday.\n';
	const sow = await create('project_documents', {
		title: 'Client portal SOW',
		project_id: project,
		kind: 'sow',
		status: 'draft',
		markdown_body: markdown
	});
	const revised = `${markdown}\n- Signed approval before implementation.\n`;
	await update('project_documents', sow, { markdown_body: revised });
	await update('project_documents', sow, {
		kind: 'signed_sow',
		status: 'signed',
		signed_by: 'Avery Tan',
		signed_on: '2026-09-02T00:00:00.000Z'
	});
	for (const status of ['sow_signed', 'submitted', 'in_delivery'])
		await update('projects', project, { status });
	await create('activities', {
		subject: 'Kickoff transcript',
		kind: 'transcript',
		project_id: project,
		contact_id: contact,
		detail: '**[00:00] Speaker 1:** Kickoff is Monday.\n\n**[00:04] Speaker 2:** Review is Friday.'
	});
	await create('issues', {
		title: 'Confirm acceptance criteria',
		project_id: project,
		status: 'open',
		severity: 'medium'
	});

	const saved = await admin.get('project_documents', sow, {
		select: { markdown_body: true, project_id: true, status: true, signed_by: true }
	});
	expect(saved).toMatchObject({
		markdown_body: revised,
		project_id: project,
		status: 'signed',
		signed_by: 'Avery Tan'
	});
	expect(
		(await admin.read('project_documents', { where: { kind: { eq: 'signed_sow' } }, all: true }))
			.rows
	).toHaveLength(1);
	const engagement = await admin.get('projects', project, {
		select: { company_id: true, lead_contact_id: true, status: true, budget: true }
	});
	expect(engagement).toMatchObject({
		company_id: company,
		lead_contact_id: contact,
		status: 'in_delivery'
	});
	expect(JSON.stringify(engagement?.['budget'])).toContain('12500');
	const [activity] = (
		await admin.read('activities', {
			where: { project_id: { eq: project } },
			select: { detail: true, recording: true },
			all: true
		})
	).rows;
	expect(String(activity?.['detail'])).toMatch(/Speaker 2/);
	expect(activity?.['recording'], 'a transcript-only activity carries no audio').toBeNull();
	expect(
		(await admin.read('issues', { where: { project_id: { eq: project } }, all: true })).rows
	).toHaveLength(1);

	expect(
		(await admin.act('notes.create', { title: 'x' } as never)).kind,
		'notes are read-only'
	).toBe('refused');
});

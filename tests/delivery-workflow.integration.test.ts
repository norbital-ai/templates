import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	asRecord,
	mutationPush,
	requireAccepted,
	requireReleaseBundle,
	rowsOf,
	startSelfHostSession
} from '@norbital-ai/test-utilities';

test(
	'a client engagement retains its documents and activity through signed SOW and submission',
	{ timeout: 60_000 },
	async () => {
		const root = fileURLToPath(new URL('../', import.meta.url));
		const { bundlePath, schemaFingerprint } = requireReleaseBundle(`${root}.norbital/artifact`, [
			'ai',
			'database',
			'tasks'
		]);
		const session = await startSelfHostSession({
			bundlePath,
			tenantId: 'project-delivery-workflow'
		});
		try {
			const create = async (collection: string, values: Record<string, unknown>) => {
				const response = await session.guestCommand(
					'collections.write',
					mutationPush(schemaFingerprint, { collection, action: 'create', inputs: [values] }),
					'bearer'
				);
				requireAccepted(response.value, `create ${collection}`);
				// The committed change names the allocated id; `records` is the policy-masked readback.
				const [change] = rowsOf(
					asRecord(response.value, `create ${collection}`).changes,
					collection
				);
				assert.equal(typeof change?.id, 'string', `create ${collection} named its row`);
				return String(change.id);
			};
			const update = async (collection: string, id: string, values: Record<string, unknown>) => {
				const [before] = await session.query(
					`select row_version from "${collection}" where id = $1`,
					[id]
				);
				return session.guestCommand(
					'collections.write',
					mutationPush(
						schemaFingerprint,
						{ collection, action: 'update', inputs: [{ id, ...values }] },
						[{ row: { collection, recordId: id }, rowVersion: before.row_version }]
					),
					'bearer'
				);
			};
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
				status: 'nda'
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
			requireAccepted(
				(await update('project_documents', sow, { markdown_body: revised })).value,
				'revise SOW'
			);
			requireAccepted(
				(
					await update('project_documents', sow, {
						kind: 'signed_sow',
						status: 'signed',
						signed_by: 'Avery Tan',
						signed_on: '2026-09-02T00:00:00.000Z'
					})
				).value,
				'sign SOW'
			);
			for (const status of ['sow_signed', 'submitted', 'in_delivery']) {
				requireAccepted((await update('projects', project, { status })).value, `advance ${status}`);
			}
			await create('activities', {
				subject: 'Kickoff transcript',
				kind: 'transcript',
				project_id: project,
				contact_id: contact,
				detail:
					'**[00:00] Speaker 1:** Kickoff is Monday.\n\n**[00:04] Speaker 2:** Review is Friday.'
			});
			await create('issues', {
				title: 'Confirm acceptance criteria',
				project_id: project,
				status: 'open',
				severity: 'medium'
			});
			const [saved] = await session.query('select * from project_documents where id = $1', [sow]);
			assert.equal(saved.markdown_body, revised);
			assert.equal(saved.project_id, project);
			assert.equal(saved.status, 'signed');
			assert.equal(saved.signed_by, 'Avery Tan');
			assert.equal(
				(await session.query('select id from project_documents where kind = $1', ['signed_sow']))
					.length,
				1
			);
			const [engagement] = await session.query('select * from projects where id = $1', [project]);
			assert.equal(engagement.company_id, company);
			assert.equal(engagement.lead_contact_id, contact);
			assert.equal(engagement.status, 'in_delivery');
			const [activity] = await session.query('select * from activities where project_id = $1', [
				project
			]);
			assert.match(String(activity.detail), /Speaker 2/);
			assert.equal(activity.recording, null, 'transcript-only activity must not contain audio');
			assert.equal(
				(await session.query('select id from issues where project_id = $1', [project])).length,
				1
			);
		} finally {
			await session.stop();
		}
	}
);

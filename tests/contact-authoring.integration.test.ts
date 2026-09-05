import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	authoredSeedStages,
	bearerHeaders,
	jsonSqlParameter,
	mutationPush,
	postGuestCommand,
	requireAccepted,
	requireReleaseBundle,
	startSelfHostSession
} from '@norbital-ai/test-utilities';

test(
	'partial contact edits preserve the existing account while changed account references remain validated',
	{ timeout: 60_000 },
	async () => {
		const root = fileURLToPath(new URL('../', import.meta.url));
		const { bundlePath, schemaFingerprint } = requireReleaseBundle(`${root}.norbital/artifact`, [
			'ai',
			'connector',
			'database',
			'tasks'
		]);
		const session = await startSelfHostSession({
			bundlePath,
			tenantId: 'crm-contact-authoring',
			seed: {
				stages: authoredSeedStages(`${root}norbital.template.json`, `${root}tests/fixtures/seed`),
				rows: `${root}tests/fixtures/seed`,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			assert.ok(session.credential);
			const headers = bearerHeaders(session.credential);
			const [before] = await session.query('select * from contacts order by id limit 1');
			const edit = async (values: Record<string, unknown>) => {
				const [current] = await session.query('select row_version from contacts where id = $1', [
					before.id
				]);
				return postGuestCommand(
					session.baseUrl,
					'collections.mutate',
					mutationPush(
						schemaFingerprint,
						{
							action: 'mutate',
							collection: 'contacts',
							rows: [{ action: 'update', values: { id: before.id, ...values } }]
						},
						[
							{
								row: { collection: 'contacts', recordId: String(before.id) },
								rowVersion: current.row_version
							}
						]
					),
					headers
				);
			};
			requireAccepted(
				(await edit({ department: 'Authored through a partial patch' })).value,
				'partial contact edit'
			);
			const [after] = await session.query('select * from contacts where id = $1', [before.id]);
			assert.equal(after.department, 'Authored through a partial patch');
			for (const field of ['account_id', 'first_name', 'last_name', 'email', 'title', 'active'])
				assert.deepEqual(after[field], before[field]);
			const invalid = await edit({ account_id: '00000000-0000-4000-8000-000000000999' });
			assert.match(JSON.stringify(invalid.value), /Referenced account does not exist/);
			const [unchanged] = await session.query('select account_id from contacts where id = $1', [
				before.id
			]);
			assert.equal(unchanged.account_id, before.account_id);
		} finally {
			await session.stop();
		}
	}
);

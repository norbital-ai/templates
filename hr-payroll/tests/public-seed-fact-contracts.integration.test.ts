import assert from 'node:assert/strict';
import test from 'node:test';
import { authoredSeedStages, jsonSqlParameter, requireAccepted } from '@norbital-ai/test-utilities';
import { writeRows } from './helpers/write.ts';
import {
	COMPANY_ID,
	JANUARY_2026,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	publicSeedRows,
	startPublicSeedHost,
	templateManifestPath
} from './helpers/public-seed-host.ts';

test(
	'stored jurisdiction declarations enforce entity writes and payroll readiness',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		const version = rows.jurisdiction_settings!.find((row) => row.id === JURISDICTION_ID)!;
		version.facts = [
			{
				key: 'count',
				type: 'number',
				label: 'Declared count',
				required_when: 'company.facts.consent',
				minimum: 0,
				maximum: 3,
				integer: true
			},
			{ key: 'consent', type: 'boolean', label: 'Declared consent', required: true },
			{
				key: 'category',
				type: 'string',
				label: 'Declared category',
				options: ['A', 'B'],
				min_length: 1
			}
		];
		const session = await startPublicSeedHost('hr-fact-contracts', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			for (const [facts, expected] of [
				[{ count: 0.5 }, /Declared count must be a whole number/],
				[{ category: 'C' }, /Declared category must be one of/],
				[{ wrong_key: 0 }, /does not declare the entity fact wrong_key/]
			] as const) {
				const result = await writeRows(session, 'companies', 'update', [{ id: COMPANY_ID, facts }]);
				assert.match(JSON.stringify(result.value), expected);
			}
			const incomplete = await writeRows(session, 'companies', 'update', [
				{ id: COMPANY_ID, facts: { consent: true } }
			]);
			requireAccepted(incomplete.value, 'save incomplete entity facts');
			const refused = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: JANUARY_2026 }
			]);
			assert.match(JSON.stringify(refused.value), /Declared count is required before calculation/);
			const supplied = await writeRows(session, 'companies', 'update', [
				{ id: COMPANY_ID, facts: { count: 0, consent: false, category: 'A' } }
			]);
			requireAccepted(supplied.value, 'save explicit zero and false');
			const [stored] = await session.query('select facts from companies where id = $1', [
				COMPANY_ID
			]);
			assert.deepEqual(stored.facts, { count: 0, consent: false, category: 'A' });
			const run = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: JANUARY_2026 }
			]);
			requireAccepted(run.value, 'calculate with complete entity declarations');
		} finally {
			await session.stop();
		}
	}
);

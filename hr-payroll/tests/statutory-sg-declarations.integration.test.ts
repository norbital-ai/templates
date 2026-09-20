import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { authoredSeedStages, jsonSqlParameter, requireAccepted } from '@norbital-ai/test-utilities';
import { writeRows } from './helpers/write.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JANUARY_2026,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	publicSeedRows,
	startPublicSeedHost,
	templateManifestPath
} from './helpers/public-seed-host.ts';

test(
	'saved SG fund instructions reach payroll through standalone commands',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		const employeeId = rows.employments!.find((row) => row.id === EMPLOYMENT_ID)!.employee_id;
		const source = JSON.parse(
			await readFile(
				new URL('../seed/jurisdiction/SG/statutory_contributions.json', import.meta.url),
				'utf8'
			)
		) as Record<string, unknown>[];
		const schemeId = 'a3000000-0000-4000-8000-000000000001';
		const factId = 'a3000000-0000-4000-8000-000000000002';
		// The public fixture exercises storage and command wiring; monetary legal cases use the SG world.
		rows.statutory_contributions!.push({
			...source.find((row) => row.code === 'CDAC')!,
			id: schemeId,
			settings_id: JURISDICTION_ID
		});
		rows.employees = rows.employees!.map((row) =>
			row.id === employeeId ? { ...row, race: 'CHINESE' } : row
		);
		rows.employment_terms = rows.employment_terms!.map((row) =>
			row.employment_id === EMPLOYMENT_ID ? { ...row, residency_status: 'CITIZEN' } : row
		);
		const session = await startPublicSeedHost('hr-sg-declarations', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		const status = (elections: Record<string, string | number | boolean>) => ({
			kind: 'REGISTERED',
			reference_number: 'SG-DECLARATION',
			rate_override: null,
			elections
		});
		try {
			const base = {
				id: factId,
				employee_id: employeeId,
				employment_id: EMPLOYMENT_ID,
				statutory_contribution_id: schemeId,
				effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
			};
			const wrongType = await writeRows(session, 'employment_statutory_facts', 'create', [
				{ ...base, status: status({ shg_monthly_amount: '0' }) }
			]);
			assert.match(JSON.stringify(wrongType.value), /number/);
			const incomplete = await writeRows(session, 'employment_statutory_facts', 'create', [
				{ ...base, status: status({ shg_monthly_amount: 0 }) }
			]);
			requireAccepted(incomplete.value, 'save an incomplete fund instruction');
			const refused = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: JANUARY_2026 }
			]);
			assert.match(JSON.stringify(refused.value), /Fund instruction reference is required/);
			const complete = await writeRows(session, 'employment_statutory_facts', 'update', [
				{
					id: factId,
					status: status({
						shg_monthly_amount: 3.33,
						shg_instruction_reference: 'FUND-INSTRUCTION'
					})
				}
			]);
			requireAccepted(complete.value, 'save the fund amount and instruction');
			const [stored] = await session.query(
				'select status from employment_statutory_facts where id = $1',
				[factId]
			);
			assert.deepEqual((stored.status as { elections: Record<string, unknown> }).elections, {
				shg_monthly_amount: 3.33,
				shg_instruction_reference: 'FUND-INSTRUCTION'
			});
			const run = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: JANUARY_2026 }
			]);
			requireAccepted(run.value, 'calculate the saved fund instruction');
			const [slip] = await session.query(
				'select statutory from payslips where employment_id = $1',
				[EMPLOYMENT_ID]
			);
			const charge = (
				slip.statutory as {
					scheme_code: string;
					employee_amount: number;
					employer_amount: number;
				}[]
			).find((row) => row.scheme_code === 'CDAC')!;
			assert.deepEqual([charge.employee_amount, charge.employer_amount], [3.33, 0]);
		} finally {
			await session.stop();
		}
	}
);

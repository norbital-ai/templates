import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { authoredSeedStages, jsonSqlParameter, requireAccepted } from '@norbital-ai/test-utilities';
import { writeRows } from './helpers/write.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	publicSeedRows,
	startPublicSeedHost,
	templateManifestPath
} from './helpers/public-seed-host.ts';

const ph = async (name: string) =>
	JSON.parse(
		await readFile(new URL(`../seed/jurisdiction/PH/${name}.json`, import.meta.url), 'utf8')
	) as Record<string, unknown>[];

test(
	'saved PH declarations reach payroll: required entity facts, tax residency, dated terms',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		// The public fixture exercises storage and command wiring; the PH world prices the law.
		const settings = await ph('jurisdiction_settings');
		const law = settings.find((row) =>
			String((row.effective_range as { start: string }).start).startsWith('2026-01-06')
		)!;
		const version = rows.jurisdiction_settings!.find((row) => row.id === JURISDICTION_ID)!;
		version.facts = law.facts;
		version.work_rules = {
			...(version.work_rules as Record<string, unknown>),
			wages: (law.work_rules as { wages: unknown }).wages
		};
		rows.companies = rows.companies!.map((row) => ({ ...row, region: 'NCR' }));
		const schemes = await ph('statutory_contributions');
		for (const [index, code] of ['SSS', 'SSS_MPF', 'SSS_EC', 'PHIC', 'HDMF', 'WTAX'].entries())
			rows.statutory_contributions!.push({
				...schemes.find((row) => row.code === code && row.settings_id === law.id)!,
				id: `a5000000-0000-4000-8000-00000000001${index}`,
				settings_id: JURISDICTION_ID
			});
		// Every contract declares residency. The public world consumes terms through 16 April 2026,
		// so the contract under test changes by a successor from 1 May: first without residency,
		// then as a non-resident alien not engaged in trade or business.
		const termsId = rows.employment_terms!.find((row) => row.employment_id === EMPLOYMENT_ID)!.id;
		rows.employment_terms = rows.employment_terms!.map((row) =>
			row.employment_id === EMPLOYMENT_ID
				? {
						...row,
						tax_residency: 'RESIDENT',
						allowances: [],
						base_salary: { ...(row.base_salary as object), value: 30_000 }
					}
				: { ...row, tax_residency: 'RESIDENT' }
		);
		// SSS coverage turns on the first contribution due date, earlier employers included (RA 11199
		// s.9); every synthetic employment declares one, so the test isolates residency.
		for (const [index, employment] of rows.employments!.entries())
			for (const [offset, scheme] of ['0', '1', '2'].entries())
				rows.employment_statutory_facts!.push({
					id: `a6000000-0000-4000-8000-00000000${String(100 + index * 3 + offset).padStart(4, '0')}`,
					employee_id: employment.employee_id,
					employment_id: employment.id,
					statutory_contribution_id: `a5000000-0000-4000-8000-00000000001${scheme}`,
					status: {
						kind: 'REGISTERED',
						reference_number: 'DECLARATION',
						rate_override: null,
						first_contribution_due_on: '2021-06-01',
						elections: {}
					},
					effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
				});
		const APRIL = '2026-04';
		const MAY = '2026-05';
		const session = await startPublicSeedHost('hr-ph-declarations', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		const run = (period: string) =>
			writeRows(session, 'payroll_runs', 'create', [{ company_id: COMPANY_ID, period }]);
		const withheld = async (period: string) => {
			const [slip] = await session.query(
				'select p.statutory from payslips p join payroll_runs r on r.id = p.payroll_run_id where p.employment_id = $1 and r.period = $2',
				[EMPLOYMENT_ID, period]
			);
			return (slip.statutory as { scheme_code: string; employee_amount: number }[]).find(
				(row) => row.scheme_code === 'WTAX'
			)?.employee_amount;
		};
		try {
			// Conflicting: a boolean establishment fact cannot be saved as text.
			const wrongType = await writeRows(session, 'companies', 'update', [
				{ id: COMPANY_ID, facts: { small_establishment: 'no' } }
			]);
			assert.match(JSON.stringify(wrongType.value), /must be a boolean/);
			// Required: an entity that records only the SIL test is saved, but not calculated.
			requireAccepted(
				(
					await writeRows(session, 'companies', 'update', [
						{ id: COMPANY_ID, facts: { small_establishment: false } }
					])
				).value,
				'save incomplete entity facts'
			);
			assert.match(
				JSON.stringify((await run(APRIL)).value),
				/Retail, service or agricultural establishment of ten or fewer is required/
			);
			requireAccepted(
				(
					await writeRows(session, 'companies', 'update', [
						{
							id: COMPANY_ID,
							facts: { small_establishment: false, retirement_exempt_establishment: false }
						}
					])
				).value,
				'save complete entity facts'
			);
			requireAccepted((await run(APRIL)).value, 'calculate a resident');
			const resident = await withheld(APRIL);
			requireAccepted(
				(
					await writeRows(session, 'employment_terms', 'update', [
						{
							id: termsId,
							effective_range: {
								start: '2021-06-01T00:00:00.000Z',
								end: '2026-04-30T00:00:00.000Z'
							}
						}
					])
				).value,
				'close the resident terms'
			);
			const current = rows.employment_terms!.find((row) => row.id === termsId)!;
			const successor = 'a5000000-0000-4000-8000-0000000000a1';
			requireAccepted(
				(
					await writeRows(session, 'employment_terms', 'create', [
						{
							...current,
							id: successor,
							tax_residency: null,
							effective_range: { start: '2026-05-01T00:00:00.000Z', end: null }
						}
					])
				).value,
				'record the successor without residency'
			);
			// Missing: ₱30,000 is taxable and the contract records no residency (NIRC ss.22–25).
			assert.match(
				JSON.stringify((await run(MAY)).value),
				/Record tax residency on the employment terms/
			);
			requireAccepted(
				(
					await writeRows(session, 'employment_terms', 'update', [
						{ id: successor, tax_residency: 'NON_RESIDENT_NETB' }
					])
				).value,
				'record the non-resident successor'
			);
			// From 1 May a non-resident alien not engaged in trade or business: 25% of the ₱30,000
			// gross, 7,500 (s.25(B)); April keeps the resident table.
			requireAccepted((await run(MAY)).value, 'calculate the non-resident month');
			assert.equal(await withheld(MAY), 7500);
			assert.notEqual(resident, 7500);
		} finally {
			await session.stop();
		}
	}
);

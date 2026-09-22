/**
 * Round 5, letter U — D22 (TW): saved entity declarations reach payroll through the write path.
 *
 * 勞動基準法 §56(1): 雇主應依勞工每月薪資總額百分之二至百分之十五範圍內，按月提撥勞工退休準備金.
 * The public fixture carries the storage and command wiring; the TW seed's reserve scheme and its
 * declared entity fact are grafted onto it. The worker is placed on the old system: in service
 * since 1 March 2000 (before 勞工退休金條例 took effect on 1 July 2005), a national, and outside
 * the new system (LABOR_PENSION NOT_REGISTERED).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { authoredSeedStages, jsonSqlParameter, requireAccepted } from '@norbital-ai/test-utilities';
import { writeRows } from './helpers/write.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	FEBRUARY_2026,
	JANUARY_2026,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	publicSeedRows,
	startPublicSeedHost,
	templateManifestPath
} from './helpers/public-seed-host.ts';

const tw = async (name: string) =>
	JSON.parse(
		await readFile(new URL(`../seed/jurisdiction/TW/${name}.json`, import.meta.url), 'utf8')
	) as Record<string, unknown>[];

/** The fixture host with the TW reserve grafted on and PUB-EMP-0001 on the old system. */
const oldSystemHost = async (label: string) => {
	const rows = await publicSeedRows();
	const law = (await tw('jurisdiction_settings')).find((row) =>
		String((row.effective_range as { start: string }).start).startsWith('2026-01-01')
	)!;
	const version = rows.jurisdiction_settings!.find((row) => row.id === JURISDICTION_ID)!;
	version.facts = [
		...((version.facts as unknown[] | undefined) ?? []),
		...(law.facts as { key: string }[]).filter((field) => field.key === 'pension_reserve_rate')
	];
	const schemes = await tw('statutory_contributions');
	const ids = {
		LABOR_PENSION: 'a6000000-0000-4000-8000-000000000011',
		LABOR_PENSION_RESERVE: 'a6000000-0000-4000-8000-000000000012'
	} as const;
	for (const [code, id] of Object.entries(ids))
		rows.statutory_contributions!.push({
			...schemes.find((row) => row.code === code && row.settings_id === law.id)!,
			id,
			settings_id: JURISDICTION_ID
		});
	const employeeId = rows.employments!.find((row) => row.id === EMPLOYMENT_ID)!.employee_id;
	const since = { start: '2000-03-01T00:00:00.000Z', end: null };
	rows.employments = rows.employments!.map((row) =>
		row.id === EMPLOYMENT_ID ? { ...row, effective_range: since } : row
	);
	rows.employment_terms = rows.employment_terms!.map((row) =>
		row.employment_id === EMPLOYMENT_ID
			? {
					...row,
					effective_range: since,
					residency_status: 'CITIZEN',
					allowances: [],
					base_salary: { ...(row.base_salary as object), value: 50_000 }
				}
			: row
	);
	// The fixture's foreign worker is a foreign professional (the reserve turns on the pass).
	rows.employment_terms = rows.employment_terms!.map((row) =>
		row.residency_status === 'FOREIGNER' ? { ...row, pass_type: 'OTHER' } : row
	);
	rows.employees!.forEach((employee, index) =>
		rows.employment_statutory_facts!.push({
			id: `a6000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
			employee_id: employee.id,
			statutory_contribution_id: ids.LABOR_PENSION,
			status: {
				kind: 'NOT_REGISTERED',
				reason: employee.id === employeeId ? 'Kept the old pension system' : 'Outside the scheme'
			},
			effective_range: { start: '2000-01-01T00:00:00.000Z', end: null }
		})
	);
	const session = await startPublicSeedHost(label, {
		seed: {
			stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
			rows,
			mapParameters: jsonSqlParameter
		}
	});
	const run = (period: string) =>
		writeRows(session, 'payroll_runs', 'create', [{ company_id: COMPANY_ID, period }]);
	const reserve = async (period: string) => {
		const [slip] = await session.query(
			'select p.statutory from payslips p join payroll_runs r on r.id = p.payroll_run_id where p.employment_id = $1 and r.period = $2',
			[EMPLOYMENT_ID, period]
		);
		return (slip.statutory as { scheme_code: string; employer_amount: number }[]).find(
			(row) => row.scheme_code === 'LABOR_PENSION_RESERVE'
		)?.employer_amount;
	};
	return { session, run, reserve };
};

test(
	'saved TW reserve declarations reach payroll: type, range and required',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const { session, run, reserve } = await oldSystemHost('hr-tw-declarations');
		try {
			// Conflicting: the rate is a number, and one inside the 2–15% the Act allows.
			assert.match(
				JSON.stringify(
					(
						await writeRows(session, 'companies', 'update', [
							{ id: COMPANY_ID, facts: { pension_reserve_rate: 'six' } }
						])
					).value
				),
				/must be a number/
			);
			assert.match(
				JSON.stringify(
					(
						await writeRows(session, 'companies', 'update', [
							{ id: COMPANY_ID, facts: { pension_reserve_rate: 20 } }
						])
					).value
				),
				/must be at most 15/
			);
			// Missing: an old-system worker and no rate — the run stops and says why.
			assert.match(
				JSON.stringify((await run(JANUARY_2026)).value),
				/§56\(1\).*pension_reserve_rate/
			);
			requireAccepted(
				(
					await writeRows(session, 'companies', 'update', [
						{ id: COMPANY_ID, facts: { pension_reserve_rate: 8 } }
					])
				).value,
				'record the rate'
			);
			requireAccepted((await run(JANUARY_2026)).value, 'calculate January');
			// 50,000 × 8% = 4,000.
			assert.equal(await reserve(JANUARY_2026), 4000);
		} finally {
			await session.stop();
		}
	}
);

test(
	'a dated TW reserve revision governs its own month through the hosted run',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const { session, run, reserve } = await oldSystemHost('hr-tw-dated-declarations');
		try {
			// 6% approved for January (a dated revision), 8% the standing record after it.
			requireAccepted(
				(
					await writeRows(session, 'company_facts', 'create', [
						{
							company_id: COMPANY_ID,
							facts: { pension_reserve_rate: 6 },
							effective_range: {
								start: '2026-01-01T00:00:00.000Z',
								end: '2026-02-01T00:00:00.000Z'
							}
						}
					])
				).value,
				'record the January rate'
			);
			requireAccepted(
				(
					await writeRows(session, 'companies', 'update', [
						{ id: COMPANY_ID, facts: { pension_reserve_rate: 8 } }
					])
				).value,
				'record the current rate'
			);
			requireAccepted((await run(JANUARY_2026)).value, 'calculate January');
			// 50,000 × 6% = 3,000.
			assert.equal(await reserve(JANUARY_2026), 3000);
			requireAccepted((await run(FEBRUARY_2026)).value, 'calculate February');
			// 50,000 × 8% = 4,000.
			assert.equal(await reserve(FEBRUARY_2026), 4000);
		} finally {
			await session.stop();
		}
	}
);

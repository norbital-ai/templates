import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { authoredSeedStages, jsonSqlParameter, requireAccepted } from '@norbital-ai/test-utilities';
import { readLawFile } from './fixtures/law-file.ts';
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

type Row = Record<string, unknown>;

const law = (name: string): Row[] =>
	readLawFile(fileURLToPath(new URL(`../seed/jurisdiction/MY/${name}`, import.meta.url)));

const registered = (elections: Row) => ({
	kind: 'REGISTERED',
	reference_number: 'DECLARATION',
	rate_override: null,
	elections
});

const accepted = (value: unknown) => JSON.stringify(value).includes('"resolution":"accepted"');

// D22: MY declarations saved as records reach payroll — required, missing, conflicting and dated.
test(
	'saved MY declarations reach payroll: a non-citizen’s EPF election, tax residence, overlap and a dated change',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		// A charged leave day pins the contract it was charged under; this case edits that contract.
		rows.leave_entries = [];
		const version = law('jurisdiction_settings').find((row) =>
			String((row.effective_range as { start: string }).start).startsWith('2025-12')
		)!;
		const ids: Record<string, string> = {};
		for (const [index, code] of [
			'EPF',
			'EPF_PR',
			'EPF_NON_CITIZEN',
			'SOCSO',
			'EIS',
			'PCB'
		].entries()) {
			ids[code] = `a7000000-0000-4000-8000-0000000000${String(10 + index)}`;
			rows.statutory_contributions!.push({
				...law('statutory_contributions').find(
					(row) => row.code === code && row.settings_id === version.id
				)!,
				id: ids[code],
				settings_id: JURISDICTION_ID
			});
		}
		// The employment under test is a non-citizen whose contract records no tax residence.
		rows.employment_terms = rows.employment_terms!.map((row) =>
			row.employment_id === EMPLOYMENT_ID
				? { ...row, residency_status: 'FOREIGNER', tax_residency: null, allowances: [] }
				: row
		);
		// Every other employment has answered both non-citizen questions (EPF Act Third Schedule,
		// Act A1760; EIS Act 2017 First Schedule); the one under test answers EIS only.
		for (const [index, employment] of rows.employments!.entries()) {
			for (const [code, elections] of [
				['EIS', { mykas_resident: false }],
				['EPF', { member_before_1998: false }]
			] as const) {
				if (employment.id === EMPLOYMENT_ID && code === 'EPF') continue;
				rows.employment_statutory_facts!.push({
					id: `a7000000-0000-4000-8000-000000000${code === 'EIS' ? 3 : 4}${String(10 + index)}`,
					employee_id: employment.employee_id,
					employment_id: employment.id,
					statutory_contribution_id: ids[code],
					status: registered(elections),
					effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
				});
			}
		}
		const employeeId = rows.employments!.find((row) => row.id === EMPLOYMENT_ID)!.employee_id;
		const session = await startPublicSeedHost('hr-my-declarations', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		const run = (period: string) =>
			writeRows(session, 'payroll_runs', 'create', [{ company_id: COMPANY_ID, period }]);
		const charged = async (period: string, code: string) => {
			const [slip] = await session.query(
				'select p.statutory from payslips p join payroll_runs r on r.id = p.payroll_run_id where p.employment_id = $1 and r.period = $2',
				[EMPLOYMENT_ID, period]
			);
			const row = (
				slip.statutory as {
					scheme_code: string;
					employee_amount: number;
					employer_amount: number;
				}[]
			).find((line) => line.scheme_code === code);
			return row == null ? null : [row.employee_amount, row.employer_amount];
		};
		const factId = 'a7000000-0000-4000-8000-000000000501';
		const fact = {
			id: factId,
			employee_id: employeeId,
			employment_id: EMPLOYMENT_ID,
			statutory_contribution_id: ids.EPF,
			effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
		};
		try {
			// The election is a yes or a no.
			assert.match(
				JSON.stringify(
					(
						await writeRows(session, 'employment_statutory_facts', 'create', [
							{ ...fact, status: registered({ member_before_1998: 'yes' }) }
						])
					).value
				),
				/boolean/
			);
			// Required: an EPF registration saved without the answer does not calculate.
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'create', [
						{ ...fact, status: registered({}) }
					])
				).value,
				'save an incomplete EPF registration'
			);
			assert.match(
				JSON.stringify((await run(JANUARY_2026)).value),
				/EPF member before 1 August 1998 is required/
			);
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'update', [
						{ id: factId, status: registered({ member_before_1998: true }) }
					])
				).value,
				'declare a pre-1998 member'
			);
			requireAccepted((await run(JANUARY_2026)).value, 'calculate the declared member');
			// Part A (Third Schedule, RM20 rows below RM5,000): 3,451 is the RM3,440.01–3,460 row,
			// 11% × 3,460 = 380.60 → 381 and 13% × 3,460 = 449.80 → 450 (next ringgit); not Part F.
			assert.deepEqual(await charged(JANUARY_2026, 'EPF'), [381, 450]);
			assert.equal(await charged(JANUARY_2026, 'EPF_NON_CITIZEN'), null);
			// Missing tax residence is "not known to be resident": 30% of remuneration (LHDN MTD
			// specification D(a); ITA s.107 and the MTD Rules) — 3,451 × 30% = 1,035.30.
			assert.deepEqual(await charged(JANUARY_2026, 'PCB'), [1035.3, 0]);
			// Conflicting: a second standing for the same scheme and dates is refused on write.
			const overlap = await writeRows(session, 'employment_statutory_facts', 'create', [
				{
					...fact,
					id: undefined,
					status: registered({ member_before_1998: false }),
					effective_range: { start: '2026-01-15T00:00:00.000Z', end: null }
				}
			]);
			assert.equal(accepted(overlap.value), false, JSON.stringify(overlap.value));
			// Dated: from 1 February the record says the membership began after 1998 (a corrected
			// KWSP statement); January keeps its answer, February is Part F.
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'update', [
						{
							id: factId,
							effective_range: {
								start: '2020-01-01T00:00:00.000Z',
								end: '2026-01-31T00:00:00.000Z'
							}
						}
					])
				).value,
				'close the pre-1998 declaration'
			);
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'create', [
						{
							...fact,
							id: undefined,
							status: registered({ member_before_1998: false }),
							effective_range: { start: '2026-02-01T00:00:00.000Z', end: null }
						}
					])
				).value,
				'record a post-1998 member from February'
			);
			requireAccepted((await run(FEBRUARY_2026)).value, 'calculate the Part F month');
			// Part F: 2% each of 3,451 = 69.02 + 69.02 = 138.04, the total rounded up to 139; the
			// employee's share up to 70, the employer the rest, 69.
			assert.deepEqual(await charged(FEBRUARY_2026, 'EPF_NON_CITIZEN'), [70, 69]);
			assert.equal(await charged(FEBRUARY_2026, 'EPF'), null);
			assert.deepEqual(await charged(JANUARY_2026, 'EPF'), [381, 450]);
		} finally {
			await session.stop();
		}
	}
);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { authoredSeedStages, jsonSqlParameter, requireAccepted } from '@norbital-ai/test-utilities';
import { observedVersion, writeRows } from './helpers/write.ts';
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

const law = async (lineage: 'VN' | 'ID', name: string) =>
	JSON.parse(
		await readFile(new URL(`../seed/jurisdiction/${lineage}/${name}.json`, import.meta.url), 'utf8')
	) as Row[];

/**
 * The public fixture with one sealed version of a lineage's schemes attached to its PUB version:
 * it exercises storage and the command path; the statutory worlds price the law.
 */
async function lineageRows(lineage: 'VN' | 'ID', versionStart: string, codes: readonly string[]) {
	const rows = await publicSeedRows();
	// A charged leave day pins the contract it was charged under; these cases edit that contract.
	rows.leave_entries = [];
	const version = (await law(lineage, 'jurisdiction_settings')).find((row) =>
		String((row.effective_range as { start: string }).start).startsWith(versionStart)
	)!;
	const pub = rows.jurisdiction_settings!.find((row) => row.id === JURISDICTION_ID)!;
	pub.facts = version.facts;
	pub.work_rules = {
		...(pub.work_rules as Row),
		wages: (version.work_rules as { wages: unknown }).wages
	};
	const schemes = await law(lineage, 'statutory_contributions');
	const ids: Record<string, string> = {};
	for (const [index, code] of codes.entries()) {
		ids[code] = `a6000000-0000-4000-8000-0000000000${String(10 + index)}`;
		rows.statutory_contributions!.push({
			...schemes.find((row) => row.code === code && row.settings_id === version.id)!,
			id: ids[code],
			settings_id: JURISDICTION_ID
		});
	}
	const employeeOf = new Map(
		rows.employments!.map((row) => [String(row.id), String(row.employee_id)])
	);
	return { rows, ids, employeeOf };
}

const registered = (elections: Row) => ({
	kind: 'REGISTERED',
	reference_number: 'DECLARATION',
	rate_override: null,
	elections
});

const accepted = (value: unknown) => JSON.stringify(value).includes('"resolution":"accepted"');

test(
	'saved VN declarations reach payroll: residency, union membership, overlap and a dated change',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		// The December 2025 version: its PIT reads nothing the published engine lacks.
		const { rows, ids, employeeOf } = await lineageRows('VN', '2025-12', [
			'SI',
			'HI',
			'UI',
			'UNION_DUES',
			'PIT'
		]);
		rows.companies = rows.companies!.map((row) => ({ ...row, region: 'I' }));
		const termsId = rows.employment_terms!.find((row) => row.employment_id === EMPLOYMENT_ID)!.id;
		rows.employment_terms = rows.employment_terms!.map((row) =>
			row.employment_id === EMPLOYMENT_ID
				? {
						...row,
						tax_residency: null,
						allowances: [],
						base_salary: { ...(row.base_salary as object), value: 20_000_000 }
					}
				: {
						...row,
						tax_residency: 'RESIDENT',
						...(row.residency_status === 'FOREIGNER' ? { pass_type: 'WORK_PERMIT' } : {})
					}
		);
		// Every employment states whether insurance continues through unpaid days (Law 41/2024 art.33);
		// every other employment declares membership, and the one under test starts without it.
		for (const [index, employment] of rows.employments!.entries()) {
			rows.employment_statutory_facts!.push({
				id: `a6000000-0000-4000-8000-0000000003${String(10 + index)}`,
				employee_id: employment.employee_id,
				employment_id: employment.id,
				statutory_contribution_id: ids.SI,
				status: registered({ continue_si_unpaid: false }),
				effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
			});
			if (employment.id !== EMPLOYMENT_ID)
				rows.employment_statutory_facts!.push({
					id: `a6000000-0000-4000-8000-0000000001${String(10 + index)}`,
					employee_id: employment.employee_id,
					employment_id: employment.id,
					statutory_contribution_id: ids.UNION_DUES,
					status: registered({ union_member: false }),
					effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
				});
		}
		const session = await startPublicSeedHost('hr-vn-declarations', {
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
			return (slip.statutory as { scheme_code: string; employee_amount: number }[]).find(
				(row) => row.scheme_code === code
			)?.employee_amount;
		};
		const factId = 'a6000000-0000-4000-8000-000000000201';
		const fact = {
			id: factId,
			employee_id: employeeOf.get(EMPLOYMENT_ID),
			employment_id: EMPLOYMENT_ID,
			statutory_contribution_id: ids.UNION_DUES,
			effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
		};
		try {
			// A membership answer must be a yes or a no.
			assert.match(
				JSON.stringify(
					(
						await writeRows(session, 'employment_statutory_facts', 'create', [
							{ ...fact, status: registered({ union_member: 'yes' }) }
						])
					).value
				),
				/declares the election union_member as a boolean/
			);
			// Required: a registration saved without the answer does not calculate.
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'create', [
						{ ...fact, status: registered({}) }
					])
				).value,
				'save an incomplete union registration'
			);
			assert.match(JSON.stringify((await run(JANUARY_2026)).value), /Union member is required/);
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'update', [
						{ id: factId, status: registered({ union_member: false }) }
					])
				).value,
				'declare no membership'
			);
			// Missing: the contract records no tax residence (Decree 253/2026 arts.4–5).
			assert.match(
				JSON.stringify((await run(JANUARY_2026)).value),
				/Record tax residency as resident or non-resident/
			);
			requireAccepted(
				(
					await writeRows(session, 'employment_terms', 'update', [
						{ id: termsId, tax_residency: 'RESIDENT' }
					])
				).value,
				'record residency'
			);
			requireAccepted((await run(JANUARY_2026)).value, 'calculate a resident non-member');
			// 20,000,000: SI 8% 1,600,000 + HI 1.5% 300,000 + UI 1% 200,000 = 2,100,000; taxable
			// 20,000,000 − 2,100,000 − 11,000,000 = 6,900,000 → 5% × 5,000,000 + 10% × 1,900,000 =
			// 440,000 (Circular 111/2013 art.7 table). No dues.
			assert.equal(await charged(JANUARY_2026, 'PIT'), 440_000);
			assert.equal((await charged(JANUARY_2026, 'UNION_DUES')) ?? 0, 0);
			// Conflicting: a second standing for the same scheme and dates is refused on write.
			const overlap = await writeRows(session, 'employment_statutory_facts', 'create', [
				{
					...fact,
					id: undefined,
					status: registered({ union_member: true }),
					effective_range: { start: '2026-01-15T00:00:00.000Z', end: null }
				}
			]);
			assert.equal(accepted(overlap.value), false, JSON.stringify(overlap.value));
			// Dated: the employee joins the union from 1 February; January keeps its answer.
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
				'close the non-member declaration'
			);
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'create', [
						{
							...fact,
							id: undefined,
							status: registered({ union_member: true }),
							effective_range: { start: '2026-02-01T00:00:00.000Z', end: null }
						}
					])
				).value,
				'record membership from February'
			);
			requireAccepted((await run(FEBRUARY_2026)).value, 'calculate the member month');
			// Dues 0.5% of the SI salary, 20,000,000 × 0.5% = 100,000, under the 10% × 2,340,000
			// = 234,000 cap (Decision 61/QĐ-TLĐ).
			assert.equal(await charged(FEBRUARY_2026, 'UNION_DUES'), 100_000);
		} finally {
			await session.stop();
		}
	}
);

test(
	'saved ID declarations reach payroll: PTKP status, tax identity, overlap and the 1 January rule',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const { rows, ids, employeeOf } = await lineageRows('ID', '2026-01', [
			'JHT',
			'JP',
			'JKK',
			'JKM',
			'KESEHATAN',
			'JKP',
			'PPH21',
			'PPH26'
		]);
		rows.companies = rows.companies!.map((row) => ({
			...row,
			region: 'DKI Jakarta',
			risk_class: 'I'
		}));
		rows.employment_terms = rows.employment_terms!.map((row) => ({
			...row,
			tax_residency: 'RESIDENT',
			...(row.employment_id === EMPLOYMENT_ID
				? { allowances: [], base_salary: { ...(row.base_salary as object), value: 10_000_000 } }
				: {})
		}));
		const maritalOf = new Map(
			rows.employees!.map((row) => [String(row.id), String(row.marital_status)])
		);
		for (const [index, employment] of rows.employments!.entries())
			if (employment.id !== EMPLOYMENT_ID)
				rows.employment_statutory_facts!.push({
					id: `a6000000-0000-4000-8000-0000000002${String(10 + index)}`,
					employee_id: employment.employee_id,
					employment_id: employment.id,
					statutory_contribution_id: ids.PPH21,
					status: registered({
						ptkp_marital_status: maritalOf.get(String(employment.employee_id)),
						ptkp_dependants: 0,
						no_tax_id: false
					}),
					effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
				});
		const session = await startPublicSeedHost('hr-id-declarations', {
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
				(row) => row.scheme_code === 'PPH21'
			)?.employee_amount;
		};
		const factId = 'a6000000-0000-4000-8000-000000000301';
		const fact = {
			id: factId,
			employee_id: employeeOf.get(EMPLOYMENT_ID),
			employment_id: EMPLOYMENT_ID,
			statutory_contribution_id: ids.PPH21,
			effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
		};
		try {
			// A dependant count is a number.
			assert.match(
				JSON.stringify(
					(
						await writeRows(session, 'employment_statutory_facts', 'create', [
							{ ...fact, status: registered({ ptkp_dependants: '0' }) }
						])
					).value
				),
				/declares the election ptkp_dependants as a number/
			);
			// Undeclared: without the 1 January status and the tax identity nothing is withheld on a
			// guess — the run pays the rest of the payroll and says whose PPh 21 is not withheld.
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'create', [
						{ ...fact, status: registered({ ptkp_dependants: 0 }) }
					])
				).value,
				'save an incomplete PTKP declaration'
			);
			const unwithheld = async (declaration: Record<string, unknown>) => {
				requireAccepted(
					(
						await writeRows(session, 'employment_statutory_facts', 'update', [
							{ id: factId, status: registered(declaration) }
						])
					).value,
					'declare part of the PTKP'
				);
				requireAccepted((await run(JANUARY_2026)).value, 'calculate without a declaration');
				assert.equal(await withheld(JANUARY_2026), 0);
				const [draft] = (await session.query(
					'select id, row_version, warnings from payroll_runs where period = $1',
					[JANUARY_2026]
				)) as { id: string; row_version: number; warnings: string }[];
				assert.match(draft!.warnings, /PPH21: PTKP status or dependants on 1 January/);
				requireAccepted(
					(
						await writeRows(session, 'payroll_runs', 'delete', [{ id: draft!.id }], undefined, [
							observedVersion('payroll_runs', draft!.id, draft!.row_version)
						])
					).value,
					'delete the draft'
				);
			};
			await unwithheld({ ptkp_dependants: 0 });
			await unwithheld({ ptkp_marital_status: 'SINGLE', ptkp_dependants: 0 });
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'update', [
						{
							id: factId,
							status: registered({
								ptkp_marital_status: 'SINGLE',
								ptkp_dependants: 0,
								no_tax_id: false
							})
						}
					])
				).value,
				'declare the tax identity'
			);
			requireAccepted((await run(JANUARY_2026)).value, 'calculate TK/0');
			const january = await withheld(JANUARY_2026);
			assert.ok((january ?? 0) > 0, 'a TK/0 resident on 10,000,000 is withheld');
			// Conflicting: a second standing for the same scheme and dates is refused on write.
			const overlap = await writeRows(session, 'employment_statutory_facts', 'create', [
				{
					...fact,
					id: undefined,
					status: registered({
						ptkp_marital_status: 'MARRIED',
						ptkp_dependants: 1,
						no_tax_id: false
					}),
					effective_range: { start: '2026-01-15T00:00:00.000Z', end: null }
				}
			]);
			assert.equal(accepted(overlap.value), false, JSON.stringify(overlap.value));
			// Dated: married with a child from 1 February. PMK 168/2023 art.9(4): the status on
			// 1 January governs the year, so February is still withheld as TK/0.
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
				'close the January declaration'
			);
			requireAccepted(
				(
					await writeRows(session, 'employment_statutory_facts', 'create', [
						{
							...fact,
							id: undefined,
							status: registered({
								ptkp_marital_status: 'MARRIED',
								ptkp_dependants: 1,
								no_tax_id: false
							}),
							effective_range: { start: '2026-02-01T00:00:00.000Z', end: null }
						}
					])
				).value,
				'record the February change'
			);
			requireAccepted((await run(FEBRUARY_2026)).value, 'calculate February');
			assert.equal(await withheld(FEBRUARY_2026), january);
		} finally {
			await session.stop();
		}
	}
);

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	authoredSeedStages,
	bearerHeaders,
	jsonSqlParameter,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import { createdIds, writeRows } from './helpers/write.ts';
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

test(
	'standalone preserves a statutory shortfall and requires its receipt before settlement and later bank export',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const rows = await publicSeedRows();
		const employment = rows.employments!.find((row) => row.id === EMPLOYMENT_ID)!;
		const schemeId = 'a2000000-0000-4000-8000-000000000001';
		rows.statutory_contributions!.push({
			id: schemeId,
			settings_id: JURISDICTION_ID,
			code: 'PUB_FUNDING',
			name: 'Synthetic funding assessment',
			authority: 'Invented test rule; not jurisdiction law.',
			assessment_period: 'PAY_PERIOD',
			assessed_on: 'BASE',
			rules: [{ when: 'period.key == "2026-01"', employee: '5000.0', employer: '100.0' }],
			parts: []
		});
		rows.employment_statutory_facts!.push({
			id: 'a2000000-0000-4000-8000-000000000002',
			employee_id: employment.employee_id,
			statutory_contribution_id: schemeId,
			status: { kind: 'REGISTERED', reference_number: 'SYNTHETIC-FUNDING' },
			effective_range: { start: '2026-01-01', end: '2026-01-31T23:59:59.999Z' }
		});
		rows.employments = rows.employments!.map((row) =>
			row.id === EMPLOYMENT_ID
				? {
						...row,
						bank: {
							bank_account_name: 'Synthetic funding employee',
							bank_code: 'MBBEMYKL',
							bank_name: 'Maybank',
							bank_account_number: '512345678901'
						}
					}
				: row
		);
		const session = await startPublicSeedHost('hr-contribution-funding', {
			seed: {
				stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
				rows,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			const january = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: '2026-01' }
			]);
			requireAccepted(january.value, 'create January');
			const januaryId = createdIds(january.value)[0];
			const [slip] = await session.query(
				'select id, gross, net, total_deductions, unfunded_contributions from payslips where payroll_run_id = $1 and employment_id = $2',
				[januaryId, EMPLOYMENT_ID]
			);
			assert.ok(slip);
			assert.equal(Number(slip.net), 0);
			// Public fixture charges: 11% + 5% of 3,761, plus the synthetic fixed 5,000.
			assert.equal(Number(slip.gross), 3761);
			assert.equal(Number(slip.total_deductions), 5601.76);
			assert.equal(Number(slip.unfunded_contributions), 1840.76);
			assert.ok(Number(slip.unfunded_contributions) > 0);
			const pay = () =>
				writeRows(session, 'payslips', 'update', [
					{ id: slip.id, status: 'PAID', paid_at: '2026-02-28' }
				]);
			assert.match(JSON.stringify((await pay()).value), /remain unfunded/);
			const february = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: '2026-02' }
			]);
			requireAccepted(february.value, 'create February');
			const [laterSlip] = await session.query(
				'select net from payslips where payroll_run_id = $1 and employment_id = $2',
				[createdIds(february.value)[0], EMPLOYMENT_ID]
			);
			assert.ok(Number(laterSlip?.net) > 0, 'February has a positive payment to protect');
			const exportFebruary = () =>
				postGuestCommand(
					session.host.baseUrl,
					'collections.export',
					{ collection: 'payroll_runs', where: { id: { eq: createdIds(february.value)[0] } } },
					bearerHeaders(session.credential)
				);
			const refused = await exportFebruary();
			assert.equal(refused.status, 422);
			assert.match(JSON.stringify(refused.value), /2026-01.*contribution funding/);
			const receive = (extra: Readonly<Record<string, unknown>>) =>
				writeRows(session, 'payslips', 'update', [
					{ id: slip.id, funding_received: slip.unfunded_contributions, ...extra }
				]);
			assert.match(JSON.stringify((await receive({})).value), /receipt date and reference/);
			requireAccepted(
				(
					await receive({
						funding_received_on: '2026-02-27',
						funding_reference: 'SYNTHETIC-RECEIPT'
					})
				).value,
				'record receipt'
			);
			requireAccepted((await pay()).value, 'settle funded January');
			assert.match(JSON.stringify((await receive({ funding_received: 0 })).value), /already paid/);
			const exported = await exportFebruary();
			assert.equal(exported.status, 200);
			assert.match(JSON.stringify(exported.value), /bank-files/);
		} finally {
			await session.stop();
		}
	}
);

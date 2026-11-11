// The salary listing is laid out as payroll teams keep theirs: a sheet per run, the company and the month above a group
// row and upper-case headers, who the person is, then pay to GROSS, deductions and the employee's statutory portion to
// NET, the employer's portion and the cost to the company, every figure the payslip's own.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { metroBank, ocbcFast } from '../src/lib/export_format_configuration/bank_files.ts';
import { exportRows } from '../src/lib/export_format_configuration/export_rows.ts';
import {
	sheetsOf,
	workbookOf
} from '../src/lib/export_format_configuration/salary_listing_export.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { ENTITY, pack, workspace } from './kit.ts';

const terms = {
	rate: { amount: 8000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {},
	job_title: 'Engineer',
	department: 'Operations'
};
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-10-15');

describe('the salary listing', () => {
	it.live('lays a run out as the listing, every figure its payslip’s', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-10', kind: 'ON_CYCLE' }]);
			const { payroll_run, payslip } = yield* t.storedQuery({
				payroll_run: { fields: ['period', 'kind', 'entity_id', 'settings_id'], limit: 10 },
				'payroll_run.entity_id': { fields: ['name'] },
				'payroll_run.settings_id': { fields: ['currency'] },
				payslip: {
					fields: [
						'payroll_run_id',
						'employee_id',
						'employment_id',
						'gross_earnings',
						'net_pay',
						'breakdown'
					],
					limit: 100
				},
				'payslip.employment_id': {
					fields: [
						'employee_number',
						'employee_id',
						'terms',
						'payroll',
						'service_started_on',
						'effective_range'
					]
				},
				'payslip.employment_id.employee_id': { fields: ['name'] }
			});
			const { employee_contract } = yield* t.storedQuery({
				employee_contract: { fields: ['employee_id', 'effective_range'], limit: 100 }
			});
			const sheets = sheetsOf({
				runs: payroll_run.rows,
				slips: payslip.rows,
				versions: employee_contract.rows
			});
			const [slip] = payslip.rows;
			assert.ok(slip !== undefined);
			const ws = workbookOf(sheets).getWorksheet('OCT 2026');
			assert.ok(ws !== undefined);
			assert.equal(
				ws.getCell(1, 1).value,
				String(payroll_run.rows[0]?.entity_id?.name).toUpperCase()
			);
			assert.match(String(ws.getCell(2, 1).value), /^STAFF SALARY LISTING - OCT 2026 \(MYR\)$/);

			const headers: string[] = [];
			ws.getRow(4).eachCell({ includeEmpty: true }, (cell) =>
				headers.push(String(cell.value ?? ''))
			);
			assert.deepEqual(headers.slice(0, 7), [
				'POSITION',
				'DEPARTMENT',
				'EMPLOYEE CODE',
				'NAME',
				'IC / ID NO.',
				'DATE JOIN',
				'LAST DAY'
			]);
			const at = (header: string) => headers.indexOf(header) + 1;
			const portion = (group: string) =>
				headers.filter((_, index) => ws.getCell(3, index + 1).value === group);
			// the largest scheme first and the tax last, as the listings read
			const employee = portion('EMPLOYEE PORTION');
			assert.equal(employee[0], 'EPF');
			assert.ok(employee.includes('SOCSO') && employee.includes('EIS'));
			if (employee.includes('PCB')) assert.equal(employee.at(-1), 'PCB');
			assert.ok(portion('EMPLOYER PORTION').includes('EPF'));
			assert.ok(at('GROSS PAY') < at('EPF') && at('EPF') < at('NET PAY'));
			assert.ok(at('NET PAY') < at('COST TO COMPANY'));

			const row = ws.getRow(5);
			assert.equal(row.getCell(1).value, 'Engineer');
			assert.equal(row.getCell(2).value, 'Operations');
			assert.equal(row.getCell(at('GROSS PAY')).value, slip.gross_earnings?.toNumber());
			assert.equal(row.getCell(at('NET PAY')).value, slip.net_pay?.toNumber());
			const sum = (group: string) =>
				headers.reduce(
					(total, _, index) =>
						ws.getCell(3, index + 1).value === group
							? total + Number(row.getCell(index + 1).value)
							: total,
					0
				);
			assert.equal(
				Number(row.getCell(at('COST TO COMPANY')).value).toFixed(2),
				(
					Number(slip.net_pay?.toNumber()) +
					sum('EMPLOYEE PORTION') +
					sum('EMPLOYER PORTION')
				).toFixed(2)
			);
			assert.equal(ws.getRow(6).getCell(4).value, 'TOTAL');
			assert.deepEqual(ws.getRow(6).getCell(at('NET PAY')).value, {
				formula: `SUM(${ws.getColumn(at('NET PAY')).letter}5:${ws.getColumn(at('NET PAY')).letter}5)`,
				result: slip.net_pay?.toNumber()
			});
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-05T02:00:00.000Z' })))
	);
});

describe('a run’s payments, as the bank files and the listing rows read them', () => {
	// the fixture's own agreed allowance, so the run pays one allowance line
	const paid = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{ ...terms, allowances: { MEAL_ALLOWANCE: { amount: 150 } } },
		{},
		[],
		[],
		'2026-10-15'
	);
	it.live(
		'one row a payslip, its net, its allowances and the contract’s bank as stored; each bank file lays it out once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* t
					.as(t.admin)
					.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-10', kind: 'ON_CYCLE' }]);
				const { payroll_run, payslip } = yield* t.storedQuery({
					payroll_run: { limit: 10 },
					payslip: { limit: 10 }
				});
				const [run] = payroll_run.rows;
				const [slip, ...more] = payslip.rows;
				assert.ok(run !== undefined && slip !== undefined);
				assert.deepEqual(more, []);
				const net = Number(slip.net_pay?.toNumber());
				const allowances = Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
					.lines.filter((line) => line.source === 'allowance_catalog')
					.reduce((total, line) => total + line.amount, 0);
				assert.ok(net > 0 && allowances > 0);
				const rows = yield* exportRows(t.storedQuery, run.id);
				assert.equal(rows.length, 1);
				const [row] = rows;
				assert.ok(row !== undefined);
				assert.deepEqual(
					[row.employee_number, row.bank_code, row.bank_account_number, row.bank_account_name],
					['W1', '001', '1', 'Worker']
				);
				assert.equal(row.net_pay, net);
				assert.equal(row.gross_earnings, slip.gross_earnings?.toNumber());
				assert.equal(row.allowances, allowances);
				// the amount is whole cents, zero-filled, once in each file's one line
				const cents = String(Math.round(net * 100));
				for (const [format, width, amount] of [
					[ocbcFast, 107, 15],
					[metroBank, 79, 12]
				] as const) {
					const [record, ...others] = format.records(rows);
					assert.deepEqual(others, []);
					const line = String(record?.line);
					assert.equal(line.length, width);
					assert.equal(line.split(cents.padStart(amount, '0')).length, 2);
					assert.ok(line.includes('W1'));
				}
				// a value longer than its field is refused, never cut
				assert.throws(
					() => metroBank.records([{ ...row, bank_code: '12345' }]),
					/Export value '12345' exceeds its 4-character field/
				);
			}).pipe(Effect.provide(workspace({ seed: paid, now: '2026-11-05T02:00:00.000Z' })))
	);
});

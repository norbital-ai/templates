// The salary listing is laid out as payroll teams keep theirs: a sheet per run, the company and the month above a group
// row and upper-case headers, who the person is, then the subtotal chain band by band (each band's lines, closed by its
// subtotal; the tax withheld beside the tax), GROSS and NET, the employer's portion and the cost to the company, every
// figure the payslip's own.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { metroBank, ocbcFast } from '../../src/lib/export_format_configuration/bank_files.ts';
import { employeeReference } from '../../src/lib/export_format_configuration/export_format.ts';
import { exportRows } from '../../src/lib/export_format_configuration/export_rows.ts';
import {
	sheetsOf,
	workbookOf
} from '../../src/lib/export_format_configuration/salary_listing_export.ts';
import { inForce } from '../../src/lib/dated.ts';
import { jsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { termsChange } from '../../src/lib/person.ts';
import {
	ENTITY,
	pack,
	storedQuery,
	storedReader,
	workspace,
	decimalNumber,
	packTerms
} from '../kit.ts';

const terms = { ...packTerms(8000), job_title: 'Engineer', department: 'Operations' };
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []);

describe('the salary listing', () => {
	it.live('lays a run out as the listing, every figure its payslip’s', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
			});
			const { payroll_run, payslip, jurisdiction } = yield* storedQuery(t, {
				payroll_run: {
					fields: ['period', 'kind', 'entity_id', 'salary_coverage'],
					limit: 10,
					entity_id: { fields: ['name', 'settings_code'] }
				},
				jurisdiction: { fields: ['code', 'currency'], limit: 1000 },
				payslip: {
					fields: [
						'payroll_run_id',
						'employee_id',
						'employment_id',
						'gross_earnings',
						'net_pay',
						'breakdown'
					],
					limit: 100,
					employment_id: {
						fields: ['employee_number', 'employee_id', 'service_started_on'],
						employee_id: { fields: ['name', 'identity_number'] },
						terms: { fields: ['effective_from', 'clears', 'job_title', 'department'] }
					}
				}
			});
			const { employment } = yield* storedQuery(t, {
				employment: { fields: ['employee_id', 'effective_range'], limit: 100 }
			});
			const closes = new Map(
				payroll_run.rows.map((run) => [run.id, String(run.salary_coverage.to ?? '')])
			);
			// a run is paid in the currency of its company's jurisdiction
			const currency = new Map(jurisdiction.rows.map((row) => [row.code, row.currency]));
			const sheets = sheetsOf({
				runs: payroll_run.rows.map((run) => ({
					...run,
					currency: currency.get(run.entity_id?.settings_code ?? '')
				})),
				// each payslip with its stint as it stood at the period's end
				slips: payslip.rows.map((slip) => {
					const stint = slip.employment_id;
					if (stint == null) return { ...slip, employment_id: null };
					const agreed = inForce(
						stint.terms.map((row) => termsChange(jsonObject(row))),
						closes.get(slip.payroll_run_id) ?? ''
					).state;
					return {
						...slip,
						employment_id: {
							employee_number: stint.employee_number,
							employee_id: stint.employee_id,
							service_started_on: stint.service_started_on,
							terms: { job_title: agreed.job_title, department: agreed.department },
							payroll: { identity_number: stint.employee_id?.identity_number }
						}
					};
				}),
				stints: employment.rows
			});
			const [slip] = payslip.rows;
			assert.ok(slip !== undefined);
			const ws = workbookOf(sheets).getWorksheet('FEB 2026');
			assert.ok(ws !== undefined);
			assert.equal(
				ws.getCell(1, 1).value,
				String(payroll_run.rows[0]?.entity_id?.name).toUpperCase()
			);
			assert.match(String(ws.getCell(2, 1).value), /^STAFF SALARY LISTING - FEB 2026 \(MYR\)$/);

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
			const groupOf = (column: number) => String(ws.getCell(3, column).value ?? '');
			const row = ws.getRow(5);
			const cell = (column: number) => Number(row.getCell(column).value);
			const breakdown = Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown);
			const taxed = breakdown.statutory.some(
				(scheme) => scheme.kind === 'TAX' && scheme.employee !== 0
			);
			// each band of the subtotal chain is grouped under its name and closes with the payslip's own checkpoint
			for (const point of breakdown.checkpoints) {
				const close = headers.findIndex(
					(header, index) => header === point.name.toUpperCase() && groupOf(index + 1) === header
				);
				if (close >= 0) assert.equal(cell(close + 1), point.value, point.name);
			}
			// the employee's statutory shares read as deductions, the largest scheme first, in the band they are taken in;
			// the tax withheld closes the band that holds the tax
			const employee = headers.filter(
				(header, index) =>
					['EPF', 'SOCSO', 'EIS', 'PCB'].includes(header) &&
					groupOf(index + 1) !== "EMPLOYER'S PORTION"
			);
			assert.equal(employee[0], 'EPF');
			assert.ok(employee.includes('SOCSO') && employee.includes('EIS'));
			assert.ok(cell(at('EPF')) < 0);
			assert.ok(taxed, 'the fixture pays tax');
			assert.ok(at('PCB') > 0 && at('PCB') < at('TAX WITHHELD'));
			assert.equal(groupOf(at('TAX WITHHELD')), groupOf(at('PCB')));
			const employer = headers
				.map((header, index) => [header, index + 1] as const)
				.filter(([, column]) => groupOf(column) === "EMPLOYER'S PORTION");
			assert.ok(employer.some(([header]) => header === 'EPF'));
			assert.ok(at('GROSS PAY') < at('EPF') && at('EPF') < at('NET PAY'));
			const [first] = employer;
			const last = employer.at(-1);
			assert.ok(first !== undefined && last !== undefined);
			assert.ok(at('NET PAY') < first[1] && last[1] < at('COST TO COMPANY'));

			assert.equal(row.getCell(1).value, 'Engineer');
			assert.equal(row.getCell(2).value, 'Operations');
			assert.equal(cell(at('GROSS PAY')), decimalNumber(slip.gross_earnings));
			assert.equal(cell(at('NET PAY')), decimalNumber(slip.net_pay));
			const contributions = headers.reduce(
				(total, header, index) =>
					['EPF', 'SOCSO', 'EIS'].includes(header) && groupOf(index + 1) !== "EMPLOYER'S PORTION"
						? total - cell(index + 1)
						: total,
				0
			);
			assert.equal(
				cell(at('COST TO COMPANY')).toFixed(2),
				(
					Number(decimalNumber(slip.net_pay)) +
					contributions +
					cell(at('TAX WITHHELD')) +
					employer.reduce((total, [, column]) => total + cell(column), 0)
				).toFixed(2)
			);
			assert.equal(ws.getRow(6).getCell(4).value, 'TOTAL');
			assert.deepEqual(ws.getRow(6).getCell(at('NET PAY')).value, {
				formula: `SUM(${ws.getColumn(at('NET PAY')).letter}5:${ws.getColumn(at('NET PAY')).letter}5)`,
				result: decimalNumber(slip.net_pay)
			});
		}).pipe(Effect.provide(workspace({ seed, now: '2026-03-05T02:00:00.000Z' })))
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
		[]
	);
	it.live(
		'one row a payslip, its net, its allowances and the person’s bank as stored; each bank file lays it out once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
				});
				const { payroll_run, payslip } = yield* storedQuery(t, {
					payroll_run: { limit: 10 },
					payslip: { limit: 10 }
				});
				const [run] = payroll_run.rows;
				const [slip, ...more] = payslip.rows;
				assert.ok(run !== undefined && slip !== undefined);
				assert.deepEqual(more, []);
				const net = Number(decimalNumber(slip.net_pay));
				const allowances = Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
					.lines.filter((line) => line.source === 'allowance_catalog')
					.reduce((total, line) => total + line.amount, 0);
				assert.ok(net > 0 && allowances > 0);
				const rows = yield* exportRows(storedReader(t), run.id);
				assert.equal(rows.length, 1);
				const [row] = rows;
				assert.ok(row !== undefined);
				assert.deepEqual(
					[row.employee_number, row.bank_code, row.bank_account_number, row.bank_account_name],
					['W1', '001', '1', 'Worker']
				);
				assert.equal(row.net_pay, net);
				assert.equal(row.gross_earnings, decimalNumber(slip.gross_earnings));
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
			}).pipe(Effect.provide(workspace({ seed: paid, now: '2026-03-05T02:00:00.000Z' })))
	);
});

describe('employee export reference', () => {
	it('formats the rolling number with the entity name in snake case', () => {
		assert.equal(
			employeeReference('HR-0001', 'Demo Singapore Pte. Ltd.'),
			'HR-0001-demo_singapore_pte_ltd'
		);
		assert.equal(employeeReference('CN0001', 'CN Demo'), 'HR-0001-cn_demo');
		assert.equal(employeeReference('HR-0042', ''), 'HR-0042');
	});
});

import ExcelJS from 'exceljs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
	leaveBalanceWorkbook,
	type LeaveBalanceReportRow
} from '../../src/lib/leave/balance-report.ts';
import { boot, officeWeek, type Host, type Row } from './payroll-probe.ts';

let host: Host;
beforeAll(async () => {
	host = await boot();
}, 300_000);
afterAll(() => host?.close());

it('exports real production leave-balance query rows into a readable XLSX', async () => {
	const refs = new Map<string, string>();
	const create = async (collection: string, values: Row, ref: string) => {
		const resolved = JSON.parse(
			JSON.stringify(values, (_key, value: unknown) =>
				typeof value === 'string' && value.startsWith('@') ? refs.get(value.slice(1)) : value
			)
		) as Row;
		const rows = await host.act(`${collection}.create`, resolved);
		refs.set(ref, String(rows.find((row) => row.collection === collection)!.id));
	};
	await create(
		'companies',
		{
			name: 'Leave export production probe',
			settings_code: 'MY',
			facts: {
				hrd_scope: 'PART_I',
				hrd_registration_class: 'NOT_REGISTERED',
				hrd_form2_count: 0,
				hrd_education_schedule_code: 'NONE'
			},
			pay_cutoff_day: 1,
			pay_frequency: 'MONTHLY',
			effective_range: { from: '2020-01-01', to: null }
		},
		'company'
	);
	for (const input of officeWeek('2020-01-01'))
		await create(input.collection, input.values, input.ref!);
	await create(
		'employees',
		{
			name: 'Leave Export Employee',
			date_of_birth: '1990-01-01',
			gender: 'MALE',
			nationality: 'Malaysian',
			marital_status: 'SINGLE',
			spouse_status: 'NONE'
		},
		'employee'
	);
	await create(
		'employments',
		{
			employee_id: '@employee',
			company_id: '@company',
			employee_number: 'EXPORT001',
			effective_range: { from: '2020-01-01', to: null }
		},
		'employment'
	);
	await create(
		'employment_terms',
		{
			employment_id: '@employment',
			residency_status: 'CITIZEN',
			tax_residency: 'RESIDENT',
			currency: 'MYR',
			base_salary: 3000,
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
			facts: { worksite_state: 'SELANGOR' },
			shift_pattern_id: '@week',
			effective_range: { from: '2020-01-01', to: null }
		},
		'terms'
	);
	const { rows } = (await host.query('leave_entries.leave_balance_report', {
		company_id: refs.get('company')!,
		as_of: '2026-06-01'
	})) as unknown as { rows: LeaveBalanceReportRow[]; next_cursor: string | null };
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		employee_number: 'EXPORT001',
		name: 'Leave Export Employee',
		service_start: '2020-01-01'
	});
	const annual = rows[0]!.balances.find((balance) => balance.code.startsWith('ANNUAL'))!;
	expect(annual.balance).toBeGreaterThan(0);
	const workbook = leaveBalanceWorkbook({
		company: 'Leave export production probe',
		asOf: '2026-06-01',
		rows
	});
	const bytes = await workbook.xlsx.writeBuffer();
	expect(bytes.byteLength).toBeGreaterThan(1000);
	const decoded = new ExcelJS.Workbook();
	await decoded.xlsx.load(bytes);
	const sheet = decoded.getWorksheet('Leave balances')!;
	expect(sheet.getCell('A1').value).toBe('Leave export production probe');
	expect(sheet.getCell('A6').value).toBe('EXPORT001');
	expect(sheet.getCell('B6').value).toBe('Leave Export Employee');
	expect(sheet.getCell('L6').value).toBe(Math.round(annual.balance! * 100) / 100);
}, 300_000);

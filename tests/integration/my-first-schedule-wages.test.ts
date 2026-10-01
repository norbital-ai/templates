import { expect, it } from 'vitest';
import {
	committed,
	NIHON_MY,
	recordNihonBirthDates,
	recordNihonEisFacts,
	recordNihonEpfFacts,
	recordNihonWorksites,
	workspace
} from './kit.ts';
import { settingsVersions } from '../fixtures/statutory-world.ts';

const MY_JAN_2026 = settingsVersions('MY').find(
	(row) => row.voided_at == null && String(row.effective_range.start).startsWith('2025-12')
)!.id;
const EMPLOYMENT = 'c02333ba-9a22-5a05-807b-f4e2e8234cfd';
const TERMS = '19944fee-1768-544c-a662-6bbf0be20395';

it('saved MY First Schedule allowance removes overtime coverage above RM4,000', async () => {
	const t = await workspace({ now: '2026-03-01T02:00:00.000Z' });
	await recordNihonBirthDates(t);
	await recordNihonWorksites(t);
	await recordNihonEisFacts(t);
	await recordNihonEpfFacts(t);
	const admin = t.as(t.admin);
	const sua = (
		await admin.read('allowance_catalogue', {
			where: { settings_id: { eq: MY_JAN_2026 }, code: { eq: 'SUA' } },
			select: { code: true, settings_id: true, counts_toward: true },
			limit: 1
		})
	).rows[0]!;
	expect(sua.counts_toward).toContain('FIRST_SCHEDULE_WAGES');
	const terms = await admin.get('employment_terms', TERMS);
	expect(terms!.base_salary).toEqual({ $dec: '3937' });
	committed(
		await admin.act('employment_terms.update', {
			target: TERMS,
			set: { effective_range: { from: '2021-06-21', to: '2026-02-20' } }
		})
	);
	const successor = committed(
		await admin.act('employment_terms.create', {
			employment_id: EMPLOYMENT,
			residency_status: 'CITIZEN',
			currency: 'MYR',
			base_salary: 3937,
			allowances: [{ catalogue_id: sua.id, amount: 200 }],
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			facts: { worksite_state: 'SELANGOR' },
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
			shift_pattern_id: '471d2ff0-2c76-5b66-9ffd-de10ab16813d',
			effective_range: { from: '2026-02-21', to: null }
		})
	)[0]!;
	expect((await admin.get('employment_terms', successor.id as string))!.allowances).toEqual([
		{ catalogue_id: sua.id, amount: 200 }
	]);
	committed(
		await admin.act('work_days.create', {
			employment_id: EMPLOYMENT,
			work_date: '2026-02-23',
			shift_definition_id: '13225822-59de-5968-a5d9-ee0561ac370d',
			worked_intervals: [{ start: '2026-02-23T09:00:00+08:00', end: '2026-02-23T20:00:00+08:00' }],
			approved_overtime_hours: 2
		})
	);
	const run = committed(
		await admin.act('payroll_runs.create', { company_id: NIHON_MY, period: '2026-02' })
	);
	const slip = (
		await admin.read('payslips', {
			where: {
				payroll_run_id: { eq: run.find((row) => row.collection === 'payroll_runs')!.id as string },
				employment_id: { eq: EMPLOYMENT }
			},
			select: { base: true, adjustments: true },
			limit: 1
		})
	).rows[0]!;
	expect(slip.base.some((row) => row.component_code === 'SUA' && row.amount > 0)).toBe(true);
	expect(
		slip.adjustments.filter((row) => row.family === 'WORK_DAY' && row.label.includes('OT'))
	).toEqual([]);
	const capturedDay = (
		await admin.read('work_days', {
			where: { employment_id: { eq: EMPLOYMENT }, work_date: { eq: '2026-02-23' } },
			select: { payslip_id: true },
			limit: 1
		})
	).rows[0]!;
	expect(capturedDay.payslip_id).toBe(slip.id);
}, 30_000);

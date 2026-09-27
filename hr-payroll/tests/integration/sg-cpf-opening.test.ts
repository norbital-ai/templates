import { expect, it } from 'vitest';
import {
	committed,
	declareSgSdl,
	NORBITAL_SG,
	SG_2026_H2,
	SG_EMPLOYMENT,
	workspace
} from './kit.ts';

for (const [origin, expected] of [
	['OTHER_EMPLOYER', [27_500, 5500, 4675]],
	['CURRENT_EMPLOYER', [12_000, 2400, 2040]],
	['APPROVED_RELATED_EMPLOYER', [12_000, 2400, 2040]]
] as const) {
	it(`saved Singapore CPF ${origin} opening governs the December 2026 AW charge`, async () => {
		const t = await workspace({ now: '2026-12-30T02:00:00.000Z' });
		const admin = t.as(t.admin);
		await declareSgSdl(t, SG_2026_H2);
		const employment = await admin.get('employments', SG_EMPLOYMENT);
		const cpf = (
			await admin.read('statutory_contributions', {
				where: { settings_id: { eq: SG_2026_H2 }, code: { eq: 'CPF' } },
				limit: 1
			})
		).rows[0]!;
		expect(cpf.opening_scope).toBe('EMPLOYER');
		const opening = {
			year: '2026',
			base: 90_000,
			ordinary: 90_000,
			employee: 18_000,
			employer: 15_300,
			reference: 'Employer CPF statement',
			origin,
			...(origin === 'APPROVED_RELATED_EMPLOYER'
				? {
						board_approval_reference: 'CPF-BOARD-APPROVAL',
						employers_related: true,
						employee_informed: true,
						terms_unchanged: true,
						transferred_employee: true
					}
				: {})
		};
		const fact = committed(
			await admin.act('employment_statutory_facts.create', {
				employee_id: employment!.employee_id!,
				employment_id: SG_EMPLOYMENT,
				statutory_contribution_id: cpf.id,
				effective_range: { from: '2026-01-01', to: null },
				status: { kind: 'REGISTERED', reference_number: 'S1234567A', opening: [opening] }
			})
		)[0]!;
		const saved = await admin.get('employment_statutory_facts', fact.id as string);
		expect(saved!.status.opening[0].origin).toBe(origin);
		const bonus = (
			await admin.read('adhoc_catalogue', {
				where: { settings_id: { eq: SG_2026_H2 }, code: { eq: 'bonus' } },
				limit: 1
			})
		).rows[0]!;
		committed(
			await admin.act('adhoc_requests.create', {
				employment_id: SG_EMPLOYMENT,
				catalogue_id: bonus.id,
				amount: 20_000,
				event_date: '2026-12-15',
				pay_period: '2026-12',
				reason: 'Year-end bonus',
				evidence_file: null,
				as_adjustment_entry: false
			})
		);
		const run = committed(
			await admin.act('payroll_runs.create', {
				company_id: NORBITAL_SG,
				period: '2026-12'
			})
		);
		const slip = (
			await admin.read('payslips', {
				where: {
					payroll_run_id: {
						eq: run.find((row) => row.collection === 'payroll_runs')!.id as string
					},
					employment_id: { eq: SG_EMPLOYMENT }
				},
				select: { statutory: true },
				all: true
			})
		).rows[0]!;
		const charge = slip.statutory.find((row) => row.scheme_code === 'CPF')!;
		expect([charge.base_amount, charge.employee_amount, charge.employer_amount]).toEqual(expected);
	});
}

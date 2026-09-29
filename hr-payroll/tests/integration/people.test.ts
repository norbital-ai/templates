/**
 * People: hiring writes the contract with its terms; a statutory declaration is checked against the scheme it names;
 * an employee reads their own payslips and no one else's. (Ports employment-contract, the statutory declaration
 * suites, public-seed-fact-contracts and the self-service read gates.)
 */
import { beforeEach, expect, it } from 'vitest';
import {
	committed,
	declareSgSdl,
	DION,
	NORBITAL_SG,
	recordSgShgFacts,
	refused,
	SG_2026_Q1,
	SG_EMPLOYMENT,
	workspace
} from './kit.ts';

let t: Awaited<ReturnType<typeof workspace>>;
beforeEach(async () => {
	t = await workspace();
});
const admin = () => t.as(t.admin);

it('hiring writes the employment and its first terms in one act', async () => {
	const person = committed(
		await admin().act('employees.create', { name: 'New Hire', email: 'new.hire@example.com' })
	)[0]!.id as string;
	const records = committed(
		await admin().act('employments.create', {
			employee_id: person,
			company_id: NORBITAL_SG,
			employee_number: 'NB-900',
			effective_range: { from: '2026-03-01', to: null },
			employment_terms: {
				create: [
					{
						residency_status: 'CITIZEN',
						currency: 'SGD',
						base_salary: 5000,
						pay_frequency: 'MONTHLY',
						work_classification: 'EA_COVERED',
						employment_type: 'PERMANENT',
						shift_pattern_id: 'b049218b-9b19-577a-8bc6-a3d08cd61ab2', // Norbital's office week
						effective_range: { from: '2026-03-01', to: null }
					}
				]
			}
		})
	);
	expect(records.map((row) => row.collection).toSorted()).toEqual([
		'employment_terms',
		'employments'
	]);
});

it('payment assessments are refused on a scheme that does not assess per unit', async () => {
	const employment = await admin().get('employments', SG_EMPLOYMENT);
	const [cpf] = (
		await admin().read('statutory_contributions', { where: { code: { eq: 'CPF' } }, limit: 1 })
	).rows;
	expect(
		refused(
			await admin().act('employment_statutory_facts.create', {
				employee_id: employment!.employee_id!,
				employment_id: SG_EMPLOYMENT,
				statutory_contribution_id: cpf!.id!,
				effective_range: { from: '2026-01-01', to: null },
				status: {
					kind: 'REGISTERED',
					reference_number: 'S1234567A',
					unit_assessments: [{ period: '2026-01', gross: 100, units: 1, reference: 'P-1' }]
				}
			})
		)
	).toMatch(/per unit/);
});

it('an employee reads their own payslips and no one else’s', async () => {
	await declareSgSdl(t, SG_2026_Q1);
	await recordSgShgFacts(t);
	committed(
		await admin().act('payroll_runs.create', { company_id: NORBITAL_SG, period: '2026-01' })
	);
	const employee = t.as(t.member(['employee'], { email: DION }));
	const mine = await employee.read('payslips', { where: {}, all: true });
	expect(mine.rows).toHaveLength(1);
	expect((await admin().read('payslips', { where: {}, all: true })).rows).toHaveLength(3);
});

/**
 * A loan and its schedule are one write; payroll recovers one instalment a slip from net pay, needs an advance's
 * actual disbursement date (SG EA s.31(1)), and a recovered instalment is money history. (Ports public-seed-loan-schedule
 * and loan-form, with the approval reference and disbursement date of the deduction-limit work.)
 */
import { beforeEach, expect, it } from 'vitest';
import {
	committed,
	declareSgSdl,
	NORBITAL_SG,
	refused,
	SG_2026_Q1,
	SG_EMPLOYMENT,
	workspace
} from './kit.ts';

let t: Awaited<ReturnType<typeof workspace>>;
beforeEach(async () => {
	t = await workspace();
	await declareSgSdl(t, SG_2026_Q1);
});
const admin = () => t.as(t.admin);

async function advance(extra: { disbursed_on?: string; approval_reference?: string } = {}) {
	const [catalogue] = (
		await admin().read('loan_catalogue', {
			where: { settings_id: { eq: SG_2026_Q1 }, code: { eq: 'SALARY_ADVANCE' } },
			limit: 1
		})
	).rows;
	const records = committed(
		await admin().act('loans.create', {
			employment_id: SG_EMPLOYMENT,
			loan_catalogue_id: catalogue!.id!,
			principal: 1000,
			effective_range: { from: '2026-02-01', to: '2026-03-31' },
			reference: 'ADV-1',
			...extra,
			loan_repayments: {
				create: [
					{ due_date: '2026-02-15', amount_due: 500, sequence: 1 },
					{ due_date: '2026-03-15', amount_due: 500, sequence: 2 }
				]
			}
		})
	);
	return records.find((row) => row.collection === 'loans')!.id as string;
}

it('a loan is written with its schedule, disbursement date and approval reference', async () => {
	const id = await advance({ disbursed_on: '2026-01-20', approval_reference: 'MOM/2026/1' });
	const loan = await admin().get('loans', id);
	expect(loan).toMatchObject({ approval_reference: 'MOM/2026/1', reference: 'ADV-1' });
	const schedule = await admin().read('loan_repayments', {
		where: { loan_id: { eq: id } },
		all: true
	});
	expect(schedule.rows).toHaveLength(2);
});

it('payroll refuses to recover an advance without its disbursement date', async () => {
	await advance();
	expect(
		refused(
			await admin().act('payroll_runs.create', { company_id: NORBITAL_SG, period: '2026-02' })
		)
	).toMatch(/disbursement date/);
});

it('a run recovers one instalment, which then cannot change', async () => {
	const id = await advance({ disbursed_on: '2026-01-20' });
	committed(
		await admin().act('payroll_runs.create', { company_id: NORBITAL_SG, period: '2026-02' })
	);
	const schedule = (
		await admin().read('loan_repayments', { where: { loan_id: { eq: id } }, all: true })
	).rows.toSorted((a, b) => Number(a.sequence) - Number(b.sequence));
	expect(schedule.map((row) => row.payslip_id != null)).toEqual([true, false]);
	expect(
		refused(
			await admin().act('loans.update', {
				target: id,
				set: {
					loan_repayments: {
						update: [{ target: schedule[0]!.id as string, set: { amount_due: 400 } }]
					}
				}
			})
		)
	).toMatch(/settled/);
});

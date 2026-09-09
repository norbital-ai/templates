// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A loan agreed under an earlier revision is still recovered.
 *
 * A lineage seals a new settings version whenever the law changes, and sealing rewrites every
 * catalogue row under a new id. A loan pins the `loan_catalogue` row it was agreed against, so from
 * the next version onward that id is in no run's catalogue: resolving the recovery line by id found
 * nothing and every remaining instalment was silently skipped — the employee was never recovered
 * from, the balance stayed outstanding, and no payslip line or run issue said so.
 *
 * The code is what survives a revision. The loan's own row still decides everything it decided —
 * its eligibility and each treatment it stated — and the run's row of the same code fills only the
 * cells a scheme sealed later left it silent about, exactly as `treatmentsInForce` charges a money
 * request or a leave day. A code the run's version does not carry at all is a refusal by name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const NEW_SETTINGS_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffff0001';
const AGREED_ROW_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffff0002';
const CURRENT_ROW_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffff0003';
const LOAN_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffff0004';
const REPAYMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffff0005';
const WORK_ROW_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffff0006';
const INSTALMENT = 300;

const scheme = (id: string, settingsId: string, code: string, sequence: number) => ({
	id,
	settings_id: settingsId,
	is_statutory: true,
	code,
	name: `Public fixture ${code}`,
	authority: 'Public fixture',
	rounding: 'NEAREST_CENT',
	relief_for: [],
	sequence,
	special_rules: [],
	bands: [
		{
			selector: { by: 'WAGE', from: 0, to: null },
			award: { kind: 'PERCENT', employee: 10, employer: 10 }
		}
	],
	approval_id: null
});

const workTreatment = (kind: string) => ({
	salary: { kind },
	overtime: { kind },
	overtime_excess: { kind },
	absence: { kind: 'REDUCE' }
});

type LoanWorldOptions = {
	/** The code the run's version carries, when it is not the one the loan was agreed under. */
	readonly currentCode?: string;
	/** The eligibility the agreed row states; '' is everyone. */
	readonly eligibility?: string;
	readonly dueDate?: string;
	/** What an earlier PAID run already recovered from the instalment. */
	readonly alreadyRecovered?: number;
};

/**
 * Two sealed versions of one lineage. `PUB-OLD` is levied by both; `PUB-NEW` is sealed into the
 * second only, the way a scheme introduced by a law change is. The loan is agreed against the first
 * version's `STAFF_LOAN` row and recovered by a run that prices under the second.
 */
function loanWorld(options: LoanWorldOptions = {}) {
	const world = createPublicPayrollWorld();
	// The standing transport allowance has no row under the second version, and this test is about
	// a code that does; drop it so the only revision question is the loan's.
	world.allowance_requests = [];
	// Punch every rostered day so the wage is not eaten by absence; this test is about the grid.
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
		day.break_minutes = 60;
	}

	const oldSettings = world.jurisdiction_settings[0];
	world.jurisdiction_settings.push({
		...structuredClone(oldSettings),
		id: NEW_SETTINGS_ID,
		effective_range: { start: '2026-02-01', end: null }
	});
	oldSettings.effective_range = { start: '2020-01-01', end: '2026-02-01' };

	world.statutory_contributions.push(
		scheme('bbbbbbbb-cccc-4ddd-8eee-ffffffff0007', JURISDICTION_ID, 'PUB-OLD', 1),
		scheme('bbbbbbbb-cccc-4ddd-8eee-ffffffff0008', NEW_SETTINGS_ID, 'PUB-OLD', 1),
		scheme('bbbbbbbb-cccc-4ddd-8eee-ffffffff0009', NEW_SETTINGS_ID, 'PUB-NEW', 2)
	);

	world.work_catalogue[0].treatments = { 'PUB-OLD': workTreatment('INCLUDE') };
	world.work_catalogue.push({
		...structuredClone(world.work_catalogue[0]),
		id: WORK_ROW_ID,
		settings_id: NEW_SETTINGS_ID,
		treatments: {
			'PUB-OLD': workTreatment('INCLUDE'),
			'PUB-NEW': workTreatment('INCLUDE')
		}
	});

	const agreed = {
		id: AGREED_ROW_ID,
		settings_id: JURISDICTION_ID,
		code: 'STAFF_LOAN',
		name: 'Staff loan',
		// The row predates PUB-NEW, so it decides PUB-OLD and nothing else.
		contribution_treatments: { 'PUB-OLD': { kind: 'EXCLUDE' } },
		sequence: 70,
		eligibility: options.eligibility ?? '',
		approval_id: null
	};
	world.loan_catalogue = [
		agreed,
		{
			...structuredClone(agreed),
			id: CURRENT_ROW_ID,
			settings_id: NEW_SETTINGS_ID,
			code: options.currentCode ?? agreed.code,
			eligibility: '',
			// The current version decides both, and disagrees with the agreed row about PUB-OLD.
			contribution_treatments: { 'PUB-OLD': { kind: 'REDUCE' }, 'PUB-NEW': { kind: 'REDUCE' } }
		}
	];
	world.loans.push({
		id: LOAN_ID,
		employment_id: EMPLOYMENT_ID,
		loan_catalogue_id: agreed.id,
		principal: 900,
		reference: 'LN-1',
		effective_range: { start: '2026-01-01', end: '2026-06-30' },
		approval_id: null
	});
	world.loan_repayments.push({
		id: REPAYMENT_ID,
		loan_id: LOAN_ID,
		employment_id: EMPLOYMENT_ID,
		due_date: options.dueDate ?? '2026-02-15',
		amount_due: INSTALMENT,
		sequence: 1,
		approval_id: null
	});
	if (options.alreadyRecovered != null) {
		world.payroll_runs.push({
			id: 'run-2026-01',
			company_id: COMPANY_ID,
			period: '2026-01',
			lifecycle: 'PAID',
			approval_id: null
		});
		world.payslips.push({
			id: 'payslip-2026-01',
			payroll_run_id: 'run-2026-01',
			employment_id: EMPLOYMENT_ID,
			statutory: [],
			adjustments: [
				{ family: 'LOAN_REPAYMENT', source_id: REPAYMENT_ID, amount: options.alreadyRecovered }
			],
			approval_id: null
		});
		world.payslip_loan_repayment_inputs.push({
			id: 'capture-2026-01',
			payslip_id: 'payslip-2026-01',
			loan_repayment_id: REPAYMENT_ID
		});
	}
	return world;
}

const build = async (world) =>
	buildPayrollRun(
		await Effect.runPromise(
			gatherPayrollRun({
				api: memoryPayrollApi(world) as never,
				companyId: COMPANY_ID,
				period: '2026-02'
			})
		)
	);

const recoveryOf = (slip) => slip.adjustments.find((row) => row.family === 'LOAN_REPAYMENT');

test('a loan agreed under an earlier revision is recovered, at the run version’s treatment for a scheme sealed after it', async () => {
	const result = await build(loanWorld());
	const slip = result.payslip_payroll_run[0];
	const recovery = recoveryOf(slip);
	assert.ok(recovery != null, 'the instalment is recovered rather than silently skipped');
	assert.equal(recovery.amount, INSTALMENT);
	assert.equal(slip.payslip_loan_repayment_input_payslip[0]!.loan_repayment_id, REPAYMENT_ID);

	const baseOf = (code: string) =>
		slip.statutory.find((line) => line.scheme_code === code)?.base_amount;
	assert.ok(baseOf('PUB-OLD')! > 0, 'the wage itself is charged');
	// PUB-NEW did not exist when the loan was agreed, so it has no cell on the agreed row to keep and
	// the run's own row decides it — REDUCE, taking the recovery off the chargeable wage. PUB-OLD did
	// exist, and the agreed row's own EXCLUDE stands against the current row's REDUCE, so the whole
	// difference between the two bases is this instalment.
	assert.equal(baseOf('PUB-OLD')! - baseOf('PUB-NEW')!, INSTALMENT);
});

test('a loan whose code the run’s version does not carry refuses the run by name', async () => {
	// Sealing dropped STAFF_LOAN and wrote a differently named row: nothing in this version can
	// recover the loan, and paying the employee in full would leave the balance owed in silence.
	await assert.rejects(
		build(loanWorld({ currentCode: 'STAFF_LOAN_2026' })),
		/LOAN_COMPONENT_MISSING.*PF0001 owes a loan recovered through STAFF_LOAN/s
	);
});

test('the agreed row’s eligibility still excludes an ineligible person, without refusing the run', async () => {
	const result = await build(loanWorld({ eligibility: 'employee.gender == "MALE"' }));
	const slip = result.payslip_payroll_run[0];
	assert.equal(recoveryOf(slip), undefined);
	assert.equal(slip.payslip_loan_repayment_input_payslip.length, 0);
});

test('an instalment that is not yet due is not recovered early', async () => {
	const result = await build(loanWorld({ dueDate: '2026-05-15' }));
	assert.equal(recoveryOf(result.payslip_payroll_run[0]), undefined);
});

test('an instalment an earlier paid run settled in full is recovered no further', async () => {
	const result = await build(loanWorld({ alreadyRecovered: INSTALMENT }));
	assert.equal(recoveryOf(result.payslip_payroll_run[0]), undefined);
});

import { collection } from '@norbital-ai/bolt';
import { dateKey, dayInstant, isCalendarDate } from '../../../lib/iso-day.js';
import { readAll } from '../../../lib/reads.js';
import { decodeNumber } from '../../../lib/wire.js';
import { cents, fromMinorUnits, toMinorUnits } from '../../../lib/payroll/run/rounding.js';
import { governed, settingsInForce } from '../../../lib/jurisdiction_settings.js';
import { coversDate, readRange } from '../../../lib/payroll/run/effective.js';
import { isEligible, personContext, scalarFacts } from '../../../lib/payroll/run/eligibility.js';
import { resolveExitFacts } from '../../../lib/declared-facts.js';
import {
	assessVnPaymentWithholding,
	type VnPaymentWithholdingInput
} from '../../../lib/vn/payment-withholding.js';
import type { PayslipStatutory } from '../../../lib/datatypes/payslip_statutory.js';
import type { WorkspaceRow } from '../../../lib/rows.js';
import * as Predicate from 'effect/Predicate';

/** An actual payment and every source allocation commit together; no update or delete is exposed. */
const c = collection('payment_events', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'company_id',
				'employee_id',
				'kind',
				'paid_on',
				'reference',
				'non_cash_basis_reference',
				'external_source_kind',
				'external_source_id',
				'currency',
				'cash_amount'
			],
			with: {
				payment_allocations: {
					create: {
						columns: ['payable_tranche_id', 'gross_amount', 'non_event_deduction_amount']
					}
				},
				vn_payment_tax_facts: {
					create: {
						columns: [
							'withhold_below_threshold_requested',
							'request_received_on',
							'request_reference',
							'commitment_form_reference',
							'commitment_received_on',
							'commitment_tax_year',
							'commitment_tax_id',
							'commitment_sole_income_declared',
							'commitment_below_taxable_threshold_declared'
						]
					}
				},
				/** The transform alone adds completed slips after validating the whole committed ledger. */
				completed_payslips: { upsert: { columns: ['status', 'paid_at'] } }
			}
		}
	}
});

type Arc = { readonly collection: string; readonly id: string };
type Tranche = {
	readonly id: string;
	readonly settlement: Arc;
	readonly source_category: string;
	readonly source_kind: string;
	readonly source_id: string;
	readonly source_component: string | null;
	readonly reference: string;
	readonly due_on: string;
	readonly currency: string;
	readonly gross_amount: unknown;
	readonly non_event_deduction_amount: unknown;
	readonly tax_treatment: string;
};
type Allocation = {
	readonly payable_tranche_id: string;
	readonly currency?: string;
	readonly gross_amount: unknown;
	readonly non_event_deduction_amount: unknown;
};
type PriorAllocation = Allocation & { readonly payment_event_id: string };
type Slip = {
	readonly id: string;
	readonly payroll_run_id: string;
	readonly employment_id: string;
	readonly payment_mode: string;
	readonly status: string;
	readonly currency: string;
	readonly gross: unknown;
	readonly total_deductions: unknown;
	readonly net: unknown;
	readonly unfunded_contributions: unknown;
	readonly funding_received: unknown;
	readonly funding_received_on: string | null;
	readonly funding_reference: string | null;
	readonly statutory: readonly { readonly payment_occasion?: boolean | null }[] | null;
};
type Employment = {
	readonly id: string;
	readonly company_id: string;
	readonly employee_id: string;
	readonly effective_range: unknown;
	readonly exit_reason: string | null;
	readonly exit_facts: Record<string, unknown> | null;
};
type Run = { readonly id: string; readonly company_id: string; readonly period: string };
type Company = { readonly id: string; readonly settings_code: string };
type VnSettlement = {
	readonly id: string;
	readonly company_id: string;
	readonly employee_id: string;
	readonly currency: string;
	readonly tax_residency: string;
	readonly tax_residency_range: unknown;
	readonly tax_residency_reference: string;
	readonly relationship_reviewed_on: string;
	readonly relationship_reference: string;
	readonly income_nature_reference: string;
};
type Version = {
	readonly id: string;
	readonly code: string;
	readonly effective_range: unknown;
	readonly sealed_at: string | null;
	readonly voided_at: string | null;
	readonly approval_id: string | null;
	readonly payroll: {
		readonly tax_clearance?: { readonly when: string; readonly category: string };
	};
	readonly exit_facts: readonly unknown[];
};
type Hold = {
	readonly employment_id: string;
	readonly category: string;
	readonly directive_reference: string;
	readonly released_on: string | null;
};
type Movement = {
	readonly id: string;
	readonly ph_maternity_case_id: string;
	readonly kind: string;
	readonly amount: unknown;
	readonly paid_on: string;
	readonly payment_reference: string;
	readonly evidence_file: unknown | null;
};
type MaternityCase = {
	readonly id: string;
	readonly employee_id: string;
	readonly employment_id: string;
};

c.transform(async (inputs, ctx) => {
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	if (inputs.length !== 1)
		refuse('Record one actual payment event at a time so each payment is reconciled in order.');
	const input = inputs[0]!;
	if (!isCalendarDate(String(input.paid_on ?? '')))
		refuse('An actual payment needs a real paid-on day.', { field: 'paid_on' });
	const paidOn = String(input.paid_on);
	if (paidOn > dateKey(String(ctx.today)))
		refuse('An actual payment cannot be dated in the future.', { field: 'paid_on' });
	const currency = String(input.currency ?? '');
	const kind = input.kind ?? 'CASH';
	if (!String(input.reference ?? '').trim())
		refuse('An actual payment needs its evidence reference.', { field: 'reference' });
	if (kind === 'CASH' && input.non_cash_basis_reference != null)
		refuse('A cash payment cannot carry a non-cash settlement basis.');
	if (kind === 'NON_CASH_SETTLEMENT' && !String(input.non_cash_basis_reference ?? '').trim())
		refuse('A zero-cash settlement needs its documented legal basis.');
	if (input.completed_payslips != null)
		refuse('Completed payslips are derived from the payment allocations.');
	const externalKind = String(input.external_source_kind ?? '');
	const externalId = String(input.external_source_id ?? '');
	if ((externalKind === '') !== (externalId === ''))
		refuse('An external cash source needs both its kind and id.');
	if (externalKind !== '' && externalKind !== 'PH_MATERNITY_MOVEMENT')
		refuse('This external cash source is not supported.');
	if (kind === 'NON_CASH_SETTLEMENT' && externalKind !== '')
		refuse('An external cash credit must be a cash payment event.');
	const proposed = (input.payment_allocations?.create ?? []) as readonly Allocation[];
	if (proposed.length === 0)
		refuse('An actual payment needs at least one priced source allocation.');
	const ids = proposed.map((allocation) => String(allocation.payable_tranche_id));
	if (new Set(ids).size !== ids.length)
		refuse('A payment must allocate each payable tranche only once.');
	const requested = await readAll<Tranche>(ctx.db, 'payable_tranches', { id: { in: ids } });
	const byId = new Map(requested.map((row) => [row.id, row]));
	if (byId.size !== ids.length) refuse('A payment allocation names a missing payable tranche.');
	const slipIds = [
		...new Set(
			requested.flatMap((row) =>
				row.settlement.collection === 'payslips' ? [row.settlement.id] : []
			)
		)
	];
	const vnIds = [
		...new Set(
			requested.flatMap((row) =>
				row.settlement.collection === 'vn_noncontract_settlements' ? [row.settlement.id] : []
			)
		)
	];
	if (
		requested.some(
			(row) =>
				row.settlement.collection !== 'payslips' &&
				row.settlement.collection !== 'vn_noncontract_settlements'
		)
	)
		refuse('A payable tranche needs a supported settlement parent.');
	const [slips, vnParents, slipTranches, vnTranches] = await Promise.all([
		readAll<Slip>(ctx.db, 'payslips', { id: { in: slipIds } }),
		readAll<VnSettlement>(ctx.db, 'vn_noncontract_settlements', { id: { in: vnIds } }),
		readAll<Tranche>(ctx.db, 'payable_tranches', { settlement: { payslips: { in: slipIds } } }),
		readAll<Tranche>(ctx.db, 'payable_tranches', {
			settlement: { vn_noncontract_settlements: { in: vnIds } }
		})
	]);
	if (slips.length !== slipIds.length || vnParents.length !== vnIds.length)
		refuse('A payable tranche has a missing settlement parent.');
	const allTranches = [...slipTranches, ...vnTranches];
	const allIds = allTranches.map((row) => row.id);
	const maternityCaseIds = [
		...new Set(
			requested.flatMap((row) => (row.source_category === 'MATERNITY_PAY' ? [row.source_id] : []))
		)
	];
	const [prior, employments, runs, companies, movements, maternityCases] = await Promise.all([
		readAll<PriorAllocation>(ctx.db, 'payment_allocations', { payable_tranche_id: { in: allIds } }),
		readAll<Employment>(ctx.db, 'employments', {
			id: { in: slips.map((row) => row.employment_id) }
		}),
		readAll<Run>(ctx.db, 'payroll_runs', { id: { in: slips.map((row) => row.payroll_run_id) } }),
		readAll<Company>(ctx.db, 'companies', { id: String(input.company_id) }),
		readAll<Movement>(ctx.db, 'ph_maternity_movements', {
			id: { in: externalId === '' ? [] : [externalId] }
		}),
		readAll<MaternityCase>(ctx.db, 'ph_maternity_cases', { id: { in: maternityCaseIds } })
	]);
	const employmentById = new Map(employments.map((row) => [row.id, row]));
	const runById = new Map(runs.map((row) => [row.id, row]));
	const company = companies[0];
	if (company == null)
		refuse('An actual payment needs a paying company on file.', { field: 'company_id' });
	if (maternityCaseIds.length > 0 && company.settings_code !== 'PH')
		refuse('A Philippine maternity cash source needs a Philippine paying company.');
	const caseById = new Map(maternityCases.map((row) => [row.id, row]));
	for (const tranche of requested) {
		if (tranche.source_category !== 'MATERNITY_PAY') continue;
		const maternity = caseById.get(tranche.source_id);
		if (
			tranche.source_kind !== 'PH_MATERNITY_CASE' ||
			!['SSS_AWARD', 'EMPLOYER_DIFFERENTIAL'].includes(tranche.source_component ?? '') ||
			maternity == null ||
			maternity.employee_id !== input.employee_id ||
			!slips.some((slip) => slip.employment_id === maternity.employment_id)
		)
			refuse('Maternity cash must name the evidenced case for this person and employment.');
	}
	for (const slip of slips) {
		const employment = employmentById.get(slip.employment_id);
		const run = runById.get(slip.payroll_run_id);
		if (
			employment == null ||
			run == null ||
			employment.company_id !== company.id ||
			run.company_id !== company.id ||
			employment.employee_id !== input.employee_id
		)
			refuse('Every allocated payslip must belong to the same paying company and person.');
		if (slip.currency !== currency)
			refuse('Every allocated payslip must use the payment currency.');
		if (slip.payment_mode !== 'EVENT_LEDGER' || slip.status === 'PAID')
			refuse('Only an unsettled event-ledger payslip accepts payment allocations.');
		if (slip.statutory?.some((row) => row.payment_occasion === true))
			refuse(
				'This payslip has payment-date statutory charges; recalculate them for the actual payment before allocating cash.'
			);
	}
	for (const parent of vnParents)
		if (
			parent.company_id !== company.id ||
			parent.employee_id !== input.employee_id ||
			parent.currency !== currency
		)
			refuse(
				'Every allocated non-contract settlement must belong to the same paying company, person and currency.'
			);
	if (slips.length > 0 && vnParents.length > 0)
		refuse('A payment cannot mix employment payslips and non-contract remuneration.');
	if (vnParents.length > 1)
		refuse('One non-contract payment must name a single evidenced tax-residency settlement.');
	if (externalKind === 'PH_MATERNITY_MOVEMENT') {
		const movement = movements[0];
		if (
			movement == null ||
			movement.kind === 'SSS_REIMBURSEMENT' ||
			movement.evidence_file == null ||
			vnParents.length > 0 ||
			slipIds.length === 0
		)
			refuse('Only employee cash from an evidenced maternity movement can be credited.');
		if (movement.paid_on !== paidOn || movement.payment_reference !== input.reference)
			refuse('The credited maternity cash date and reference must match its movement.');
		const component = movement.kind === 'SSS_ADVANCE' ? 'SSS_AWARD' : 'EMPLOYER_DIFFERENTIAL';
		if (
			requested.some(
				(row) =>
					row.source_category !== 'MATERNITY_PAY' ||
					row.source_kind !== 'PH_MATERNITY_CASE' ||
					row.source_id !== movement.ph_maternity_case_id ||
					row.source_component !== component
			)
		)
			refuse(
				'The credited maternity cash must settle the matching cash component of the same maternity case.'
			);
		if (
			toMinorUnits(decodeNumber(movement.amount), currency) !==
			money(input.cash_amount, currency, 'Cash amount')
		)
			refuse('The credited maternity cash must equal its recorded movement amount.');
	}
	const usedGross = new Map<string, bigint>();
	const usedDeductions = new Map<string, bigint>();
	for (const allocation of prior) {
		if (allocation.currency !== currency)
			refuse('Existing payment allocations use a different currency from their frozen obligation.');
		usedGross.set(
			allocation.payable_tranche_id,
			(usedGross.get(allocation.payable_tranche_id) ?? 0n) +
				money(allocation.gross_amount, currency, 'Prior gross allocation')
		);
		usedDeductions.set(
			allocation.payable_tranche_id,
			(usedDeductions.get(allocation.payable_tranche_id) ?? 0n) +
				money(allocation.non_event_deduction_amount, currency, 'Prior deduction allocation', true)
		);
	}
	for (const tranche of allTranches) {
		if (tranche.currency !== currency)
			refuse('All payable tranches of the affected settlement must use its payment currency.');
		const sourceGross = money(tranche.gross_amount, currency, 'Tranche gross');
		const sourceDeductions = money(
			tranche.non_event_deduction_amount,
			currency,
			'Tranche deductions',
			true
		);
		const allocatedGross = usedGross.get(tranche.id) ?? 0n;
		const allocatedDeductions = usedDeductions.get(tranche.id) ?? 0n;
		if (
			sourceDeductions > sourceGross ||
			allocatedGross > sourceGross ||
			allocatedDeductions > sourceDeductions ||
			(allocatedGross === sourceGross && allocatedDeductions !== sourceDeductions)
		)
			refuse('Existing payment allocations no longer reconcile to their frozen source.');
	}
	let gross = 0n;
	let deductions = 0n;
	for (const allocation of proposed) {
		const tranche = byId.get(String(allocation.payable_tranche_id))!;
		if (tranche.currency !== currency)
			refuse('A payment allocation must use the source and event currency.');
		if (
			!tranche.source_kind.trim() ||
			!tranche.source_id.trim() ||
			!tranche.reference.trim() ||
			!isCalendarDate(tranche.due_on)
		)
			refuse('A payable tranche needs a priced source and contractual due date.');
		const amount = money(allocation.gross_amount, currency, 'Gross allocation');
		const deducted = money(
			allocation.non_event_deduction_amount,
			currency,
			'Deduction allocation',
			true
		);
		const trancheGross = money(tranche.gross_amount, currency, 'Tranche gross');
		const trancheDeduction = money(
			tranche.non_event_deduction_amount,
			currency,
			'Tranche deductions',
			true
		);
		if (trancheDeduction > trancheGross || deducted > amount)
			refuse('A payable tranche cannot deduct more than its allocated gross.');
		const totalGross = (usedGross.get(tranche.id) ?? 0n) + amount;
		const totalDeduction = (usedDeductions.get(tranche.id) ?? 0n) + deducted;
		if (totalGross > trancheGross || totalDeduction > trancheDeduction)
			refuse('A payment cannot allocate more gross or deductions than the frozen tranche.');
		if (totalGross === trancheGross && totalDeduction !== trancheDeduction)
			refuse(
				'A final gross allocation must also consume this tranche’s remaining priced deductions.'
			);
		usedGross.set(tranche.id, totalGross);
		usedDeductions.set(tranche.id, totalDeduction);
		gross += amount;
		deductions += deducted;
	}
	for (const slip of slips) {
		const itsTranches = slipTranches.filter((row) => row.settlement.id === slip.id);
		if (itsTranches.length === 0)
			refuse('An event-ledger payslip needs its complete priced payable tranches.');
		const sourceGross = itsTranches.reduce(
			(sum, row) => sum + money(row.gross_amount, currency, 'Tranche gross'),
			0n
		);
		const sourceDeductions = itsTranches.reduce(
			(sum, row) =>
				sum + money(row.non_event_deduction_amount, currency, 'Tranche deductions', true),
			0n
		);
		if (
			sourceGross !== money(slip.gross, currency, 'Payslip gross') ||
			sourceDeductions !== money(slip.total_deductions, currency, 'Payslip deductions', true) ||
			sourceGross - sourceDeductions !== money(slip.net, currency, 'Payslip net', true)
		)
			refuse(
				'Frozen payable tranches do not reconcile to this payslip. Recalculate the draft payroll.'
			);
	}
	let statutory: readonly PayslipStatutory[] = [];
	if (vnParents.length > 0) {
		if (kind !== 'CASH')
			refuse('Vietnam no-contract payment-date withholding requires an actual cash payment.');
		const facts = input.vn_payment_tax_facts?.create ?? [];
		if (facts.length !== 1)
			refuse('Vietnam non-contract withholding needs one payment-specific tax evidence row.');
		if (externalKind !== '')
			refuse('A Vietnam non-contract payment cannot use a maternity cash credit.');
		const versions = await readAll<Version>(ctx.db, 'jurisdiction_settings', {
			code: company.settings_code,
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			approval_id: { isNull: true }
		});
		const version = settingsInForce(versions, company.settings_code, paidOn);
		if (version == null || version.code !== 'VN')
			refuse('Sealed Vietnam payment-date settings are missing.');
		const schemes = await readAll<
			{ readonly id: string; readonly settings_id: string } & VnPaymentWithholdingInput['pit']
		>(ctx.db, 'statutory_contributions', { settings_id: version.id, code: 'PIT' });
		const pit = schemes[0];
		const range = governed(version.effective_range);
		if (pit == null || range == null)
			refuse('The sealed Vietnam PIT rule or its effective range is missing.');
		try {
			statutory = assessVnPaymentWithholding({
				event: {
					company_id: String(input.company_id),
					employee_id: String(input.employee_id),
					paid_on: paidOn,
					reference: String(input.reference),
					currency,
					gross_amount: fromMinorUnits(gross, currency),
					non_event_deduction_amount: fromMinorUnits(deductions, currency),
					cash_amount: decodeNumber(input.cash_amount)
				},
				allocations: proposed.map((allocation) => {
					const tranche = byId.get(String(allocation.payable_tranche_id))!;
					return {
						gross_amount: decodeNumber(allocation.gross_amount),
						non_event_deduction_amount: decodeNumber(allocation.non_event_deduction_amount),
						tranche: {
							...tranche,
							gross_amount: decodeNumber(tranche.gross_amount),
							tax_treatment: tranche.tax_treatment as 'TAXABLE' | 'EXEMPT'
						}
					};
				}),
				facts: {
					...facts[0]!,
					withhold_below_threshold_requested: facts[0]!.withhold_below_threshold_requested ?? false
				},
				settlement: {
					...vnParents[0]!,
					tax_residency: vnParents[0]!.tax_residency as 'RESIDENT' | 'NON_RESIDENT'
				},
				pit,
				settingsRange: range
			});
		} catch (error) {
			refuse(
				error instanceof Error
					? error.message
					: 'Vietnam payment-date withholding could not be calculated.'
			);
		}
	} else if ((input.vn_payment_tax_facts?.create ?? []).length > 0) {
		refuse('Vietnam payment tax facts belong only to non-contract remuneration.');
	}
	const cash = money(input.cash_amount, currency, 'Cash amount', kind === 'NON_CASH_SETTLEMENT');
	if (kind === 'NON_CASH_SETTLEMENT' && cash !== 0n)
		refuse('A non-cash settlement cannot record cash paid.');
	const withholding = statutory.reduce(
		(sum, row) => sum + money(row.employee_amount, currency, 'Payment withholding', true),
		0n
	);
	if (cash + deductions + withholding !== gross)
		refuse('Cash, prepriced deductions and payment-date withholding must equal allocated gross.');
	const completed = slips.filter((slip) =>
		slipTranches
			.filter((row) => row.settlement.id === slip.id)
			.every(
				(row) =>
					usedGross.get(row.id) === money(row.gross_amount, currency, 'Tranche gross') &&
					usedDeductions.get(row.id) ===
						money(row.non_event_deduction_amount, currency, 'Tranche deductions', true)
			)
	);
	if (slips.length > 0)
		await assertPayslipsPayable(slips, completed, employments, runs, company, paidOn);
	const previousEvents = await readAll<{ readonly id: string; readonly paid_on: string }>(
		ctx.db,
		'payment_events',
		{
			id: { in: prior.map((row) => row.payment_event_id) }
		}
	);
	const previousDate = new Map(previousEvents.map((row) => [row.id, row.paid_on]));
	return [
		{
			...input,
			gross_amount: fromMinorUnits(gross, currency),
			non_event_deduction_amount: fromMinorUnits(deductions, currency),
			statutory,
			payment_allocations: { create: proposed.map((allocation) => ({ ...allocation, currency })) },
			...(completed.length === 0
				? {}
				: {
						completed_payslips: {
							upsert: completed.map((slip) => {
								const trancheIds = new Set(
									slipTranches.filter((row) => row.settlement.id === slip.id).map((row) => row.id)
								);
								const latest = [
									paidOn,
									...prior
										.filter((row) => trancheIds.has(row.payable_tranche_id))
										.map((row) => previousDate.get(row.payment_event_id))
										.filter((day): day is string => day != null)
								]
									.sort()
									.at(-1)!;
								return { id: slip.id, status: 'PAID', paid_at: dayInstant(latest) };
							})
						}
					})
		} as never
	];

	function money(value: unknown, unit: string, label: string, zero = false): bigint {
		const number = decodeNumber(value);
		if (
			!Number.isFinite(number) ||
			(zero ? number < 0 : number <= 0) ||
			cents(number, unit) !== number
		)
			refuse(
				`${label} needs a ${zero ? 'nonnegative' : 'positive'} amount in ${unit} currency precision.`
			);
		return toMinorUnits(number, unit);
	}

	async function assertPayslipsPayable(
		paying: readonly Slip[],
		closing: readonly Slip[],
		people: readonly Employment[],
		payrollRuns: readonly Run[],
		payer: Company,
		paymentDay: string
	): Promise<void> {
		const ids = [...new Set(paying.map((slip) => slip.employment_id))];
		const [holds, terms, employees, versions, unpaid, earlierRuns] = await Promise.all([
			readAll<Hold>(ctx.db, 'payment_holds', { employment_id: { in: ids } }),
			readAll<WorkspaceRow<'employment_terms'>>(ctx.db, 'employment_terms', {
				employment_id: { in: ids }
			}),
			readAll<WorkspaceRow<'employees'>>(ctx.db, 'employees', {
				id: { in: people.map((row) => row.employee_id) }
			}),
			readAll<Version>(ctx.db, 'jurisdiction_settings', {
				code: payer.settings_code,
				sealed_at: { isNull: false },
				voided_at: { isNull: true },
				approval_id: { isNull: true }
			}),
			readAll<Slip>(ctx.db, 'payslips', { employment_id: { in: ids }, status: { ne: 'PAID' } }),
			readAll<Run>(ctx.db, 'payroll_runs', { payslips: { some: { employment_id: { in: ids } } } })
		]);
		const allRuns = new Map([...payrollRuns, ...earlierRuns].map((run) => [run.id, run]));
		for (const slip of paying) {
			const funding = money(slip.funding_received, slip.currency, 'Funding received', true);
			const unfunded = money(
				slip.unfunded_contributions,
				slip.currency,
				'Unfunded contributions',
				true
			);
			if (funding > 0n && (slip.funding_received_on == null || !slip.funding_reference?.trim()))
				refuse('Contribution funding needs its receipt date and reference before payment.');
			if (funding < unfunded)
				refuse(
					'Employee statutory contributions remain unfunded. Record the funds before paying this payslip.'
				);
			if (funding > 0n && dateKey(slip.funding_received_on) > paymentDay)
				refuse('A payment cannot precede its contribution funding receipt.');
			const open = holds.find(
				(hold) =>
					hold.employment_id === slip.employment_id &&
					(hold.released_on == null || dateKey(hold.released_on) > paymentDay)
			);
			if (open != null)
				refuse(`Disbursement hold ${open.directive_reference} is open on this employment.`);
			const employment = people.find((row) => row.id === slip.employment_id)!;
			const exit = dateKey(readRange(employment.effective_range)?.end);
			if (exit !== '') {
				const version = settingsInForce(versions, payer.settings_code, exit);
				if (version == null)
					refuse(
						`Sealed ${payer.settings_code} settings are missing on this employment's exit date.`
					);
				const clearance = version.payroll?.tax_clearance;
				if (clearance != null) {
					const term = terms.find(
						(row) => row.employment_id === employment.id && coversDate(row.effective_range, exit)
					);
					const person = personContext({
						employee: employees.find((row) => row.id === employment.employee_id) ?? null,
						employment: {
							service_start: dateKey(readRange(employment.effective_range)?.start),
							exit_date: exit,
							exit_reason: employment.exit_reason,
							exit_facts: employment.exit_facts
						},
						terms: term ?? null,
						asOf: exit
					});
					const declaredPerson = resolveExitFacts(
						version.exit_facts as never,
						scalarFacts(employment.exit_facts),
						person
					);
					if (isEligible(clearance.when, declaredPerson)) {
						const declared = employment.exit_facts?.clearance_awareness_on;
						const awareness = dateKey(Predicate.isString(declared) ? declared : null);
						if (awareness === '')
							refuse('Tax clearance awareness date is required before a leaver can be paid.');
						if (
							paymentDay >= awareness &&
							!holds.some(
								(hold) =>
									hold.employment_id === employment.id &&
									hold.category === clearance.category &&
									hold.released_on != null &&
									dateKey(hold.released_on) <= paymentDay
							)
						)
							refuse('Tax clearance requires a released hold before this payslip can be paid.');
					}
				}
			}
			const run = allRuns.get(slip.payroll_run_id);
			if (run == null) refuse('A payslip cannot be paid without its payroll run.');
			const previous = unpaid.find(
				(other) =>
					other.employment_id === slip.employment_id &&
					other.id !== slip.id &&
					!closing.some((one) => one.id === other.id) &&
					allRuns.get(other.payroll_run_id)?.company_id === run.company_id &&
					(allRuns.get(other.payroll_run_id)?.period ?? '') < run.period
			);
			if (previous != null)
				refuse(
					`This person's earlier ${allRuns.get(previous.payroll_run_id)?.period} pay is still unpaid.`
				);
		}
	}
});

export default c;

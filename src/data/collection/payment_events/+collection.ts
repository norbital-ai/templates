import { collection } from '@norbital-ai/bolt';
import { dateKey, dayInstant, isCalendarDate } from '../../../lib/iso-day.js';
import { readAll } from '../../../lib/reads.js';
import { decodeNumber } from '../../../lib/wire.js';
import { cents, fromMinorUnits, toMinorUnits } from '../../../lib/payroll/run/rounding.js';
import { governed, settingsInForce } from '../../../lib/jurisdiction_settings.js';
import { coversDate, readRange } from '../../../lib/payroll/run/effective.js';
import { isEligible, personContext, scalarFacts } from '../../../lib/payroll/run/eligibility.js';
import {
	requireFactValues,
	resolveExitFacts,
	resolveFactValues
} from '../../../lib/declared-facts.js';
import { entityFactsFault, evidenceFault } from '../../../lib/entity-facts.js';
import { evaluateBoolean, expressionEngine } from '../../../lib/expressions/evaluate.js';
import {
	assessPaymentWithholding,
	paymentSite,
	type PaymentWithholdingInput
} from '../../../lib/payroll/payment-withholding.js';
import type { PayslipStatutory } from '../../../lib/datatypes/payslip_statutory.js';
import type { WorkspaceRow } from '../../../lib/rows.js';
import {
	benefitCaseTypeOf,
	CASE_SETTINGS_SELECT,
	type CaseSettingsVersion
} from '../../../lib/benefit-cases/benefit.js';
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
				'cash_amount',
				'facts'
			],
			with: {
				/** Evidence of the declared payment inputs, recorded with the payment it evidences. */
				fact_evidence: { create: { columns: ['fact_key', 'reference', 'file', 'received_on'] } },
				payment_allocations: {
					create: {
						columns: ['payable_tranche_id', 'gross_amount', 'non_event_deduction_amount']
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
	readonly exit_ground: string | null;
	readonly exit_facts: Record<string, unknown> | null;
};
type Run = { readonly id: string; readonly company_id: string; readonly period: string };
type Company = { readonly id: string; readonly settings_code: string };
type Settlement = PaymentWithholdingInput['settlement'];
type Version = {
	readonly id: string;
	readonly code: string;
	readonly effective_range: unknown;
	readonly sealed_at: string | null;
	readonly voided_at: string | null;
	readonly approval_id: string | null;
	readonly payroll: {
		readonly currency: string;
		readonly tax_clearance?: { readonly when: string; readonly category: string };
		readonly payment_occasion_scheme?: string | null;
	};
	readonly exit_facts: readonly unknown[];
	readonly payment_facts: readonly object[];
	readonly settlement_facts: readonly object[];
};
type Hold = {
	readonly employment_id: string;
	readonly category: string;
	readonly directive_reference: string;
	readonly released_on: string | null;
};
type Movement = {
	readonly id: string;
	readonly benefit_case_id: string;
	readonly kind: string;
	readonly amount: unknown;
	readonly paid_on: string;
	readonly payment_reference: string;
	readonly evidence_file: unknown | null;
};
type BenefitCase = {
	readonly id: string;
	readonly employee_id: string;
	readonly employment_id: string;
	readonly case_type: string;
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
	if (externalKind !== '' && externalKind !== 'BENEFIT_CASE_MOVEMENT')
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
	const settlementIds = [
		...new Set(
			requested.flatMap((row) =>
				row.settlement.collection === 'noncontract_settlements' ? [row.settlement.id] : []
			)
		)
	];
	if (
		requested.some(
			(row) =>
				row.settlement.collection !== 'payslips' &&
				row.settlement.collection !== 'noncontract_settlements'
		)
	)
		refuse('A payable tranche needs a supported settlement parent.');
	const [slips, settlements, slipTranches, settlementTranches, settlementEvidence] =
		await Promise.all([
			readAll<Slip>(ctx.db, 'payslips', { id: { in: slipIds } }),
			readAll<Settlement>(ctx.db, 'noncontract_settlements', { id: { in: settlementIds } }),
			readAll<Tranche>(ctx.db, 'payable_tranches', { settlement: { payslips: { in: slipIds } } }),
			readAll<Tranche>(ctx.db, 'payable_tranches', {
				settlement: { noncontract_settlements: { in: settlementIds } }
			}),
			settlementIds.length === 0
				? []
				: readAll<{ readonly fact_key: string }>(ctx.db, 'fact_evidence', {
						subject: { noncontract_settlements: { in: settlementIds } }
					})
		]);
	if (slips.length !== slipIds.length || settlements.length !== settlementIds.length)
		refuse('A payable tranche has a missing settlement parent.');
	const allTranches = [...slipTranches, ...settlementTranches];
	const allIds = allTranches.map((row) => row.id);
	const benefitCaseIds = [
		...new Set(
			requested.flatMap((row) =>
				row.source_category === 'BENEFIT_CASE_PAY' ? [row.source_id] : []
			)
		)
	];
	const [prior, employments, runs, companies, movements, benefitCases] = await Promise.all([
		readAll<PriorAllocation>(ctx.db, 'payment_allocations', { payable_tranche_id: { in: allIds } }),
		readAll<Employment>(ctx.db, 'employments', {
			id: { in: slips.map((row) => row.employment_id) }
		}),
		readAll<Run>(ctx.db, 'payroll_runs', { id: { in: slips.map((row) => row.payroll_run_id) } }),
		readAll<Company>(ctx.db, 'companies', { id: String(input.company_id) }),
		readAll<Movement>(ctx.db, 'benefit_case_movements', {
			id: { in: externalId === '' ? [] : [externalId] }
		}),
		readAll<BenefitCase>(ctx.db, 'benefit_cases', { id: { in: benefitCaseIds } })
	]);
	const employmentById = new Map(employments.map((row) => [row.id, row]));
	const runById = new Map(runs.map((row) => [row.id, row]));
	const company = companies[0];
	if (company == null)
		refuse('An actual payment needs a paying company on file.', { field: 'company_id' });
	// A benefit-case cash source is priced by a case type the paying entity's lineage declares.
	const caseVersions =
		benefitCaseIds.length === 0
			? []
			: await readAll<CaseSettingsVersion>(
					ctx.db,
					'jurisdiction_settings',
					{ code: { eq: company.settings_code } },
					undefined,
					CASE_SETTINGS_SELECT
				);
	const caseById = new Map(benefitCases.map((row) => [row.id, row]));
	const typeOfCase = (caseId: string) => {
		const benefitCase = caseById.get(caseId);
		return benefitCase == null
			? null
			: benefitCaseTypeOf(caseVersions, company.settings_code, benefitCase.case_type, paidOn);
	};
	if (slips.length > 0 && settlements.length > 0)
		refuse('A payment cannot mix employment payslips and non-contract remuneration.');
	if (settlements.length > 1)
		refuse('One non-contract payment must name a single evidenced tax-residency settlement.');
	const settlement = settlements[0];
	for (const parent of settlements)
		if (
			parent.company_id !== company.id ||
			parent.employee_id !== input.employee_id ||
			parent.currency !== currency
		)
			refuse(
				'Every allocated non-contract settlement must belong to the same paying company, person and currency.'
			);
	const { version: factsVersion, facts: paymentFacts } = await assertPaymentFacts(
		company,
		paidOn,
		currency,
		kind
	);
	for (const tranche of requested) {
		if (tranche.source_category !== 'BENEFIT_CASE_PAY') continue;
		const benefitCase = caseById.get(tranche.source_id);
		const type = typeOfCase(tranche.source_id);
		if (
			tranche.source_kind !== 'BENEFIT_CASE' ||
			benefitCase == null ||
			type == null ||
			![type.components.award, type.components.differential].includes(
				tranche.source_component ?? ''
			) ||
			benefitCase.employee_id !== input.employee_id ||
			!slips.some((slip) => slip.employment_id === benefitCase.employment_id)
		)
			refuse('Benefit-case cash must name the evidenced case for this person and employment.');
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
	if (externalKind === 'BENEFIT_CASE_MOVEMENT') {
		const movement = movements[0];
		const type = movement == null ? null : typeOfCase(movement.benefit_case_id);
		const declared = type?.movement_kinds.find((row) => row.code === movement?.kind);
		if (
			movement == null ||
			declared?.direction !== 'EMPLOYEE_PAYMENT' ||
			movement.evidence_file == null ||
			settlements.length > 0 ||
			slipIds.length === 0
		)
			refuse('Only employee cash from an evidenced benefit-case movement can be credited.');
		if (movement.paid_on !== paidOn || movement.payment_reference !== input.reference)
			refuse('The credited benefit cash date and reference must match its movement.');
		if (
			requested.some(
				(row) =>
					row.source_category !== 'BENEFIT_CASE_PAY' ||
					row.source_kind !== 'BENEFIT_CASE' ||
					row.source_id !== movement.benefit_case_id ||
					row.source_component !== declared.component
			)
		)
			refuse(
				'The credited benefit cash must settle the matching cash component of the same benefit case.'
			);
		if (
			toMinorUnits(decodeNumber(movement.amount), currency) !==
			money(input.cash_amount, currency, 'Cash amount')
		)
			refuse('The credited benefit cash must equal its recorded movement amount.');
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
	if (settlement != null) {
		if (kind !== 'CASH')
			refuse('Non-contract payment-date withholding requires an actual cash payment.');
		if (externalKind !== '') refuse('A non-contract payment cannot use an external cash credit.');
		const version = factsVersion!;
		const code = version.payroll.payment_occasion_scheme;
		const range = governed(version.effective_range);
		if (code == null || range == null)
			refuse(
				`Sealed ${company.settings_code} settings on the paid-on day name no payment-occasion scheme.`
			);
		const [scheme] = await readAll<
			{ readonly id: string; readonly settings_id: string } & PaymentWithholdingInput['scheme']
		>(ctx.db, 'statutory_contributions', { settings_id: version.id, code });
		if (scheme == null) refuse(`The sealed payment-occasion scheme ${code} is missing.`);
		try {
			statutory = assessPaymentWithholding({
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
				facts: paymentFacts,
				settlement,
				scheme,
				settingsRange: range,
				settingsCurrency: version.payroll.currency
			});
		} catch (error) {
			refuse(
				error instanceof Error ? error.message : 'Payment-date withholding could not be calculated.'
			);
		}
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

	/**
	 * The payment's declared inputs: every key some sealed live version of the lineage declares, with
	 * a value it admits; against the version governing the paid-on day, required values present and
	 * declared evidence recorded in this write. A settled non-contract obligation's own inputs are
	 * judged there too, complete, with the evidence recorded on it. Answers that version and the
	 * payment's facts resolved with their typed blanks.
	 */
	async function assertPaymentFacts(
		payer: Company,
		paymentDay: string,
		unit: string,
		paymentKind: string
	): Promise<{
		readonly version: Version | null;
		readonly facts: Record<string, string | number | boolean>;
	}> {
		const facts = scalarFacts(input.facts);
		const evidence = (input.fact_evidence?.create ?? []) as readonly {
			readonly fact_key?: string | null;
			readonly reference?: string | null;
			readonly file?: unknown;
		}[];
		if (Object.keys(facts).length === 0 && evidence.length === 0 && settlement == null)
			return { version: null, facts: {} };
		const lineage = await readAll<Version>(ctx.db, 'jurisdiction_settings', {
			code: payer.settings_code,
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			approval_id: { isNull: true }
		});
		const declared = lineage.flatMap((version) => version.payment_facts ?? []);
		const fault = entityFactsFault(payer.settings_code, facts, declared);
		if (fault != null) refuse(fault, { field: 'facts' });
		for (const row of evidence) {
			const key = String(row.fact_key ?? '').trim();
			if (!Object.hasOwn(facts, key)) refuse(`The payment records no fact ${key} to evidence.`);
			const missing = evidenceFault(payer.settings_code, key, row, declared);
			if (missing != null) refuse(missing);
		}
		const version = settingsInForce(lineage, payer.settings_code, paymentDay);
		if (version == null)
			refuse(`Sealed ${payer.settings_code} settings are missing on the paid-on day.`);
		const paymentFields = (version.payment_facts ?? []) as never;
		const settlementFields = (version.settlement_facts ?? []) as never;
		const settled = scalarFacts(settlement?.facts);
		const resolved = resolveFactValues(paymentFields, facts, 'Payment', false);
		const context = paymentSite(
			{
				kind: paymentKind,
				paid_on: paymentDay,
				currency: unit,
				facts: resolved,
				fact_keys: Object.keys(facts)
			},
			settlement == null
				? null
				: {
						tax_residency: settlement.tax_residency,
						facts: resolveFactValues(settlementFields, settled, 'Settlement', false),
						fact_keys: Object.keys(settled)
					}
		);
		const when = (expression: string) => evaluateBoolean(expressionEngine, expression, context);
		const evidenced = new Set(evidence.map((row) => String(row.fact_key ?? '').trim()));
		requireFactValues(paymentFields, facts, 'Payment', when, (key) => evidenced.has(key));
		if (settlement != null) {
			const onSettlement = new Set(settlementEvidence.map((row) => row.fact_key));
			requireFactValues(settlementFields, settled, 'Settlement', when, (key) =>
				onSettlement.has(key)
			);
		}
		return { version, facts: resolved };
	}

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
							exit_ground: employment.exit_ground,
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

import { beforeEach, expect, it } from 'vitest';
import {
	committed,
	declareSgSdl,
	NORBITAL_SG,
	OPS_PH,
	recordPhBirthDates,
	recordPhShiftBreaks,
	recordSgShgFacts,
	refused,
	SG_2026_Q1,
	workspace
} from './kit.ts';
import { decodeNumber, plain } from '../../src/lib/wire.ts';

let t: Awaited<ReturnType<typeof workspace>>;
beforeEach(async () => {
	t = await workspace({ now: '2026-09-29T02:00:00.000Z' });
});
const admin = () => t.as(t.admin);

async function vnObligation(gross = 9_000_000) {
	const company = committed(
		await admin().act('companies.create', {
			settings_code: 'VN',
			name: `VN payment event ${crypto.randomUUID()}`,
			pay_cutoff_day: 21,
			pay_frequency: 'MONTHLY',
			region: 'IV',
			facts: {},
			effective_range: { from: '2026-01-01', to: null }
		})
	)[0]!.id as string;
	const person = committed(
		await admin().act('employees.create', {
			name: 'VN no-contract payment recipient',
			email: `vn-payment-${crypto.randomUUID()}@example.com`
		})
	)[0]!.id as string;
	// The settlement and its frozen tranche are one write in the product (`vn_noncontract_settlements.create`
	// nests them), but that transform's payload is a Bolt build behind; this isolated fixture supplies the
	// same priced obligation directly, as `pricedSlip` does for its payslip tranches.
	const settlement = crypto.randomUUID();
	const tranche = crypto.randomUUID();
	await t.db.write({
		text: `INSERT INTO vn_noncontract_settlements (
		         id, company_id, employee_id, reference, agreed_gross_vnd, agreed_due_on,
		         agreement_amount_reference, relationship_reference, relationship_reviewed_on,
		         income_nature_reference, tax_residency, tax_residency_range,
		         tax_residency_reference, currency)
		       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::daterange, $13, $14)`,
		params: [
			settlement,
			company,
			person,
			'ENGAGEMENT-2026-09',
			gross,
			'2026-09-30',
			'SIGNED-FEE-1',
			'SIGNED-ENGAGEMENT-1',
			'2026-09-01',
			'WAGE-CLASSIFICATION-1',
			'RESIDENT',
			'[2026-09-01,2027-01-01)',
			'TAX-RESIDENCE-1',
			'VND'
		]
	});
	await t.db.write({
		text: `INSERT INTO payable_tranches (
		         id, settlement__vn_noncontract_settlements, source_category, source_kind, source_id,
		         reference, due_on, currency, gross_amount, non_event_deduction_amount, tax_treatment)
		       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		params: [
			tranche,
			settlement,
			'NONCONTRACT_REMUNERATION',
			'VN_NONCONTRACT_SETTLEMENT',
			settlement,
			'SIGNED-FEE-1',
			'2026-09-30',
			'VND',
			gross,
			0,
			'TAXABLE'
		]
	});
	return { company, person, settlement, tranche };
}

function event(
	obligation: Awaited<ReturnType<typeof vnObligation>>,
	paidOn: string,
	reference: string,
	gross: number,
	cash: number
) {
	return {
		company_id: obligation.company,
		employee_id: obligation.person,
		paid_on: paidOn,
		reference,
		currency: 'VND',
		cash_amount: cash,
		payment_allocations: {
			create: [
				{
					payable_tranche_id: obligation.tranche,
					gross_amount: gross,
					non_event_deduction_amount: 0
				}
			]
		},
		vn_payment_tax_facts: { create: [{ withhold_below_threshold_requested: false }] }
	};
}

it('saves two actual VN payments against one frozen obligation and freezes each paid-date PIT charge', async () => {
	const obligation = await vnObligation();
	const first = committed(
		await admin().act(
			'payment_events.create',
			event(obligation, '2026-09-10', 'BANK-1', 4_000_000, 4_000_000)
		)
	);
	const second = committed(
		await admin().act(
			'payment_events.create',
			event(obligation, '2026-09-20', 'BANK-2', 5_000_000, 4_500_000)
		)
	);
	const firstId = first.find((row) => row.collection === 'payment_events')!.id as string;
	const secondId = second.find((row) => row.collection === 'payment_events')!.id as string;
	const firstSaved = await admin().get('payment_events', firstId, {
		statutory: true,
		gross_amount: true,
		cash_amount: true
	});
	const secondSaved = await admin().get('payment_events', secondId, {
		statutory: true,
		gross_amount: true,
		cash_amount: true
	});
	expect(firstSaved?.statutory?.[0]?.employee_amount).toBe(0);
	expect(secondSaved?.statutory?.[0]?.employee_amount).toBe(500_000);
	expect(firstSaved?.statutory?.[0]?.payment_occasion).toBe(true);
	expect(
		(
			await admin().read('payment_allocations', {
				where: { payable_tranche_id: { eq: obligation.tranche } },
				all: true
			})
		).rows
	).toHaveLength(2);
	expect(
		refused(
			await admin().act('payment_events.create', event(obligation, '2026-09-21', 'BANK-3', 1, 1))
		)
	).toMatch(/allocate more gross/);
});

it('rejects a different payee, currency and duplicate actual-payment identity before changing the ledger', async () => {
	const obligation = await vnObligation();
	const other = committed(
		await admin().act('employees.create', {
			name: 'Different payee',
			email: `different-${crypto.randomUUID()}@example.com`
		})
	)[0]!.id as string;
	expect(
		refused(
			await admin().act('payment_events.create', {
				...event(obligation, '2026-09-10', 'WRONG-PAYEE', 4_000_000, 4_000_000),
				employee_id: other
			})
		)
	).toMatch(/same paying company, person and currency/);
	expect(
		refused(
			await admin().act('payment_events.create', {
				...event(obligation, '2026-09-10', 'WRONG-CURRENCY', 4_000_000, 4_000_000),
				currency: 'USD'
			})
		)
	).toMatch(/same paying company, person and currency/);
	committed(
		await admin().act(
			'payment_events.create',
			event(obligation, '2026-09-10', 'BANK-1', 4_000_000, 4_000_000)
		)
	);
	expect(
		refused(
			await admin().act(
				'payment_events.create',
				event(obligation, '2026-09-10', 'BANK-1', 1_000_000, 1_000_000)
			)
		)
	).not.toBe('');
	expect(
		(
			await admin().read('payment_allocations', {
				where: { payable_tranche_id: { eq: obligation.tranche } },
				all: true
			})
		).rows
	).toHaveLength(1);
});

/** A persisted run and slip are kept, while this isolated fixture supplies a controlled, priced event plan. */
async function pricedSlip(
	options: { country?: 'SG' | 'PH'; zeroCash?: boolean; maternity?: boolean } = {}
) {
	const country = options.country ?? 'SG';
	if (country === 'SG') {
		await declareSgSdl(t, SG_2026_Q1);
		await recordSgShgFacts(t);
	} else {
		await recordPhBirthDates(t);
		await recordPhShiftBreaks(t);
	}
	const company = country === 'SG' ? NORBITAL_SG : OPS_PH;
	const period = country === 'SG' ? '2026-01' : '2026-01-1';
	const records = committed(
		await admin().act('payroll_runs.create', { company_id: company, period })
	);
	const run = records.find((row) => row.collection === 'payroll_runs')!.id as string;
	const slips = (
		await admin().read('payslips', { where: { payroll_run_id: { eq: run } }, all: true })
	).rows;
	const slip = slips.find(
		(row) =>
			decodeNumber(row.net) > 100 &&
			!row.statutory?.some((charge) => charge.payment_occasion === true)
	);
	expect(slip).toBeDefined();
	const employment = await admin().get('employments', slip!.employment_id as string);
	expect(employment).not.toBeNull();
	const gross = options.maternity ? 100 : decodeNumber(slip!.gross);
	const deductions = options.maternity
		? 0
		: options.zeroCash
			? gross
			: decodeNumber(slip!.total_deductions);
	await t.db.write({
		text: 'UPDATE payslips SET payment_mode = $1, gross = $2, total_deductions = $3, net = $4 WHERE id = $5',
		params: ['EVENT_LEDGER', gross, deductions, gross - deductions, slip!.id]
	});
	const caseId = options.maternity ? crypto.randomUUID() : null;
	if (caseId != null)
		await t.db.write({
			text: 'INSERT INTO ph_maternity_cases (id, employee_id, employment_id, case_reference, application_on) VALUES ($1, $2, $3, $4, $5)',
			params: [caseId, employment!.employee_id, employment!.id, `SYNTHETIC-${caseId}`, '2026-01-01']
		});
	const tranche = crypto.randomUUID();
	await t.db.write({
		text: 'INSERT INTO payable_tranches (id, settlement__payslips, source_category, source_kind, source_id, source_component, reference, due_on, currency, gross_amount, non_event_deduction_amount, tax_treatment) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
		params: [
			tranche,
			slip!.id,
			options.maternity ? 'MATERNITY_PAY' : 'REGULAR_WAGE',
			options.maternity ? 'PH_MATERNITY_CASE' : 'SYNTHETIC_SAVED_RUN',
			caseId ?? run,
			options.maternity ? 'SSS_AWARD' : null,
			`SOURCE-${tranche}`,
			'2026-01-31',
			slip!.currency,
			gross,
			deductions,
			options.maternity ? 'EXEMPT' : 'TAXABLE'
		]
	});
	return {
		company,
		person: employment!.employee_id as string,
		run,
		slip: slip!.id as string,
		tranche,
		currency: slip!.currency as string,
		gross,
		deductions,
		caseId
	};
}

function slipEvent(
	fixture: Awaited<ReturnType<typeof pricedSlip>>,
	paidOn: string,
	reference: string,
	gross: number,
	deductions: number,
	more: Record<string, unknown> = {}
) {
	return {
		company_id: fixture.company,
		employee_id: fixture.person,
		paid_on: paidOn,
		reference,
		currency: fixture.currency,
		cash_amount: gross - deductions,
		payment_allocations: {
			create: [
				{
					payable_tranche_id: fixture.tranche,
					gross_amount: gross,
					non_event_deduction_amount: deductions
				}
			]
		},
		...more
	};
}

it('keeps a partly paid payslip and run, blocks direct PAID, and closes the slip on the final actual event', async () => {
	const fixture = await pricedSlip();
	const firstGross = 100;
	committed(
		await admin().act(
			'payment_events.create',
			slipEvent(fixture, '2026-01-30', 'SG-BANK-1', firstGross, 0)
		)
	);
	expect((await admin().get('payslips', fixture.slip))?.status).toBe('DRAFT');
	expect(
		refused(
			await admin().act('payslips.update', {
				target: fixture.slip,
				set: { status: 'PAID', paid_at: '2026-01-30T00:00:00.000Z' }
			})
		)
	).toMatch(/requires actual payment allocations/);
	// The engine's own reference guard now answers first (a frozen tranche refers to the slip);
	// the slip-level guard says the same thing when it gets the chance.
	expect(refused(await admin().act('payslips.delete', { target: fixture.slip }))).toMatch(
		/actual payment allocation|refer to this one/
	);
	expect(refused(await admin().act('payroll_runs.delete', { target: fixture.run }))).toMatch(
		/partial payment|refer to this one/
	);
	committed(
		await admin().act(
			'payment_events.create',
			slipEvent(fixture, '2026-02-03', 'SG-BANK-2', fixture.gross - firstGross, fixture.deductions)
		)
	);
	const completed = await admin().get('payslips', fixture.slip);
	expect(completed?.status).toBe('PAID');
	expect(String(plain(completed?.paid_at)).slice(0, 10)).toBe('2026-02-03');
	expect(completed?.settled_by_payment_event_id).toBeTruthy();
});

it('permits zero cash only as a documented non-cash settlement', async () => {
	const fixture = await pricedSlip({ zeroCash: true });
	expect(
		refused(
			await admin().act(
				'payment_events.create',
				slipEvent(fixture, '2026-02-03', 'ZERO-WITHOUT-BASIS', fixture.gross, fixture.gross)
			)
		)
	).not.toBe('');
	committed(
		await admin().act(
			'payment_events.create',
			slipEvent(fixture, '2026-02-03', 'ZERO-WITH-BASIS', fixture.gross, fixture.gross, {
				kind: 'NON_CASH_SETTLEMENT',
				non_cash_basis_reference: 'SIGNED-NET-OFF-DIRECTIVE-1'
			})
		)
	);
	expect((await admin().get('payslips', fixture.slip))?.status).toBe('PAID');
});

it('credits a PH maternity movement only to its matching cash component, once', async () => {
	const fixture = await pricedSlip({ country: 'PH', maternity: true });
	const wrong = crypto.randomUUID();
	const correct = crypto.randomUUID();
	for (const [id, kind, reference] of [
		[wrong, 'SALARY_DIFFERENTIAL', 'PH-DIFF-BANK'],
		[correct, 'SSS_ADVANCE', 'PH-SSS-BANK']
	] as const)
		await t.db.write({
			text: 'INSERT INTO ph_maternity_movements (id, ph_maternity_case_id, kind, paid_on, amount, payment_reference, evidence_file) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)',
			params: [id, fixture.caseId, kind, '2026-01-20', 50, reference, '{}']
		});
	expect(
		refused(
			await admin().act(
				'payment_events.create',
				slipEvent(fixture, '2026-01-20', 'PH-DIFF-BANK', 50, 0, {
					external_source_kind: 'PH_MATERNITY_MOVEMENT',
					external_source_id: wrong
				})
			)
		)
	).toMatch(/matching cash component/);
	committed(
		await admin().act(
			'payment_events.create',
			slipEvent(fixture, '2026-01-20', 'PH-SSS-BANK', 50, 0, {
				external_source_kind: 'PH_MATERNITY_MOVEMENT',
				external_source_id: correct
			})
		)
	);
	expect(
		refused(
			await admin().act(
				'payment_events.create',
				slipEvent(fixture, '2026-01-20', 'PH-SSS-BANK', 50, 0, {
					external_source_kind: 'PH_MATERNITY_MOVEMENT',
					external_source_id: correct
				})
			)
		)
	).not.toBe('');
});

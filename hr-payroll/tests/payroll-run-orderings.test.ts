// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * One month, three orderings, one bill (owner design 2026-10-01, "off-cycle settles salary first").
 *
 * For every seeded lineage, every entry kind a run can pay off-cycle (a bonus, another ad hoc earning, a claim) and
 * a low, middle and high wage, the month is paid three ways through the real `payroll_runs` transform:
 *
 *   (a) COMBINED — one REGULAR run pays the salary and the entry together;
 *   (b) EARLY    — an OFF_CYCLE run pays the entry first: its transform settles the salary early (an EARLY run at
 *                  the regular pay date) in the same act, then the REGULAR run pays everyone else and skips them;
 *   (c) AFTER    — the REGULAR run pays the salary (and the slip is paid), then an OFF_CYCLE run pays the entry.
 *
 * PH also runs at a semi-monthly company: the first half is paid, and the off-cycle run in the second half settles
 * the remaining half early; a PAY_PERIOD scheme (WTAX) bills the half the way a month scheme bills the month.
 *
 * Every scheme's employee and employer figure for the month, the tax, gross, net and employer cost, and the
 * company's remittances and company-assessed charges are identical to the cent in all three; the entry is paid
 * once and the salary once; the REGULAR run of (b) pays the person nothing. A colleague paid only by the REGULAR
 * run is identical too. No lineage needs a documented difference: every scheme is one bill of its period.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import {
	COMPANY_ID,
	LINEAGES,
	adhocCatalogue,
	claimCatalogue,
	createStatutoryWorld,
	leaveCatalogue,
	settingsIdOn
} from './fixtures/statutory-world.ts';
import workDays from '../src/data/collection/work_days/+collection.ts';
import leaveEntries from '../src/data/collection/leave_entries/+collection.ts';
import { nextPeriod } from '../src/lib/payroll/run/period.ts';
import { offsetMinutesFor } from '../src/lib/timezone.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { lockStateForDate, payrollWindows } from '../src/lib/scheduling/lock.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { runTransform } from './helpers/ctx.ts';
import { storeRun } from './helpers/settlement.ts';
import { workDayTables, writeDay } from './helpers/work-day-db.ts';

const PERIOD = '2026-03';
/** The off-cycle day of the owner's example: 10 March, before the 25 March regular run. */
const EVENT = '2026-03-10';
/** The transform's clock: the off-cycle run is created on the 10th. */
const NOW = '2026-03-10T02:00:00.000Z';

const CN_FACTS = {
	injury_rate: 0.2,
	housing_fund_rate: 7,
	housing_fund_supplementary_rate: 0,
	unemployment_employer_rate: 0.5,
	unemployment_employee_rate: 0.5
};

/**
 * Per lineage: the company the fixture needs, the subject's facts at a wage, three wages (the low one at or above
 * the lineage's floor, the high one past every contribution ceiling), and the catalogue code of each entry kind.
 */
const SETUP = {
	CN: {
		// Shanghai: 2,740 a month net of the employee shares on the 2026 social base floor.
		wages: [4_000, 15_000, 60_000],
		world: { region: 'SHANGHAI', companyFacts: CN_FACTS },
		person: (wage) => ({
			registrations: {
				PENSION: { kind: 'REGISTERED', elections: { contribution_base: wage } },
				HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: wage } }
			}
		}),
		entries: { bonus: 'BONUS', adhoc: 'TRAVEL_ALLOWANCE', claim: null }
	},
	ID: {
		wages: [6_000_000, 20_000_000, 150_000_000],
		world: { riskClass: 'II' },
		entries: { bonus: 'BONUS_THR', adhoc: 'BACK_PAY_SALARY', claim: 'SWAB_TEST_REIMBURSEMENT' }
	},
	JP: {
		// The wage is the declared 標準報酬月額 grade; 1,390,000 is the top 健康保険 grade (健康保険法 §40).
		wages: [220_000, 340_000, 1_390_000],
		world: {
			region: '東京都',
			companyFacts: { employment_insurance_class: 'GENERAL', workers_comp_business_type: '94' }
		},
		person: (wage) => ({
			worksite: '東京都',
			citizenship: 'CITIZEN',
			tax_residency: 'RESIDENT',
			work_classification: 'LSA_COVERED',
			registrations: {
				HEALTH: { kind: 'REGISTERED', elections: { standard_monthly_remuneration: wage } },
				INCOME_TAX_BONUS: { kind: 'REGISTERED', elections: { prior_month_net_pay: wage * 0.75 } }
			}
		}),
		// 介護休暇 (育児介護休業法 §16-5) counts the family members cared for.
		terms: { annual_scheduled_hours: 2040, care_family_members: 1 },
		// JP's other ad hoc earnings are not ordinary one-offs: 休業手当 prices on three months of wage history
		// (労基法 §12, §26), 退職手当 is separate retirement income (所得税法 §30); there is no claim catalogue.
		entries: { bonus: 'BONUS', adhoc: null, claim: null }
	},
	MY: {
		wages: [1_800, 6_000, 30_000],
		entries: { bonus: 'BONUS', adhoc: 'BPAYBS', claim: 'MEDICAL_CLAIM' }
	},
	PH: {
		wages: [16_000, 40_000, 200_000],
		entries: {
			bonus: 'bonus',
			adhoc: 'BACKPAY_BASIC',
			thirteenth: 'THIRTEENTH_MONTH_PAY_YEAR_END',
			claim: 'MEDICAL_CLAIM'
		}
	},
	SG: {
		wages: [1_500, 6_000, 15_000],
		entries: {
			bonus: 'bonus',
			adhoc: 'SALARY_IN_LIEU_OF_NOTICE',
			claim: 'MEDICAL_TREATMENT_REIMBURSEMENT'
		}
	},
	TH: {
		wages: [12_000, 30_000, 200_000],
		entries: { bonus: 'BONUS', adhoc: 'LATE_WAGE_INTEREST', claim: null }
	},
	TW: {
		wages: [30_000, 60_000, 200_000],
		world: { riskClass: '1' },
		entries: { bonus: 'bonus', adhoc: 'OCC_INJURY_MEDICAL', claim: null }
	},
	VN: {
		wages: [6_000_000, 30_000_000, 120_000_000],
		world: { region: 'I' },
		entries: { bonus: 'BONUS', adhoc: 'LATE_WAGE_COMPENSATION', claim: null }
	}
};

/** An entry's size against the wage: a bonus of one and a half months, a smaller earning, a modest claim. */
const FACTOR = { bonus: 1.5, adhoc: 0.4, thirteenth: 1, claim: 0.05 };
/**
 * Entries whose catalogue band prices the line rather than paying the request's amount: the 13th month from the
 * year's basic (PD 851), late-wage interest from the sum paid late (VN Labour Code art.97(4); TH LPA s.9).
 */
const COMPUTED = /^(THIRTEENTH|LATE_WAGE)/;
/** A wage paid 28 days late at a 5% deposit rate, the inputs a late-wage class prices. */
const LATE_WAGE = {
	due_on: '2026-02-10',
	paid_on: EVENT,
	deposit_rate: 5,
	rate_reference: 'Fixture bank notice',
	force_majeure: false
};
/** SG MOM's medical-treatment conditions for a reimbursement, all met (EA s.2 "salary" (d)). */
const SG_MEDICAL = {
	patient: 'EMPLOYEE',
	relationship_recognised: true,
	treatment: 'MEDICAL',
	treatment_received: true,
	treatment_necessary: true,
	practitioner_qualified: true,
	solely_aesthetic: false
};

const REQUEST_ID = 'd0000000-0000-4000-8000-0000000ff001';

/**
 * The cadences the gate pays: every lineage's monthly company, and PH at a semi-monthly one, where the off-cycle
 * run in the second half settles the remaining half early (owner Rule 2) and the first half is already paid.
 */
const CADENCES = [
	...LINEAGES.map((code) => ({ code, name: code, period: PERIOD, semi: false })),
	{ code: 'PH', name: 'PH semi-monthly', period: '2026-03-2', semi: true }
];

function world(code, wage, semi = false, subject = {}) {
	const setup = SETUP[code];
	const cadence = semi ? { pay_frequency: 'SEMI_MONTHLY' } : {};
	const tables = createStatutoryWorld({
		code,
		period: PERIOD,
		...setup.world,
		...(semi ? { payFrequency: 'SEMI_MONTHLY' } : {}),
		people: [
			{ key: 'P', wage, ...cadence, ...setup.person?.(wage), ...subject },
			{ key: 'OTHER', wage: setup.wages[1], ...cadence, ...setup.person?.(setup.wages[1]) }
		]
	});
	if (setup.terms != null)
		for (const row of tables.employment_terms) row.facts = { ...row.facts, ...setup.terms };
	return tables;
}

/** The selected entry, filed as the product files it: an approved, unsettled request paid in March. */
function addEntry(tables, code, kind, wage, period = PERIOD) {
	const catalogue = kind === 'claim' ? claimCatalogue(code) : adhocCatalogue(code);
	const settingsId = settingsIdOn(code, EVENT);
	const row = catalogue.find(
		(entry) => entry.settings_id === settingsId && entry.code === SETUP[code].entries[kind]
	);
	assert.ok(row, `${code} has no ${SETUP[code].entries[kind]} on ${EVENT}`);
	const amount = Math.round(wage * FACTOR[kind] * 100) / 100;
	const common = {
		id: REQUEST_ID,
		employment_id: tables.employments[0].id,
		catalogue_id: row.id,
		amount,
		pay_period: period,
		payslip_id: null,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	};
	if (kind === 'claim')
		tables.claim_requests.push({
			...common,
			incurred_on: EVENT,
			evidence_file: { id: 'receipt', name: 'receipt.pdf' },
			// A claim with request inputs is payable from its due day, which then names its pay period.
			...((row.request_facts ?? []).length === 0
				? {}
				: { due_on: EVENT, pay_period: null, facts: { amount_incurred: amount, ...SG_MEDICAL } })
		});
	else
		tables.adhoc_requests.push({
			...common,
			event_date: EVENT,
			reason: 'ordering probe',
			...(row.code.startsWith('LATE_WAGE') ? { late_wage: LATE_WAGE } : {}),
			...((row.request_facts ?? []).some((fact) => fact.key === 'wage_due_on')
				? { facts: { wage_due_on: LATE_WAGE.due_on, paid_on: EVENT } }
				: {})
		});
	return amount;
}

/** One `payroll_runs.create` through the transform, stored the way the database would hold it. */
async function run(tables, kind = 'REGULAR', sources = [], period = PERIOD, now = NOW) {
	const [payload] = await runTransform(
		payrollRuns,
		[{ company_id: COMPANY_ID, period, kind, ...(sources.length > 0 ? { sources } : {}) }],
		{ tables, now }
	);
	storeRun(tables, payload);
	return payload;
}

const cents = (value) => Math.round(value * 100) / 100;
const employees = (payload) => (payload.payslips?.create ?? []).map((slip) => slip.employment_id);

/** The month as the person and the company carry it, after every run. */
function month(tables) {
	const person = (employmentId) => {
		const slips = tables.payslips.filter((slip) => slip.employment_id === employmentId);
		const schemes = {};
		for (const slip of slips)
			for (const charge of slip.statutory) {
				const sum = (schemes[charge.scheme_code] ??= { employee: 0, employer: 0 });
				sum.employee = cents(sum.employee + charge.employee_amount);
				sum.employer = cents(sum.employer + charge.employer_amount);
			}
		const total = (field) => cents(slips.reduce((sum, slip) => sum + (slip[field] ?? 0), 0));
		return {
			schemes,
			gross: total('gross'),
			net: total('net'),
			deductions: total('total_deductions'),
			employerCost: total('employer_cost'),
			salary: cents(
				slips.flatMap((slip) => slip.base).reduce((sum, line) => sum + (line.amount ?? 0), 0)
			),
			entryLines: slips
				.flatMap((slip) => slip.adjustments)
				.filter((line) => line.source_id === REQUEST_ID)
				.map((line) => line.amount)
		};
	};
	const company = {};
	for (const stored of tables.payroll_runs) {
		for (const row of stored.company_remittances ?? []) {
			const sum = (company[`remit ${row.scheme_code}:${row.remittance_rounding}`] ??= {
				accrued: 0,
				payable: 0
			});
			sum.accrued = cents(sum.accrued + row.accrued_amount);
			sum.payable = cents(sum.payable + row.payable_amount);
		}
		for (const row of stored.company_charges ?? []) {
			const sum = (company[`charge ${row.scheme_code}`] ??= { employee: 0, employer: 0 });
			sum.employee = cents(sum.employee + row.employee_amount);
			sum.employer = cents(sum.employer + row.employer_amount);
		}
	}
	return {
		subject: person(tables.employments[0].id),
		other: person(tables.employments[1].id),
		company
	};
}

/** Each scheme figure as one flat key, so a difference names the scheme and the share. */
const flat = (side) =>
	Object.fromEntries(
		Object.entries(side.schemes).flatMap(([code, sum]) => [
			[`${code}.employee`, sum.employee],
			[`${code}.employer`, sum.employer]
		])
	);

/** A run's slips filed as paid on its pay date, the way the payslip write records a payment. */
function pay(tables, payload) {
	for (const slip of payload.payslips?.create ?? []) {
		const stored = tables.payslips.find((row) => row.id === slip.id);
		stored.status = 'PAID';
		stored.paid_at = `${payload.pay_date}T00:00:00.000Z`;
	}
}

for (const { code, name, period, semi } of CADENCES)
	for (const kind of Object.keys(SETUP[code].entries).filter(
		(entry) => SETUP[code].entries[entry] != null
	))
		for (const [index, wage] of SETUP[code].wages.entries())
			test(`${name} × ${kind} ${SETUP[code].entries[kind]} × ${['low', 'middle', 'high'][index]} wage ${wage}: combined, early and after orderings pay one identical month`, async () => {
				/** A fresh world; at a semi-monthly company the first half is run and paid first. */
				const start = async () => {
					const tables = world(code, wage, semi);
					if (semi) pay(tables, await run(tables, 'REGULAR', [], '2026-03-1'));
					return tables;
				};
				// (a) one REGULAR run pays the salary and the entry.
				const combined = await start();
				const amount = addEntry(combined, code, kind, wage, period);
				const combinedRun = await run(combined, 'REGULAR', [], period);

				// (b) the off-cycle run first: it settles the salary early in the same act, then the REGULAR run.
				const early = await start();
				addEntry(early, code, kind, wage, period);
				const offCycle = await run(early, 'OFF_CYCLE', [REQUEST_ID], period);
				const settlement = offCycle.early_settlements?.create ?? [];
				assert.equal(settlement.length, 1, 'the off-cycle run writes one EARLY run beside it');
				assert.equal(settlement[0].kind, 'EARLY');
				assert.equal(settlement[0].period, period, 'the remaining pay period is settled early');
				assert.equal(settlement[0].sequence, offCycle.sequence - 1);
				assert.deepEqual(employees(settlement[0]), [early.employments[0].id]);
				assert.deepEqual(employees(offCycle), [early.employments[0].id]);
				assert.equal(
					settlement[0].pay_date,
					combinedRun.pay_date,
					'the early salary keeps the regular pay date'
				);
				const regularAfterEarly = await run(early, 'REGULAR', [], period);
				assert.deepEqual(
					employees(regularAfterEarly),
					[early.employments[1].id],
					'the REGULAR run skips the person the EARLY run settled'
				);

				// (c) the REGULAR run, paid, then the off-cycle run: the salary is settled and is history now,
				// so nothing is settled early and the paid slip is not counted twice.
				const after = await start();
				pay(after, await run(after, 'REGULAR', [], period));
				addEntry(after, code, kind, wage, period);
				const late = await run(after, 'OFF_CYCLE', [REQUEST_ID], period);
				assert.equal(late.early_settlements, undefined);

				const [a, b, c] = [month(combined), month(early), month(after)];
				for (const [label, other] of [
					['early', b],
					['after', c]
				]) {
					assert.deepEqual(
						flat(other.subject),
						flat(a.subject),
						`${label}: every scheme of the month, tax included, to the cent`
					);
					assert.deepEqual(
						{
							gross: other.subject.gross,
							net: other.subject.net,
							deductions: other.subject.deductions,
							employerCost: other.subject.employerCost
						},
						{
							gross: a.subject.gross,
							net: a.subject.net,
							deductions: a.subject.deductions,
							employerCost: a.subject.employerCost
						},
						`${label}: the month's gross, net, deductions and employer cost`
					);
					assert.equal(other.subject.salary, a.subject.salary, `${label}: the salary, once`);
					assert.deepEqual(
						other.subject.entryLines,
						a.subject.entryLines,
						`${label}: the entry, once`
					);
					assert.deepEqual(other.other, a.other, `${label}: the colleague's month`);
					assert.deepEqual(
						other.company,
						a.company,
						`${label}: the company's remittances and charges`
					);
				}
				assert.equal(a.subject.entryLines.length, 1, 'the combined run pays the entry once');
				if (!COMPUTED.test(SETUP[code].entries[kind]))
					assert.deepEqual(a.subject.entryLines, [amount]);
			});

// ── Settled means locked, and the off-cycle entry rules ──

test('an EARLY settlement keeps its window open: a new record saves unconsumed and settles in the next period', async () => {
	const tables = workDayTables({
		runs: [
			{
				id: 'early-03',
				period: '2026-03',
				kind: 'EARLY',
				attendance_from: '2026-02-21',
				attendance_to: '2026-03-20'
			},
			{
				id: 'off-03',
				period: '2026-03',
				kind: 'OFF_CYCLE',
				attendance_from: '2026-02-21',
				attendance_to: '2026-03-20'
			}
		],
		// Paid or not, neither slip closes a day: the EARLY one settles in the next period, the off-cycle prices none.
		payslips: [
			{ payroll_run_id: 'early-03', employment_id: 'emp-1', paid_at: '2026-03-25T00:00:00.000Z' },
			{ payroll_run_id: 'off-03', employment_id: 'emp-1', paid_at: '2026-03-10T00:00:00.000Z' }
		]
	});
	const windows = payrollWindows(tables.payroll_runs, tables.payslips);
	assert.deepEqual(lockStateForDate(windows, '2026-03-15', 'emp-1'), {
		kind: 'IN_WINDOW',
		period: '2026-03',
		settlesIn: '2026-04'
	});
	assert.deepEqual(lockStateForDate(windows, '2026-03-15', 'emp-2'), {
		kind: 'IN_WINDOW',
		period: '2026-03'
	});
	assert.deepEqual(lockStateForDate(windows, '2026-03-21', 'emp-1'), { kind: 'NONE' });
	// The kiosk and HR record as usual.
	await writeDay(
		workDays,
		{
			employment_id: 'emp-1',
			work_date: '2026-03-15',
			worked_intervals: [],
			approved_overtime_hours: 2
		},
		undefined,
		tables
	);
	// A record the EARLY slip took into account is still frozen.
	await assert.rejects(
		writeDay(
			workDays,
			{ worked_intervals: [] },
			{
				id: 'day-early',
				employment_id: 'emp-1',
				work_date: '2026-03-02',
				worked_intervals: null,
				payslip_id: 'slip-early',
				approval_id: null
			},
			tables
		),
		/already taken this record into account/
	);
});

const offCycleWorld = (code = 'MY', options = {}) => {
	const tables = world(code, SETUP[code].wages[1]);
	Object.assign(tables.companies[0], options.company ?? {});
	return tables;
};
const adhocRow = (code, entry) =>
	adhocCatalogue(code).find(
		(row) => row.settings_id === settingsIdOn(code, EVENT) && row.code === entry
	);
const request = (tables, catalogueId, extra = {}) =>
	tables.adhoc_requests.push({
		id: REQUEST_ID,
		employment_id: tables.employments[0].id,
		catalogue_id: catalogueId,
		amount: 500,
		event_date: EVENT,
		pay_period: PERIOD,
		payslip_id: null,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null,
		reason: 'entry rule probe',
		...extra
	});

test('the engine refuses an off-cycle payment whose salary is unsettled; only the transform settles it first', () => {
	const tables = offCycleWorld();
	request(tables, adhocRow('MY', 'BONUS').id);
	assert.throws(
		() =>
			buildPayrollRun(
				gatherPayrollRun({
					world: payrollWorld(tables),
					companyId: COMPANY_ID,
					period: PERIOD,
					kind: 'OFF_CYCLE',
					sources: [REQUEST_ID]
				})
			),
		/2026-03 salary is not settled yet.*EARLY/
	);
});

test('an EARLY run is never created on its own', async () => {
	await assert.rejects(
		runTransform(payrollRuns, [{ company_id: COMPANY_ID, period: PERIOD, kind: 'EARLY' }], {
			tables: offCycleWorld(),
			now: NOW
		}),
		/An EARLY run is written by the off-cycle run/
	);
});

test('an off-cycle payslip of deductions alone is refused: a deduction needs an earning in the same run', async () => {
	const tables = offCycleWorld('SG');
	request(tables, adhocRow('SG', 'DAMAGE_RECOVERY').id);
	await assert.rejects(
		run(tables, 'OFF_CYCLE', [REQUEST_ID]),
		/an off-cycle payslip with only deductions has no earning/
	);
});

test("a leaver's separation payment is refused off-cycle: it goes in the FINAL run", async () => {
	const tables = offCycleWorld();
	const leaver = tables.employments[0];
	leaver.effective_range = { start: '2015-01-01', end: '2026-03-20' };
	leaver.exit_ground = 'REDUNDANCY';
	tables.employment_terms[0].effective_range = { start: '2015-01-01', end: '2026-03-20' };
	request(tables, adhocRow('MY', 'TERMINATION_BENEFIT').id);
	await assert.rejects(
		run(tables, 'OFF_CYCLE', [REQUEST_ID]),
		/TERMINATION_BENEFIT is a leaver's separation payment\. Pay it in their FINAL run/
	);
});

test("a leaver's month is settled by their FINAL run, never early: the off-cycle run waits for it", async () => {
	const tables = createStatutoryWorld({
		code: 'MY',
		period: PERIOD,
		people: [
			{ key: 'P', wage: 6_000, exit_date: '2026-03-20', exit_ground: 'RESIGNATION' },
			{ key: 'OTHER', wage: 6_000 }
		]
	});
	request(tables, adhocRow('MY', 'BONUS').id);
	await assert.rejects(
		run(tables, 'OFF_CYCLE', [REQUEST_ID]),
		/P leaves in 2026-03: run their FINAL run first/
	);
	// The FINAL run pays what is due in the month, so the bonus is recorded after it here.
	tables.adhoc_requests.length = 0;
	const final = await run(tables, 'FINAL');
	assert.deepEqual(employees(final), [tables.employments[0].id]);
	request(tables, adhocRow('MY', 'BONUS').id);
	const offCycle = await run(tables, 'OFF_CYCLE', [REQUEST_ID]);
	assert.equal(offCycle.early_settlements, undefined);
	assert.deepEqual(employees(offCycle), [tables.employments[0].id]);
});

test('a weekly company runs off-cycle only after the month’s last weekly run', async () => {
	const tables = createStatutoryWorld({
		code: 'MY',
		period: PERIOD,
		payFrequency: 'WEEKLY',
		people: [{ key: 'P', wage: 6_000 }]
	});
	request(tables, adhocRow('MY', 'BONUS').id, { pay_period: '2026-03-1' });
	await assert.rejects(
		runTransform(
			payrollRuns,
			[{ company_id: COMPANY_ID, period: '2026-03-1', kind: 'OFF_CYCLE', sources: [REQUEST_ID] }],
			{ tables, now: NOW }
		),
		/pays weekly, so an off-cycle run waits for the month's last weekly run \(2026-03-5\)/
	);
});

test('an early settlement warns that overtime still to be worked is pushed into the next period', async () => {
	const open = offCycleWorld();
	request(open, adhocRow('MY', 'BONUS').id);
	const [payload] = await runTransform(
		payrollRuns,
		[{ company_id: COMPANY_ID, period: PERIOD, kind: 'OFF_CYCLE', sources: [REQUEST_ID] }],
		{ tables: open, now: NOW }
	);
	assert.match(
		payload.early_settlements.create[0].warnings,
		/^EARLY_SETTLEMENT_OVERTIME: P: 2026-03 salary is settled early, so overtime worked from 2026-03-10 to 2026-03-20 is paid in the next period/
	);
	// Settled after the attendance window closed, nothing is pushed.
	const closed = offCycleWorld();
	request(closed, adhocRow('MY', 'BONUS').id);
	const [late] = await runTransform(
		payrollRuns,
		[{ company_id: COMPANY_ID, period: PERIOD, kind: 'OFF_CYCLE', sources: [REQUEST_ID] }],
		{ tables: closed, now: '2026-03-24T02:00:00.000Z' }
	);
	assert.doesNotMatch(late.early_settlements.create[0].warnings, /EARLY_SETTLEMENT_OVERTIME/);
});

test('PH semi-monthly: ₱200,000 bonus on ₱40,000 withholds the same WTAX in every ordering (RR 2-98 s.2.79(B)(3))', async () => {
	// The second half's regular and supplementary compensation are one payroll period's: the off-cycle slip is
	// withheld bill(half + bonus) − bill(half). Withheld on the bonus alone it was 27,389.00 for the month.
	const wtax = async (order) => {
		// The earlier figures' setting: both halves' slips still unpaid (the gate above pays them).
		const tables = world('PH', 40_000, true);
		await run(tables, 'REGULAR', [], '2026-03-1');
		const add = () =>
			request(tables, adhocRow('PH', 'bonus').id, { amount: 200_000, pay_period: '2026-03-2' });
		if (order === 'combined') {
			add();
			await run(tables, 'REGULAR', [], '2026-03-2');
		} else if (order === 'early') {
			add();
			await run(tables, 'OFF_CYCLE', [REQUEST_ID], '2026-03-2');
			await run(tables, 'REGULAR', [], '2026-03-2');
		} else {
			await run(tables, 'REGULAR', [], '2026-03-2');
			add();
			await run(tables, 'OFF_CYCLE', [REQUEST_ID], '2026-03-2');
		}
		return month(tables).subject.schemes.WTAX.employee;
	};
	for (const order of ['combined', 'early', 'after'])
		assert.equal(await wtax(order), 31_784.9, order);
});

// ── Recorded after the early settlement: the next period settles it, once ──

const LEAVE_DAY = '2026-03-16';
const OVERTIME_DAY = '2026-03-20';

/**
 * An unpaid leave day and an overtime day for the person, written through their transforms on the day they happen
 * (Monday 16 and Friday 20 March 2026: the 15th is a Sunday, a rest day no leave charges).
 */
async function addRecords(tables, code) {
	const settingsId = settingsIdOn(code, LEAVE_DAY);
	const unpaid =
		tables.leave_catalogue.find(
			(row) => row.settings_id === settingsId && row.code === 'UNPAID_LEAVE'
		) ?? tables.leave_catalogue.find((row) => row.settings_id === settingsId && row.is_npl);
	const [leave] = await runTransform(
		leaveEntries,
		[
			{
				employment_id: tables.employments[0].id,
				catalogue_id: unpaid.id,
				reference: 'ORDERING-NPL',
				from_date: LEAVE_DAY,
				to_date: LEAVE_DAY,
				half_day_start: false,
				half_day_end: false,
				no_pay_origin: 'EMPLOYEE_REQUESTED',
				reason: 'Recorded after the early settlement'
			}
		],
		{ tables, now: `${LEAVE_DAY}T02:00:00.000Z` }
	);
	tables.leave_entries.push({ id: 'late-leave', approval_id: null, payslip_id: null, ...leave });
	const zone = tables.jurisdiction_settings[0].payroll.timezone;
	const offset = offsetMinutesFor(zone, OVERTIME_DAY);
	const at = (clock) =>
		new Date(Date.parse(`${OVERTIME_DAY}T${clock}:00.000Z`) - offset * 60_000).toISOString();
	const [day] = await runTransform(
		workDays,
		[
			{
				employment_id: tables.employments[0].id,
				work_date: OVERTIME_DAY,
				worked_intervals: [
					{ start: at('09:00'), end: at('13:00') },
					{ start: at('14:00'), end: at('20:00') }
				],
				approved_overtime_hours: 2,
				// TH LPA s.24: the worker consents to each overtime occasion.
				overtime_consented_at: at('08:00')
			}
		],
		{ tables, now: `${OVERTIME_DAY}T02:00:00.000Z` }
	);
	tables.work_days.push({ id: 'late-day', approval_id: null, payslip_id: null, ...day });
}

/** Both months' slips of the person: gross, and every pay line by code, bucket and amount. */
function twoMonths(tables) {
	const slips = tables.payslips.filter((slip) => slip.employment_id === tables.employments[0].id);
	return {
		gross: cents(slips.reduce((sum, slip) => sum + slip.gross, 0)),
		lines: slips
			.flatMap((slip) => [
				...slip.base.map((line) => `BASE ${line.component_code} ${line.amount}`),
				...slip.adjustments.map(
					(line) => `${line.bucket} ${line.component_code} ${line.source_id ?? ''} ${line.amount}`
				)
			])
			.toSorted()
	};
}

const LATER_ID = 'd0000000-0000-4000-8000-0000000ff002';

/** A second bonus, paid by an off-cycle run in `period` after its regular slip. */
function addLaterBonus(tables, code, amount, period) {
	const row = adhocCatalogue(code).find(
		(entry) =>
			entry.settings_id === settingsIdOn(code, '2026-04-10') &&
			entry.code === SETUP[code].entries.bonus
	);
	tables.adhoc_requests.push({
		id: LATER_ID,
		employment_id: tables.employments[0].id,
		catalogue_id: row.id,
		amount,
		event_date: '2026-04-10',
		pay_period: period,
		payslip_id: null,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null,
		reason: 'later off-cycle bonus'
	});
}

/** Every scheme's employee and employer figure on the subject's slips of the periods `keep` selects. */
function schemesOf(tables, keep = () => true) {
	const runPeriod = new Map(tables.payroll_runs.map((row) => [row.id, row.period]));
	const out = {};
	for (const slip of tables.payslips)
		if (slip.employment_id === tables.employments[0].id && keep(runPeriod.get(slip.payroll_run_id)))
			for (const charge of slip.statutory) {
				const sum = (out[charge.scheme_code] ??= { employee: 0, employer: 0 });
				sum.employee = cents(sum.employee + charge.employee_amount);
				sum.employer = cents(sum.employer + charge.employer_amount);
			}
	return out;
}

/**
 * One month settled early on the 10th, an unpaid leave day and an overtime day recorded after it, the next period's
 * regular run, and optionally an off-cycle bonus later in that next period — paid three ways: (a) the records in
 * before the month's regular run, (b) recorded after the early settlement, (c) as (b) without the records.
 *
 * Each record settles once, in the next period. Each scheme bills the late lines by its declared `late_line_month`:
 * EARNED as a top-up of the earned month, so every scheme figure and the year to date equal (a) to the cent; PAID with
 * the next period, bill(next incl. the late lines) − bill(next without them). With `discriminates`, the case is built
 * so that billing those EARNED schemes PAID instead moves their figures: the gate fails if the top-up is lost.
 */
async function lateRecordsCase({
	code,
	period,
	semi = false,
	wage,
	subject = {},
	bonus,
	laterBonus,
	discriminates = []
}) {
	const next = nextPeriod(period);
	const start = async (rules = {}) => {
		const tables = world(code, wage, semi, subject);
		for (const row of tables.statutory_contributions)
			if (rules[row.code] != null) row.late_line_month = rules[row.code];
		tables.leave_catalogue = leaveCatalogue(code);
		if (semi) await run(tables, 'REGULAR', [], '2026-03-1');
		addEntry(tables, code, 'bonus', wage, period);
		if (bonus != null) tables.adhoc_requests.at(-1).amount = bonus;
		return tables;
	};
	/** The next period: its regular run, then the later off-cycle bonus. */
	const nextRuns = async (tables) => {
		const regular = await run(tables, 'REGULAR', [], next);
		if (laterBonus != null) {
			pay(tables, regular);
			addLaterBonus(tables, code, laterBonus, next);
			await run(tables, 'OFF_CYCLE', [LATER_ID], next, '2026-04-28T02:00:00.000Z');
		}
		return regular;
	};
	/** (b) the off-cycle run on the 10th settles the salary early; the records, if any, come after it. */
	const earlyPath = async (records, rules) => {
		const tables = await start(rules);
		await run(tables, 'OFF_CYCLE', [REQUEST_ID], period);
		if (records) await addRecords(tables, code);
		const regular = await run(tables, 'REGULAR', [], period);
		assert.ok(!employees(regular).includes(tables.employments[0].id), 'the month stays settled');
		return [tables, await nextRuns(tables)];
	};
	// (a) the records are in before the month's one regular run.
	const combined = await start();
	await addRecords(combined, code);
	await run(combined, 'REGULAR', [], period);
	await nextRuns(combined);
	const [early, earlyNext] = await earlyPath(true);
	const [none] = await earlyPath(false);

	const slipOf = (payload) =>
		payload.payslips.create.find((slip) => slip.employment_id === early.employments[0].id);
	for (const [tables, settledIn] of [
		[combined, 'the month'],
		[early, 'the next period']
	]) {
		// Each record is pinned once, by the slip that settled it.
		const pins = [
			tables.leave_entries.find((row) => row.id === 'late-leave').payslip_id,
			tables.work_days.find((row) => row.id === 'late-day').payslip_id
		];
		assert.ok(
			pins.every((pin) => pin != null),
			`both records are settled (${settledIn})`
		);
		if (tables === early)
			assert.deepEqual(
				pins,
				[slipOf(earlyNext).id, slipOf(earlyNext).id],
				'the next period settles both'
			);
	}
	// Nothing of the records is in the early-settled month, and each record's lines are paid once.
	const lateLines = (tables) =>
		tables.payslips
			.filter((slip) => slip.employment_id === tables.employments[0].id)
			.flatMap((slip) => slip.adjustments)
			.filter((line) => ['late-leave', 'late-day'].includes(line.source_id))
			.map((line) => `${line.source_id} ${line.component_code} ${line.amount}`)
			.toSorted();
	const march = early.payslips.filter(
		(slip) =>
			slip.employment_id === early.employments[0].id &&
			early.payroll_runs.find((row) => row.id === slip.payroll_run_id).period === period
	);
	assert.ok(
		march.every((slip) =>
			slip.adjustments.every((line) => !['late-leave', 'late-day'].includes(line.source_id))
		)
	);
	assert.deepEqual(lateLines(early), lateLines(combined), 'each late line is paid once');
	const [a, b] = [twoMonths(combined), twoMonths(early)];
	assert.equal(b.gross, a.gross, 'the two months pay the same gross');
	assert.deepEqual(b.lines, a.lines, 'the two months pay the same lines, each once');

	// Each scheme bills the late lines by its declared rule.
	const rule = new Map(
		early.statutory_contributions
			.filter((row) => row.settings_id === settingsIdOn(code, `${next.slice(0, 7)}-15`))
			.map((row) => [row.code, row.late_line_month ?? 'PAID'])
	);
	const inNext = (at) => at === next;
	const [all, settled, without] = [combined, early, none].map((tables) => schemesOf(tables));
	const [nextSettled, nextWithout] = [schemesOf(early, inNext), schemesOf(none, inNext)];
	const zero = { employee: 0, employer: 0 };
	for (const scheme of new Set([...Object.keys(all), ...Object.keys(settled)])) {
		const declared = rule.get(scheme) ?? 'PAID';
		for (const share of ['employee', 'employer'])
			assert.equal(
				(settled[scheme] ?? zero)[share],
				declared === 'EARNED'
					? (all[scheme] ?? zero)[share]
					: cents(
							(without[scheme] ?? zero)[share] +
								(nextSettled[scheme] ?? zero)[share] -
								(nextWithout[scheme] ?? zero)[share]
						),
				`${scheme}.${share} (${declared})`
			);
	}
	// The year to date a later run reads counts each late line and its top-up once: an EARNED scheme's equals (a).
	const yearToDate = (tables) =>
		gatherPayrollRun({
			world: payrollWorld(tables),
			companyId: COMPANY_ID,
			period: nextPeriod(next)
		}).gathered.yearToDate;
	const [ytdAll, ytdSettled] = [yearToDate(combined), yearToDate(early)];
	const person = early.employments[0].employee_id;
	for (const [scheme, declared] of rule) {
		const key = `${person}:${scheme}`;
		const got = ytdSettled.get(key);
		if (declared === 'EARNED')
			for (const field of ['employee', 'employer', 'base', 'ordinary'])
				assert.equal(
					cents(got?.[field] ?? 0),
					cents(ytdAll.get(key)?.[field] ?? 0),
					`${scheme} year to date ${field}`
				);
		else
			for (const share of ['employee', 'employer'])
				assert.equal(
					cents(got?.[share] ?? 0),
					(settled[scheme] ?? zero)[share],
					`${scheme} year to date ${share}, each slip once`
				);
	}
	// The case discriminates: billed PAID, each named EARNED scheme would come out differently.
	if (discriminates.length > 0) {
		const [paid] = await earlyPath(
			true,
			Object.fromEntries(discriminates.map((scheme) => [scheme, 'PAID']))
		);
		const asPaid = schemesOf(paid);
		for (const scheme of discriminates) {
			assert.equal(rule.get(scheme), 'EARNED', `${scheme} is declared EARNED`);
			assert.notDeepEqual(
				asPaid[scheme] ?? zero,
				settled[scheme] ?? zero,
				`${scheme} discriminates: billed PAID ${JSON.stringify(asPaid[scheme])}, EARNED ${JSON.stringify(settled[scheme])}`
			);
		}
	}
}

for (const { code, name, period, semi } of CADENCES)
	for (const [index, wage] of SETUP[code].wages.entries()) {
		const at = `${name} × ${['low', 'middle', 'high'][index]} wage ${wage}`;
		test(`${at}: leave and overtime recorded after the early settlement settle once, in the next period`, () =>
			lateRecordsCase({ code, period, semi, wage }));
		test(`${at}: an off-cycle bonus after the next period's late lines bills them once`, () =>
			lateRecordsCase({ code, period, semi, wage, laterBonus: Math.round(wage * 0.5) }));
	}

// ── Late lines that cross a band edge, ceiling or bracket: EARNED and PAID would bill them differently ──

test('SG CPF: late lines bill at the earned month’s age band (55 in March 2026, April’s is the 55–60 band), a later April bonus included', () =>
	lateRecordsCase({
		code: 'SG',
		period: PERIOD,
		wage: 6_000,
		subject: { birth_date: '1971-03-05' },
		laterBonus: 1_000,
		discriminates: ['CPF']
	}));

test('SG CDAC: late lines take the paid month below $2,000 but not the earned month, bonus included', () =>
	lateRecordsCase({
		code: 'SG',
		period: PERIOD,
		wage: 2_050,
		subject: { race: 'CHINESE' },
		discriminates: ['CDAC']
	}));

test('SG ECF: late lines take the paid month below $2,500 but not the earned month, bonus included', () =>
	lateRecordsCase({
		code: 'SG',
		period: PERIOD,
		wage: 2_550,
		subject: { race: 'EURASIAN' },
		discriminates: ['ECF']
	}));

test('SG SINDA: late lines take the paid month below $2,500 but not the earned month, bonus included', () =>
	lateRecordsCase({
		code: 'SG',
		period: PERIOD,
		wage: 2_550,
		subject: { race: 'INDIAN' },
		discriminates: ['SINDA']
	}));

test('SG MBMF: late lines take the paid month below $3,000 but not the earned month, bonus included', () =>
	lateRecordsCase({
		code: 'SG',
		period: PERIOD,
		wage: 3_050,
		subject: { race: 'MALAY', religion: 'ISLAM' },
		discriminates: ['MBMF']
	}));

test('MY EPF, SOCSO, EIS: late lines cross table rows of the earned month, before the person turns 60 in the paid month, a later bonus included', () =>
	lateRecordsCase({
		code: 'MY',
		period: PERIOD,
		wage: 3_030,
		subject: { birth_date: '1966-04-15' },
		laterBonus: 1_000,
		discriminates: ['EPF', 'SOCSO', 'EIS']
	}));

test('MY PCB near the RM35,000 bracket bills late lines with the paid month, EPF across RM100 rows with the earned month’s bonus', () =>
	lateRecordsCase({
		code: 'MY',
		period: PERIOD,
		wage: 4_030,
		discriminates: ['EPF']
	}));

test('ID JP: late unpaid leave bills JP in the earned month, though the person reaches pension age 59 in the paid month, a later bonus included', () =>
	lateRecordsCase({
		code: 'ID',
		period: PERIOD,
		wage: 6_000_000,
		subject: { birth_date: '1967-04-15' },
		laterBonus: 1_000_000,
		discriminates: ['JP']
	}));

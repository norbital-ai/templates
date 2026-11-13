import { Effect } from 'effect';
import {
	awardedMinutes,
	holidaysForDay,
	overlapSpans,
	scheduled,
	spanMinutes
} from './attendance.js';
import { dateWeekday, intervalSpans } from './time_evidence.js';

const WEEKDAYS = [
	'SUNDAY',
	'MONDAY',
	'TUESDAY',
	'WEDNESDAY',
	'THURSDAY',
	'FRIDAY',
	'SATURDAY'
] as const;
import { calculatePayroll, isWorkingDay, offDaysFor, type ProjectedDay } from './engine.js';
import type { JsonObject } from './contracts.js';
import type { PayWindow } from './pay_cycle.js';
import { idOf, objectValue, queryRows, type Reader } from './reads.js';
import { Refusal, daysIn, isJsonObject } from './foundation.js';
import { breakdownOf, type PayslipBreakdown } from './payslip_breakdown.js';
import { accountsOf, latestWindow, totalsScope, viewOf } from '../ledger/core.js';
import { claimLeft, claimWanted } from '../ledger/service.js';
import { chainOf, isExit, startsOf } from './contract_change.js';

/** One payslip row the run's create transform attaches as a child. */

export interface CalculatedPayslip {
	readonly employee_id: string;
	readonly employment_id: string;
	readonly entity_id: string;
	readonly basic_earnings: number;
	readonly gross_earnings: number;
	readonly net_pay: number;
	readonly total_deductions: number;
	readonly employer_cost: number;
	readonly period: string;
	readonly ordinary_wages: number;
	readonly employee_statutory: number;
	readonly tax_withheld: number;
	readonly breakdown: PayslipBreakdown;
}

const covers = (range: unknown, from: string, to: string): boolean => {
	if (!isJsonObject(range)) return false;
	const start = range.from,
		end = range.to;
	return (
		typeof start === 'string' &&
		start <= to &&
		(end === null || end === undefined || (typeof end === 'string' && end >= from))
	);
};

/** A run's frame: the attendance it prices and an off-cycle run's entries. */
export interface RunFrame {
	readonly attendance: PayWindow;
	/** An off-cycle run: the entries it pays. Only their people get a payslip. */
	readonly pays?: ReadonlySet<string>;
	/** An off-cycle run: the open amendment rows HR named for it. It carries their people's earlier periods. */
	readonly carries?: ReadonlySet<string>;
	/** A paid period worked out again: only these people are priced. */
	readonly people?: ReadonlySet<string>;
	/** Dated rows this run leaves to a paid period it works out again. */
	readonly leftOut?: ReadonlySet<string>;
	/** Back pay this period owes each person: the run puts it on the law's own back-pay row. */
	readonly backPay?: ReadonlyMap<string, number>;
	/** Pay the run carries for earlier periods, by person and checkpoint code: wages of this month for a scheme assessed when paid. */
	readonly carried?: ReadonlyMap<string, Readonly<Record<string, number>>>;
	/** Agreed terms are read as they were signed by this day. The run's pay date when left out. */
	readonly termsAsOf?: string;
}

const CATALOG = ['id', 'code', 'subtotal_id', 'lookup', 'eligibility', 'conversion'];
/** Fields read by the calculation, shared by a new run and a paid period worked out again. */
export const CALCULATION_FIELDS = {
	subtotal: ['id', 'code', 'name', 'previous_id', 'calculation'],
	allowance: [...CATALOG, 'include_in_rate'],
	overtime: [...CATALOG, 'direction'],
	statutory: [
		'id',
		'code',
		'kind',
		'assessed',
		'lookup',
		'subtotal_id',
		'employer_cost_subtotal_id',
		'eligibility',
		'depends_on',
		'employee_amount',
		'employer_amount'
	],
	leave: [
		'id',
		'code',
		'settings_id',
		'subtotal_id',
		'lookup',
		'eligibility',
		'paid_share',
		'payout'
	],
	claim: CATALOG,
	adhoc: [...CATALOG, 'direction', 'party', 'off_cycle_eligible']
} as const;
const CODE_OF_CATALOG = { fields: ['code'] };

/**
 * Everything a run needs, read once before any payslip: the window's rows and nothing outside it.
 * It is one request, so one statement, and neither the calculation nor the attachments read again.
 */
const refOf = (value: unknown) => String(isJsonObject(value) ? value.id : value);

/**
 * A claim on a limited row pays what it posted: the ledger, not the entry, knows what was left when it came in. One with
 * no movement found nothing left or is on its way, so it pays what posting it would.
 */
export const claimsAsPosted = Effect.fn('payroll.claimsAsPosted')(function* (
	read: Reader,
	data: Readonly<Record<string, readonly JsonObject[]>>
) {
	// by code: an entry keeps the row it was raised on, and a later run reads that code in its own version
	const limited = new Map(
		(data.claim_catalog ?? [])
			.filter((row) => objectValue(row.lookup).annual_limit != null)
			.map((row) => [String(row.code), { code: String(row.code), lookup: objectValue(row.lookup) }])
	);
	const codeOf = (row: JsonObject) => String(objectValue(row.catalog_id).code);
	const claims = (data.claim_catalog_entry ?? []).filter((row) => limited.has(codeOf(row)));
	if (claims.length === 0) return data;
	const { ledger_entry: rows = [] } = yield* queryRows(read, {
		ledger_entry: {
			where: { source: { in: claims.map((row) => `claim_catalog_entry:${String(row.id)}`) } },
			fields: ['source', 'operation', 'amount'],
			limit: 10000
		}
	});
	const posted = new Map<string, number>();
	for (const row of rows)
		posted.set(
			String(row.source),
			(posted.get(String(row.source)) ?? 0) +
				(row.operation === 'DEDUCT' ? -1 : 1) * Number(row.amount ?? 0)
		);
	const contract = new Map((data.employee_contract ?? []).map((row) => [String(row.id), row]));
	const balance = new Map(
		(data.employee_balance ?? []).map((row) => [String(row.employee_id), row])
	);
	const scope = String(data.jurisdiction_settings?.[0]?.code);
	const drawn = new Map<string, number>();
	return {
		...data,
		claim_catalog_entry: (data.claim_catalog_entry ?? []).map((row) => {
			const amount = posted.get(`claim_catalog_entry:${String(row.id)}`);
			if (amount !== undefined) return { ...row, quantity: Math.abs(amount) };
			const catalog = limited.get(codeOf(row));
			const employment = contract.get(refOf(row.employment_id));
			if (catalog === undefined || employment === undefined) return row;
			const employee = String(employment.employee_id);
			const accounts = accountsOf(balance.get(employee)?.account);
			const keyOf = (period: string) => `${employee}/${catalog.code}/${period}`;
			const [wanted] = claimWanted(
				row,
				catalog,
				{ scope, started: String(employment.service_started_on), events: [] },
				(period) => claimLeft(accounts, catalog, period) - (drawn.get(keyOf(period)) ?? 0)
			);
			if (wanted === undefined) return row;
			drawn.set(keyOf(wanted.period), (drawn.get(keyOf(wanted.period)) ?? 0) + wanted.amount);
			return { ...row, quantity: wanted.amount };
		})
	};
});

export const loadRun = Effect.fn('payroll.loadRun')(function* (
	read: Reader,
	run: JsonObject,
	{ attendance, pays }: RunFrame,
	jurisdiction: string
) {
	const coverage = objectValue(run.salary_coverage);
	const companyId = String(run.entity_id);
	const settingsId = String(run.settings_id);
	const [opens = attendance.from] = [attendance.from, String(coverage.from)].sort();
	const closes = [attendance.to, String(coverage.to)].sort().at(-1) ?? attendance.to;
	const own = { entity_id: { eq: companyId } };
	// a run pays one pay group: its contracts and their roster, nobody else's
	const paid = { ...own, pay_group_id: { eq: String(run.pay_group_id) } };
	const inVersion = { where: { settings_id: { eq: settingsId } }, limit: 10000 };
	// every version of the run's own law, never another country's
	const inLaw = { settings_id: { is: { code: { eq: jurisdiction } } } };
	// to the salary period's end: a leaver's last run pays what falls after its attendance, up to their last day
	const window = { gte: attendance.from, lte: closes };
	const unsealed = { payroll_run_id: { is_null: true } };
	// a claim or adhoc entry no run has paid is due whatever its date: one entered for a period that paid the person
	// nothing. One dated in a period they were paid for is that period's own, worked out again (`leftOut`)
	const unpaid =
		pays === undefined
			? { ...own, ...unsealed, incurred_on: { lte: closes } }
			: { id: { in: [...pays] } };
	// an instalment is read in its own window
	const repaid =
		pays === undefined ? { ...own, ...unsealed, paid_on: window } : { id: { in: [...pays] } };
	// a cash-out with a slot not yet paid, whatever its date
	const pendingLeave = {
		leave_catalog_entry_day: { some: unsealed },
		encashment: { eq: true }
	};
	// the contracts in force in the window, and any an unpaid entry was raised on before it
	const contract = {
		...paid,
		status: { eq: 'SEALED' },
		or: [
			{ effective_range: { overlaps: { from: opens, to: closes } } },
			{ claim_catalog_entry: { some: unpaid } },
			{ adhoc_catalog_entry: { some: unpaid } },
			// a leave entry keeps the contract version it was raised on; its open slots still belong to this run
			{
				leave_catalog_entry: {
					some: { leave_catalog_entry_day: { some: { ...unsealed, incurred_on: window } } }
				}
			},
			{ leave_catalog_entry: { some: pendingLeave } },
			{ loan_catalog_entry_repayment: { some: repaid } },
			// a roster day keeps the version it was keyed under; the run prices it under the one in force on its date
			{ roster_entry: { some: { work_date: window } } }
		]
	};
	const data = yield* queryRows(read, {
		jurisdiction_settings: {
			where: { id: { eq: settingsId } },
			fields: [
				'id',
				'code',
				'status',
				'timezone',
				'tax_year_start_month',
				'lookup',
				'conversions',
				'ledger'
			],
			limit: 1
		},
		subtotal: { ...inVersion, fields: CALCULATION_FIELDS.subtotal },
		allowance_catalog: { ...inVersion, fields: CALCULATION_FIELDS.allowance },
		overtime_catalog: { ...inVersion, fields: CALCULATION_FIELDS.overtime },
		statutory_contribution_catalog: { ...inVersion, fields: CALCULATION_FIELDS.statutory },
		// every version: a leave entry keeps the catalogue it was raised on, and the run maps it by code
		leave_catalog: { where: inLaw, fields: CALCULATION_FIELDS.leave, limit: 10000 },
		claim_catalog: { ...inVersion, fields: CALCULATION_FIELDS.claim },
		adhoc_catalog: { ...inVersion, fields: CALCULATION_FIELDS.adhoc },
		// a loan entry keeps the catalog it was created under; read every version so a cutover does not orphan it
		loan_catalog: {
			where: inLaw,
			fields: ['id', 'code', 'subtotal_id'],
			limit: 10000
		},
		work_event_catalog: { where: inLaw, limit: 10000 },
		work_event: { where: own, limit: 10000 },
		shift_definition: { where: own, limit: 10000 },
		shift_pattern: { where: own, limit: 10000 },
		holiday: { where: own, limit: 10000 },
		pay_group: {
			where: { id: { eq: String(run.pay_group_id) } },
			fields: ['payment_schedule'],
			limit: 1
		},
		entity_profile_version: { where: { ...own, status: { eq: 'SEALED' } }, limit: 10000 },
		employee_contract: { where: contract, limit: 10000 },
		employee_profile: {
			where: { employee_contract: { some: contract } },
			limit: 10000,
			employee_contract: {
				where: { status: { eq: 'SEALED' } },
				fields: ['employee_id', 'status', 'effective_range', 'entity_id'],
				limit: 10000,
				entity_id: { fields: ['settings_code'] }
			}
		},
		employee_balance: {
			where: { employee_id: { is: { employee_contract: { some: contract } } } },
			limit: 10000
		},
		// a leave with a slot in this window, or one still pending
		leave_catalog_entry: {
			where: {
				...own,
				or: [{ leave_catalog_entry_day: { some: { incurred_on: window } } }, pendingLeave]
			},
			limit: 10000,
			leave_catalog_entry_day: {
				fields: ['id', 'leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
				limit: 10000
			},
			catalog_id: CODE_OF_CATALOG
		},
		claim_catalog_entry: { where: unpaid, limit: 10000, catalog_id: CODE_OF_CATALOG },
		adhoc_catalog_entry: { where: unpaid, limit: 10000, catalog_id: CODE_OF_CATALOG },
		loan_catalog_entry: {
			where: { ...own, repayments: { some: repaid } },
			limit: 10000,
			catalog_id: CODE_OF_CATALOG
		},
		loan_catalog_entry_repayment: { where: repaid, limit: 10000 },
		workplace_case_catalog_entry: {
			where: { ...own, payroll_run_id: { is_null: true } },
			fields: ['id', 'employment_id', 'opened_on', 'closed_on'],
			limit: 10000
		},
		roster_entry: {
			where: {
				employment_id: { is: paid },
				work_date: window
			},
			fields: [
				'id',
				'employment_id',
				'payroll_run_id',
				'work_date',
				'shift_definition_id',
				'actual_worked_intervals',
				'planned_overtime_intervals',
				'overtime_as_time_off'
			],
			limit: 10000
		},
		statutory_change: {
			where: {
				applied_version_id: { is_null: true },
				finding_id: { is: { status: { eq: 'CONFIRMED' } } }
			},
			fields: ['jurisdiction_code', 'effective_from'],
			limit: 10000
		}
	});
	// a version signed after this run's pay date keeps the terms that were signed in time: read those versions
	const payDate = String(run.pay_date ?? coverage.to);
	const lateFor = [
		...new Set(
			(data.employee_contract ?? []).flatMap((row) => {
				const signed = objectValue(row.terms).signed_on;
				return typeof signed === 'string' && signed > payDate ? [String(row.employee_id)] : [];
			})
		)
	];
	const earlier =
		lateFor.length === 0
			? {}
			: yield* queryRows(read, {
					employee_contract: {
						where: { employee_id: { in: lateFor }, status: { eq: 'SEALED' } },
						fields: ['id', 'employee_id', 'status', 'effective_range', 'terms'],
						limit: 10000
					}
				});
	return yield* claimsAsPosted(read, {
		...withStints(data),
		contract_terms: earlier.employee_contract ?? []
	});
});

/** A contract carries the service start worked out from its stints, as windows and expressions read it. */
export const withStints = (data: RunData): RunData => {
	const { chain, lineage } = chainOf(
		(data.employee_profile ?? []).flatMap((row) =>
			Array.isArray(row.employee_contract) ? row.employee_contract.filter(isJsonObject) : []
		)
	);
	const cumulative = new Set(
		(data.employee_profile ?? []).flatMap((row) =>
			row.cumulative_service === true ? [String(row.id)] : []
		)
	);
	return {
		...data,
		employee_profile: (data.employee_profile ?? []).map((row) =>
			Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'employee_contract'))
		),
		employee_contract: (data.employee_contract ?? []).map((row) => ({
			...row,
			...startsOf(row, chain, lineage, cumulative.has(String(row.employee_id))),
			// the employment ends with this version only at an exit: a later version of the lineage continues it
			exit: isExit(row, chain, lineage)
		}))
	};
};

export type RunData = Readonly<Record<string, readonly JsonObject[]>>;

/**
 * One run's payslips from what `loadRun` read: pure calculation, one pass per person. `attaches` is what those payslips
 * priced, so the one write seals exactly that: nothing of someone the run does not pay, no slot it did not price.
 */
export const calculateRun = Effect.fn('payroll.calculateRun')(function* (
	stored: RunData,
	run: JsonObject,
	frame: RunFrame
) {
	const coverage = run.salary_coverage;
	if (
		!isJsonObject(coverage) ||
		typeof coverage.from !== 'string' ||
		typeof coverage.to !== 'string'
	)
		return yield* Effect.fail(
			new Refusal({ message: 'Payroll needs a complete salary coverage.' })
		);
	const from = coverage.from,
		to = coverage.to;
	// a run prices only what falls in its period, the same dates `attaches` posts: nothing dated elsewhere pays or deducts
	const { from: start, to: end } = frame.attendance;
	const companyId = String(run.entity_id);
	const settings = (stored.jurisdiction_settings ?? [])[0];
	const settingsId = String(run.settings_id);
	if (settings === undefined || settings['status'] !== 'SEALED')
		return yield* Effect.fail(new Refusal({ message: 'The run needs a sealed jurisdiction.' }));
	// the law's own row for pay that belongs to earlier periods: without one, a version applies from its start
	const backPayCode = objectValue(settings.conversions).back_pay;
	const backPayRow =
		typeof backPayCode !== 'string'
			? undefined
			: (stored.adhoc_catalog ?? []).find(
					(row) => row.code === backPayCode && String(row.settings_id ?? settingsId) === settingsId
				);
	// agreed terms are the latest signed by the pay date; every other fact is the version's in force on the date
	const asOf = frame.termsAsOf ?? String(run.pay_date ?? to);
	const signedOf = (row: JsonObject) => {
		const signed = objectValue(row.terms).signed_on;
		return typeof signed === 'string' ? signed : '';
	};
	const late = (row: JsonObject) =>
		backPayRow !== undefined && signedOf(row) !== '' && signedOf(row) > asOf;
	const startOf = (row: JsonObject) => String(objectValue(row.effective_range).from ?? '');
	const signedInTime = [
		...new Map(
			[...(stored.contract_terms ?? []), ...(stored.employee_contract ?? [])].map((row) => [
				String(row.id),
				row
			])
		).values()
	]
		.filter((row) => row.status !== 'VOID' && !late(row))
		.toSorted((left, right) => startOf(left).localeCompare(startOf(right)));
	const data: RunData = {
		...stored,
		employee_contract: (stored.employee_contract ?? []).flatMap((row) => {
			if (!late(row)) return [row];
			const agreed = signedInTime.findLast(
				(version) => version.employee_id === row.employee_id && startOf(version) <= to
			);
			// nothing was signed in time: the period pays nothing of its own, and the signing period owes it as back pay
			return agreed === undefined ? [] : [{ ...row, terms: agreed.terms ?? null }];
		})
	};
	const employerVersion = (data.entity_profile_version ?? []).find((row) =>
		covers(row.effective_range, from, to)
	);
	if (employerVersion === undefined)
		return yield* Effect.fail(
			new Refusal({ message: 'No employer version covers the salary period.' })
		);
	// the employer as this run sees it: the sealed version, on the run's pay group's schedule
	const payGroup = (data.pay_group ?? [])[0];
	const employer: JsonObject = {
		...employerVersion,
		...(payGroup === undefined ? {} : { payment_schedule: payGroup.payment_schedule })
	};
	const covering = (data.employee_contract ?? []).filter(
		(row) =>
			covers(row.effective_range, from, to) &&
			(frame.people === undefined || frame.people.has(String(row.employee_id)))
	);
	const sealing = {
		leave: new Set<string>(),
		leave_day: new Set<string>(),
		claim: new Set<string>(),
		adhoc: new Set<string>(),
		repayment: new Set<string>(),
		case: new Set<string>(),
		roster_entry: new Set<string>()
	};
	const sealed = () => ({
		leave: [...sealing.leave].map((id) => idOf('leave_catalog_entry', id)),
		leave_day: [...sealing.leave_day].map((id) => idOf('leave_catalog_entry_day', id)),
		claim: [...sealing.claim].map((id) => idOf('claim_catalog_entry', id)),
		adhoc: [...sealing.adhoc].map((id) => idOf('adhoc_catalog_entry', id)),
		repayment: [...sealing.repayment].map((id) => idOf('loan_catalog_entry_repayment', id)),
		case: [...sealing.case].map((id) => idOf('workplace_case_catalog_entry', id)),
		roster_entry: [...sealing.roster_entry].map((id) => idOf('roster_entry', id))
	});
	if (covering.length === 0) return { payslips: [], attaches: sealed() };
	// one payslip a person: a renewal inside the period pays on the contract in force at its end
	const contracts = [
		...new Map(
			[...covering]
				.toSorted((left, right) => startOf(left).localeCompare(startOf(right)))
				.map((row) => [String(row.employee_id), row])
		).values()
	];

	const { pays } = frame;
	// a leaver's last run is the one covering their last day: it also pays what falls after its attendance, up to then
	const until = new Map(
		contracts.map((row) => {
			const last = objectValue(row.effective_range).to;
			const leaves = row.exit === true && typeof last === 'string' && last > end && last <= to;
			return [String(row.employee_id), leaves ? last : end];
		})
	);
	const employeeOf = new Map(
		(data.employee_contract ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const untilOf = (row: JsonObject) =>
		until.get(employeeOf.get(String(row.employment_id)) ?? '') ?? end;
	// what was entered after an earlier run closed is paid here, a cycle late
	const due = (row: JsonObject, date: unknown): boolean =>
		pays?.has(String(row.id)) ??
		(typeof date === 'string' &&
			date <= untilOf(row) &&
			(date >= start || row.payroll_run_id == null) &&
			// a paid period this run works out again prices its own late rows
			frame.leftOut?.has(String(row.id)) !== true);
	const employeeIds = [...new Set(contracts.map((row) => String(row.employee_id)))];
	// every contract of the person answers for its entries by their dates, a run pays on the one in force
	const answering = (data.employee_contract ?? []).filter((row) =>
		employeeIds.includes(String(row.employee_id))
	);
	const profiles = new Map((data.employee_profile ?? []).map((row) => [String(row.id), row]));
	const balances = new Map(
		(data.employee_balance ?? []).map((row) => [String(row.employee_id), row])
	);

	// a day rostered outside the person's employment (planned before an exit was known) is no absence and no pay
	const answeringBy = Map.groupBy(
		answering.filter((contract) => contract.status !== 'VOID'),
		(contract) => String(contract.employee_id)
	);
	const versionOn = (person: string | undefined, date: string) =>
		answeringBy
			.get(String(person))
			?.find((contract) => covers(contract.effective_range, date, date));
	const employed = (row: JsonObject): boolean =>
		versionOn(employeeOf.get(String(row.employment_id)), String(row.work_date)) !== undefined;
	// a roster day is priced under the version in force on its date, whatever version it was keyed under
	const owners = new WeakMap<JsonObject, string>();
	const ownerOf = (row: JsonObject): string => {
		const held = owners.get(row);
		if (held !== undefined) return held;
		const owner = String(
			versionOn(employeeOf.get(String(row.employment_id)), String(row.work_date))?.id ??
				row.employment_id
		);
		owners.set(row, owner);
		return owner;
	};
	// one roster day a person and date: where two versions each hold one, the day keyed under the version in force wins
	const workRows = [
		...new Map(
			(data.roster_entry ?? [])
				.filter((row) => due(row, row.work_date) && employed(row))
				.toSorted(
					(left, right) =>
						Number(ownerOf(left) === String(left.employment_id)) -
						Number(ownerOf(right) === String(right.employment_id))
				)
				.map((row) => [
					`${employeeOf.get(String(row.employment_id))}/${String(row.work_date)}`,
					row
				])
		).values()
	];
	const closedSpans = (value: unknown) =>
		intervalSpans(
			Array.isArray(value) ? value.filter((row) => isJsonObject(row) && row.end != null) : []
		);
	const fullAward = Number(employer.overtime_full_award_percent ?? 100);
	const shifts = new Map((data.shift_definition ?? []).map((row) => [row.id, row]));
	const patterns = new Map((data.shift_pattern ?? []).map((row) => [row.id, row]));
	/** A contract's planned day with no roster entry: its pattern's day, else its ordinary week (undefined: no shift). */
	const plannedWork = (terms: JsonObject, date: string): boolean | undefined => {
		const pattern = patterns.get(terms.shift_pattern_id);
		if (pattern === undefined) return isWorkingDay(date, offDaysFor(terms, employer));
		const cycle = objectValue(pattern.pattern);
		const weekly = isJsonObject(cycle.days) ? cycle.days : null;
		const rotation = Array.isArray(cycle.cycle) ? cycle.cycle : null;
		const from = String(objectValue(pattern.effective_range).from ?? '');
		let shiftId: string | null = null;
		if (weekly !== null) {
			const weekday = WEEKDAYS[dateWeekday(date)] ?? 'SUNDAY';
			shiftId = String(weekly[weekday] ?? '');
		} else if (rotation !== null && rotation.length > 0 && from !== '') {
			const span = Math.round(
				(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
			);
			shiftId = String(
				objectValue(rotation[((span % rotation.length) + rotation.length) % rotation.length])
					.shift_definition_id
			);
		}
		const shift = shiftId == null ? undefined : shifts.get(shiftId);
		return shift === undefined ? undefined : objectValue(shift.variant).day_type === 'WORK';
	};
	const zone = String(settings.timezone);
	const planOf = (row: JsonObject) => {
		const shift = shifts.get(row.shift_definition_id);
		return scheduled(row, { zone, ...(shift === undefined ? {} : { shift }) });
	};
	const scheduledHours = ({ spans, untimed }: ReturnType<typeof planOf>) =>
		spans.reduce((total, span) => total + (span.end - span.start) / 3_600_000, untimed);
	const rosterDayTypes = new Map<string, Record<string, string>>();
	for (const row of workRows) {
		const owner = ownerOf(row);
		const days = rosterDayTypes.get(owner) ?? {};
		days[String(row.work_date)] = planOf(row).day_type;
		rosterDayTypes.set(owner, days);
	}
	// a holiday given only to those off on the date it replaces reads that date's plan, rostered or not: a six-day week
	// works its Saturday, so the weekday in lieu of a Saturday holiday is not its holiday
	const replaced = [
		...new Set(
			(data.holiday ?? []).flatMap((row) =>
				typeof row.replaces === 'string' ? [row.replaces] : []
			)
		)
	];
	for (const [owner, days] of rosterDayTypes) {
		const own = answering.find((row) => String(row.id) === owner);
		if (own === undefined) continue;
		for (const date of replaced) {
			if (days[date] !== undefined) continue;
			const row =
				answering.find(
					(contract) =>
						contract.employee_id === own.employee_id && covers(contract.effective_range, date, date)
				) ?? own;
			const work = plannedWork(objectValue(row.terms), date);
			if (work !== undefined) days[date] = work ? 'WORK' : 'OFF';
		}
	}
	// a dated leave slot is not an absence: leave prices the day itself
	const leaveDays = new Set<string>();
	for (const entry of data.leave_catalog_entry ?? []) {
		if (entry.encashment === true) continue;
		for (const child of Array.isArray(entry.leave_catalog_entry_day)
			? entry.leave_catalog_entry_day
			: [])
			if (
				isJsonObject(child) &&
				child.payroll_run_id == null &&
				typeof child.incurred_on === 'string'
			)
				leaveDays.add(`${employeeOf.get(String(entry.employment_id))}:${child.incurred_on}`);
	}
	// each day is priced at the rates of the contract version it was worked under
	const termsOf = new Map(
		(data.employee_contract ?? []).map((row) => [String(row.id), objectValue(row.terms)])
	);
	const workDays = new Map<string, JsonObject[]>();
	for (const row of workRows) {
		const owner = ownerOf(row);
		const days = workDays.get(owner) ?? [];
		const date = String(row.work_date);
		const holidays = holidaysForDay(date, {
			holidays: data.holiday ?? [],
			roster_day_types: rosterDayTypes.get(owner) ?? {},
			roster_days: [],
			employee: employeeOf.get(owner)
		});
		// a makeup workday never masks the holiday it makes up for: every other kind earns its premium
		const holiday = holidays.find((row) => row.kind !== 'MAKEUP_WORKDAY') ?? holidays[0];
		const plan = planOf(row);
		// the clock proves the person came and awards the plan; it never adds time of its own
		const clock = closedSpans(row.actual_worked_intervals);
		const planned = closedSpans(row.planned_overtime_intervals);
		const awarded = awardedMinutes(planned, clock, fullAward) / 60;
		// overtime the worker takes as time off is owed by the hour, never also paid: the day prices none of it
		const timeOff = row.overtime_as_time_off === true ? awarded : 0;
		const overtime = awarded - timeOff;
		const worked = clock.length === 0 ? 0 : scheduledHours(plan) + overtime;
		const paidSpans = timeOff > 0 ? [] : planned;
		// a planned work day with no clock is an absence; leave and a published holiday are not
		const absent =
			plan.day_type === 'WORK' &&
			clock.length === 0 &&
			holiday === undefined &&
			!leaveDays.has(`${employeeOf.get(owner)}:${date}`);
		days.push({
			date,
			terms: termsOf.get(owner) ?? null,
			day_type: absent ? 'ABS' : plan.day_type,
			scheduled_hours: absent ? 0 : scheduledHours(plan),
			holiday_kind: typeof holiday?.kind === 'string' ? holiday.kind : '',
			worked: worked + timeOff > 0,
			worked_hours: worked,
			overtime_hours: overtime,
			// the clock inside the day's own shift, in completed half hours: what an attendance system records
			clocked_shift_hours: Math.floor(spanMinutes(overlapSpans(clock, plan.spans)) / 30) / 2,
			time_off_hours: timeOff,
			// epoch milliseconds: the helpers that read them take an instant either way
			intervals: overlapSpans(clock, [...plan.spans, ...paidSpans]).map(({ start, end }) => ({
				start,
				end
			})),
			overtime_intervals: overlapSpans(paidSpans, clock).map(({ start, end }) => ({ start, end }))
		});
		workDays.set(owner, days);
	}

	// the slots a run prices: open ones its attendance holds, up to a leaver's last day. A cash-out is a balance
	// settled, not leave taken on its placeholder dates
	const slotsDue = (row: JsonObject) =>
		(Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : [])
			.filter(isJsonObject)
			.filter(
				(child) =>
					child.payroll_run_id == null &&
					frame.leftOut?.has(String(child.id)) !== true &&
					(row.encashment === true ||
						(typeof child.incurred_on === 'string' &&
							child.incurred_on >= start &&
							child.incurred_on <= untilOf(row)))
			);
	// a sealed entry still answers for its dates in later runs: only its own period's days are here
	const leaveWithin = (rows: readonly JsonObject[]): readonly JsonObject[] =>
		rows.flatMap((row) => {
			const days = slotsDue(row).map((child) => ({
				date: String(child.incurred_on),
				part: String(child.part)
			}));
			return days.length === 0 ? [] : [{ ...row, days, payroll_run_id: null }];
		});

	// an entry keeps the catalogue row it was raised on; a run reads it as that code in its own version
	const inRunVersion = (
		entries: readonly JsonObject[],
		own: readonly JsonObject[] = []
	): readonly JsonObject[] => {
		const ownVersion = own.filter((row) => String(row.settings_id ?? '') === settingsId);
		const current = new Map(
			(ownVersion.length > 0 ? ownVersion : own).map((row) => [row.code, row.id])
		);
		const known = new Map(own.map((row) => [String(row.id), row]));
		return entries.map((row) => {
			const raised =
				typeof row.catalog_id === 'string'
					? (known.get(row.catalog_id) ?? {})
					: objectValue(row.catalog_id);
			return { ...row, catalog_id: current.get(raised.code) ?? raised.id ?? null };
		});
	};

	/** What a person's contracts project over the salary and attendance periods. */
	// from the first of the month attendance starts in: a day missed there is counted against that whole month
	const projectionDays = daysIn(
		`${(start < from ? start : from).slice(0, 7)}-01`,
		end > to ? end : to
	);
	const projectedDays = (
		rows: readonly JsonObject[],
		roster: ReadonlyMap<string, JsonObject>
	): readonly ProjectedDay[] | undefined => {
		const days: ProjectedDay[] = [];
		const ordered = rows.toSorted((left, right) =>
			String(objectValue(left.effective_range).from).localeCompare(
				String(objectValue(right.effective_range).from)
			)
		);
		for (const date of projectionDays) {
			// a day outside the employment is still one of the period's: the share leaves it unpaid
			const row =
				rows.find((contract) => covers(contract.effective_range, date, date)) ??
				ordered.findLast(
					(contract) => String(objectValue(contract.effective_range).from) <= date
				) ??
				ordered[0];
			if (row === undefined) continue;
			const terms = objectValue(row.terms);
			// a roster day changes the plan; a day with no roster entry follows the contract's pattern or ordinary week
			const rostered = roster.get(`${String(row.id)}:${date}`);
			const rosteredShift =
				rostered === undefined ? undefined : shifts.get(String(rostered.shift_definition_id));
			if (rosteredShift !== undefined) {
				days.push({ date, work: objectValue(rosteredShift.variant).day_type === 'WORK' });
				continue;
			}
			const work = plannedWork(terms, date);
			if (work === undefined) continue;
			days.push({ date, work });
		}
		return days;
	};

	// each row list indexed once by contract, so a person reads only their own rows, in the list's order
	const indexed = new WeakMap<readonly JsonObject[], Map<string, number[]>>();
	const ownRows = (rows: readonly JsonObject[] | undefined, ids: ReadonlySet<string>) => {
		if (rows === undefined) return [];
		let index = indexed.get(rows);
		if (index === undefined) {
			index = new Map();
			for (const [at, row] of rows.entries()) {
				const key = String(row.employment_id);
				const held = index.get(key);
				if (held === undefined) index.set(key, [at]);
				else held.push(at);
			}
			indexed.set(rows, index);
		}
		const found = index;
		return [...ids]
			.flatMap((id) => found.get(id) ?? [])
			.toSorted((a, b) => a - b)
			.flatMap((at): JsonObject[] => {
				const row = rows[at];
				return row === undefined ? [] : [row];
			});
	};
	const employmentsOf = new Map<string, Set<string>>();
	for (const [employment, person] of employeeOf) {
		const held = employmentsOf.get(String(person));
		if (held === undefined) employmentsOf.set(String(person), new Set([employment]));
		else held.add(employment);
	}

	const paid: CalculatedPayslip[] = [];
	for (const contract of contracts) {
		const employmentId = String(contract.id),
			employeeId = String(contract.employee_id);
		const employee = profiles.get(employeeId),
			balance = balances.get(employeeId);
		if (employee === undefined) continue;
		const own = new Set(
			answering.filter((row) => row.employee_id === employeeId).map((row) => String(row.id))
		);
		// only the person's own entries
		const entries = (rows: readonly JsonObject[] | undefined) =>
			ownRows(rows, own).filter((row) => pays?.has(String(row.id)) ?? true);
		if (
			pays !== undefined &&
			[data.adhoc_catalog_entry, data.claim_catalog_entry].every(
				(rows) => entries(rows).length === 0
			)
		)
			continue;
		const contractsOfEmployee = answering.filter((row) => row.employee_id === employeeId);
		const contractIds = new Set(contractsOfEmployee.map((row) => String(row.id)));
		const roster = new Map(
			ownRows(data.roster_entry, contractIds)
				.filter(
					(row) => typeof row.work_date === 'string' && typeof row.shift_definition_id === 'string'
				)
				.map((row) => [`${ownerOf(row)}:${String(row.work_date)}`, row])
		);
		const projected = projectedDays(contractsOfEmployee, roster);
		const workCatalog = new Map(
			(data.work_event_catalog ?? []).map((row) => [String(row.id), row])
		);
		// an event for one person is theirs under every version of their contract; one for no one is everyone's
		const eventKeys = new Set([...(employmentsOf.get(employeeId) ?? []), 'null', 'undefined']);
		const workEvents = ownRows(data.work_event, eventKeys).flatMap((row) => {
			const catalog = workCatalog.get(String(row.catalog_id));
			if (catalog === undefined) return [];
			return [
				{
					code: String(catalog.code),
					from: String(row.from),
					to: row.to == null ? null : String(row.to),
					location: row.location ?? null
				}
			];
		});
		const leave = entries(data.leave_catalog_entry);
		const lastAttended = until.get(employeeId) ?? end;
		const rosterDates = new Set(
			ownRows(data.roster_entry, contractIds)
				.filter(
					(row) =>
						typeof row.work_date === 'string' &&
						row.work_date >= start &&
						row.work_date <= lastAttended
				)
				.map((row) => `${ownerOf(row)}:${String(row.work_date)}`)
		);
		const leaveDates = new Set(
			ownRows(data.leave_catalog_entry, contractIds)
				.filter((row) => row.encashment !== true)
				.flatMap((row) =>
					(Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : [])
						.filter((child) => isJsonObject(child) && child.payroll_run_id == null)
						.map((child) => String(child.incurred_on))
				)
		);
		// the supplied roster is the cycle's source of truth: a planned work day it leaves out, with no leave and no
		// published holiday, is an absence. An office worker has no roster and keeps the pattern's assumption.
		const absences =
			rosterDates.size === 0
				? []
				: daysIn(start, lastAttended)
						.filter((date) => {
							const contract = contractsOfEmployee.find((row) =>
								covers(row.effective_range, date, date)
							);
							if (contract === undefined) return false;
							if (rosterDates.has(`${String(contract.id)}:${date}`)) return false;
							if (leaveDates.has(date)) return false;
							if (
								holidaysForDay(date, {
									holidays: data.holiday ?? [],
									roster_day_types: rosterDayTypes.get(String(contract.id)) ?? {},
									roster_days: [],
									employee: employeeId
								}).length > 0
							)
								return false;
							return plannedWork(objectValue(contract.terms), date) === true;
						})
						.map((date) => ({
							date,
							day_type: 'ABS',
							scheduled_hours: 0,
							holiday_kind: '',
							worked: false,
							worked_hours: 0,
							overtime_hours: 0,
							time_off_hours: 0,
							intervals: [],
							overtime_intervals: []
						}));
		const claims = entries(data.claim_catalog_entry).filter((row) => due(row, row.incurred_on));
		// what a later-signed version adds for earlier periods is this period's back pay, on the law's own row
		const owed = pays === undefined ? (frame.backPay?.get(employeeId) ?? 0) : 0;
		const adhoc = [
			...entries(data.adhoc_catalog_entry).filter((row) => due(row, row.incurred_on)),
			...(backPayRow === undefined || owed === 0
				? []
				: [
						{
							id: `back_pay:${employeeId}`,
							entity_id: companyId,
							employment_id: employmentId,
							catalog_id: String(backPayRow.id),
							incurred_on: to,
							quantity: owed,
							unit: 'MONEY',
							payroll_run_id: null,
							back_pay: true
						}
					])
		];
		// an instalment is priced by the run whose attendance holds its date, like every other entry
		const repayments = entries(data.loan_catalog_entry_repayment).filter(
			(row) =>
				typeof row.paid_on === 'string' &&
				row.paid_on >= start &&
				row.paid_on <= lastAttended &&
				frame.leftOut?.has(String(row.id)) !== true
		);
		// expressions read the employment, not the version: it ends with this version only at an exit
		const { exit, ...version } = contract;
		const range = objectValue(contract.effective_range);
		// An exit settles its leave on the payslip that covers the last day, from the balance as that period saw it:
		// what is left of a row with a payout is paid out unless HR declined it or the exit is a dismissal for
		// misconduct, and what was taken beyond what the last day earned is taken back at the same rate. Nothing is
		// keyed: correcting the contract or the leave amends the period, and the next run carries the difference.
		const lastDay = typeof range.to === 'string' ? range.to : '';
		const settles =
			pays === undefined &&
			exit === true &&
			lastDay >= String(coverage.from) &&
			lastDay <= String(coverage.to);
		const paysOut =
			contract.encash_leave !== false && contract.exit_ground !== 'MISCONDUCT_DISMISSAL';
		const hoursADay = Number(objectValue(contract.terms).normal_hours_per_day ?? 0);
		const settled = !settles
			? []
			: (data.leave_catalog ?? []).flatMap((row) => {
					if (String(row.settings_id) !== settingsId) return [];
					if (typeof row.payout !== 'string' || row.payout.trim() === '') return [];
					const code = String(row.code);
					// the row's window under this run's law: a person who moved country holds the same code under another
					const window = latestWindow(
						accountsOf(balance?.account),
						'leave',
						code,
						String(settings.code)
					);
					// a row that counts in hours settles them as days of the contract's normal day
					const hourly = objectValue(row.lookup).unit === 'HOUR' && hoursADay > 0;
					const days = Math.round(((window?.left ?? 0) / (hourly ? hoursADay : 1)) * 2) / 2;
					if (window === undefined || !Number.isFinite(days) || days === 0) return [];
					if (days > 0 && !paysOut) return [];
					return [
						{
							entry: {
								id: `cash_out:${employeeId}:${code}`,
								entity_id: companyId,
								employment_id: employmentId,
								catalog_id: String(row.id),
								encashment: true,
								incurred_on: lastDay,
								quantity: Math.abs(days),
								unit: 'DAY',
								payroll_run_id: null,
								...(days < 0 ? { take_back: true } : {})
							},
							posts: {
								code,
								period: window.period,
								amount: hourly ? days * hoursADay : days,
								unit: hourly ? ('HOUR' as const) : ('DAY' as const),
								on: lastDay
							}
						}
					];
				});
		const result = yield* Effect.try({
			try: () =>
				calculatePayroll({
					run,
					settings,
					subtotals: data.subtotal ?? [],
					allowance: data.allowance_catalog ?? [],
					overtime: data.overtime_catalog ?? [],
					statutory: data.statutory_contribution_catalog ?? [],
					leave_catalog: data.leave_catalog ?? [],
					claim_catalog: data.claim_catalog ?? [],
					adhoc_catalog: data.adhoc_catalog ?? [],
					loan_catalog: data.loan_catalog ?? [],
					employee,
					employment: {
						...version,
						effective_range: { ...range, to: exit === true ? (range.to ?? null) : null }
					},
					employer,
					...(frame.carried?.has(employeeId) === true
						? { carried: frame.carried.get(employeeId) ?? {} }
						: {}),
					balance: {
						account: viewOf(
							accountsOf(balance?.account),
							totalsScope(settings, companyId),
							Number(settings.tax_year_start_month ?? 1),
							String(run.pay_date ?? objectValue(run.salary_coverage).to)
						),
						// the days each leave row's windows have used, for a `paid_share` that reads them
						leave: accountsOf(balance?.account).leave ?? {}
					},
					entries: {
						leave_catalog_entry: [
							...inRunVersion(leaveWithin(leave), data.leave_catalog),
							...settled.map((item) => item.entry)
						],
						claim_catalog_entry: inRunVersion(claims, data.claim_catalog),
						adhoc_catalog_entry: inRunVersion(adhoc, data.adhoc_catalog),
						// a loan belongs to the employee, not one contract: a repayment may outlive the contract it opened on
						loan_catalog_entry: inRunVersion(data.loan_catalog_entry ?? [], data.loan_catalog),
						loan_catalog_entry_repayment: repayments
					},
					work: {
						days: [...own].flatMap((id) => workDays.get(id) ?? []).concat(absences)
					},
					work_events: workEvents,
					...(projected === undefined ? {} : { projected_days: projected }),
					employed: answering
						.filter((row) => row.employee_id === employeeId)
						.map((row) => {
							const { from, to } = objectValue(row.effective_range);
							return {
								from: String(from),
								to: to == null ? null : String(to),
								terms: objectValue(row.terms)
							};
						})
				}),
			catch: (cause) =>
				cause instanceof Refusal
					? cause
					: new Refusal({ message: cause instanceof Error ? cause.message : 'Payroll failed.' })
		});
		const cashed = settled
			.filter((item) => result.lines.some((line) => line.source_id.id === item.entry.id))
			.map((item) => item.posts);
		const deductions = result.lines
			.filter((line) => line.party === 'EMPLOYEE' && line.direction === 'DEDUCT')
			.reduce((total, line) => total + line.amount, 0);
		const money = (value: number) => Math.round(value * 1e12) / 1e12;
		const subtotalValue = (code: unknown): number => {
			if (typeof code !== 'string') return 0;
			return result.subtotals.find((row) => row.code === code)?.value ?? 0;
		};
		const ordinary = subtotalValue('ORDINARY_WAGES');
		const contributions = result.statutory.filter((row) => row.kind === 'CONTRIBUTION');
		const employeeStatutory = contributions.reduce((total, row) => total + row.employee, 0);
		// An ad hoc row that posts to a scheme's employee share counts with that scheme; one that posts to a code no
		// contribution scheme of this law holds is the employee's tax paid outside the scheme (Malaysia's CP38).
		const contributionCodes = new Set(
			(data.statutory_contribution_catalog ?? [])
				.filter((row) => row.kind === 'CONTRIBUTION')
				.map((row) => String(row.code))
		);
		const adhocRows = new Map((data.adhoc_catalog ?? []).map((row) => [String(row.code), row]));
		const taxPaidOutside = result.lines
			.filter((line) => line.source_id.model === 'adhoc_catalog_entry' && line.party === 'EMPLOYEE')
			.reduce((total, line) => {
				const accounts = objectValue(adhocRows.get(line.code)?.lookup).accounts;
				const tax = (Array.isArray(accounts) ? accounts : []).some(
					(account) =>
						isJsonObject(account) &&
						account.account === 'statutory' &&
						String(account.code).endsWith('.employee') &&
						!contributionCodes.has(String(account.code).split('.')[0] ?? '')
				);
				return tax ? total + (line.direction === 'DEDUCT' ? line.amount : -line.amount) : total;
			}, 0);
		const taxWithheld =
			result.statutory
				.filter((row) => row.kind === 'TAX')
				.reduce((total, row) => total + row.employee, 0) + taxPaidOutside;
		paid.push({
			employee_id: employeeId,
			employment_id: employmentId,
			entity_id: companyId,
			basic_earnings: money(result.subtotals[0]?.value ?? 0),
			gross_earnings: money(result.net_pay + deductions),
			net_pay: money(result.net_pay),
			total_deductions: money(Math.max(0, deductions)),
			// a run that settles an earlier over-charge can owe the employer back; the reported totals stop at zero
			employer_cost: money(Math.max(0, result.employer_cost)),
			period: String(run.period ?? coverage.from.slice(0, 7)),
			// a deduction entry can exceed the period's pay; reported wages stop at zero
			ordinary_wages: money(Math.max(0, ordinary)),
			employee_statutory: money(Math.max(0, employeeStatutory)),
			tax_withheld: money(Math.max(0, taxWithheld)),
			breakdown: {
				...breakdownOf(result),
				// only what the payslip priced posts: a row whose payout did not apply leaves the balance as it is
				...(cashed.length === 0 ? {} : { cash_out: cashed })
			}
		});
		// an off-cycle run prices only ad hoc entries on rows marked for it: anything else it named would be sealed
		// and never paid
		if (pays !== undefined) {
			const marked = new Set(
				(data.adhoc_catalog ?? [])
					.filter((row) => row.off_cycle_eligible === true)
					.map((row) => String(row.id))
			);
			const stray = [
				...claims,
				...adhoc.filter(
					(row) =>
						!marked.has(
							typeof row.catalog_id === 'string'
								? row.catalog_id
								: String(objectValue(row.catalog_id).id)
						)
				)
			];
			if (stray.length > 0)
				return yield* Effect.fail(
					new Refusal({
						message:
							'An off-cycle run pays only ad hoc entries on rows marked for off-cycle. Leave the others for the on-cycle run.'
					})
				);
		}
		// a run is not a decision: what waits for approval is not paid, whoever runs it
		if (
			[...leave.filter((row) => slotsDue(row).length > 0), ...claims, ...adhoc].some(
				(row) => row.$approval != null
			)
		)
			return yield* Effect.fail(
				new Refusal({
					message:
						'Under approval: an entry this run would pay still waits for its decision. Decide it, then run.'
				})
			);
		// what this payslip priced is sealed by its run, and nothing else. A paid period worked out again seals only
		// what no run had sealed (`sealed`): a row its own run priced keeps that seal
		const open = (row: JsonObject) => row.sealed !== true;
		for (const row of leave) {
			const slots = slotsDue(row).filter(open);
			if (slots.length === 0) continue;
			if (row.payroll_run_id == null && open(row)) sealing.leave.add(String(row.id));
			for (const slot of slots) sealing.leave_day.add(String(slot.id));
		}
		for (const row of claims.filter(open)) sealing.claim.add(String(row.id));
		for (const row of adhoc.filter(open))
			if (row.back_pay !== true) sealing.adhoc.add(String(row.id));
		for (const row of repayments.filter(open)) sealing.repayment.add(String(row.id));
		if (pays !== undefined) continue;
		for (const row of data.workplace_case_catalog_entry ?? [])
			if (
				own.has(String(row.employment_id)) &&
				String(row.opened_on) <= untilOf(row) &&
				(row.closed_on == null || String(row.closed_on) >= start)
			)
				sealing.case.add(String(row.id));
		for (const row of workRows)
			if (own.has(String(row.employment_id)) && row.payroll_run_id == null && open(row))
				sealing.roster_entry.add(String(row.id));
	}
	return { payslips: paid, attaches: sealed() };
});

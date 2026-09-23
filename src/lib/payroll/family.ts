import type { CatalogueBand } from '../../datatypes/catalogue_band/+definition.js';

/** Where a line settles. `EMPLOYER` and `DISPLAY` carry no direction. */
export type SettlementDestination = 'PAY' | 'NET' | 'EMPLOYER' | 'DISPLAY';
export type SettlementDirection = 'ADD' | 'SUBTRACT';

/** The payslip bucket a line lands in, derived from its catalogue's destination × direction. */
export type SettlementBucket =
	'EARNING' | 'ABSENCE' | 'DEDUCTION' | 'NON_WAGE_PAYMENT' | 'EMPLOYER_COST' | 'INFORMATION';

/**
 * The bucket a negative amount really lands in: a reversal of a deduction is a payment, a clawed-back
 * earning an absence. A line carries a magnitude, never a direction (`payslip_adjustments`), so a
 * signed figure crosses to the opposite bucket rather than storing its sign.
 */
export function oppositeBucket(bucket: SettlementBucket): SettlementBucket {
	switch (bucket) {
		case 'EARNING':
			return 'ABSENCE';
		case 'ABSENCE':
			return 'EARNING';
		case 'DEDUCTION':
			return 'NON_WAGE_PAYMENT';
		case 'NON_WAGE_PAYMENT':
			return 'DEDUCTION';
		default:
			return bucket;
	}
}

/**
 * The landing table: destination × direction → the bucket the line lands in.
 *
 * One function, because settle, report, graph and export all ask the same question of a catalogue
 * row's policy, and a second copy of this switch is how ABSENCE starts settling as an earning.
 */
export function settlementBucket(
	destination: SettlementDestination,
	direction: SettlementDirection | null
): SettlementBucket {
	switch (destination) {
		case 'PAY':
			return direction === 'SUBTRACT' ? 'ABSENCE' : 'EARNING';
		case 'NET':
			return direction === 'SUBTRACT' ? 'DEDUCTION' : 'NON_WAGE_PAYMENT';
		case 'EMPLOYER':
			return 'EMPLOYER_COST';
		case 'DISPLAY':
			return 'INFORMATION';
	}
}

/** Metadata carried by a family result. Consumers do not need its calculation definition. */
export type FamilyPayItem = {
	readonly id: string;
	readonly catalogue_id?: string;
	readonly output?: string;
	readonly settings_id: string;
	readonly code: string;
	readonly name?: string | null;
	/** How the line settles: destination × direction is its bucket. */
	readonly destination: SettlementDestination;
	readonly direction: SettlementDirection | null;
	/** The ordered bands a catalogue prices its entries with; empty for engine-priced Work lines. */
	readonly bands: readonly CatalogueBand[];
	readonly eligibility: string;
	readonly family: 'WORK' | 'LEAVE' | 'CLAIM' | 'ADHOC' | 'ALLOWANCE' | 'LOAN';
	/** The schemes (and parts, `CPF.ADDITIONAL`) this class counts toward; absent (a work line) is none. */
	readonly counts_toward?: readonly string[];
	/**
	 * Whether an unpaid day comes off this allowance class; absent follows the version's
	 * `payroll.allowance_npl_prorates`, and false marks a class the statute excludes from the
	 * deduction's wage (SG's travel, food and housing allowances; MY's travelling allowance).
	 */
	readonly npl_prorates?: boolean | null;
};

import type { InLieuSlice } from '../../datatypes/payroll_trace/+definition.js';
import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import type { RunIssue } from '../../collections/payroll_runs/lib/validate.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import type { PreparedPayRequest, PayRequest, PayRequestFamily } from './money.js';
import type { PayslipBase } from '../../datatypes/payslip_base/+definition.js';
import type { PayslipProration } from '../../datatypes/payslip_proration/+definition.js';
import type { SettledLeaveCapture } from '../leave/payroll.js';
import type { IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import type { DailyOvertime } from '../../collections/payroll_runs/lib/overtime.js';
import type { ScheduledDay } from '../../collections/payroll_runs/lib/schedule.js';
import type { PayrollWindow } from '../../collections/payroll_runs/lib/period.js';
import type { PersonContext } from '../../collections/payroll_runs/lib/eligibility.js';

/**
 * What a measured amount looks like to the steps that price the whole payslip.
 *
 * ACCUMULATE and SETTLE ask three questions of every amount — what it settles as, which catalogue
 * row (if any) it pays, and whether the statute derived it — and those questions are the same for a
 * contracted amount and for one an input caused. They are asked of this shape, which both planes
 * satisfy structurally, so neither step reshapes anything on the way in.
 */
export type PricedItem = {
	/**
	 * The catalogue row this pays. Always present, derived overtime included: a work band decides
	 * what an overtime hour is *worth*, and the Work rules' `OVERTIME` class or funneled
	 * `INCENTIVE` line is still where it is paid. `label` carries the band.
	 */
	readonly catalogueComponent: FamilyPayItem;
	/**
	 * The bucket the amount settles in, carried rather than read back off the component,
	 * because derived overtime has none to read it from. It is always an `EARNING`.
	 */
	readonly bucket: SettlementBucket;
	/** What to call this in an engine message — a component code, or the rule key that priced it. */
	readonly label: string;
	/** Signed within its economic direction; a reversal negates the original amount. */
	readonly amount: number;
};

/**
 * One contracted amount, before any input touched it.
 *
 * BASE is `employment_terms x period`: it points at nothing, which is why it is inlined on
 * `payslips` rather than being a row in `payslip_adjustments`: nobody can edit a record that
 * caused it, because no such record exists.
 */
export type MeasuredBase = PricedItem & {
	readonly catalogueComponent: CatalogueComponent;
	/** The stored shape, produced here so nothing downstream has to assemble it. */
	readonly entry: PayslipBase;
};

/** One contracted amount as a base line: the catalogue row, how it settles, and the stored entry. */
export function baseLine(
	catalogueComponent: CatalogueComponent,
	bucket: SettlementBucket,
	amount: number
): MeasuredBase {
	return {
		catalogueComponent,
		bucket,
		label: catalogueComponent.code,
		amount,
		entry: { component_code: catalogueComponent.code, amount }
	};
}

/**
 * The one input that caused an adjustment, in the shape `payslip_adjustments.input` is written in.
 *
 * MEASURE speaks of the input **families** — the business sources themselves; GRAPH maps each
 * family onto the source collection whose `payslip_id` it pins. Keeping the family here and the
 * pin writing in GRAPH is what lets MEASURE stay pure: it decides which source caused what, and
 * the id minting and the pins happen once, beside them.
 */
type InputFamily = 'WORK_DAY' | PayRequestFamily | 'LEAVE' | 'LOAN_REPAYMENT';

/** One source the run read, spelled in the four input families the payslip stores. */
type MeasuredInput = {
	readonly family: InputFamily;
	readonly id: string;
};

/**
 * One thing an input caused, in the shape `payslip_adjustments` stores.
 *
 * The adjustment names its causal input by family and source id. There are no zero-amount
 * settlement locks here: a source the run read and priced at nothing is a pinned row with no
 * adjustment beside it, because an output that settles to nothing is no output at all, and the
 * pin is what locks the source.
 */
export type MeasuredAdjustment = PricedItem & {
	/** The one input that caused this row, by family and source id. */
	readonly input: MeasuredInput;
	/** The stable key of the statutory rule that priced a work-day input. Null on every other row. */
	readonly statutoryRuleKey: string | null;
	readonly quantity: number | null;
	readonly rate: number | null;
};

/** The captured inputs of one employment's payslip, as the run must write them. */
type CapturedInputs = {
	readonly workDays: readonly string[];
	/** Every authored pay request this payslip consumed, kept apart by the collection it came from. */
	readonly payRequests: Readonly<Record<PayRequestFamily, readonly string[]>>;
	readonly leave: readonly SettledLeaveCapture[];
	readonly loanRepayments: readonly string[];
	/** Approved dated wage periods consumed by rates or leave valuation. */
	readonly wagePeriods: readonly string[];
};

export type MeasuredEmployment = {
	readonly bundle: EmploymentBundle;
	/** The contracted amounts. One entry per component, never one per terms row. */
	readonly base: readonly MeasuredBase[];
	/**
	 * What this employment's measurements decided not to pay, and why.
	 *
	 * A captured request that priced to nothing is locked and silent; these are the sentences that
	 * make it readable. Warnings, never blockers: the arithmetic is right, the operator just has to
	 * be able to see it happened.
	 */
	readonly notes: readonly RunIssue[];
	/**
	 * What the calendar did to the contracted wage, one entry per segment.
	 *
	 * These are evidence rather than money: they are the working behind a `base` amount the calendar
	 * split, and their `prorated_amount` sums to it. Proration is no longer folded silently into
	 * base — a mid-month salary change is two segments here and one base entry, so the halves are
	 * readable years later against a proration basis that may since have changed.
	 */
	readonly proration: readonly PayslipProration[];
	/** One entry per thing exactly one input caused, where that input produced money. */
	readonly adjustments: readonly MeasuredAdjustment[];
	/** The four input families the run captured — including every zero-value source. */
	readonly captured: CapturedInputs;
	/** What a deferred earlier period is owed, when this run is the one paying it. */
	readonly arrears: {
		readonly period: string;
		readonly componentCatalogueId: string;
		readonly amount: number;
	} | null;
	/** Amounts of every component measured, including `INFORMATION` — what coverage reads. */
	readonly componentAmounts: ReadonlyMap<string, number>;
	readonly ordinaryHourlyRate: number;
	readonly ordinaryDayWage: number;
	readonly overtimeDays: readonly DailyOvertime[];
	/** Regulated ordinary/off-day OT by calendar month; rest days and PH are excluded. */
	readonly calendarMonthOvertimeHours: ReadonlyMap<string, number>;
	/** Every hour beyond the normal day by calendar month, rest days and holidays included (reported only). */
	readonly calendarMonthAllOvertimeHours?: ReadonlyMap<string, number>;
	/** Limit key → its own count by calendar month, for a limit whose `counts_day_when` adds whole days. */
	readonly calendarMonthLimitHours?: ReadonlyMap<string, ReadonlyMap<string, number>>;
	/**
	 * The overtime this payslip settles (its attendance window), as each month, quarter and year
	 * limit counts it: limit key → calendar month → hours, `''` the regulated count.
	 */
	readonly settledOvertimeHours?: ReadonlyMap<string, ReadonlyMap<string, number>>;
	/** The in-lieu slices this payslip credited and paid, for the trace a later run reads. */
	readonly inLieuSlices?: readonly InLieuSlice[];
	readonly currency: string;
	readonly schedule: ReadonlyMap<IsoDate, ScheduledDay>;
	/** The version's limits that govern this person, the conditional ones (`limits[].when`) judged. */
	readonly limits: Configuration['limits'];
	/** The pay month's scheduled working days — what `person.period.working_days` reads. */
	readonly periodWorkingDays: number;
	/** Employed working days the run did not pay — what `person.period.unpaid_days` reads. */
	readonly periodUnpaidDays: number;
	/** Dates with no employer-paid portion; partial days remain separate. */
	readonly periodFullyUnpaidDays: number;
	readonly periodLeaveDays: Readonly<Record<string, number>>;
	readonly periodFullLeaveDays: Readonly<Record<string, number>>;
	/** The salary the pay period attributes to each paid leave code's days — what `person.period.leave_pay` reads. */
	readonly periodLeavePay: Readonly<Record<string, number>>;
	/** Attendance-window dates with overtime or night-window hours — what `person.period.overtime_days` reads. */
	readonly periodOvertimeDays: number;
	/** Calendar-month eligibility counts, independent of this payroll's wage window. */
	readonly monthlyContributionDays?: {
		readonly employed: number;
		readonly unpaid: number;
		readonly fullyUnpaid: number;
		readonly leaveDays: Readonly<Record<string, number>>;
		readonly fullLeaveDays: Readonly<Record<string, number>>;
		readonly leavePay: Readonly<Record<string, number>>;
		readonly working: number;
		readonly overtimeDays: number;
	};
	/** The contract's week as the run resolved it — what `terms.ordinary_hours_per_week` and the monthly basic read. */
	readonly week: {
		readonly ordinary_hours_per_week: number;
		readonly working_days_per_week: number;
	};
};

/** The window-shaped arguments `measureEmployment` hands its helpers. */
export type PayRange = PayrollWindow['salary'];

/** Measure one employment's whole payslip. */
export type MeasureEmploymentOptions = {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly period: string;
	readonly salary: PayRange;
	readonly periodsRemaining: number;
	readonly headcount: number;
	/** `component_entry_id` → what earlier PAID runs already took from it. See `gather.ts`. */
	readonly consumedEntries: ReadonlyMap<string, number>;
	/** component code → what earlier payslips of this employee earned this tax year. */
	readonly yearEarned: ReadonlyMap<string, number>;
	/** Calculate a deferred period's wages without settling manual money again. */
	readonly deferredWagesOnly?: boolean;
	/**
	 * Overtime earlier payslips settled, as each limit counts it: limit key → calendar month →
	 * hours, `''` the regulated count the monthly funnel reads.
	 */
	readonly priorOvertimeHours?: ReadonlyMap<string, ReadonlyMap<string, number>>;
	/** The in-lieu slices earlier payslips credited and paid (TW 勞基法 §32-1). */
	readonly priorInLieu?: readonly InLieuSlice[];
	/** calendar month → code → what earlier payslips filed; a pay request's person reads it. */
	readonly earnedByMonth?: ReadonlyMap<string, ReadonlyMap<string, number>>;
};

export type Measurement = {
	readonly amount: number;
	readonly base: readonly MeasuredBase[];
	readonly proration: readonly PayslipProration[];
	readonly adjustments: readonly MeasuredAdjustment[];
};

/** The cap rule lives in `./entry-cap.ts` so the transform enforces the same ceiling this does. */
/**
 * The year axis every entry expression reads: the tax year the period sits in, how
 * much of it this employment covers, what has been earned in it so far by component code — prior
 * paid payslips plus this run's own lines as they are measured — and whether this period closes it.
 */
export type YearContext = {
	readonly start: string;
	readonly end: string;
	readonly months_employed: number;
	readonly days_employed: number;
	readonly last_of_year: boolean;
	/** Component code → the amount, prior payslips plus this run's own lines; `BASIC` always. */
	readonly earned: Readonly<Record<string, number>>;
};

export type MeasureComponentOptions = {
	readonly component: CatalogueComponent;
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	/** Read at pricing time, so `earned` carries the lines this run has already measured. */
	readonly year: () => YearContext;
	readonly salary: PayRange;
	readonly employed: PayRange;
	readonly contracted: PayRange;
	/** The one component entry this call measures, or `null` for a component no entry feeds. */
	readonly entry: PreparedPayRequest | null;
	readonly consumedEntries: ReadonlyMap<string, number>;
	readonly period: string;
	readonly workingDaysIn: (window: PayRange) => number;
	/** Eligible unpaid-leave days inside a window, for the jurisdictions that prorate on them. */
	readonly unpaidDaysIn: (window: PayRange) => number;
	/** How many instalments of the month this period is one of: 2 on semi-monthly terms, else 1. */
	readonly instalments: number;
	/** The day and hour rates the entry context exposes to a catalogue band. */
	readonly rates: {
		readonly ordinaryDay: number;
		readonly ordinaryHour: number;
	};
	readonly subject: PersonContext;
	/** calendar month → code → what earlier payslips filed; a pay request's person reads it. */
	readonly earnedByMonth?: ReadonlyMap<string, ReadonlyMap<string, number>>;
	/**
	 * Where a measurement says why it produced nothing.
	 *
	 * A request the run read and priced at nothing is still pinned — the pin is the settlement
	 * lock — so a skip is invisible on the payslip and invisible in the source: the
	 * entry is marked consumed and no line names it. Every `return null` that is a decision rather
	 * than an absence says so here, and the run reports them as warnings.
	 */
	readonly note: (issue: RunIssue) => void;
};

/** A family supplies a pure calculation; the coordinator only preserves the family pipeline. */
export type FamilyStep = {
	readonly item: FamilyPayItem;
	readonly calculate: () => Measurement | null;
};

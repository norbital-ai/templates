import type { WorkspaceRow } from '../../collections/payroll_runs/$types.js';

/** Metadata carried by a family result. Consumers do not need its calculation definition. */
export type FamilyPayItem = {
	readonly id: string;
	readonly catalogue_id?: string;
	readonly output?: string;
	readonly settings_id: string;
	readonly code: string;
	readonly name?: string | null;
	/** Work and Leave items only: the money catalogues carry no statutory flag. */
	readonly is_statutory?: boolean;
	/** The economic direction the line settles in; `ABSENCE` reduces gross, the rest are what they say. */
	readonly nature: string;
	readonly contribution_treatments: WorkspaceRow<'claim_catalogue'>['contribution_treatments'];
	readonly sequence: number;
	readonly eligibility: string;
	/** `PAYROLL` or `COMPANY_DIRECT`; absent on Work items, which payroll always pays. */
	readonly settlement?: string;
	readonly family: 'WORK' | 'LEAVE' | 'CLAIM' | 'ALLOWANCE' | 'PAYMENT' | 'LOAN';
};

import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import type { PayRequest, PayRequestFamily } from './money.js';
import type { PayslipBase } from '../../datatypes/payslip_base/+definition.js';
import type { PayslipProration } from '../../datatypes/payslip_proration/+definition.js';
import type { SettledLeaveCapture } from '../leave/payroll.js';
import type { IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import type { DailyOvertime } from '../../collections/payroll_runs/lib/overtime.js';
import type { ScheduledDay } from '../../collections/payroll_runs/lib/schedule.js';
import type { PayrollWindow } from '../../collections/payroll_runs/lib/period.js';
import type { FormulaContext } from '../../collections/payroll_runs/lib/formula.js';
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
	/** The catalogue row this pays, or `null` for an amount the statute derived. */
	readonly catalogueComponent: FamilyPayItem;
	/**
	 * What the amount settles as, carried rather than read back off the component, because derived
	 * overtime has none to read it from. It is always an `EARNING`.
	 */
	readonly nature: string | null;
	/** What to call this in an engine message — a component code, or the rule key that priced it. */
	readonly label: string;
	/** Signed within its economic direction; a reversal negates the original amount. */
	readonly amount: number;
};

/**
 * One contracted amount, before any input touched it.
 *
 * BASE is `employment_terms x period`: it points at nothing, which is why it is inlined on
 * `payslips` rather than being a row in `payslip_adjustments`. A formula over the contract is base
 * for the same reason — nobody can edit a record that caused it, because no such record exists.
 */
export type MeasuredBase = PricedItem & {
	readonly catalogueComponent: CatalogueComponent;
	/** The stored shape, produced here so nothing downstream has to assemble it. */
	readonly entry: PayslipBase;
};

/**
 * The one input that caused an adjustment, in the shape `payslip_adjustments.input` is written in.
 *
 * MEASURE speaks of the four input **families** — the business sources themselves; GRAPH maps each
 * family onto the junction collection that stores the capture and the adjustment row the engine
 * emits carries the reference the database enforces. Keeping the family here and the junction
 * handle in GRAPH is what lets MEASURE stay pure: it decides which source caused what, and the
 * id minting and the junction writing happen once, beside them.
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
 * The adjustment names its causal input by family and source id; GRAPH resolves that to the
 * captured input link the junction row it is about to write will carry, because the junction row —
 * not the source record — is the thing `payslip_adjustments.input` points at. There are no
 * zero-amount settlement locks here any more: a source the run read and priced at nothing is a
 * junction row with no adjustment beside it, because an output that settles to nothing is no output
 * at all, and the capture is what locks the source.
 */
export type MeasuredAdjustment = PricedItem & {
	/** The one input that caused this row, by family and source id. */
	readonly input: MeasuredInput;
	/** The stable key of the statutory rule that priced a work-day input. Null on every other row. */
	readonly statutoryRuleKey: string | null;
	readonly quantity: number | null;
	readonly rate: number | null;
};

/** The captured inputs of one employment's payslip, before the junction ids exist. */
type CapturedInputs = {
	readonly workDays: readonly string[];
	/** Every pay request this payslip consumed, kept apart by the collection it came from. */
	readonly payRequests: Readonly<Record<PayRequestFamily, readonly string[]>>;
	readonly leave: readonly SettledLeaveCapture[];
	readonly loanRepayments: readonly string[];
};

export type MeasuredEmployment = {
	readonly bundle: EmploymentBundle;
	/** The contracted amounts. One entry per component, never one per terms row. */
	readonly base: readonly MeasuredBase[];
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
	/** Amounts of every component measured, including `INFORMATION` — what formulas read. */
	readonly componentAmounts: ReadonlyMap<string, number>;
	readonly ordinaryHourlyRate: number;
	readonly ordinaryDayWage: number;
	readonly overtimeDays: readonly DailyOvertime[];
	/** Regulated ordinary/off-day OT by calendar month; rest days and PH are excluded. */
	readonly calendarMonthOvertimeHours: ReadonlyMap<string, number>;
	readonly currency: string;
	readonly schedule: ReadonlyMap<IsoDate, ScheduledDay>;
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
	/** `loan_repayment_id` → what earlier PAID runs already recovered from it. See `gather.ts`. */
	readonly consumedRepayments: ReadonlyMap<string, number>;
	/** Calculate a deferred period's wages without settling manual money again. */
	readonly deferredWagesOnly?: boolean;
};

export type Measurement = {
	readonly amount: number;
	readonly base: readonly MeasuredBase[];
	readonly proration: readonly PayslipProration[];
	readonly adjustments: readonly MeasuredAdjustment[];
};

/** The cap rule lives in `./entry-cap.ts` so the write hook enforces the same ceiling this does. */
export type MeasureComponentOptions = {
	readonly component: CatalogueComponent;
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly salary: PayRange;
	readonly employed: PayRange;
	readonly contracted: PayRange;
	/** The one component entry this call measures, or `null` for a component no entry feeds. */
	readonly entry: PayRequest | null;
	readonly consumedEntries: ReadonlyMap<string, number>;
	readonly period: string;
	readonly workingDaysIn: (window: PayRange) => number;
	readonly allowanceWorkingDaysIn: (sourceMonth: string, window: PayRange) => number;
	readonly context: () => FormulaContext;
	readonly subject: PersonContext;
};

/** A family supplies a pure calculation; the coordinator only preserves common sequence order. */
export type FamilyStep = {
	readonly item: FamilyPayItem;
	readonly calculate: () => Measurement | null;
};

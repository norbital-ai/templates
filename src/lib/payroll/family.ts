import type { StatutoryOptIn } from '../../datatypes/work_rules/+definition.js';
import type { CatalogueBand } from '../../datatypes/catalogue_band/+definition.js';

/** Where a line settles (RFC 0001 §9). `EMPLOYER` and `DISPLAY` carry no direction. */
export type SettlementDestination = 'PAY' | 'NET' | 'EMPLOYER' | 'DISPLAY';
export type SettlementDirection = 'ADD' | 'SUBTRACT';

/** The payslip bucket a line lands in, derived from its catalogue's destination × direction. */
export type SettlementBucket =
	'EARNING' | 'ABSENCE' | 'DEDUCTION' | 'NON_WAGE_PAYMENT' | 'EMPLOYER_COST' | 'INFORMATION';

/**
 * The §9 table: destination × direction → the bucket the line lands in.
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
	/** Work and Leave items only: the money catalogues carry no statutory flag. */
	readonly is_statutory?: boolean;
	/** How the line settles: destination × direction is its bucket. */
	readonly destination: SettlementDestination;
	readonly direction: SettlementDirection | null;
	/** The ordered bands a catalogue prices its entries with; empty for engine-priced Work lines. */
	readonly bands: readonly CatalogueBand[];
	/** Engine-priced lines state their opt-ins on the component; catalogues carry them on bands. */
	readonly optIns?: readonly StatutoryOptIn[];
	readonly eligibility: string;
	readonly family: 'WORK' | 'LEAVE' | 'CLAIM' | 'ALLOWANCE' | 'PAYMENT' | 'LOAN';
};

import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import type { RunIssue } from '../../collections/payroll_runs/lib/validate.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import type {
	MaterialisedMoney,
	PreparedPayRequest,
	PayRequest,
	PayRequestFamily
} from './money.js';
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
	 * The bucket the amount settles in (§9), carried rather than read back off the component,
	 * because derived overtime has none to read it from. It is always an `EARNING`.
	 */
	readonly bucket: SettlementBucket;
	/** The schemes the priced band opted into; ACCUMULATE reads these and nothing else. */
	readonly optIns: readonly StatutoryOptIn[];
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
		// A base line carries the component's own opt-ins: ACCUMULATE reads them and nothing else,
		// so dropping them here silently charges no scheme on the contracted wage.
		optIns: catalogueComponent.optIns ?? [],
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
	/** Per-period rows the run materialised from standing sources, ready to create and link. */
	readonly materialised: readonly MaterialisedMoney[];
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
	readonly entry: PreparedPayRequest | null;
	readonly consumedEntries: ReadonlyMap<string, number>;
	readonly period: string;
	readonly workingDaysIn: (window: PayRange) => number;
	readonly allowanceWorkingDaysIn: (sourceMonth: string, window: PayRange) => number;
	/** The day and hour rates the entry context exposes to a catalogue band. */
	readonly rates: {
		readonly ordinaryDay: number;
		readonly ordinaryHour: number;
	};
	readonly subject: PersonContext;
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

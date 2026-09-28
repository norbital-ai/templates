import { serviceStart, stint } from '../employment-contract.js';
import type { PayrollWorld } from '../payroll/world.js';
import { refuse } from '../refuse.js';
import { fromMinorUnits, toMinorUnits, type MoneyValue } from '../payroll/run/rounding.js';
import type { LeaveCharge } from '../datatypes/leave_charges.js';
import type { LeavePayItem } from '../datatypes/leave_pay_items.js';
import { leaveWindowOf, type LeaveWindow } from './entitlement.js';
import type {
	SettlementBucket,
	SettlementDestination,
	SettlementDirection,
	FamilyPayItem
} from '../payroll/family.js';
import type { LeaveActivity } from './pending.js';
import { activeTimeOff } from './activity.js';
import { leaveActivityOf, normaliseLeaveDays } from './activity-fields.js';
import type { LeaveContext } from './context.js';
import { coversDate, live } from '../../lib/payroll/run/effective.js';
import {
	evaluateNumberOver,
	isEligible,
	personContext
} from '../../lib/payroll/run/eligibility.js';
import { inclusiveDays } from '../../lib/payroll/run/dates.js';
import type { Configuration } from '../../lib/payroll/run/configuration.js';
import { encashmentCode } from './codes.js';
import { cents } from '../../lib/payroll/run/rounding.js';
import { personFactsForVersion } from '../payroll/facts.js';
import { resolveCompanyFacts } from '../declared-facts.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { personWageFloor } from '../payroll/contribution.js';
import type { WorkspaceRow } from '../rows.js';
import { decodeNumber } from '../wire.js';

export { encashmentCode } from './codes.js';

type LeaveCatalogue = LeaveContext['catalogues'][number];

type LeaveCapture = {
	readonly leave_entry_id: string;
	readonly charges: readonly LeaveCharge[];
	readonly gross_amount: MoneyValue;
};

export type SettledLeaveCapture = LeaveCapture & { readonly pay_items: readonly LeavePayItem[] };
export type PreparedLeavePayroll = {
	readonly entries: readonly LeaveActivity[];
	readonly catalogues: readonly LeaveCatalogue[];
	readonly captures: readonly (SettledLeaveCapture & { readonly paid: boolean })[];
	readonly deductionEligibility: Readonly<Record<string, boolean>>;
	/**
	 * `entry id/date` → the share of the day wage deducted for that charged day: 1 for an unpaid
	 * or fund-paid day, `1 − pay_fraction` for a part-paid one. Absent reads as the whole day.
	 */
	readonly deductionShare?: Readonly<Record<string, number>> | undefined;
};

/** Whole calendar months between two days, the day of month ignored. */
const wholeMonthsBetween = (start: string, end: string): number =>
	(Number.parseInt(end.slice(0, 4), 10) - Number.parseInt(start.slice(0, 4), 10)) * 12 +
	(Number.parseInt(end.slice(5, 7), 10) - Number.parseInt(start.slice(5, 7), 10));

/** A row whose days take something off the wage: unpaid, paid by a fund, or paid in part. */
const deductsWage = (
	catalogue: Pick<LeaveCatalogue, 'is_npl' | 'paid_by' | 'pay_fraction'>
): boolean =>
	catalogue.is_npl || catalogue.paid_by === 'FUND' || (catalogue.pay_fraction ?? '').trim() !== '';

/** The deducted share of one charged day, as prepared; the whole day where none was stated. */
const shareOf = (prepared: PreparedLeavePayroll, key: string): number =>
	prepared.deductionShare?.[key] ?? 1;

/** The catalogue revision a settled line names, resolved by the code the payslip froze. */
function settledCatalogueOf(
	entry: LeaveActivity,
	componentCode: string,
	catalogues: readonly LeaveCatalogue[]
): LeaveCatalogue {
	const matches = (row: LeaveCatalogue | undefined) =>
		row != null && (row.code === componentCode || encashmentCode(row.code) === componentCode);
	const own = catalogues.find((row) => row.id === entry.catalogue_id);
	if (matches(own)) return own!;
	const charged = entry.charges
		.map((charge) => catalogues.find((row) => row.id === charge.catalogue_id))
		.find(matches);
	if (charged != null) return charged;
	const byCode = catalogues.find(matches);
	if (byCode != null) return byCode;
	refuse(`Settled Leave line ${componentCode} has no catalogue revision in this lineage.`);
}

/** The frozen pay lines of one settled entry, read back off the payslip it is pinned to. */
function settledPayItems(
	entry: LeaveActivity,
	payslip: LeaveContext['payslips'][number],
	catalogues: readonly LeaveCatalogue[]
): readonly LeavePayItem[] {
	return payslip.adjustments.flatMap((line): LeavePayItem[] => {
		if (line.family !== 'LEAVE' || line.source_id !== entry.id) return [];
		const catalogue = settledCatalogueOf(entry, line.component_code, catalogues);
		return [
			{
				catalogue_id: catalogue.id,
				settings_id: catalogue.settings_id,
				code: line.component_code,
				bucket: line.bucket === 'ABSENCE' ? 'ABSENCE' : 'EARNING',
				date: null,
				amount: line.amount,
				quantity: line.quantity ?? null,
				rate: line.rate ?? null
			}
		];
	});
}

/**
 * Family-owned preparation. Payroll receives approved activity and frozen settlement evidence.
 *
 * Batched reads on rows the run has already selected: the approved entries of these employments,
 * every revision of the lineage's leave catalogue (a settled entry cites the revision it was
 * settled under), their statutory declaration definitions, and the payslips those settled entries
 * are pinned to. The employments, company
 * and versions come from the caller, which read them once for everybody; the deduction verdicts
 * need the terms and the person, and are added by `withLeaveDeductionEligibility` once the run
 * has read those too.
 */
export function prepareLeavePayroll(options: {
	readonly world: PayrollWorld;
	readonly employments: readonly { readonly id: string }[];
	readonly versions: readonly { readonly id: string }[];
	/** The payroll's currency, which a settled capture nobody reverses is stated in. */
	readonly currency: string;
}): ReadonlyMap<string, GatheredLeave> {
	const { world } = options;
	const employmentIds = new Set(options.employments.map((row) => row.id));
	const versionIds = new Set(options.versions.map((row) => row.id));
	const entryRows = live(world.leave_entries).filter((row) => employmentIds.has(row.employment_id));
	const catalogueRows = live(world.leave_catalogue).filter((row) =>
		versionIds.has(row.settings_id)
	);
	const catalogues = catalogueRows as LeaveCatalogue[];
	// A settled entry's frozen pay lines are read back only where something negates them: the
	// approved reversals name their targets, and every other settled capture is just its pin.
	const entries = (entryRows as LeaveActivity[]).map(normaliseLeaveDays);
	const reversedIds = new Set(
		entries.flatMap((row) =>
			row.approval_id == null && row.as_adjustment_entry === true && row.reversal_of_id != null
				? [row.reversal_of_id]
				: []
		)
	);
	const settlingIds = [
		...new Set(
			entries.flatMap((row) =>
				row.payslip_id != null && reversedIds.has(row.id) ? [row.payslip_id] : []
			)
		)
	];
	const settling = new Set(settlingIds);
	const payslipRows = live(world.payslips).filter((row) => settling.has(row.id));
	const schemes = entries.some((entry) => entry.charges.length > 0)
		? live(world.statutory_contributions).filter((row) => versionIds.has(row.settings_id))
		: [];
	const payslipById = new Map<string, (typeof payslipRows)[number]>(
		payslipRows.map((row) => [row.id, row])
	);
	const entriesByEmployment = Map.groupBy(entries, (row) => row.employment_id);
	const result = new Map<string, GatheredLeave>();
	for (const employment of options.employments) {
		const entries = entriesByEmployment.get(employment.id) ?? [];
		// A settled entry's pin is the capture; its payslip's adjustments are the frozen outputs.
		const captures = entries.flatMap((entry) => {
			if (entry.payslip_id == null) return [];
			const payslip = payslipById.get(entry.payslip_id);
			if (payslip == null && reversedIds.has(entry.id))
				refuse('A settled Leave entry has no owning payslip.');
			const pay_items = payslip == null ? [] : settledPayItems(entry, payslip, catalogues);
			return [
				{
					leave_entry_id: entry.id,
					charges: entry.charges,
					pay_items,
					gross_amount: leaveCaptureAmount(pay_items, payslip?.currency ?? options.currency),
					// Paid is this person's own slip, read only where a reversal negates it.
					paid: payslip?.paid_at != null
				}
			];
		});
		result.set(employment.id, { entries, catalogues, captures, schemes });
	}
	return result;
}

/** What `prepareLeavePayroll` gathers before the person and their terms are known. */
type GatheredLeave = Omit<PreparedLeavePayroll, 'deductionEligibility'> & {
	readonly schemes: readonly Pick<
		WorkspaceRow<'statutory_contributions'>,
		'id' | 'settings_id' | 'code' | 'elections'
	>[];
};

/**
 * The deduction covers whom the leave covers: one predicate per charged day, judged on the person
 * as they stood that day. Pure, so the run adds it once it has read the terms and the employee.
 */
export function withLeaveDeductionEligibility(
	gathered: GatheredLeave,
	options: {
		readonly employment: Parameters<typeof serviceStart>[0];
		readonly servicePeriods: readonly { readonly start: string; readonly end: string | null }[];
		readonly employee: LeaveContext['employees'][number];
		readonly configuration: Pick<
			Configuration,
			'company' | 'recordedCompanyFacts' | 'companyFactRevisions' | 'lineageVersions'
		>;
		readonly statutoryFacts: Parameters<typeof personFactsForVersion>[0];
		readonly terms: readonly LeaveContext['terms'][number][];
	}
): PreparedLeavePayroll {
	const deductionEligibility: Record<string, boolean> = {};
	const deductionShare: Record<string, number> = {};
	const { configuration } = options;
	// Every charged day of the employment's time off, so `leave.taken(code)` can count a code's
	// days in the leave year before the day being priced, across entries.
	const charged = activeTimeOff(gathered.entries).flatMap((entry) =>
		entry.charges.map((charge) => ({
			date: charge.date,
			code: entry.leave_code,
			days: charge.days
		}))
	);
	const timeOff = activeTimeOff(gathered.entries);
	for (const entry of timeOff) {
		const chargedDays = entry.charges.reduce((sum, charge) => sum + charge.days, 0);
		// One stoppage or other event filed as several entries (one per pay period) is one event:
		// the entries of this code naming the same event date; an entry naming none is its own.
		const eventCharges = timeOff
			.filter(
				(row) =>
					row.id === entry.id ||
					(entry.event_date != null &&
						row.leave_code === entry.leave_code &&
						row.event_date === entry.event_date)
			)
			.flatMap((row) => row.charges);
		const opening = entry.charges.map((charge) => charge.date).toSorted()[0] ?? '';
		for (const charge of entry.charges) {
			const catalogue = gathered.catalogues.find((row) => row.id === charge.catalogue_id);
			if (!catalogue) refuse('Approved leave refers to a missing catalogue revision.');
			if (!deductsWage(catalogue)) continue;
			const term = options.terms.find((row) => row.id === charge.employment_term_id);
			if (!term || !coversDate(term.effective_range, charge.date))
				refuse('Approved leave has no effective captured employment terms.');
			const version = settingsInForce(
				configuration.lineageVersions,
				configuration.company.settings_code,
				charge.date
			);
			const person = personContext({
				event: {
					kind: entry.event_kind,
					relationship: entry.event_relationship,
					child_index: entry.event_child_index,
					date: entry.event_date
				},
				employee: options.employee,
				employment: stint(options.employment, version?.exit_facts ?? []),
				servicePeriods: options.servicePeriods,
				terms: term,
				asOf: charge.date,
				children: options.employee.children ?? [],
				company: {
					...configuration.company,
					facts: resolveCompanyFacts(
						version?.facts ?? [],
						{ ...configuration.company, facts: configuration.recordedCompanyFacts },
						{ asOf: charge.date, revisions: configuration.companyFactRevisions }
					)
				},
				facts: personFactsForVersion(
					options.statutoryFacts,
					gathered.schemes,
					catalogue.settings_id,
					charge.date,
					entry.employment_id
				)
			});
			const key = `${entry.id}/${charge.date}`;
			let eligible = isEligible(catalogue.eligibility, person);
			// The employer's share of the day: none for an unpaid or fund-paid day, `pay_fraction`
			// of it otherwise — read on the day, so a scale that steps by month steps here.
			let share = 1;
			if (eligible && !catalogue.is_npl && catalogue.paid_by !== 'FUND') {
				const yearStart = leaveWindowOf(charge.date, catalogue.entitlement).start;
				const yearTaken: Record<string, number> = {};
				for (const row of charged)
					if (row.date >= yearStart && row.date < charge.date)
						yearTaken[row.code] = (yearTaken[row.code] ?? 0) + row.days;
				const paid = evaluateNumberOver(catalogue.pay_fraction, {
					...person,
					// The floor on the day (VN Labour Code art.99: stoppage pay not below the minimum wage).
					wage_floor:
						version == null || !catalogue.pay_fraction.includes('wage_floor')
							? 0
							: personWageFloor({ company: configuration.company, jurisdiction: version }, person),
					leave: {
						month_index: wholeMonthsBetween(opening, charge.date) + 1,
						day_index: inclusiveDays(opening, charge.date),
						days: chargedDays,
						event_day: eventCharges
							.filter((row) => row.date <= charge.date)
							.reduce((sum, row) => sum + row.days, 0),
						agreed_fraction: decodeNumber(entry.agreed_pay_fraction ?? 0),
						year_taken: yearTaken
					}
				});
				share = 1 - Math.min(1, Math.max(0, paid));
				if (share <= 0) eligible = false;
			}
			deductionEligibility[key] = eligible;
			deductionShare[key] = share;
		}
	}
	return { ...gathered, deductionEligibility, deductionShare };
}

/** The Leave family selects its own approved sources; payroll receives date slices and encashed days. */
export function leavePayrollInputs(options: {
	readonly entries: readonly LeaveActivity[];
	readonly salaryWindow: { readonly start: string; readonly end: string };
	readonly dueThrough: string;
	/** Every settled entry reserves its whole self; the pin on the entry is that reservation. */
	readonly captures: readonly {
		readonly leave_entry_id: string;
		/** Whether the payslip that froze this capture had been paid. */
		readonly paid?: boolean | undefined;
	}[];
	/** Money-only callers (hasLeavePayment) do not judge whether a time-off entry straddles. */
	readonly monetaryOnly?: boolean | undefined;
}) {
	const approved = options.entries.filter((row) => row.approval_id == null);
	const reversed = new Set(
		approved.flatMap((row) =>
			row.as_adjustment_entry === true && row.reversal_of_id != null ? [row.reversal_of_id] : []
		)
	);
	const settled = new Set(options.captures.map((row) => row.leave_entry_id));
	const timeOff = options.monetaryOnly
		? []
		: activeTimeOff(approved).flatMap((entry) => {
				if (settled.has(entry.id)) return [];
				const charges = entry.charges.filter(
					(row) => row.date >= options.salaryWindow.start && row.date <= options.salaryWindow.end
				);
				if (charges.length === 0) return [];
				if (charges.length !== entry.charges.length)
					refuse(
						`Approved ${entry.leave_code} leave straddles the payroll window ` +
							`${options.salaryWindow.start}–${options.salaryWindow.end}. A time-off entry ` +
							'settles whole in the period that contains all of its days; split the leave ' +
							'into one entry per period.'
					);
				if (new Set(charges.map((row) => row.date)).size !== charges.length)
					refuse('Approved leave has duplicate charges for one date.');
				return [{ entry, charges }];
			});
	const monetary = approved.flatMap((entry) => {
		if (settled.has(entry.id) || reversed.has(entry.id)) return [];
		const activity = leaveActivityOf(entry);
		if (activity !== 'ENCASHMENT' && activity !== 'REVERSAL') return [];
		// A reversal with no due date never read captured money back off a paid payslip; it is a
		// pending correction, not a monetary obligation.
		if (entry.due_on == null) {
			if (activity === 'REVERSAL') return [];
			refuse('A monetary Leave entry is missing its approved due date.');
		}
		// A reversal negates the outputs of one paid source, and nothing else: with no paid capture
		// of the entry it names, there is no money to negate.
		if (
			activity === 'REVERSAL' &&
			!options.captures.some(
				(row) => row.leave_entry_id === entry.reversal_of_id && row.paid === true
			)
		)
			return [];
		if (entry.due_on > options.dueThrough) return [];
		// An encashment has no keyed amount: the engine applies its dated valuation rule.
		// A reversal negates the outputs it named when it was approved.
		return [{ entry, dueOn: entry.due_on }];
	});
	return { timeOff, monetary };
}

/** Outstanding Leave money keeps an ended employment selectable without restoring salary. */
export function hasLeavePayment(prepared: GatheredLeave, dueThrough: string): boolean {
	return (
		leavePayrollInputs({
			entries: prepared.entries,
			captures: prepared.captures,
			salaryWindow: { start: dueThrough, end: dueThrough },
			dueThrough,
			monetaryOnly: true
		}).monetary.length > 0
	);
}

/** Approved date coverage is separate from whether a source has already been paid. */
export function leaveCoverage(
	prepared: PreparedLeavePayroll,
	window: LeaveWindow,
	includesDate: (date: string) => boolean = () => true
) {
	const days: Record<string, number> = {};
	const byCode: Record<string, number> = {};
	const datesByCode = new Map<string, Map<string, number>>();
	const seen = new Set<string>();
	const add = (entryId: string, charge: LeaveCharge) => {
		if (
			charge.date < window.start ||
			charge.date > window.end ||
			!includesDate(charge.date) ||
			seen.has(`${entryId}/${charge.date}`)
		)
			return;
		seen.add(`${entryId}/${charge.date}`);
		const code = prepared.entries.find((row) => row.id === entryId)?.leave_code;
		if (code == null) refuse('Captured Leave has no source entry.');
		days[charge.date] = (days[charge.date] ?? 0) + charge.days;
		if (days[charge.date]! > 1) refuse(`Approved leave exceeds one day on ${charge.date}.`);
		byCode[code] = (byCode[code] ?? 0) + charge.days;
		const dates = datesByCode.get(code) ?? new Map<string, number>();
		dates.set(charge.date, (dates.get(charge.date) ?? 0) + charge.days);
		datesByCode.set(code, dates);
	};
	for (const entry of activeTimeOff(prepared.entries))
		for (const charge of entry.charges) add(entry.id, charge);
	const fullDaysByCode = Object.fromEntries(
		[...datesByCode].map(([code, dates]) => [
			code,
			[...dates.values()].filter((days) => days >= 1).length
		])
	);
	return { days, byCode, fullDaysByCode };
}

/**
 * The unpaid-leave days a jurisdiction may take off a standing allowance: every eligible `is_npl`
 * charge inside the window, in days. Eligibility was prepared with the deduction, so a day the
 * catalogue's rule excuses is not counted here either.
 */
function unpaidLeaveDaysByDate(prepared: PreparedLeavePayroll, window: LeaveWindow) {
	const days = new Map<string, number>();
	for (const entry of activeTimeOff(prepared.entries))
		for (const charge of entry.charges) {
			if (charge.date < window.start || charge.date > window.end) continue;
			const catalogue = prepared.catalogues.find((row) => row.id === charge.catalogue_id);
			if (catalogue == null || !deductsWage(catalogue)) continue;
			const key = `${entry.id}/${charge.date}`;
			if (prepared.deductionEligibility[key] !== true) continue;
			days.set(charge.date, (days.get(charge.date) ?? 0) + charge.days * shareOf(prepared, key));
		}
	return days;
}

export function unpaidLeaveDays(prepared: PreparedLeavePayroll, window: LeaveWindow): number {
	return [...unpaidLeaveDaysByDate(prepared, window).values()].reduce((sum, days) => sum + days, 0);
}

/** Count dates without any employer-paid portion; separate half-days do not form a full day. */
export function fullyUnpaidDays(
	prepared: PreparedLeavePayroll,
	window: LeaveWindow,
	absences: readonly { readonly date: string; readonly days: number }[],
	includesDate: (date: string) => boolean = () => true
): number {
	const days = unpaidLeaveDaysByDate(prepared, window);
	for (const absence of absences) {
		if (absence.date < window.start || absence.date > window.end) continue;
		days.set(absence.date, (days.get(absence.date) ?? 0) + absence.days);
	}
	return [...days].filter(([date, day]) => includesDate(date) && day >= 1).length;
}

function leaveCaptureAmount(items: readonly LeavePayItem[], currency: string): MoneyValue {
	const minor = items.reduce(
		(sum, item) =>
			sum + toMinorUnits(item.bucket === 'ABSENCE' ? -item.amount : item.amount, currency),
		0n
	);
	return { currency, value: fromMinorUnits(minor, currency) };
}

/** Pure Leave calculation: Work supplies withheld-day rates; the engine prices encashed days. */
export function calculateLeavePayroll(options: {
	readonly prepared: PreparedLeavePayroll;
	readonly window: LeaveWindow;
	readonly dueThrough: string;
	readonly currency: string;
	readonly absenceRate: (charge: LeaveCharge) => number;
	/**
	 * The statutory day rate for this entry's conversion date and catalogue revision.
	 */
	readonly encashmentRate: (entry: LeaveActivity) => number;
	/** Deferred salary replay includes dated leave only; encashed days settle in the regular pass. */
	readonly includeMonetary?: boolean | undefined;
}) {
	const { prepared, currency } = options;
	const selected = leavePayrollInputs({
		entries: prepared.entries,
		captures: prepared.captures,
		salaryWindow: options.window,
		dueThrough: options.dueThrough
	});
	const captures: SettledLeaveCapture[] = [];
	const add = (
		entryId: string,
		charges: readonly LeaveCharge[],
		items: readonly LeavePayItem[]
	) => {
		captures.push({
			leave_entry_id: entryId,
			charges,
			pay_items: items,
			gross_amount: leaveCaptureAmount(items, currency)
		});
	};
	// Round cumulative deductions per dated salary basis. Independently rounded days can exceed
	// the prorated salary when an entire pay period is unpaid. Each capture retains its allocated share.
	const deductionTotals = new Map<string, number>();
	for (const { entry, charges } of selected.timeOff.toSorted(
		(a, b) =>
			(a.charges[0]?.date ?? '').localeCompare(b.charges[0]?.date ?? '') ||
			a.entry.id.localeCompare(b.entry.id)
	)) {
		const items: LeavePayItem[] = [];
		for (const charge of charges.toSorted((a, b) => a.date.localeCompare(b.date))) {
			const catalogue = prepared.catalogues.find((row) => row.id === charge.catalogue_id);
			if (!catalogue) refuse('Approved Leave has no captured catalogue revision.');
			if (!deductsWage(catalogue)) continue;
			const key = `${entry.id}/${charge.date}`;
			const eligible = prepared.deductionEligibility[key];
			if (eligible == null) refuse('The Leave deduction eligibility was not prepared.');
			if (!eligible) continue;
			const rate = options.absenceRate(charge);
			if (!Number.isFinite(rate) || rate < 0)
				refuse('Work must supply a nonnegative Leave absence rate.');
			const basis = `${charge.employment_term_id}/${charge.date.slice(0, 7)}`;
			const previous = deductionTotals.get(basis) ?? 0;
			const total = previous + rate * charge.days * shareOf(prepared, key);
			const amount = cents(cents(total, currency) - cents(previous, currency), currency);
			deductionTotals.set(basis, total);
			if (amount === 0) continue;
			items.push({
				catalogue_id: catalogue.id,
				settings_id: catalogue.settings_id,
				code: catalogue.code,
				bucket: 'ABSENCE',
				date: charge.date,
				amount,
				quantity: charge.days,
				rate
			});
		}
		add(entry.id, charges, items);
	}
	for (const { entry } of options.includeMonetary === false ? [] : selected.monetary) {
		const activity = leaveActivityOf(entry);
		if (activity === 'ENCASHMENT') {
			const catalogue = prepared.catalogues.find((row) => row.id === entry.catalogue_id);
			if (!catalogue) refuse('The agreed encashment catalogue revision is missing.');
			if (!catalogue.can_encash)
				refuse(`${catalogue.code} is not encashable in this settings version.`);
			const rate = options.encashmentRate(entry);
			if (!Number.isFinite(rate) || rate < 0)
				refuse('The valuation rule must supply a nonnegative Leave encashment rate.');
			const encashDays = entry.encash_days ?? 0;
			add(
				entry.id,
				[],
				[
					{
						code: encashmentCode(catalogue.code),
						catalogue_id: catalogue.id,
						settings_id: catalogue.settings_id,
						bucket: 'EARNING',
						date: null,
						amount: cents(rate * encashDays, currency),
						quantity: encashDays,
						rate
					}
				]
			);
		} else if (activity === 'REVERSAL') {
			// Leave carries no entered money: the reversal negates exactly the frozen outputs of the
			// paid source it names.
			const sources = prepared.captures.filter(
				(row) => row.leave_entry_id === entry.reversal_of_id && row.paid
			);
			if (sources.some((row) => row.gross_amount.currency !== currency))
				refuse('Reversed Leave currency differs from this payroll.');
			const items = sources.flatMap((row) =>
				row.pay_items.map((item) => ({
					...item,
					amount: -item.amount,
					quantity: item.quantity == null ? null : -item.quantity
				}))
			);
			add(entry.id, [], items);
		}
	}
	const adjustments = captures.flatMap((capture) =>
		capture.pay_items.map((item) => {
			const catalogue = prepared.catalogues.find((row) => row.id === item.catalogue_id);
			if (!catalogue)
				refuse('A settled Leave line names a catalogue revision that is not available.');
			// The frozen pay item states its own bucket: an unpaid day is the ABSENCE arm, an
			// encashment the EARNING arm; the metadata spells the landing that bucket means.
			const bucket: SettlementBucket = item.bucket;
			const catalogueComponent: FamilyPayItem = {
				id: `${item.catalogue_id}:${item.code}`,
				catalogue_id: item.catalogue_id,
				settings_id: item.settings_id,
				code: item.code,
				// Leave carries no pricing and no landing: the frozen bucket is the truth, so the
				// metadata states the landing that bucket already means.
				destination: 'PAY' as SettlementDestination,
				direction: item.bucket === 'ABSENCE' ? 'SUBTRACT' : 'ADD',
				bands: [],
				eligibility: catalogue.eligibility,
				family: 'LEAVE'
			};
			return {
				catalogueComponent,
				bucket,
				label: item.code,
				amount: item.amount,
				input: { family: 'LEAVE' as const, id: capture.leave_entry_id },
				quantity: item.quantity ?? null,
				rate: item.rate ?? null,
				statutoryRuleKey: null
			};
		})
	);
	return { adjustments, captures };
}

export const prepareLeaveCatalogue = (world: PayrollWorld, settingsId: string) =>
	live(world.leave_catalogue).filter((row) => row.settings_id === settingsId);

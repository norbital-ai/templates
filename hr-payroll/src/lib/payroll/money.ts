/** Normalized money inputs supplied by Claim, Allowance and Payment (RFC 0001 §9, §11 step 3). */
import type { CatalogueBand } from '../../datatypes/catalogue_band/+definition.js';
import type { AllowanceRecurrence } from '../../datatypes/allowance_recurrence/+definition.js';
import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import { requiredDateKey, type IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import { defaultPayPeriod, type PayCadence } from '../../collections/payroll_runs/lib/period.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { compileEligibility } from '../../collections/payroll_runs/lib/eligibility.js';
import { expressionEngine, evaluateBoolean, evaluateNumber } from '../expressions/evaluate.js';
import {
	personContext,
	type PersonContext
} from '../../collections/payroll_runs/lib/eligibility.js';
import {
	entryLimitRefusal,
	resolveEntryLimit,
	type LimitSibling
} from '../../collections/payroll_runs/lib/entry-cap.js';
import { prorationFraction } from '../../collections/payroll_runs/lib/proration.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import { termsAt } from './work.js';
import { activeTimeOff } from '../leave/activity.js';
import { patternAnchor, termPatternRow } from '../scheduling/work-pattern.js';
import { payRequestTerms } from '../component_entry_cap_subject.js';
import { resolveSchedule, type ScheduledDay } from '../../collections/payroll_runs/lib/schedule.js';
import {
	intersectDays,
	monthBounds,
	monthDays,
	shiftPeriod
} from '../../collections/payroll_runs/lib/dates.js';
import { isEligible } from '../../collections/payroll_runs/lib/eligibility.js';
import { serviceStart } from '../employment-contract.js';
import type { RunIssue } from '../../collections/payroll_runs/lib/validate.js';
import type { PayslipAdjustment } from '../../datatypes/payslip_adjustments/+definition.js';
import { settlementBucket } from './family.js';
import type { Measurement, MeasureComponentOptions, PayRange, FamilyStep } from './family.js';

type ClaimRequest =
	import('../../collections/payroll_runs/$types.js').WorkspaceRow<'claim_requests'>;
type AllowanceRequest =
	import('../../collections/payroll_runs/$types.js').WorkspaceRow<'allowance_requests'>;
type PaymentRequest =
	import('../../collections/payroll_runs/$types.js').WorkspaceRow<'payment_requests'>;

/** Which collection a request came from. The engine names it in refusals and in provenance. */
export const PAY_REQUEST_FAMILIES = ['CLAIM', 'ALLOWANCE', 'PAYMENT'] as const;
export type PayRequestFamily = (typeof PAY_REQUEST_FAMILIES)[number];

/** The window a standing allowance is live across; `end` null is open-ended. */
type RequestWindow = { readonly start: IsoDate; readonly end: IsoDate | null };

/**
 * One pay request as the run reads it. Every derived answer is settled by the builder that made it,
 * so nothing downstream re-derives economics from storage shape.
 */
export type PayRequest = {
	readonly id: string;
	readonly family: PayRequestFamily;
	readonly employment_id: string;
	readonly catalogue_id: string;
	/** A positive magnitude, exactly as stored. */
	readonly amount: unknown;
	readonly approval_id: string | null;
	readonly pay_period: string | null;
	/** The day this request's economics belong to. */
	readonly event_date: IsoDate;
	/**
	 * `+1` to settle the way its catalogue declares, `−1` to settle the opposite way.
	 *
	 * `−1` is what `as_adjustment_entry` means, and it is available to every family: clawing back a
	 * transport claim is a transport claim entry with the tick set, under the same catalogue and on
	 * the same payslip line as the one it corrects.
	 */
	readonly sign: number;
	/** A standing allowance's own window, which prorates it independently of the employment. */
	readonly window: RequestWindow | null;
	/** Whether a part-month reduces it. Only a standing allowance is measured per day. */
	readonly prorates: boolean;
	/** Whether drawing on it uses it up. */
	readonly depletes: boolean;
	/** Whether the catalogue says the allowance recurs per period. */
	readonly recurring: boolean;
	/** A recurring allowance's incurred day of month, from its catalogue. */
	readonly on_day: number | null;
	/** A payslip already captured this single-use request. */
	readonly captured: boolean;
};

/** A prepared request retains the definition its source references, including older sealed revisions. */
export type PayRequestCapture = {
	readonly id: string;
	readonly period: string;
	readonly amount: number;
};
export type PreparedPayRequest = PayRequest & {
	readonly catalogueComponent: CatalogueComponent;
	readonly captures: readonly PayRequestCapture[];
	/** The per-period allowance row this request materialised, when it is a standing source. */
	readonly materialised: MaterialisedMoney | null;
};

const magnitudeBase = (
	row: {
		readonly id: string;
		readonly employment_id: string;
		readonly amount: unknown;
		readonly approval_id?: string | null;
		readonly pay_period?: string | null;
		readonly as_adjustment_entry?: boolean;
		readonly payslip_id?: string | null;
	},
	family: PayRequestFamily,
	eventDate: IsoDate,
	catalogueId: string
) => ({
	id: row.id,
	family,
	employment_id: row.employment_id,
	// The three catalogues are three tables and one id space, so the view keeps one column: which
	// table it came from is `family`, and nothing downstream has to ask.
	catalogue_id: catalogueId,

	amount: row.amount,
	approval_id: row.approval_id ?? null,
	pay_period: row.pay_period ?? null,
	event_date: eventDate,
	// The catalogue says which way this settles; the tick says settle it the other way.
	sign: row.as_adjustment_entry === true ? -1 : 1,
	window: null as RequestWindow | null,
	prorates: false,
	/**
	 * Everything except a live recurring allowance is bounded by its amount, so what earlier paid
	 * runs took reduces what is left — and it belongs to at most one payslip.
	 *
	 * An adjustment entry is **signed rather than depleted**: netting a negative draw against a
	 * magnitude would grow the ceiling it is supposed to be bounded by.
	 */
	depletes: row.as_adjustment_entry !== true,
	recurring: false,
	on_day: null as number | null,
	captured: row.payslip_id != null
});

/** A claim's economics belong to the day the expense was incurred, not the day it was entered. */
export const claimRequest = (row: ClaimRequest): PayRequest =>
	magnitudeBase(
		row,
		'CLAIM',
		requiredDateKey(row.incurred_on, 'claim incurred date'),
		row.catalogue_id
	);

/**
 * A standing allowance. The catalogue states whether it recurs, prorates and which day of the month
 * it is incurred on; the entry states its window (or one day).
 */
export const allowanceRequest = (row: AllowanceRequest, catalogue: AllowanceFacts): PayRequest => {
	const recurrence = row.recurrence as AllowanceRecurrence;
	// The entry's own recurrence kind is what makes it standing: a one-off instance of a code the
	// catalogue marks recurring is still a single-use request, priced as itself over its own month.
	const standing = recurrence.kind === 'RECURRING' && catalogue.recurring;
	const window: RequestWindow =
		recurrence.kind === 'ONE_OFF'
			? {
					start: requiredDateKey(`${monthKey(recurrence.on)}-01`, 'allowance month'),
					end: requiredDateKey(monthEndDay(monthKey(recurrence.on)), 'allowance month end')
				}
			: {
					start: requiredDateKey(recurrence.from, 'allowance start'),
					end: recurrence.to == null ? null : requiredDateKey(recurrence.to, 'allowance end')
				};
	return {
		...magnitudeBase(
			row,
			'ALLOWANCE',
			requiredDateKey(
				recurrence.kind === 'ONE_OFF' ? recurrence.on : recurrence.from,
				'allowance day'
			),
			row.catalogue_id
		),
		window,
		prorates: catalogue.prorates,
		depletes: recurrence.kind === 'ONE_OFF' && row.as_adjustment_entry !== true,
		recurring: standing,
		on_day: standing ? catalogue.on_day : null
	};
};

/** The catalogue facts an allowance entry reads. */
type AllowanceFacts = {
	readonly recurring: boolean;
	readonly prorates: boolean;
	readonly on_day: number | null;
};

/** The last calendar day of a `YYYY-MM` month. */
const monthEndDay = (month: string): string => {
	const [year, index] = month.split('-').map(Number) as [number, number];
	return `${month}-${String(new Date(Date.UTC(year, index, 0)).getUTCDate()).padStart(2, '0')}`;
};

const monthKey = (day: string): string => day.slice(0, 7);

export const paymentRequest = (row: PaymentRequest): PayRequest =>
	magnitudeBase(
		row,
		'PAYMENT',
		requiredDateKey(row.effective_on, 'payment effective date'),
		row.catalogue_id
	);

/**
 * Which run a request settles in. The stored `pay_period` wins; the cutoff supplies the default, in
 * the grammar of the cadence the employment is paid on.
 */
export function requestPayPeriod(
	request: PayRequest,
	cutoffDay: number,
	cadence?: PayCadence
): string {
	if (request.pay_period != null && request.pay_period !== '') return request.pay_period;
	return defaultPayPeriod(request.event_date, cutoffDay, cadence);
}

/** Late approvals settle once in the next regular period; standing amounts keep their window. */
export function requestIsDue(
	request: PayRequest,
	period: string,
	salary: { readonly start: string; readonly end: string },
	cutoffDay: number,
	cadence: PayCadence
): boolean {
	if (request.approval_id != null || request.captured) return false;
	if (request.recurring) {
		const window = request.window!;
		if (request.on_day == null)
			return window.start <= salary.end && (window.end == null || window.end >= salary.start);
		/**
		 * One instalment a month, incurred on `on_day`: the run the cutoff maps that month's
		 * occurrence to is the one that pays it. A 15th at a semi-monthly company belongs to the
		 * first half, a 20th to the second; a 25th past a 21st cutoff belongs to the next month's
		 * run, so this run's month and the one before it are the candidates.
		 */
		for (const month of [monthKey(period), shiftPeriod(monthKey(period), -1)]) {
			const day = Math.min(request.on_day, monthDays(`${month}-01`));
			const occurrence = `${month}-${String(day).padStart(2, '0')}`;
			if (occurrence < window.start) continue;
			if (window.end != null && occurrence > window.end) continue;
			if (defaultPayPeriod(occurrence, cutoffDay, cadence) === period) return true;
		}
		return false;
	}
	// Every request is dated now, so the cutoff rule places it: a one-off allowance on its day, a
	// claim on its incurred date, a payment on its effective date. Anything already due is picked
	// up by this run rather than lost.
	return requestPayPeriod(request, cutoffDay, cadence) <= period;
}

/**
 * The `entry` CEL context of RFC 0001 §7.2, as values.
 *
 * The builder supplies what the run knows about the entry being priced; a catalogue band's `when`
 * and `amount` are evaluated here, and the same blank instance compiled the expression at write.
 */
export function entryContext(options: {
	readonly entry: PayRequest;
	readonly subject: PersonContext;
	readonly period: string;
	readonly periodStart: string;
	readonly periodEnd: string;
	readonly instalments: number;
	readonly ordinaryDay: number;
	readonly ordinaryHour: number;
	readonly limits: Readonly<Record<string, number>>;
	readonly captures: { readonly paidToDate: number; readonly remaining: number };
}): Record<string, unknown> {
	const { entry } = options;
	return {
		person: options.subject,
		entry: {
			amount: Math.abs(decodeNumber(entry.amount)),
			days: 0,
			hours: 0,
			quantity: 0,
			event_date: entry.event_date,
			period: options.period,
			recurring: entry.recurring,
			occurrence_index: 1,
			window: {
				start: entry.window?.start ?? '',
				end: entry.window?.end ?? ''
			},
			captures: {
				paid_to_date: options.captures.paidToDate,
				remaining: options.captures.remaining
			}
		},
		rates: { ordinary_day: options.ordinaryDay, ordinary_hour: options.ordinaryHour },
		limits: options.limits,
		period: {
			key: options.period,
			start: options.periodStart,
			end: options.periodEnd,
			index: options.instalments > 1 ? 1 : 1,
			instalments: options.instalments
		},
		leave: {}
	};
}

/** The band that governs this entry: the first whose `when` holds, or null when none does. */
function selectBand(
	bands: readonly CatalogueBand[],
	context: Record<string, unknown>
): CatalogueBand | null {
	if (bands.length === 0) return null;
	const engine = expressionEngine;
	for (const band of bands) {
		if (band.when.trim() === '') return band;
		try {
			if (evaluateBoolean(engine, band.when, context)) return band;
		} catch (error) {
			throw new Error(
				`A catalogue band condition did not evaluate: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
	return null;
}

/** The band's amount: its money expression evaluated over the entry context. */
function bandAmount(band: CatalogueBand, context: Record<string, unknown>): number {
	return evaluateNumber(expressionEngine, band.amount, context);
}

/**
 * One entry as MEASURE prices it. The catalogue's bands decide the amount, the limit and the
 * opt-ins; with no bands the entry's own amount stands unchanged.
 */
function measureMoneyEntry(options: MeasureComponentOptions): Measurement | null {
	const definition = options.component.definition;
	if (definition.source !== 'ENTRY')
		throw new Error(
			`A ${options.component.family} request must have an ENTRY catalogue definition.`
		);
	if (options.entry == null) return null;
	const bucket = settlementBucket(options.component.destination, options.component.direction);
	const entryFraction = (source: PreparedPayRequest): number => {
		const window = source.window;
		// A late one-off allowance retains the source month's proration and employment coverage; a
		// standing allowance's materialised slice is a period occurrence, not a source month.
		const lateOneOff = !source.recurring && source.materialised == null && window != null;
		const sourcePeriod = lateOneOff ? { start: window.start, end: window.end! } : options.salary;
		const employmentRange = employmentDates(options.bundle.employment);
		const covered = lateOneOff
			? intersectDays(sourcePeriod, {
					start: employmentRange.hire,
					end: employmentRange.exit ?? sourcePeriod.end
				})
			: window == null
				? options.employed
				: intersectDays(
						{ start: window.start, end: window.end ?? sourcePeriod.end },
						options.employed
					);
		const sourceMonth = lateOneOff ? monthKey(window.start) : null;
		// A due one-off always has its source month prepared. A sibling read for a ceiling can be
		// dated in a month this run never prepared — a later month's award counted against an
		// annual cap — and is valued under this run's own law rather than stopping the payroll.
		const allowanceConfiguration =
			sourceMonth == null ? null : options.bundle.allowanceConfigurations?.get(sourceMonth);
		return source.prorates
			? prorationFraction({
					// The basis is the source month's law, not today's: the entry was earned then.
					work: allowanceConfiguration?.work ?? options.configuration.work,
					period: sourcePeriod,
					covered,
					workingDaysIn:
						sourceMonth == null
							? options.workingDaysIn
							: (window) => options.allowanceWorkingDaysIn(sourceMonth, window)
				})
			: 1;
	};

	const measureEntry = (entry: PreparedPayRequest): Measurement | null => {
		const subjectOn = (source: PayRequest): PersonContext =>
			personContext({
				employee: options.bundle.employee,
				employment: { service_start: serviceStart(options.bundle.employment) },
				// A post-departure obligation reads the final terms of its own contract: an event
				// after the exit is still priced against the last terms that covered the service.
				terms: payRequestTerms(
					options.bundle.termsHistory,
					options.bundle.employment,
					source.event_date
				),
				children: options.bundle.children,
				company: options.configuration.company,
				asOf: source.event_date
			});
		const subject = subjectOn(entry);
		/**
		 * A skipped request is captured, so it has to be reported: the entry is consumed whether or
		 * not it paid, and without a note an approved allowance disappears between periods with
		 * nothing to look at.
		 */
		const skipped = (reason: string): null => {
			options.note({
				code: 'PAY_REQUEST_SKIPPED',
				severity: 'WARNING',
				message:
					`${options.bundle.employment.employee_number}: ${options.component.family.toLowerCase()} ` +
					`${options.component.code} was captured for ${options.period} and paid nothing — ${reason}.`,
				collection: `${options.component.family.toLowerCase()}_requests`,
				recordId: entry.id
			});
			return null;
		};
		if (!isEligible(options.component.eligibility, subject))
			return skipped('this employment does not satisfy the catalogue’s eligibility rule');

		const rates = options.rates;
		const captures = entry.captures;
		const paidToDate = captures.reduce((sum, capture) => sum + capture.amount, 0);
		const context = entryContext({
			entry,
			subject,
			period: options.period,
			periodStart: options.salary.start,
			periodEnd: options.salary.end,
			instalments: 1,
			ordinaryDay: rates.ordinaryDay,
			ordinaryHour: rates.ordinaryHour,
			limits: Object.fromEntries(
				options.configuration.limits.map((limit) => [limit.key, limit.max_hours])
			),
			captures: {
				paidToDate,
				remaining: Math.max(0, decodeNumber(entry.amount) - paidToDate)
			}
		});
		const band = selectBand(options.component.bands, context);
		// A non-empty band table that covers nobody leaves the entry priced at nothing: the bands
		// are the entitlement, and no band is no entitlement.
		if (band == null && options.component.bands.length > 0)
			return skipped('no band of the catalogue covers this entry');
		const sign = entry.sign;
		const fraction = entryFraction(entry);
		if (fraction <= 0)
			return skipped('the employment covered none of the period the amount is prorated over');
		const raw = band == null ? decodeNumber(entry.amount) : bandAmount(band, context);
		const reimbursable = cents(raw * fraction);
		let payable = reimbursable;
		if (band?.limit != null) {
			const limitAmount = evaluateNumber(expressionEngine, band.limit.amount, context);
			// The ceiling spans catalogue revisions of one code: a request agreed under an earlier
			// revision still consumes it. Compare by code, not id, for the same reason the hook's
			// `catalogueRevisionsOf` reads the whole lineage.
			const siblings: LimitSibling[] = options.bundle.payRequests
				.filter(
					(candidate) =>
						candidate.employment_id === entry.employment_id &&
						((candidate.catalogueComponent?.code === options.component.code &&
							candidate.catalogueComponent.family === options.component.family) ||
							candidate.catalogue_id === entry.catalogue_id)
				)
				.flatMap((candidate) => {
					if (candidate.captures.length === 0)
						return [
							{
								id: candidate.id,
								employment_id: candidate.employment_id,
								event_date: candidate.event_date,
								// A sibling is valued the way the run will price it: a due one-off allowance by
								// its actual source-month proration, a captured one by what it actually paid.
								amount:
									candidate.sign * cents(decodeNumber(candidate.amount) * entryFraction(candidate))
							}
						];
					// Each period a standing award paid is its own use of the ceiling, dated in the
					// period it occurred; a single-use capture keeps the source's own event date.
					const perOccurrence = candidate.recurring || candidate.materialised != null;
					return candidate.captures.map((capture) => ({
						id: perOccurrence ? `${candidate.id}:${capture.id}` : candidate.id,
						employment_id: candidate.employment_id,
						event_date:
							perOccurrence && capture.period !== ''
								? `${capture.period}-15`
								: candidate.event_date,
						amount: candidate.sign * capture.amount
					}));
				});
			const resolved = resolveEntryLimit({
				limit: band.limit,
				limitAmount,
				entryId: entry.id,
				employmentId: entry.employment_id,
				eventDate: entry.event_date,
				siblings
			});
			if (resolved == null) throw new Error('A stated limit must resolve against its siblings.');
			// A standing award is bounded per occurrence: it pays what the ceiling has left rather
			// than stopping the whole run, so the next period continues from the remainder.
			if (
				(entry.recurring || entry.materialised != null) &&
				sign > 0 &&
				band.limit.on_exceed === 'BLOCK'
			)
				payable = Math.min(reimbursable, Math.max(0, cents(limitAmount - resolved.exceededBy)));
			const refusal = entryLimitRefusal({
				limit: band.limit,
				resolved,
				componentCode: options.component.code,
				subject: String(options.bundle.employment.employee_number),
				proposed: sign * payable
			});
			if (refusal !== null) throw new Error(refusal);
		}
		const amount = cents(sign * payable);
		return {
			amount,
			base: [],
			proration: [],
			adjustments: [
				{
					input: {
						family: entry.family,
						// The stored row's id is the runtime's; the adjustment names the standing
						// source it repeats, which is what the capture and its ceiling key on.
						id: entry.materialised?.sourceId ?? entry.id
					},
					catalogueComponent: options.component,
					bucket,
					label: options.component.code,
					amount,
					quantity: null,
					rate: null,
					statutoryRuleKey: null
				}
			]
		};
	};

	return measureEntry(options.entry);
}

export function prepareAllowanceWork(
	options: Pick<MeasureComponentOptions, 'bundle' | 'configuration'>
) {
	const { bundle } = options;
	const allowanceWorkDayIds = new Set<string>();
	const allowanceSchedules = new Map<string, Map<IsoDate, ScheduledDay>>();
	const allowanceWorkingDaysIn = (sourceMonth: string, window: PayRange): number => {
		// Same fallback as `entryFraction`: a month nobody prepared is a ceiling sibling's month.
		const source = bundle.allowanceConfigurations?.get(sourceMonth) ?? options.configuration;
		let schedule = allowanceSchedules.get(sourceMonth);
		if (!schedule) {
			const sourceWindow = monthBounds(sourceMonth);
			const dates = daysBetween(sourceWindow.start, sourceWindow.end);
			const { hire, exit } = employmentDates(bundle.employment);
			const sourceTermsAt = (date: IsoDate) =>
				termsAt(bundle, date < hire ? hire : exit != null && date > exit ? exit : date);
			const leaveCharges = new Map(
				activeTimeOff(bundle.leave.entries).flatMap((row) =>
					row.charges.map((charge) => [charge.date, charge] as const)
				)
			);
			const sourceRows = bundle.workDays.filter((row) => {
				const date = requiredDateKey(row.work_date, 'work_days.work_date');
				return date >= sourceWindow.start && date <= sourceWindow.end;
			});
			const plannedByDate = new Map(
				sourceRows.map((row) => [requiredDateKey(row.work_date, 'work_days.work_date'), row])
			);
			const planned = dates.flatMap<
				Pick<EmploymentBundle['workDays'][number], 'work_date' | 'shift_definition_id'>
			>((date) => {
				const patternRow = termPatternRow(sourceTermsAt(date), source.patternById);
				const pattern = patternRow?.pattern ?? null;
				const row = plannedByDate.get(date);
				// The approved Leave charge preserves the original shift if an absence changed the roster to OFF.
				const leaveShift = leaveCharges.get(date)?.shift_definition_id;
				if (
					pattern != null &&
					'expectation' in pattern &&
					row?.shift_definition_id == null &&
					leaveShift == null &&
					!source.holidays.has(date)
				)
					throw new Error(
						`Allowance working-day proration requires a source-month roster assignment on ${date}.`
					);
				if (row) allowanceWorkDayIds.add(row.id);
				if (leaveCharges.has(date))
					return (pattern != null && 'days' in pattern) || leaveShift == null
						? []
						: [{ work_date: date, shift_definition_id: leaveShift }];
				return row == null ? [] : [row];
			});
			schedule = resolveSchedule({
				window: sourceWindow,
				dates,
				workDays: planned,
				configuration: source,
				terms: (date) => {
					const row = termPatternRow(sourceTermsAt(date), source.patternById);
					return {
						work_pattern: row?.pattern ?? null,
						pattern_anchor: patternAnchor(row),
						// Only ORDINARY day classification enters this fraction; no clock hours are priced.
						normal_daily_hours: 8
					};
				}
			});
			allowanceSchedules.set(sourceMonth, schedule);
		}
		const resolved = schedule;
		return daysBetween(window.start, window.end).filter(
			(date) => resolved.get(date)?.dayType === 'ORDINARY'
		).length;
	};

	return { allowanceWorkDayIds, allowanceWorkingDaysIn };
}

/** Imported late to keep the module graph flat; these are engine internals. */
import { daysBetween } from '../../collections/payroll_runs/lib/dates.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';

export function prepareMoneySteps(
	options: Omit<MeasureComponentOptions, 'component' | 'entry'> & {
		readonly requests: readonly PreparedPayRequest[];
	}
): readonly FamilyStep[] {
	// A request prices under the catalogue row it was raised against, not the run version's row of
	// the same code: a loan or allowance agreed under an earlier revision still carries that
	// revision's bands and opt-ins, and a later version may not carry the row at all.
	return options.requests.map((entry) => ({
		item: entry.catalogueComponent,
		calculate: () => measureMoneyEntry({ ...options, component: entry.catalogueComponent, entry })
	}));
}

import { pickConfiguration } from '../../collections/payroll_runs/lib/configuration.js';
import type { PayrollWindow, PayFrequency } from '../../collections/payroll_runs/lib/period.js';
import type { PayrollReadApi, ReadLog } from '../../collections/payroll_runs/lib/api.js';
import { PAGE_LIMIT } from '../../collections/payroll_runs/lib/api.js';

/** The catalogue rows of the money families, lifted into engine components. */
export function prepareMoneyCatalogues(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly settingsId: string;
}) {
	return Effect.gen(function* () {
		const where = {
			settings_id: { eq: options.settingsId },
			approval_id: { isNull: true }
		} as const;
		const [claims, allowances, payments] = yield* Effect.all(
			[
				options.api.db.claim_catalogue.findMany({ where, limit: PAGE_LIMIT }),
				options.api.db.allowance_catalogue.findMany({ where, limit: PAGE_LIMIT }),
				options.api.db.payment_catalogue.findMany({ where, limit: PAGE_LIMIT })
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claims, 'claim catalogue');
		options.api.reads.assertComplete(allowances, 'allowance catalogue');
		options.api.reads.assertComplete(payments, 'payment catalogue');
		const components: CatalogueComponent[] = [
			...claims.map((row) => ({ ...row, family: 'CLAIM' as const, definition: entryOf() })),
			...allowances.map((row) => ({
				...row,
				family: 'ALLOWANCE' as const,
				definition: entryOf()
			})),
			...payments.map((row) => ({ ...row, family: 'PAYMENT' as const, definition: entryOf() }))
		] as unknown as CatalogueComponent[];
		return components;
	});
}

/** The stored row lifted into the engine's `ENTRY` arm: the bands are the definition. */
const entryOf = () => ({ source: 'ENTRY' }) as const;

/**
 * The source-month Work and calendar facts for the late one-off allowances this run pays.
 *
 * A late allowance is measured against the month it was earned in: that month's proration basis,
 * its roster and its published holidays — not today's. One governed configuration is picked per
 * distinct source month, exactly as a run's own is picked, and filed on the employment that
 * carries the entry.
 */
export function prepareAllowanceSources(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly employments: readonly { readonly id: string }[];
	readonly requestsByEmployment: ReadonlyMap<string, readonly PreparedPayRequest[]>;
	readonly cadenceByEmployment: ReadonlyMap<
		string,
		{ readonly window: PayrollWindow; readonly payFrequency: PayFrequency }
	>;
	readonly window: PayrollWindow;
}) {
	return Effect.gen(function* () {
		const { window, employments, requestsByEmployment, cadenceByEmployment } = options;
		const period = window.period;
		const company = options.configuration.company;
		const companyId = company.id;
		const allowanceMonthsByEmployment = new Map<string, Set<string>>();
		for (const employment of employments) {
			const cadence = cadenceByEmployment.get(employment.id);
			if (!cadence) continue;
			const months = new Set(
				(requestsByEmployment.get(employment.id) ?? [])
					.filter(
						(request) =>
							request.family === 'ALLOWANCE' &&
							!request.recurring &&
							request.materialised == null &&
							requestIsDue(
								request,
								period,
								cadence.window.salary,
								decodeNumber(company.pay_cutoff_day),
								{ company, payFrequency: cadence.payFrequency }
							)
					)
					.map((request) => monthKey(request.window!.start))
			);
			if (months.size) allowanceMonthsByEmployment.set(employment.id, months);
		}
		const allowanceConfigurations = new Map<string, Configuration>();
		for (const sourceMonth of [
			...new Set([...allowanceMonthsByEmployment.values()].flatMap((months) => [...months]))
		].sort()) {
			const span = monthBounds(sourceMonth);
			const source = yield* pickConfiguration({
				api: options.api,
				companyId,
				window: {
					...window,
					period: sourceMonth,
					salary: span,
					attendance: span,
					payDate: span.end,
					instalments: [{ sequence: 1, salary: span, attendance: span, payDate: span.end }]
				}
			});
			if (
				source.jurisdiction.payroll.currency !== options.configuration.jurisdiction.payroll.currency
			)
				refuse('An Allowance source month has a different currency from this payroll.');
			allowanceConfigurations.set(sourceMonth, source);
		}

		return { allowanceMonthsByEmployment, allowanceConfigurations };
	});
}

/** A source-to-payslip link: which family source settled on which payslip, and in which period. */
type PayRequestCaptureLink = {
	readonly family: PayRequestFamily;
	readonly payslipId: string;
	readonly period: string;
	readonly sourceId: string;
};

/**
 * Sum what each payslip actually settled per source, keyed by source id. The write-time guard and
 * the engine share this arithmetic so a captured zero means the same thing on both. A materialised
 * allowance row's adjustment names its standing source, so both link to the same key.
 */
export function captureAmounts(
	links: readonly PayRequestCaptureLink[],
	payslips: readonly {
		readonly id: string;
		readonly adjustments: readonly PayslipAdjustment[];
	}[]
): ReadonlyMap<string, readonly PayRequestCapture[]> {
	const captures = new Map<string, PayRequestCapture[]>();
	if (links.length === 0) return captures;
	const amounts = new Map<string, number>();
	const present = new Set(payslips.map((payslip) => payslip.id));
	for (const payslip of payslips)
		for (const row of payslip.adjustments) {
			if (!(PAY_REQUEST_FAMILIES as readonly string[]).includes(row.family)) continue;
			const key = `${payslip.id}:${row.source_id}`;
			amounts.set(key, (amounts.get(key) ?? 0) + decodeNumber(row.amount));
		}
	for (const link of links) {
		// A released materialised row names a payslip that no longer exists; it is history nobody
		// reads any more, so it is not a capture.
		if (!present.has(link.payslipId)) continue;
		const rows = captures.get(link.sourceId) ?? [];
		rows.push({
			id: link.payslipId,
			period: link.period,
			amount: amounts.get(`${link.payslipId}:${link.sourceId}`) ?? 0
		});
		captures.set(link.sourceId, rows);
	}
	return captures;
}

/** The link rows of one money family, read from the pins the engine wrote. */
function captureLinksOf(
	family: PayRequestFamily,
	api: PayrollReadApi & { readonly reads: ReadLog },
	ids: readonly string[]
): Effect.Effect<readonly PayRequestCaptureLink[]> {
	return Effect.gen(function* () {
		if (ids.length === 0) return [];
		const where = { id: { in: [...ids] }, payslip_id: { isNull: false } } as const;
		const columns = { id: true, payslip_id: true } as const;
		const rows =
			family === 'CLAIM'
				? yield* api.db.claim_requests.findMany({ where, columns, limit: PAGE_LIMIT })
				: family === 'PAYMENT'
					? yield* api.db.payment_requests.findMany({ where, columns, limit: PAGE_LIMIT })
					: yield* api.db.allowance_requests.findMany({
							where: { derived_from_id: { in: [...ids] }, payslip_id: { isNull: false } },
							columns: { id: true, payslip_id: true, derived_from_id: true, recurrence: true },
							limit: PAGE_LIMIT
						});
		return rows.map((row): PayRequestCaptureLink => {
			if (!('derived_from_id' in row) || row.derived_from_id == null)
				return { family, payslipId: row.payslip_id!, period: '', sourceId: row.id };
			return {
				family,
				payslipId: row.payslip_id!,
				// The slice the materialised row paid for names the period its cap usage belongs to.
				period: monthKey(
					requiredDateKey((row.recurrence as { readonly from: string }).from, 'allowance start')
				),
				sourceId: String(row.derived_from_id)
			};
		});
	});
}

/** Standing captures exclude single-use requests, including signed corrections, from later runs. */
function requestCaptures(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly requests: readonly PayRequest[];
	/** request id → the standing source a per-period allowance row materialised from. */
	readonly sourceOf?: ReadonlyMap<string, string>;
}): Effect.Effect<ReadonlyMap<string, readonly PayRequestCapture[]>, never, never> {
	return Effect.gen(function* () {
		const captures = new Map<string, PayRequestCapture[]>();
		if (options.requests.length === 0) return captures;
		const sourceIdOf = (request: PayRequest) => options.sourceOf?.get(request.id) ?? request.id;
		const idsOf = (family: PayRequestFamily) =>
			options.requests.filter((request) => request.family === family).map(sourceIdOf);
		const links = [
			...(yield* captureLinksOf('CLAIM', options.api, idsOf('CLAIM'))),
			...(yield* captureLinksOf('ALLOWANCE', options.api, idsOf('ALLOWANCE'))),
			...(yield* captureLinksOf('PAYMENT', options.api, idsOf('PAYMENT')))
		];
		if (links.length === 0) return captures;
		const payslips = yield* options.api.db.payslips.findMany({
			where: { id: { in: [...new Set(links.map((row) => row.payslipId))] } },
			columns: { id: true, adjustments: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(payslips, 'captured pay-request outputs');
		const bySource = captureAmounts(links, payslips);
		// A materialised row carries its source's capture history, so its cap usage and its
		// same-period exclusion are read from the standing allowance it repeats.
		for (const request of options.requests)
			captures.set(request.id, [...(bySource.get(sourceIdOf(request)) ?? [])]);
		return captures;
	});
}

type MoneyPreparationOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: import('../../collections/payroll_runs/lib/configuration.js').Configuration;
	readonly employmentIds: readonly string[];
	readonly period: string;
	/** The salary window this run settles; a recurring allowance outside it materialises a slice. */
	readonly periodWindow: { readonly start: string; readonly end: string };
};

/** Whether the salary window is fully inside a request's window. */
function windowCovered(
	window: RequestWindow | null,
	salary: { readonly start: string; readonly end: string }
): boolean {
	if (window == null) return true;
	return window.start >= salary.start && (window.end == null || window.end <= salary.end);
}

/** The slice of a standing window this period covers, clamped to both ends. */
function windowSlice(
	window: RequestWindow,
	salary: { readonly start: string; readonly end: string }
): { readonly start: string; readonly end: string } {
	return {
		start: window.start > salary.start ? window.start : salary.start,
		end: window.end == null ? salary.end : window.end < salary.end ? window.end : salary.end
	};
}

/**
 * Build the requests the run prices.
 *
 * A single-period request is priced as itself. A standing allowance whose window reaches past this
 * period materialises **one per-period row** (RFC 0001 decision 3): the row is created with the
 * run, linked to the payslip it priced, and deleted with that payslip, so the source is due again
 * next period.
 */
function buildRequests(options: {
	readonly claimRows: readonly ClaimRequest[];
	readonly allowanceRows: readonly AllowanceRequest[];
	readonly paymentRows: readonly PaymentRequest[];
	readonly allowanceFacts: ReadonlyMap<string, AllowanceFacts>;
	readonly periodWindow: { readonly start: string; readonly end: string };
}): {
	readonly direct: readonly PayRequest[];
	readonly materialised: readonly MaterialisedMoney[];
} {
	const direct: PayRequest[] = [
		...options.claimRows.map(claimRequest),
		...options.paymentRows.map(paymentRequest)
	];
	const materialised: MaterialisedMoney[] = [];
	for (const row of options.allowanceRows) {
		const facts = options.allowanceFacts.get(row.catalogue_id) ?? {
			recurring: false,
			prorates: false,
			on_day: null
		};
		const request = allowanceRequest(row, facts);
		if (!request.recurring || windowCovered(request.window, options.periodWindow)) {
			direct.push(request);
			continue;
		}
		const slice = windowSlice(request.window!, options.periodWindow);
		const id = crypto.randomUUID();
		materialised.push({
			id,
			sourceId: row.id,
			values: {
				employment_id: row.employment_id,
				catalogue_id: row.catalogue_id,
				amount: decodeNumber(row.amount),
				recurrence: { kind: 'RECURRING', from: slice.start, to: slice.end },
				evidence_file: null,
				as_adjustment_entry: row.as_adjustment_entry,
				derived_from_id: row.id
			}
		});
		direct.push({
			...request,
			id,
			// The occurrence's economics belong to the slice it pays for, not the standing source's
			// start: its event date places its use of any ceiling in the period it occurred.
			event_date: slice.start,
			window: { start: slice.start, end: slice.end },
			recurring: false
		});
	}
	return { direct, materialised };
}

/**
 * One per-period row the run materialised, ready to create and link to its payslip.
 *
 * `id` is the engine's own request identity for the occurrence; the stored row's id is the
 * runtime's, assigned on create, and the payslip adjustment names the standing `sourceId` it
 * repeats rather than the row, so nothing downstream needs to know the stored id.
 */
export type MaterialisedMoney = {
	readonly id: string;
	readonly sourceId: string;
	readonly values: Readonly<Record<string, unknown>>;
};

/** The catalogue facts an allowance entry reads, keyed by catalogue id. */
function allowanceFactsOf(
	rows: readonly {
		readonly id: string;
		readonly recurring: boolean;
		readonly prorates: boolean;
		readonly on_day: number | null;
	}[]
): ReadonlyMap<string, AllowanceFacts> {
	return new Map(
		rows.map((row) => [
			row.id,
			{ recurring: row.recurring, prorates: row.prorates, on_day: row.on_day }
		])
	);
}

export function prepareMoneyInputs(options: MoneyPreparationOptions) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const approved = { approval_id: { isNull: true }, payslip_id: { isNull: true } } as const;
		const inBegun = { employment_id: { in: [...options.employmentIds] }, ...approved } as const;
		const [claimRows, allowanceRows, paymentRows] = yield* Effect.all(
			[
				db.claim_requests.findMany({ where: inBegun, limit: PAGE_LIMIT }),
				// A released materialised row (unpinned, still derived) is an orphan of a deleted
				// draft; it is not a source, so it is not read.
				db.allowance_requests.findMany({
					where: { ...inBegun, derived_from_id: { isNull: true } },
					limit: PAGE_LIMIT
				}),
				db.payment_requests.findMany({ where: inBegun, limit: PAGE_LIMIT })
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claimRows, 'claim requests');
		options.api.reads.assertComplete(allowanceRows, 'allowance requests');
		options.api.reads.assertComplete(paymentRows, 'payment requests');
		const allowanceCatalogues = yield* db.allowance_catalogue.findMany({
			where: {
				id: { in: [...new Set(allowanceRows.map((row) => row.catalogue_id))] },
				approval_id: { isNull: true }
			},
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(allowanceCatalogues, 'allowance catalogue facts');
		const built = buildRequests({
			claimRows,
			allowanceRows,
			paymentRows,
			allowanceFacts: allowanceFactsOf(allowanceCatalogues),
			periodWindow: options.periodWindow
		});
		const requests: readonly PayRequest[] = built.direct;
		const sourceOf = new Map(built.materialised.map((row) => [row.id, row.sourceId]));
		const capturesByRequest = yield* requestCaptures({ api: options.api, requests, sourceOf });
		const requestCatalogues = yield* prepareRequestCatalogues(options, requests);
		const requestsByEmployment = Map.groupBy(
			requests.map((request): PreparedPayRequest => {
				const captures = capturesByRequest.get(request.id) ?? [];
				const standing = request.recurring || sourceOf.has(request.id);
				return {
					...request,
					// A standing award is due again each period; only an occurrence already paid in
					// *this* period excludes it, while a single-use entry is spent by any capture.
					captured: captures.some((capture) => !standing || capture.period === options.period),
					captures,
					catalogueComponent: requestCatalogues.get(request.catalogue_id)!,
					materialised: built.materialised.find((row) => row.id === request.id) ?? null
				};
			}),
			(row) => row.employment_id
		);

		return { requestsByEmployment, materialised: built.materialised };
	});
}

/** Requests retain their source revision; current contribution schemes still assess the result. */
function prepareRequestCatalogues(
	options: MoneyPreparationOptions,
	requests: readonly PayRequest[]
) {
	return Effect.gen(function* () {
		if (requests.length === 0) return new Map<string, CatalogueComponent>();
		const idsOf = (family: PayRequestFamily) => [
			...new Set(
				requests
					.filter((request) => request.family === family)
					.map((request) => request.catalogue_id)
			)
		];
		const approved = { approval_id: { isNull: true } } as const;
		const [claims, allowances, payments] = yield* Effect.all(
			[
				options.api.db.claim_catalogue.findMany({
					where: { id: { in: idsOf('CLAIM') }, ...approved },
					limit: PAGE_LIMIT
				}),
				options.api.db.allowance_catalogue.findMany({
					where: { id: { in: idsOf('ALLOWANCE') }, ...approved },
					limit: PAGE_LIMIT
				}),
				options.api.db.payment_catalogue.findMany({
					where: { id: { in: idsOf('PAYMENT') }, ...approved },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claims, 'source Claim catalogue');
		options.api.reads.assertComplete(allowances, 'source Allowance catalogue');
		options.api.reads.assertComplete(payments, 'source Payment catalogue');
		const components = [
			...claims.map((row) => ({ ...row, family: 'CLAIM' as const, definition: entryOf() })),
			...allowances.map((row) => ({
				...row,
				family: 'ALLOWANCE' as const,
				definition: entryOf()
			})),
			...payments.map((row) => ({ ...row, family: 'PAYMENT' as const, definition: entryOf() }))
		] as unknown as CatalogueComponent[];
		// The lineage's versions are already in hand; only a component from outside it is read.
		const settingsById = new Map(
			options.configuration.lineageVersions.map((row) => [row.id, row] as const)
		);
		const unknownVersionIds = [
			...new Set(components.map((row) => row.settings_id).filter((id) => !settingsById.has(id)))
		];
		if (unknownVersionIds.length > 0) {
			const settings = yield* options.api.db.jurisdiction_settings.findMany({
				where: { id: { in: unknownVersionIds }, ...approved },
				limit: PAGE_LIMIT
			});
			options.api.reads.assertComplete(settings, 'source catalogue settings');
			for (const row of settings) settingsById.set(row.id, row);
		}
		const byId = new Map(components.map((row) => [row.id, row]));
		for (const request of requests) {
			const component = byId.get(request.catalogue_id);
			const version = component == null ? undefined : settingsById.get(component.settings_id);
			if (
				component == null ||
				component.family !== request.family ||
				version == null ||
				version.code !== options.configuration.company.settings_code ||
				version.sealed_at == null ||
				version.voided_at != null
			)
				refuse(
					`A ${request.family} input must reference an approved catalogue in a sealed version of this entity's settings.`
				);
			if (version.payroll.currency !== options.configuration.jurisdiction.payroll.currency)
				refuse(`A ${request.family} input's source currency differs from this payroll's currency.`);
		}
		return byId;
	});
}

/**
 * What earlier PAID runs already took from each entry, keyed by entry id. A captured zero means the
 * entry was read and paid nothing, rather than leaving historical usage unknown.
 */
export function prepareMoneyConsumption(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly payslipIds: readonly string[];
}) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const priorPayslipIds = [...options.payslipIds];
		const consumedEntries = new Map<string, number>();
		const [claims, allowances, payments, payslips] = yield* Effect.all(
			[
				db.claim_requests.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { id: true },
					limit: PAGE_LIMIT
				}),
				db.allowance_requests.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { id: true, derived_from_id: true },
					limit: PAGE_LIMIT
				}),
				db.payment_requests.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { id: true },
					limit: PAGE_LIMIT
				}),
				db.payslips.findMany({
					where: { id: { in: priorPayslipIds } },
					columns: { id: true, adjustments: true },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claims, 'prior claim captures');
		options.api.reads.assertComplete(allowances, 'prior allowance captures');
		options.api.reads.assertComplete(payments, 'prior payment captures');
		options.api.reads.assertComplete(payslips, 'prior payslips');
		for (const row of claims) consumedEntries.set(row.id, 0);
		for (const row of allowances) consumedEntries.set(row.derived_from_id ?? row.id, 0);
		for (const row of payments) consumedEntries.set(row.id, 0);
		for (const payslip of payslips)
			for (const row of payslip.adjustments) {
				if (!(PAY_REQUEST_FAMILIES as readonly string[]).includes(row.family)) continue;
				consumedEntries.set(
					row.source_id,
					(consumedEntries.get(row.source_id) ?? 0) + decodeNumber(row.amount ?? 0)
				);
			}
		return consumedEntries;
	});
}

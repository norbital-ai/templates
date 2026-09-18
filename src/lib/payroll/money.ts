/** Normalized money inputs supplied by Claim and Allowance. */
import type { CollectionPayload } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { CatalogueBand } from '../../datatypes/catalogue_band/+definition.js';
import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import { requiredDateKey, type IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import { defaultPayPeriod, type PayCadence } from '../../collections/payroll_runs/lib/period.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { expressionEngine, evaluateBoolean, evaluateNumber } from '../expressions/evaluate.js';
import {
	isEligible,
	personContext,
	type PersonContext
} from '../../collections/payroll_runs/lib/eligibility.js';
import {
	entryLimitRefusal,
	resolveEntryLimit,
	type LimitSibling
} from '../../collections/payroll_runs/lib/entry-cap.js';
import { prorationSegment } from '../../collections/payroll_runs/lib/proration.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import {
	intersectDays,
	monthBounds,
	monthDays,
	monthKey,
	shiftPeriod
} from '../../collections/payroll_runs/lib/dates.js';
import { stint } from '../employment-contract.js';
import { payRequestTerms } from '../component_entry_cap_subject.js';
import type { PayslipAdjustment } from '../../datatypes/payslip_adjustments/+definition.js';
import { settlementBucket } from './family.js';
import type {
	Measurement,
	MeasureComponentOptions,
	FamilyStep,
	PayRange,
	YearContext
} from './family.js';
import {
	PAGE_LIMIT,
	type PayrollReadApi,
	type ReadLog
} from '../../collections/payroll_runs/lib/api.js';

type ClaimRequest =
	import('../../collections/payroll_runs/$types.js').WorkspaceRow<'claim_requests'>;
type Allowance = import('../../collections/payroll_runs/$types.js').WorkspaceRow<'allowances'>;

/** Which collection a request came from. The engine names it in refusals and in provenance. */
export const PAY_REQUEST_FAMILIES = ['CLAIM', 'ALLOWANCE'] as const;
export type PayRequestFamily = (typeof PAY_REQUEST_FAMILIES)[number];

/** The window a standing allowance is in force across; `end` null is open-ended. */
type RequestWindow = { readonly start: IsoDate; readonly end: IsoDate | null };

/**
 * One pay request as the run reads it: a claim as itself, a standing allowance as the one entry
 * this run will price and create. Every derived answer is settled by the builder that made it, so
 * nothing downstream re-derives economics from storage shape.
 */
export type PayRequest = {
	/** A claim's own row id; an allowance's is the id of the entry the run creates under the slip. */
	readonly id: string;
	readonly family: PayRequestFamily;
	/** What the payslip adjustment names and what a ceiling counts: the claim, or the allowance. */
	readonly source_id: string;
	readonly employment_id: string;
	readonly catalogue_id: string;
	/** A positive magnitude, exactly as stored; a monthly amount for an allowance. */
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
	/** A standing allowance's own window, which prorates it beside the employment; null for a claim. */
	readonly window: RequestWindow | null;
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
};

/** A claim's economics belong to the day the expense was incurred, not the day it was entered. */
export const claimRequest = (row: ClaimRequest): PayRequest => ({
	id: row.id,
	family: 'CLAIM',
	source_id: row.id,
	employment_id: row.employment_id,
	catalogue_id: row.catalogue_id,
	amount: row.amount,
	approval_id: row.approval_id ?? null,
	pay_period: row.pay_period ?? null,
	event_date: requiredDateKey(row.incurred_on, 'claim incurred date'),
	// The catalogue says which way this settles; the tick says settle it the other way.
	sign: row.as_adjustment_entry === true ? -1 : 1,
	window: null,
	captured: row.payslip_id != null
});

/**
 * A standing allowance as one period's entry: the amount is the month's, the window is the
 * allowance's own, and the id is the entry the run creates under the payslip that prices it.
 */
export const allowanceEntryRequest = (row: Allowance): PayRequest => {
	const start = requiredDateKey(row.effective_from, 'allowance start');
	return {
		id: crypto.randomUUID(),
		family: 'ALLOWANCE',
		source_id: row.id,
		employment_id: row.employment_id,
		catalogue_id: row.catalogue_id,
		amount: row.amount,
		approval_id: row.approval_id ?? null,
		pay_period: null,
		event_date: start,
		sign: row.as_adjustment_entry === true ? -1 : 1,
		window: {
			start,
			end: row.effective_to == null ? null : requiredDateKey(row.effective_to, 'allowance end')
		},
		captured: false
	};
};

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
	const window = request.window;
	if (window != null)
		return window.start <= salary.end && (window.end == null || window.end >= salary.start);
	// Every claim is dated, so the cutoff rule places it on its incurred date. Anything already
	// due is picked up by this run rather than lost.
	return requestPayPeriod(request, cutoffDay, cadence) <= period;
}

/**
 * The `entry` CEL context, as values.
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
	/** The employment's days of the pay month on the proration basis, and the month's calendar days. */
	readonly daysEmployed: number;
	readonly daysInMonth: number;
	readonly ordinaryDay: number;
	readonly ordinaryHour: number;
	readonly limits: Readonly<Record<string, number>>;
	readonly captures: { readonly paidToDate: number; readonly remaining: number };
	readonly year?: () => YearContext;
}): Record<string, unknown> {
	const { entry } = options;
	const year = options.year?.();
	return {
		person: options.subject,
		entry: {
			amount: Math.abs(decodeNumber(entry.amount)),
			days: 0,
			hours: 0,
			quantity: 0,
			event_date: entry.event_date,
			period: options.period,
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
			index: 1,
			instalments: options.instalments,
			last_of_year: year?.last_of_year ?? false,
			days_employed: options.daysEmployed,
			days_in_month: options.daysInMonth
		},
		year:
			year == null
				? { start: '', end: '', months_employed: 0, days_employed: 0, earned: {} }
				: {
						start: year.start,
						end: year.end,
						months_employed: year.months_employed,
						days_employed: year.days_employed,
						earned: year.earned
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

/** The proration facts of one allowance entry, as the payslip stores them beside the money. */
type AllowanceProration = {
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly basis: NonNullable<Configuration['work']['proration']>;
	readonly days: number;
	readonly denominator: number;
	readonly unpaid_days: number;
};

/**
 * How much of the period a standing allowance earns, on the same basis as basic salary.
 *
 * The covered span is the allowance's window ∩ the employment's own days of the period, so a
 * joiner, a leaver, an allowance that opens or closes mid-period all prorate everywhere. Unpaid
 * leave comes off it only where the jurisdiction says so (`payroll.allowance_npl_prorates`): the
 * Philippines' "no work, no pay" reaches the allowance; Singapore, Malaysia, Taiwan, Indonesia and
 * Vietnam leave a fixed allowance whole. `null` is a span that never touches the period.
 */
function allowanceProration(options: {
	readonly window: RequestWindow;
	readonly employed: PayRange;
	readonly salary: PayRange;
	readonly configuration: Configuration;
	readonly person: PersonContext;
	readonly workingDaysIn: (window: PayRange) => number;
	readonly instalments: number;
	readonly unpaidDaysIn: (window: PayRange) => number;
}): AllowanceProration | null {
	const covered = intersectDays(
		{ start: options.window.start, end: options.window.end ?? options.salary.end },
		options.employed
	);
	const segment = prorationSegment({
		work: options.configuration.work,
		person: options.person,
		period: options.salary,
		covered,
		workingDaysIn: options.workingDaysIn,
		instalments: options.instalments
	});
	if (segment == null) return null;
	const unpaid = options.configuration.jurisdiction.payroll.allowance_npl_prorates
		? options.unpaidDaysIn({ start: segment.from, end: segment.to })
		: 0;
	return {
		from: segment.from,
		to: segment.to,
		basis: segment.basis,
		days: Math.max(0, segment.days - unpaid),
		denominator: segment.denominator,
		unpaid_days: unpaid
	};
}

/**
 * One entry as MEASURE prices it. The catalogue's bands decide the amount, the limit and the
 * opt-ins; with no bands the entry's own amount stands unchanged. An allowance entry is prorated
 * first and carries its proration out with the measurement, for the row the run creates.
 */
function measureMoneyEntry(options: MeasureComponentOptions): Measurement | null {
	const definition = options.component.definition;
	if (definition.source !== 'ENTRY')
		throw new Error(
			`A ${options.component.family} request must have an ENTRY catalogue definition.`
		);
	if (options.entry == null) return null;
	const bucket = settlementBucket(options.component.destination, options.component.direction);
	const prorationOf = (
		source: PreparedPayRequest,
		person: PersonContext
	): AllowanceProration | null =>
		source.window == null
			? null
			: allowanceProration({
					window: source.window,
					employed: options.employed,
					salary: options.salary,
					configuration: options.configuration,
					person,
					workingDaysIn: options.workingDaysIn,
					instalments: options.instalments,
					unpaidDaysIn: options.unpaidDaysIn
				});
	const fractionOf = (proration: AllowanceProration | null): number =>
		proration == null ? 0 : proration.denominator <= 0 ? 0 : proration.days / proration.denominator;
	const currency = options.configuration.jurisdiction.payroll.currency;

	const measureEntry = (entry: PreparedPayRequest): Measurement | null => {
		const subjectOn = (source: PayRequest): PersonContext =>
			personContext({
				employee: options.bundle.employee,
				employment: stint(options.bundle.employment),
				fixedAllowances: fixedAllowancesOn(options.bundle.payRequests, source.event_date),
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
				collection: entry.family === 'CLAIM' ? 'claim_requests' : 'allowances',
				recordId: entry.source_id
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
			year: options.year,
			period: options.period,
			periodStart: options.salary.start,
			periodEnd: options.salary.end,
			instalments: options.instalments,
			daysEmployed:
				prorationSegment({
					work: options.configuration.work,
					person: subject,
					period: options.salary,
					covered: options.employed,
					workingDaysIn: options.workingDaysIn,
					instalments: options.instalments
				})?.days ?? 0,
			daysInMonth: monthDays(options.salary.start),
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
		const proration = prorationOf(entry, subject);
		// A claim is never prorated; an allowance whose window and employment cover none of the
		// period is not an entry at all — the source is silent rather than captured at nothing.
		if (entry.window != null && proration == null) return null;
		const fraction = entry.window == null ? 1 : fractionOf(proration);
		if (fraction <= 0 && entry.window != null)
			return skipped('unpaid leave covered every day of the period the allowance was in force');
		const raw = band == null ? decodeNumber(entry.amount) : bandAmount(band, context);
		const reimbursable = cents(raw * fraction, currency);
		let payable = reimbursable;
		if (band?.limit != null) {
			const limitAmount = evaluateNumber(expressionEngine, band.limit.amount, context);
			// The ceiling spans catalogue revisions of one code: a request agreed under an earlier
			// revision still consumes it. Compare by code, not id, for the same reason the transform's
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
								event_date: candidate.window == null ? candidate.event_date : options.salary.start,
								// A sibling is valued the way the run will price it: an allowance by this
								// period's proration, a claim by its amount.
								amount:
									candidate.sign *
									cents(
										decodeNumber(candidate.amount) *
											(candidate.window == null
												? 1
												: fractionOf(prorationOf(candidate, subjectOn(candidate)))),
										currency
									)
							}
						];
					// Each period a standing allowance paid is its own use of the ceiling, dated in the
					// period it occurred; a claim's capture keeps the claim's own event date.
					return candidate.captures.map((capture) => ({
						id: candidate.window == null ? candidate.id : `${candidate.source_id}:${capture.id}`,
						employment_id: candidate.employment_id,
						event_date:
							candidate.window != null && capture.period !== ''
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
				eventDate: entry.window == null ? entry.event_date : options.salary.start,
				siblings
			});
			if (resolved == null) throw new Error('A stated limit must resolve against its siblings.');
			// A standing allowance is bounded per period: it pays what the ceiling has left rather
			// than stopping the whole run, so the next period continues from the remainder.
			if (entry.window != null && sign > 0 && band.limit.on_exceed === 'BLOCK')
				payable = Math.min(
					reimbursable,
					Math.max(0, cents(limitAmount - resolved.exceededBy, currency))
				);
			const refusal = entryLimitRefusal({
				limit: band.limit,
				resolved,
				componentCode: options.component.code,
				subject: String(options.bundle.employment.employee_number),
				proposed: sign * payable
			});
			if (refusal !== null) throw new Error(refusal);
		}
		const amount = cents(sign * payable, currency);
		return {
			amount,
			base: [],
			proration: [],
			adjustments: [
				{
					// The adjustment names the standing source an allowance entry repeats, which is what
					// the capture and its ceiling key on; a claim names itself.
					input: { family: entry.family, id: entry.source_id },
					catalogueComponent: options.component,
					bucket,
					label: options.component.code,
					amount,
					quantity: null,
					rate: null,
					statutoryRuleKey: null
				}
			],
			...(proration == null
				? {}
				: {
						allowanceEntry: {
							id: entry.id,
							sourceId: entry.source_id,
							collection: 'allowance_entries' as const,
							values: {
								derived_from_id: entry.source_id,
								employment_id: entry.employment_id,
								catalogue_id: entry.catalogue_id,
								...proration,
								contract_amount: decodeNumber(entry.amount),
								amount
							}
						}
					})
		};
	};

	return measureEntry(options.entry);
}

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
		const [claims, allowances] = yield* Effect.all(
			[
				options.api.db.claim_catalogue.findMany({ where, limit: PAGE_LIMIT }),
				options.api.db.allowance_catalogue.findMany({ where, limit: PAGE_LIMIT })
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claims, 'claim catalogue');
		options.api.reads.assertComplete(allowances, 'allowance catalogue');
		const components: CatalogueComponent[] = [
			...claims.map((row) => ({ ...row, family: 'CLAIM' as const, definition: entryOf() })),
			...allowances.map((row) => ({
				...row,
				family: 'ALLOWANCE' as const,
				definition: entryOf()
			}))
		] as unknown as CatalogueComponent[];
		return components;
	});
}

/** The stored row lifted into the engine's `ENTRY` arm: the bands are the definition. */
const entryOf = () => ({ source: 'ENTRY' }) as const;

/** A source-to-payslip link: which family source settled on which payslip, and in which period. */
type PayRequestCaptureLink = {
	readonly family: PayRequestFamily;
	readonly payslipId: string;
	readonly period: string;
	readonly sourceId: string;
};

/**
 * Sum what each payslip actually settled per source, keyed by source id. The write-time guard and
 * the engine share this arithmetic so a captured zero means the same thing on both. An allowance
 * entry's adjustment names its standing source, so both link to the same key.
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
	sourceIds: readonly string[]
): Effect.Effect<readonly PayRequestCaptureLink[]> {
	return Effect.gen(function* () {
		if (sourceIds.length === 0) return [];
		if (family === 'CLAIM') {
			const rows = yield* api.db.claim_requests.findMany({
				where: { id: { in: [...sourceIds] }, payslip_id: { isNull: false } },
				columns: { id: true, payslip_id: true },
				limit: PAGE_LIMIT
			});
			return rows.map((row): PayRequestCaptureLink => ({
				family,
				payslipId: row.payslip_id!,
				period: '',
				sourceId: row.id
			}));
		}
		const rows = yield* api.db.allowance_entries.findMany({
			where: { derived_from_id: { in: [...sourceIds] } },
			columns: { id: true, payslip_id: true, derived_from_id: true, from: true },
			limit: PAGE_LIMIT
		});
		return rows.map((row): PayRequestCaptureLink => ({
			family,
			payslipId: row.payslip_id,
			// The period the entry paid for names the month its cap usage belongs to.
			period: monthKey(requiredDateKey(row.from, 'allowance entry start')),
			sourceId: row.derived_from_id
		}));
	});
}

/** Standing captures exclude single-use requests, including signed corrections, from later runs. */
function requestCaptures(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly requests: readonly PayRequest[];
}): Effect.Effect<ReadonlyMap<string, readonly PayRequestCapture[]>, never, never> {
	return Effect.gen(function* () {
		const captures = new Map<string, PayRequestCapture[]>();
		if (options.requests.length === 0) return captures;
		const idsOf = (family: PayRequestFamily) => [
			...new Set(
				options.requests
					.filter((request) => request.family === family)
					.map((request) => request.source_id)
			)
		];
		const links = [
			...(yield* captureLinksOf('CLAIM', options.api, idsOf('CLAIM'))),
			...(yield* captureLinksOf('ALLOWANCE', options.api, idsOf('ALLOWANCE')))
		];
		if (links.length === 0) return captures;
		const payslips = yield* options.api.db.payslips.findMany({
			where: { id: { in: [...new Set(links.map((row) => row.payslipId))] } },
			columns: { id: true, adjustments: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(payslips, 'captured pay-request outputs');
		const bySource = captureAmounts(links, payslips);
		// An allowance entry carries its source's capture history, so its cap usage is read from the
		// standing allowance it repeats.
		for (const request of options.requests)
			captures.set(request.id, [...(bySource.get(request.source_id) ?? [])]);
		return captures;
	});
}

type MoneyPreparationOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly employmentIds: readonly string[];
	readonly period: string;
	/** The salary window this run settles; an allowance in force inside it is an entry. */
	readonly periodWindow: { readonly start: string; readonly end: string };
};

/**
 * Build the requests the run prices: every unpinned approved claim of these people, and one entry
 * per standing allowance in force in the window. The entry is created with the run under the
 * payslip that priced it and deleted with that payslip, so the source is due again next period.
 */
export function prepareMoneyInputs(options: MoneyPreparationOptions) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const approved = { approval_id: { isNull: true } } as const;
		const [claimRows, allowanceRows] = yield* Effect.all(
			[
				db.claim_requests.findMany({
					where: {
						employment_id: { in: [...options.employmentIds] },
						...approved,
						payslip_id: { isNull: true }
					},
					limit: PAGE_LIMIT
				}),
				db.allowances.findMany({
					where: {
						employment_id: { in: [...options.employmentIds] },
						...approved,
						effective_from: { lte: options.periodWindow.end }
					},
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claimRows, 'claim requests');
		options.api.reads.assertComplete(allowanceRows, 'allowances');
		// One month back as well as this one: a deferred joining period is measured against the
		// previous month, and the standing allowances in force then are part of what it owes.
		const earliest = monthBounds(shiftPeriod(monthKey(options.periodWindow.start), -1)).start;
		const requests: readonly PayRequest[] = [
			...claimRows.map(claimRequest),
			...allowanceRows
				.filter(
					(row) =>
						row.effective_to == null ||
						requiredDateKey(row.effective_to, 'allowance end') >= earliest
				)
				.map(allowanceEntryRequest)
		];
		const capturesByRequest = yield* requestCaptures({ api: options.api, requests });
		const requestCatalogues = yield* prepareRequestCatalogues(options, requests);
		const requestsByEmployment = Map.groupBy(
			requests.map((request): PreparedPayRequest => ({
				...request,
				captures: capturesByRequest.get(request.id) ?? [],
				catalogueComponent: requestCatalogues.get(request.catalogue_id)!
			})),
			(row) => row.employment_id
		);
		return { requestsByEmployment };
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
		const [claims, allowances] = yield* Effect.all(
			[
				options.api.db.claim_catalogue.findMany({
					where: { id: { in: idsOf('CLAIM') }, ...approved },
					limit: PAGE_LIMIT
				}),
				options.api.db.allowance_catalogue.findMany({
					where: { id: { in: idsOf('ALLOWANCE') }, ...approved },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claims, 'source Claim catalogue');
		options.api.reads.assertComplete(allowances, 'source Allowance catalogue');
		const components = [
			...claims.map((row) => ({ ...row, family: 'CLAIM' as const, definition: entryOf() })),
			...allowances.map((row) => ({
				...row,
				family: 'ALLOWANCE' as const,
				definition: entryOf()
			}))
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
 * What earlier PAID runs already took from each entry, keyed by source id. A captured zero means
 * the entry was read and paid nothing, rather than leaving historical usage unknown.
 */
export function prepareMoneyConsumption(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly payslipIds: readonly string[];
}) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const priorPayslipIds = [...options.payslipIds];
		const consumedEntries = new Map<string, number>();
		const [claims, entries, payslips] = yield* Effect.all(
			[
				db.claim_requests.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { id: true },
					limit: PAGE_LIMIT
				}),
				db.allowance_entries.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { id: true, derived_from_id: true },
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
		options.api.reads.assertComplete(entries, 'prior allowance entries');
		options.api.reads.assertComplete(payslips, 'prior payslips');
		for (const row of claims) consumedEntries.set(row.id, 0);
		for (const row of entries) consumedEntries.set(row.derived_from_id, 0);
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

/**
 * The standing PAY allowances in force for one employment on a day, summed: what a statute means by
 * "one month's wage" when it names the fixed allowances (ID THR and pesangon, Permenaker 6/2016
 * art. 3(2): upah pokok + tunjangan tetap). A deduction is not wage, and neither is an allowance
 * whose window is confined to one pay month — a one-month reimbursement keyed as an allowance is
 * paid once, not "regularly and irrespective of attendance" (SE-07/MEN/1990 §I(2)(b)), so it does
 * not carry into the month's wage a THR is a multiple of.
 */
export function fixedAllowancesOn(requests: readonly PreparedPayRequest[], asOf: IsoDate): number {
	const month = monthBounds(monthKey(asOf));
	return requests
		.filter(
			(request) =>
				request.family === 'ALLOWANCE' &&
				request.sign === 1 &&
				request.window != null &&
				request.window.start <= asOf &&
				(request.window.end == null || asOf <= request.window.end) &&
				// Standing: the window reaches beyond the pay month the day sits in.
				(request.window.start < month.start ||
					request.window.end == null ||
					request.window.end > month.end) &&
				request.catalogueComponent.destination === 'PAY' &&
				request.catalogueComponent.direction === 'ADD'
		)
		.reduce((sum, request) => sum + Math.abs(decodeNumber(request.amount)), 0);
}

/**
 * One allowance entry the run materialised, ready to create under its payslip.
 *
 * `id` is the engine's own identity for the entry and the stored row's id; the payslip adjustment
 * names the standing `sourceId` it repeats, which is what the capture and its ceiling key on.
 */
export type MaterialisedMoney = {
	readonly id: string;
	readonly sourceId: string;
	/** The table the run creates the row in when the payslip is written. */
	readonly collection: 'allowance_entries';
	/** The row as the payslip's nested `create` submits it; the pin is the parent's to fill. */
	readonly values: Omit<CollectionPayload<WorkspaceSchema, 'allowance_entries'>, 'payslip_id'>;
};

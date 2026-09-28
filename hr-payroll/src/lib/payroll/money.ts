/** Normalized money inputs supplied by Claim and Ad hoc. */
import type { WorkspaceRow } from '../rows.js';
import type { CatalogueBand } from '../datatypes/catalogue_band.js';
import type { CatalogueComponent, Configuration } from '../../lib/payroll/run/configuration.js';
import { inclusiveDays, requiredDateKey, type IsoDate } from '../../lib/payroll/run/dates.js';
import { contractAllowancesOn } from './contract-allowances.js';
import { configuredMonthlyWageAverage } from './contribution.js';
import { defaultPayPeriod, type PayCadence } from '../../lib/payroll/run/period.js';
import { decodeNumber } from '../wire.js';
import { placeWage } from '../datatypes/wages.js';
import { refuse } from '../refuse.js';
import {
	evaluateBoolean,
	evaluateNumber,
	runtimeExpressionEngine,
	type ExpressionEngine
} from '../expressions/evaluate.js';
import {
	isEligible,
	personContext,
	type PersonContext
} from '../../lib/payroll/run/eligibility.js';
import {
	entryLimitRefusal,
	resolveEntryLimit,
	type LimitSibling
} from '../../lib/payroll/run/entry-cap.js';
import { prorationSegment } from '../../lib/payroll/run/proration.js';
import { factStatusesOn, personFacts } from './facts.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { exitFactsMissing, resolveCompanyFacts, resolveExitFacts } from '../declared-facts.js';
import { cents } from '../../lib/payroll/run/rounding.js';
import {
	intersectDays,
	monthBounds,
	monthDays,
	monthKey,
	shiftPeriod
} from '../../lib/payroll/run/dates.js';
import { stint } from '../employment-contract.js';
import { activeTimeOff } from '../leave/activity.js';
import { dateKey } from '../iso-day.js';
import { payRequestTerms } from '../component_entry_cap_subject.js';
import type { PayslipAdjustment } from '../datatypes/payslip_adjustments.js';
import { oppositeBucket, settlementBucket } from './family.js';
import type {
	Measurement,
	MeasureComponentOptions,
	FamilyStep,
	PayRange,
	YearContext
} from './family.js';
import type { PayrollWorld } from './world.js';
import { live } from './run/effective.js';
import * as Predicate from 'effect/Predicate';
import { getErrorMessage } from '../refuse.js';

type ClaimRequest = WorkspaceRow<'claim_requests'>;
type AdhocRequest = WorkspaceRow<'adhoc_requests'>;

/** Which collection a request came from. The engine names it in refusals and in provenance. */
export const PAY_REQUEST_FAMILIES = ['CLAIM', 'ADHOC'] as const;
export type PayRequestFamily = (typeof PAY_REQUEST_FAMILIES)[number];

/**
 * One pay request as the run reads it: a claim or an ad hoc request, as itself. Every derived
 * answer is settled by the builder that made it, so nothing downstream re-derives economics from
 * storage shape.
 */
export type PayRequest = {
	readonly id: string;
	readonly family: PayRequestFamily;
	/** What the payslip adjustment names and what a ceiling counts: the request's own row. */
	readonly source_id: string;
	readonly employment_id: string;
	readonly catalogue_id: string;
	/** A positive magnitude, exactly as stored. */
	readonly amount: unknown;
	readonly approval_id: string | null;
	readonly pay_period: string | null;
	/** The day this request's economics belong to. */
	readonly event_date: IsoDate;
	readonly evidence_file?: ClaimRequest['evidence_file'] | null | undefined;
	readonly incurred_on?: string | null | undefined;
	readonly medical_reimbursement?: ClaimRequest['medical_reimbursement'] | null | undefined;
	readonly late_wage?: AdhocRequest['late_wage'] | null | undefined;
	/**
	 * `+1` to settle the way its catalogue declares, `−1` to settle the opposite way.
	 *
	 * `−1` is what `as_adjustment_entry` means, and it is available to every family: clawing back a
	 * transport claim is a transport claim entry with the tick set, under the same catalogue and on
	 * the same payslip line as the one it corrects.
	 */
	readonly sign: number;
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

/** A claim belongs to its expense day unless a dated reimbursement becomes payable later. */
export const claimRequest = (row: ClaimRequest): PayRequest => {
	if (row.medical_reimbursement != null && row.pay_period != null && row.pay_period !== '')
		refuse('A treatment reimbursement settles from its due date; do not override its pay period.');
	return {
		id: row.id,
		family: 'CLAIM',
		source_id: row.id,
		employment_id: row.employment_id,
		catalogue_id: row.catalogue_id,
		amount: row.amount,
		approval_id: row.approval_id ?? null,
		pay_period: row.pay_period ?? null,
		event_date: requiredDateKey(
			row.medical_reimbursement?.due_on ?? row.incurred_on,
			row.medical_reimbursement == null ? 'claim incurred date' : 'reimbursement due date'
		),
		medical_reimbursement: row.medical_reimbursement,
		evidence_file: row.evidence_file,
		incurred_on: row.incurred_on,
		// The catalogue says which way this settles; the tick says settle it the other way.
		sign: row.as_adjustment_entry === true ? -1 : 1,
		captured: row.payslip_id != null
	};
};

/** An ad hoc request's economics belong to the day it is for; it is due whole, never prorated. */
const adhocRequest = (row: AdhocRequest): PayRequest => ({
	id: row.id,
	family: 'ADHOC',
	source_id: row.id,
	employment_id: row.employment_id,
	catalogue_id: row.catalogue_id,
	amount: row.amount,
	approval_id: row.approval_id ?? null,
	pay_period: row.pay_period ?? null,
	event_date: requiredDateKey(row.event_date, 'ad hoc event date'),
	evidence_file: row.evidence_file,
	late_wage: row.late_wage,
	sign: row.as_adjustment_entry === true ? -1 : 1,
	captured: row.payslip_id != null
});

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

/** Late approvals settle once in the next regular period. */
export function requestIsDue(
	request: PayRequest,
	period: string,
	salary: { readonly start: string; readonly end: string },
	cutoffDay: number,
	cadence: PayCadence
): boolean {
	if (request.approval_id != null || request.captured) return false;
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
/** A published day of the entity that is some religion's own holiday. */
export type ReligiousHoliday = { readonly date: string; readonly religion: string };

export function entryContext(options: {
	/** What the context reads of the entry: its magnitude and its day. */
	readonly entry: Pick<
		PayRequest,
		'amount' | 'event_date' | 'incurred_on' | 'medical_reimbursement' | 'late_wage'
	>;
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
	readonly year?: (() => YearContext) | undefined;
	/** The entity's published days that name a religion (`jurisdiction_holidays.religion`). */
	readonly religiousHolidays?: readonly ReligiousHoliday[] | undefined;
}): Record<string, unknown> {
	const { entry } = options;
	const year = options.year?.();
	const medical = entry.medical_reimbursement;
	const late = entry.late_wage;
	const religion = options.subject.employee.religion;
	const religiousHolidays =
		religion === ''
			? 0
			: (options.religiousHolidays ?? []).filter(
					(row) =>
						row.date.slice(0, 4) === entry.event_date.slice(0, 4) &&
						row.religion.split(',').some((named) => named.trim().toUpperCase() === religion)
				).length;
	return {
		person: options.subject,
		entry: {
			amount: Math.abs(decodeNumber(entry.amount)),
			days: 0,
			hours: 0,
			quantity: 0,
			event_date: entry.event_date,
			period: options.period,
			religious_holidays: religiousHolidays,
			medical: {
				incurred_on: entry.incurred_on ?? '',
				due_on: medical?.due_on ?? '',
				amount_incurred: medical?.amount_incurred ?? 0,
				patient: medical?.patient ?? '',
				relationship_from: medical?.relationship_from ?? '',
				relationship_through: medical?.relationship_through ?? '',
				relationship_recognised: medical?.relationship_recognised ?? false,
				treatment: medical?.treatment ?? '',
				treatment_received: medical?.treatment_received ?? false,
				treatment_necessary: medical?.treatment_necessary ?? false,
				solely_aesthetic: medical?.solely_aesthetic ?? false,
				practitioner_qualified: medical?.practitioner_qualified ?? false
			},
			late_wage: {
				due_on: late?.due_on ?? '',
				paid_on: late?.paid_on ?? '',
				days: late == null ? 0 : inclusiveDays(late.due_on, late.paid_on) - 1,
				deposit_rate: late?.deposit_rate ?? 0,
				force_majeure: late?.force_majeure ?? false
			},
			captures: {
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
		// `leave.days(code)`: the salary window's charged days, the same map `person.period.leave_days` reads.
		leave: { charged: options.subject.period.leave_days }
	};
}

/** The band that governs this entry: the first whose `when` holds, or null when none does. */
function selectBand(
	bands: readonly CatalogueBand[],
	context: Record<string, unknown>,
	engine: ExpressionEngine
): CatalogueBand | null {
	if (bands.length === 0) return null;
	for (const band of bands) {
		if (band.when.trim() === '') return band;
		try {
			if (evaluateBoolean(engine, band.when, context)) return band;
		} catch (error) {
			throw new Error(`A catalogue band condition did not evaluate: ${getErrorMessage(error)}`);
		}
	}
	return null;
}

/** The governing band's amount over the context, or null where no band governs. */
export function priceBand(
	bands: readonly CatalogueBand[],
	context: Record<string, unknown>,
	engine: ExpressionEngine
): number | null {
	const band = selectBand(bands, context, engine);
	return band == null ? null : bandAmount(band, context, engine);
}

/** The band's amount: its money expression evaluated over the entry context. */
function bandAmount(
	band: CatalogueBand,
	context: Record<string, unknown>,
	engine: ExpressionEngine
): number {
	return evaluateNumber(engine, band.amount, context);
}

/**
 * One entry as MEASURE prices it. The catalogue's bands decide the amount and the limit; with no
 * bands the entry's own amount stands unchanged. A request is due whole: nothing here prorates.
 */
function measureMoneyEntry(options: MeasureComponentOptions): Measurement | null {
	const definition = options.component.definition;
	if (definition.source !== 'ENTRY')
		throw new Error(
			`A ${options.component.family} request must have an ENTRY catalogue definition.`
		);
	if (options.entry == null) return null;
	const bucket = settlementBucket(options.component.destination, options.component.direction);
	const currency = options.configuration.jurisdiction.payroll.currency;

	// The entry site's engine: a band can read the version's minimum wage for a region (PH de
	// minimis on the statutory minimum, VN's twenty-times-the-minimum unemployment ceiling).
	const engine = runtimeExpressionEngine({
		minimumWage: (region) =>
			placeWage(options.configuration.jurisdiction.work_rules.wages?.by_region ?? {}, region) ?? 0
	});
	const measureEntry = (entry: PreparedPayRequest): Measurement | null => {
		// Evidence is held where a request is written (pay_request_rules, the one write surface). The run
		// asks again only where the law prices it: a medical reimbursement's statutory treatment rests on
		// the receipt. A plain company claim's paperwork never refuses a whole entity's run.
		if (
			options.component.evidence === 'REQUIRED' &&
			entry.evidence_file == null &&
			entry.medical_reimbursement != null
		)
			refuse(`${options.component.code} requires a receipt or other evidence.`);
		// Only a class whose own rules read departure inputs owes them: ID's THR is classed for
		// off-boarding but prices a festival wage, not a termination benefit.
		const expressions = [
			options.component.eligibility,
			...options.component.bands.flatMap((band) => [
				band.when ?? '',
				band.amount ?? '',
				Predicate.isString(band.limit) ? band.limit : ''
			])
		];
		const readsExitFacts = expressions.some((expression) =>
			expression.includes('employment.exit_facts')
		);
		const readsSeparationAverage = expressions.some((expression) =>
			expression.includes('monthly_wage_6m_average')
		);
		/** The person the entry is priced for, or the departure declaration it lacks. */
		const subjectOn = (source: PayRequest): PersonContext | string => {
			// The recorded departure inputs, undefaulted: requiredness is judged on these.
			const employment = stint(options.bundle.employment, []);
			// A separation-classed row raised while the contract still runs — ID's THR for an
			// active employee — is an ordinary payment on its event date, not a final obligation.
			// A fixed-term contract states its end from the first day, so the contract has only
			// ended once that day falls inside this run's window.
			// Manual requests can also price a departure obligation (e.g. evidenced notice
			// recovery). Reading exit facts fixes their rules and person at the final service day;
			// the way the request was raised must not bypass required departure declarations.
			const separation =
				(readsExitFacts ||
					('raised_by' in options.component && options.component.raised_by === 'SEPARATION')) &&
				employment.exit_date != null &&
				employment.exit_date <= options.salary.end;
			const asOf = separation ? employment.exit_date! : source.event_date;
			const version = separation
				? settingsInForce(
						options.configuration.lineageVersions,
						options.configuration.company.settings_code,
						asOf
					)
				: options.configuration.jurisdiction;
			if (version == null) refuse(`No sealed settings govern the final service day ${asOf}.`);
			if (separation && version.id !== options.component.settings_id)
				refuse(
					'A separation payment must use the catalogue version governing the final service day.'
				);
			const company = separation
				? {
						...options.configuration.company,
						facts: resolveCompanyFacts(
							version.facts ?? [],
							{
								...options.configuration.company,
								facts: options.configuration.recordedCompanyFacts
							},
							{
								asOf,
								revisions: options.configuration.companyFactRevisions
							}
						)
					}
				: options.configuration.company;
			const subject = personContext({
				employee: options.bundle.employee,
				employment: stint(options.bundle.employment, version.exit_facts ?? []),
				fixedAllowances: contractAllowancesOn(options.bundle, options.configuration, asOf),
				monthlyWage6mAverage: readsSeparationAverage
					? configuredMonthlyWageAverage(options.bundle, options.configuration, asOf, version)
					: null,
				earnings: options.earnedByMonth ?? null,
				// The approved time off, as calendar spans: 施行細則 §2's periods and MY s.60E(3B)'s days.
				leaveSpans: activeTimeOff(options.bundle.leave.entries).map((row) => ({
					code: row.leave_code,
					from: dateKey(row.from_date),
					to: dateKey(row.to_date)
				})),
				terms: payRequestTerms(options.bundle.termsHistory, options.bundle.employment, asOf),
				children: options.bundle.children,
				company,
				period: { ...options.subject.period, ...options.leavePeriod?.() },
				facts: personFacts(
					options.configuration.contributions,
					factStatusesOn(
						options.bundle.statutoryFacts,
						asOf,
						options.bundle.employment.id,
						options.configuration.contributions
					)
				),
				asOf
			});
			if (!(separation && readsExitFacts)) return subject;
			// The declared cause decides a separation amount (ID PP 35/2021 arts.40–57): a leaver
			// whose departure is recorded without it cannot be priced for this class, which is
			// skipped by name, not a reason to stop everyone else's pay. A stated value that is
			// invalid still refuses.
			const missing = exitFactsMissing(version.exit_facts ?? [], employment.exit_facts, subject);
			return missing ?? resolveExitFacts(version.exit_facts ?? [], employment.exit_facts, subject);
		};
		const subjectOrMissing = subjectOn(entry);
		/**
		 * A skipped request is captured, so it has to be reported: the entry is consumed whether or
		 * not it paid, and without a note an approved request disappears with nothing to look at.
		 */
		const skipped = (reason: string): null => {
			options.note({
				code: 'PAY_REQUEST_SKIPPED',
				severity: 'WARNING',
				message:
					`${options.bundle.employment.employee_number}: ${options.component.family.toLowerCase()} ` +
					`${options.component.code} was captured for ${options.period} and paid nothing — ${reason}.`,
				collection: entry.family === 'CLAIM' ? 'claim_requests' : 'adhoc_requests',
				recordId: entry.source_id
			});
			return null;
		};
		if (Predicate.isString(subjectOrMissing))
			return skipped(`the departure record is incomplete: ${subjectOrMissing}`);
		const subject = subjectOrMissing;
		if (!isEligible(options.component.eligibility, subject))
			return skipped('this employment does not satisfy the catalogue’s eligibility rule');

		const rates = options.rates;
		const contextOf = (source: PreparedPayRequest) => {
			const paidToDate = source.captures.reduce((sum, capture) => sum + capture.amount, 0);
			return entryContext({
				entry: source,
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
					remaining: Math.max(0, decodeNumber(source.amount) - paidToDate)
				},
				religiousHolidays: options.configuration.religiousHolidays
			});
		};
		const context = contextOf(entry);
		if (
			(options.component.qualifies_when ?? '').trim() !== '' &&
			!evaluateBoolean(engine, options.component.qualifies_when!, context)
		)
			refuse(`${options.component.code} does not satisfy its claim qualification rule.`);
		const band = selectBand(options.component.bands, context, engine);
		// A non-empty band table that covers nobody leaves the entry priced at nothing: the bands
		// are the entitlement, and no band is no entitlement.
		if (band == null && options.component.bands.length > 0)
			return skipped('no band of the catalogue covers this entry');
		const sign = entry.sign;
		// A claim or an ad hoc request — a bonus, back pay, an ex-gratia sum — is due in its period
		// whole, whatever the joiner's days: no statute prorates a lump sum (SG CPF counts the AW
		// "payable in the month"; MY EA s.18A prorates monthly wages only). What prorates is the
		// contract's own money, the wage and the allowances on it.
		const reimbursable = cents(
			band == null ? decodeNumber(entry.amount) : bandAmount(band, context, engine),
			currency
		);
		const payable = reimbursable;
		if (band?.limit != null) {
			const limitAmount = evaluateNumber(engine, band.limit.amount, context);
			// ponytail: a sibling is priced for this entry's person, not re-judged for its own
			// eligibility or departure facts; one employment in one window reads the same person.
			const pricedAt = (candidate: PreparedPayRequest): number => {
				const own = contextOf(candidate);
				const bands = candidate.catalogueComponent.bands;
				const priced = selectBand(bands, own, engine);
				if (priced != null) return bandAmount(priced, own, engine);
				return bands.length > 0 ? 0 : decodeNumber(candidate.amount);
			};
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
								event_date: candidate.event_date,
								// An unsettled sibling uses what its own band prices it at, not the figure it
								// was keyed at: ID's THR is one month's wage whatever is typed (Permenaker 6/2016
								// art.3(1)), so two requests keyed 0 are two THRs (art.5(1)).
								amount: candidate.sign * cents(pricedAt(candidate), currency)
							}
						];
					// A capture keeps the request's own event date.
					return candidate.captures.map((capture) => ({
						id: candidate.id,
						employment_id: candidate.employment_id,
						event_date: candidate.event_date,
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
			const refusal = entryLimitRefusal({
				limit: band.limit,
				resolved,
				componentCode: options.component.code,
				subject: options.bundle.employment.employee_number,
				proposed: sign * payable
			});
			if (refusal !== null) throw new Error(refusal);
		}
		const signed = cents(sign * payable, currency);
		// A reversal (`as_adjustment_entry`) or a negative figure lands in the opposite bucket as a
		// magnitude: a PhilHealth adjustment of −750 on a NET/SUBTRACT row is a 750 payment, not a
		// deduction of −750.
		const landing = signed < 0 && bucket !== 'EMPLOYER_COST' ? oppositeBucket(bucket) : bucket;
		const amount = landing === bucket ? signed : Math.abs(signed);
		return {
			amount: signed,
			base: [],
			proration: [],
			adjustments: [
				{
					input: { family: entry.family, id: entry.source_id },
					catalogueComponent: options.component,
					bucket: landing,
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

export function prepareMoneySteps(
	options: Omit<MeasureComponentOptions, 'component' | 'entry'> & {
		readonly requests: readonly PreparedPayRequest[];
	}
): readonly FamilyStep[] {
	// A request prices under the catalogue row it was raised against, not the run version's row of
	// the same code: a loan agreed under an earlier revision still carries that
	// revision's bands and opt-ins, and a later version may not carry the row at all.
	return options.requests.map((entry) => ({
		item: entry.catalogueComponent,
		calculate: () => measureMoneyEntry({ ...options, component: entry.catalogueComponent, entry })
	}));
}

/** The catalogue rows of the money families, lifted into engine components. */
export function prepareMoneyCatalogues(options: {
	readonly world: PayrollWorld;
	readonly settingsId: string;
	readonly lineageIds: readonly string[];
}) {
	const { world } = options;
	const ofVersion = <
		T extends { readonly approval_id?: string | null | undefined; readonly settings_id: string }
	>(
		rows: readonly T[]
	) => live(rows).filter((row) => row.settings_id === options.settingsId);
	const lineage = new Set(options.lineageIds);
	const components: CatalogueComponent[] = [
		...ofVersion(world.claim_catalogue).map((row) => ({
			...row,
			family: 'CLAIM' as const,
			definition: entryOf()
		})),
		...ofVersion(world.adhoc_catalogue).map((row) => ({
			...row,
			family: 'ADHOC' as const,
			definition: entryOf()
		})),
		...ofVersion(world.allowance_catalogue).map((row) => ({
			...row,
			family: 'ALLOWANCE' as const,
			definition: entryOf()
		}))
	];
	return {
		components,
		// Every version's allowance classes by id: a contract lists the row of the version it was
		// signed under, and the code carries the class into this one.
		allowanceCodeById: new Map(
			live(world.allowance_catalogue)
				.filter((row) => lineage.has(row.settings_id))
				.map((row) => [row.id, row.code])
		)
	};
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
			amounts.set(key, (amounts.get(key) ?? 0) + row.amount);
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

/** Standing captures exclude single-use requests, including signed corrections, from later runs. */
function requestCaptures(
	world: PayrollWorld,
	requests: readonly PayRequest[]
): ReadonlyMap<string, readonly PayRequestCapture[]> {
	const captures = new Map<string, PayRequestCapture[]>();
	if (requests.length === 0) return captures;
	// The link rows of each money family, read from the pins the engine wrote.
	const linksOf = (
		family: PayRequestFamily,
		rows: readonly { readonly id: string; readonly payslip_id: string | null }[]
	) => {
		const ids = new Set(
			requests.filter((request) => request.family === family).map((request) => request.source_id)
		);
		return rows.flatMap((row): PayRequestCaptureLink[] =>
			ids.has(row.id) && row.payslip_id != null
				? [{ family, payslipId: row.payslip_id, period: '', sourceId: row.id }]
				: []
		);
	};
	const links = [
		...linksOf('CLAIM', world.claim_requests),
		...linksOf('ADHOC', world.adhoc_requests)
	];
	if (links.length === 0) return captures;
	const payslipIds = new Set(links.map((row) => row.payslipId));
	const bySource = captureAmounts(
		links,
		world.payslips.filter((row) => payslipIds.has(row.id))
	);
	for (const request of requests)
		captures.set(request.id, [...(bySource.get(request.source_id) ?? [])]);
	return captures;
}

type MoneyPreparationOptions = {
	readonly world: PayrollWorld;
	readonly configuration: Configuration;
	readonly employmentIds: readonly string[];
};

/** Build the requests the run prices: every unpinned approved claim and ad hoc request of these people. */
export function prepareMoneyInputs(options: MoneyPreparationOptions) {
	const { world } = options;
	const employmentIds = new Set(options.employmentIds);
	const unpinned = <
		T extends {
			readonly approval_id?: string | null | undefined;
			readonly employment_id: string;
			readonly payslip_id: string | null;
		}
	>(
		rows: readonly T[]
	) => live(rows).filter((row) => employmentIds.has(row.employment_id) && row.payslip_id == null);
	const requests: readonly PayRequest[] = [
		...unpinned(world.claim_requests).map(claimRequest),
		...unpinned(world.adhoc_requests).map(adhocRequest)
	];
	const capturesByRequest = requestCaptures(world, requests);
	const requestCatalogues = prepareRequestCatalogues(options, requests);
	const requestsByEmployment = Map.groupBy(
		requests.map((request): PreparedPayRequest => ({
			...request,
			captures: capturesByRequest.get(request.id) ?? [],
			catalogueComponent: requestCatalogues.get(request.catalogue_id)!
		})),
		(row) => row.employment_id
	);
	return { requestsByEmployment };
}

/** Requests retain their source revision; current contribution schemes still assess the result. */
function prepareRequestCatalogues(
	options: MoneyPreparationOptions,
	requests: readonly PayRequest[]
) {
	if (requests.length === 0) return new Map<string, CatalogueComponent>();
	const idsOf = (family: PayRequestFamily) =>
		new Set(
			requests.filter((request) => request.family === family).map((request) => request.catalogue_id)
		);
	const claimIds = idsOf('CLAIM');
	const adhocIds = idsOf('ADHOC');
	const components: CatalogueComponent[] = [
		...live(options.world.claim_catalogue)
			.filter((row) => claimIds.has(row.id))
			.map((row) => ({ ...row, family: 'CLAIM' as const, definition: entryOf() })),
		...live(options.world.adhoc_catalogue)
			.filter((row) => adhocIds.has(row.id))
			.map((row) => ({ ...row, family: 'ADHOC' as const, definition: entryOf() }))
	];
	// The lineage's versions are already in hand; only a component from outside it is looked up.
	const settingsById = new Map<string, (typeof options.configuration.lineageVersions)[number]>(
		options.configuration.lineageVersions.map((row) => [row.id, row] as const)
	);
	const unknownVersionIds = new Set(
		components.map((row) => row.settings_id).filter((id) => !settingsById.has(id))
	);
	for (const row of live(options.world.jurisdiction_settings))
		if (unknownVersionIds.has(row.id)) settingsById.set(row.id, row);
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
}

/**
 * What earlier PAID runs already took from each entry, keyed by source id. A captured zero means
 * the entry was read and paid nothing, rather than leaving historical usage unknown.
 */
export function prepareMoneyConsumption(
	world: PayrollWorld,
	payslipIds: readonly string[]
): Map<string, number> {
	const prior = new Set(payslipIds);
	const consumedEntries = new Map<string, number>();
	for (const row of [...world.claim_requests, ...world.adhoc_requests])
		if (row.payslip_id != null && prior.has(row.payslip_id)) consumedEntries.set(row.id, 0);
	for (const payslip of world.payslips)
		if (prior.has(payslip.id))
			for (const row of payslip.adjustments) {
				if (!(PAY_REQUEST_FAMILIES as readonly string[]).includes(row.family)) continue;
				consumedEntries.set(
					row.source_id,
					(consumedEntries.get(row.source_id) ?? 0) + (row.amount ?? 0)
				);
			}
	return consumedEntries;
}

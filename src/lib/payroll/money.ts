/** Normalized money inputs supplied by Claim and Ad hoc. */
import type { CollectionPayload } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { CatalogueBand } from '../../datatypes/catalogue_band/+definition.js';
import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import { requiredDateKey, type IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import { contractAllowancesOn } from './contract-allowances.js';
import { defaultPayPeriod, type PayCadence } from '../../collections/payroll_runs/lib/period.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
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
} from '../../collections/payroll_runs/lib/eligibility.js';
import {
	entryLimitRefusal,
	resolveEntryLimit,
	type LimitSibling
} from '../../collections/payroll_runs/lib/entry-cap.js';
import { prorationSegment } from '../../collections/payroll_runs/lib/proration.js';
import { factStatusesOn, personFacts } from './facts.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { resolveCompanyFacts, resolveExitFacts, resolveFactValues } from '../declared-facts.js';
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
import { oppositeBucket, settlementBucket } from './family.js';
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
type AdhocRequest =
	import('../../collections/payroll_runs/$types.js').WorkspaceRow<'adhoc_requests'>;

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
	captured: row.payslip_id != null
});

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
export function entryContext(options: {
	/** What the context reads of the entry: its magnitude and its day. */
	readonly entry: Pick<PayRequest, 'amount' | 'event_date'>;
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
		leave: {}
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
			throw new Error(
				`A catalogue band condition did not evaluate: ${error instanceof Error ? error.message : String(error)}`
			);
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
			decodeNumber(options.configuration.jurisdiction.work_rules.wages?.by_region?.[region] ?? 0)
	});
	const measureEntry = (entry: PreparedPayRequest): Measurement | null => {
		// Only a class whose own rules read departure inputs owes them: ID's THR is classed for
		// off-boarding but prices a festival wage, not a termination benefit.
		const readsExitFacts = [
			options.component.eligibility,
			...options.component.bands.flatMap((band) => [
				band.when ?? '',
				band.amount ?? '',
				typeof band.limit === 'string' ? band.limit : ''
			])
		].some((expression) => expression.includes('employment.exit_facts'));
		const subjectOn = (source: PayRequest): PersonContext => {
			const employment = stint(options.bundle.employment);
			// A separation-classed row raised while the contract still runs — ID's THR for an
			// active employee — is an ordinary payment on its event date, not a final obligation.
			const separation =
				'raised_by' in options.component &&
				options.component.raised_by === 'SEPARATION' &&
				employment.exit_date != null;
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
						facts: resolveCompanyFacts(version.facts ?? [], {
							...options.configuration.company,
							facts: options.configuration.recordedCompanyFacts
						})
					}
				: options.configuration.company;
			const subject = personContext({
				employee: options.bundle.employee,
				employment:
					separation && readsExitFacts
						? employment
						: {
								// Eligibility over an active contract reads declared exit facts with their
								// defaults; requiredness is enforced only where the rules read them.
								...employment,
								exit_facts: resolveFactValues(
									version.exit_facts ?? [],
									employment.exit_facts ?? {},
									options.bundle.employment.employee_number,
									false
								)
							},
				fixedAllowances: contractAllowancesOn(options.bundle, options.configuration, asOf),
				terms: payRequestTerms(options.bundle.termsHistory, options.bundle.employment, asOf),
				children: options.bundle.children,
				company,
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
			return separation && readsExitFacts
				? resolveExitFacts(version.exit_facts ?? [], employment.exit_facts, subject)
				: subject;
		};
		const subject = subjectOn(entry);
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
								amount: candidate.sign * cents(decodeNumber(candidate.amount), currency)
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
				subject: String(options.bundle.employment.employee_number),
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
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly settingsId: string;
	readonly lineageIds: readonly string[];
}) {
	return Effect.gen(function* () {
		const where = {
			settings_id: { eq: options.settingsId },
			approval_id: { isNull: true }
		} as const;
		const [claims, adhoc, allowances, lineageClasses] = yield* Effect.all(
			[
				options.api.db.claim_catalogue.findMany({ where, limit: PAGE_LIMIT }),
				options.api.db.adhoc_catalogue.findMany({ where, limit: PAGE_LIMIT }),
				options.api.db.allowance_catalogue.findMany({ where, limit: PAGE_LIMIT }),
				// Every version's allowance classes by id: a contract lists the row of the version
				// it was signed under, and the code carries the class into this one.
				options.api.db.allowance_catalogue.findMany({
					where: { settings_id: { in: options.lineageIds }, approval_id: { isNull: true } },
					columns: { id: true, code: true },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claims, 'claim catalogue');
		options.api.reads.assertComplete(adhoc, 'ad hoc catalogue');
		options.api.reads.assertComplete(allowances, 'allowance catalogue');
		options.api.reads.assertComplete(lineageClasses, 'allowance classes of the lineage');
		const components: CatalogueComponent[] = [
			...claims.map((row) => ({ ...row, family: 'CLAIM' as const, definition: entryOf() })),
			...adhoc.map((row) => ({ ...row, family: 'ADHOC' as const, definition: entryOf() })),
			...allowances.map((row) => ({
				...row,
				family: 'ALLOWANCE' as const,
				definition: entryOf()
			}))
		] as unknown as CatalogueComponent[];
		return {
			components,
			allowanceCodeById: new Map(lineageClasses.map((row) => [row.id, row.code]))
		};
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
		// The two request tables share the pin columns; the union of their clients is not
		// callable, the claim client's shape reads either.
		const requests = (
			family === 'CLAIM' ? api.db.claim_requests : api.db.adhoc_requests
		) as typeof api.db.claim_requests;
		const rows = yield* requests.findMany({
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
			...(yield* captureLinksOf('ADHOC', options.api, idsOf('ADHOC')))
		];
		if (links.length === 0) return captures;
		const payslips = yield* options.api.db.payslips.findMany({
			where: { id: { in: [...new Set(links.map((row) => row.payslipId))] } },
			columns: { id: true, adjustments: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(payslips, 'captured pay-request outputs');
		const bySource = captureAmounts(links, payslips);
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
	/** The salary window this run settles. */
	readonly periodWindow: { readonly start: string; readonly end: string };
};

/** Build the requests the run prices: every unpinned approved claim and ad hoc request of these people. */
export function prepareMoneyInputs(options: MoneyPreparationOptions) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const approved = { approval_id: { isNull: true } } as const;
		const unpinned = {
			employment_id: { in: [...options.employmentIds] },
			...approved,
			payslip_id: { isNull: true }
		} as const;
		const [claimRows, adhocRows] = yield* Effect.all(
			[
				db.claim_requests.findMany({ where: unpinned, limit: PAGE_LIMIT }),
				db.adhoc_requests.findMany({ where: unpinned, limit: PAGE_LIMIT })
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claimRows, 'claim requests');
		options.api.reads.assertComplete(adhocRows, 'ad hoc requests');
		const requests: readonly PayRequest[] = [
			...claimRows.map(claimRequest),
			...adhocRows.map(adhocRequest)
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
		const [claims, adhoc] = yield* Effect.all(
			[
				options.api.db.claim_catalogue.findMany({
					where: { id: { in: idsOf('CLAIM') }, ...approved },
					limit: PAGE_LIMIT
				}),
				options.api.db.adhoc_catalogue.findMany({
					where: { id: { in: idsOf('ADHOC') }, ...approved },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claims, 'source Claim catalogue');
		options.api.reads.assertComplete(adhoc, 'source Ad hoc catalogue');
		const components = [
			...claims.map((row) => ({ ...row, family: 'CLAIM' as const, definition: entryOf() })),
			...adhoc.map((row) => ({ ...row, family: 'ADHOC' as const, definition: entryOf() }))
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
		const [claims, adhoc, payslips] = yield* Effect.all(
			[
				db.claim_requests.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { id: true },
					limit: PAGE_LIMIT
				}),
				db.adhoc_requests.findMany({
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
		options.api.reads.assertComplete(adhoc, 'prior ad hoc captures');
		options.api.reads.assertComplete(payslips, 'prior payslips');
		for (const row of [...claims, ...adhoc]) consumedEntries.set(row.id, 0);
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

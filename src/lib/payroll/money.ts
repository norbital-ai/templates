/** Normalized money inputs supplied by Claim, Allowance and Payment. */
import type { WorkspaceRow } from '../../collections/payroll_runs/$types.js';
import type { CatalogueComponent } from '../../collections/payroll_runs/lib/configuration.js';
import type { AllowanceRecurrence } from '../../datatypes/allowance_recurrence/+definition.js';
import { requiredDateKey, type IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import { defaultPayPeriod, type PayCadence } from '../../collections/payroll_runs/lib/period.js';
import { decodeNumber } from '@norbital-ai/std/json';

type ClaimRequest = WorkspaceRow<'claim_requests'>;
type AllowanceRequest = WorkspaceRow<'allowance_requests'>;
type PaymentRequest = WorkspaceRow<'payment_requests'>;

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
	readonly component_catalogue_id: string;
	/** A positive magnitude, exactly as stored. */
	readonly amount: unknown;
	readonly approval_id: string | null;
	readonly pay_period: string | null;
	/** The day this request's economics belong to. */
	readonly event_date: IsoDate;
	/**
	 * `+1` to settle the way its component declares, `−1` to settle the opposite way.
	 *
	 * `−1` is what `as_adjustment_entry` means, and it is available to every family: clawing back a
	 * transport claim is a transport claim entry with the tick set, under the same component and on
	 * the same payslip line as the one it corrects.
	 */
	readonly sign: number;
	/** A standing allowance's own window, which prorates it independently of the employment. */
	readonly window: RequestWindow | null;
	/** Whether a part-month reduces it. Only a standing allowance is measured per day of the month. */
	readonly prorates: boolean;
	/** Whether drawing on it uses it up. */
	readonly depletes: boolean;
	/** Only recurring allowances may be consumed in more than one period. */
	readonly recurring: boolean;
	/** A standing payslip already captured this single-use request. */
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

const magnitudeBase = (
	row: {
		readonly id: string;
		readonly employment_id: string;
		readonly amount: unknown;
		readonly approval_id?: string | null;
		readonly pay_period?: string | null;
		readonly as_adjustment_entry?: boolean;
	},
	family: PayRequestFamily,
	eventDate: IsoDate,
	catalogueId: string
) => ({
	id: row.id,
	family,
	employment_id: row.employment_id,
	// The four catalogues are four tables and one id space, so the view keeps one column: which
	// table it came from is `family`, and nothing downstream has to ask.
	component_catalogue_id: catalogueId,

	amount: row.amount,
	approval_id: row.approval_id ?? null,
	pay_period: row.pay_period ?? null,
	event_date: eventDate,
	// The component says which way this settles; the tick says settle it the other way.
	sign: row.as_adjustment_entry === true ? -1 : 1,
	window: null,
	prorates: false,
	/**
	 * Everything except a recurring allowance is bounded by its amount, so what earlier paid runs
	 * took reduces what is left — and it belongs to at most one standing/paid payslip, which its
	 * capture junction's unique index now states outright.
	 *
	 * An adjustment entry is **signed rather than depleted**: netting a negative draw against a
	 * magnitude would grow the ceiling it is supposed to be bounded by.
	 */
	depletes: row.as_adjustment_entry !== true,
	recurring: false,
	captured: false
});

/** A claim's economics belong to the day the expense was incurred, not the day it was entered. */
export const claimRequest = (row: ClaimRequest): PayRequest =>
	magnitudeBase(
		row,
		'CLAIM',
		requiredDateKey(row.incurred_on, 'claim incurred date'),
		row.claim_catalogue_id
	);

/**
 * A standing allowance, whose window is read off its recurrence and never off a column beside it.
 *
 * A one-off's window is its period's own month, and that period is the one it settles in: the
 * recurrence names it once, and `requestIsDue` reads it off the window's end, in the grammar of
 * the cadence the employment is paid on. There is no override column. Proration still measures
 * the one-off against the days actually employed — what it no longer does is masquerade as a
 * recurring allowance whose range happens to be one month long. A **recurring** allowance is bounded by nothing: it states an
 * amount **per period** and pays it whole in every period its window covers, so it never depletes
 * and its junction is the one with no unique on its source.
 */
export const allowanceRequest = (row: AllowanceRequest): PayRequest => {
	const recurrence = row.recurrence as AllowanceRecurrence;
	const window: RequestWindow =
		recurrence.kind === 'ONE_OFF'
			? {
					start: requiredDateKey(`${recurrence.period}-01`, 'allowance period'),
					end: requiredDateKey(monthEndDay(recurrence.period), 'allowance period end')
				}
			: {
					start: requiredDateKey(recurrence.from, 'allowance start'),
					end: recurrence.to == null ? null : requiredDateKey(recurrence.to, 'allowance end')
				};
	return {
		...magnitudeBase(row, 'ALLOWANCE', window.start, row.allowance_catalogue_id),
		window,
		prorates: true,
		depletes: recurrence.kind === 'ONE_OFF' && row.as_adjustment_entry !== true,
		recurring: recurrence.kind === 'RECURRING'
	};
};

export const paymentRequest = (row: PaymentRequest): PayRequest =>
	magnitudeBase(
		row,
		'PAYMENT',
		requiredDateKey(row.effective_on, 'payment effective date'),
		row.payment_catalogue_id
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

/** Late approvals settle once in the next regular period; recurring amounts keep their window. */
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
		return window.start <= salary.end && (window.end == null || window.end >= salary.start);
	}
	// A one-off allowance names its earned month explicitly, independently of the work cutoff.
	const due =
		request.window == null || request.pay_period != null
			? requestPayPeriod(request, cutoffDay, cadence)
			: defaultPayPeriod(request.window.end!, 31, cadence);
	return due <= period;
}

/** The last calendar day of a `YYYY-MM` period. */
const monthEndDay = (period: string): string => {
	const [year, month] = period.split('-').map(Number) as [number, number];
	return `${period}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
};

import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import {
	PAGE_LIMIT,
	groupBy,
	type PayrollReadApi,
	type ReadLog
} from '../../collections/payroll_runs/lib/api.js';
import { live } from '../../collections/payroll_runs/lib/effective.js';
import type { Configuration } from '../../collections/payroll_runs/lib/configuration.js';

type MoneyPreparationOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly employmentIds: readonly string[];
	readonly period: string;
};

export function prepareMoneyInputs(options: MoneyPreparationOptions) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const approved = { approval_id: { isNull: true } } as const;
		const period = options.period;
		const inBegun = { employment_id: { in: [...options.employmentIds] }, ...approved } as const;
		const [claimRows, allowanceRows, paymentRows] = yield* Effect.all(
			[
				db.claim_requests.findMany({ where: inBegun, limit: PAGE_LIMIT }),
				db.allowance_requests.findMany({ where: inBegun, limit: PAGE_LIMIT }),
				db.payment_requests.findMany({ where: inBegun, limit: PAGE_LIMIT })
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claimRows, 'claim requests');
		options.api.reads.assertComplete(allowanceRows, 'allowance requests');
		options.api.reads.assertComplete(paymentRows, 'payment requests');
		const requests: readonly PayRequest[] = [
			...live(claimRows).map(claimRequest),
			...live(allowanceRows).map(allowanceRequest),
			...live(paymentRows).map(paymentRequest)
		];
		const capturesByRequest = yield* requestCaptures({ api: options.api, requests });
		const requestCatalogues = yield* prepareRequestCatalogues(options, requests);
		const requestsByEmployment = groupBy(
			requests.map((request): PreparedPayRequest => ({
				...request,
				captured: (capturesByRequest.get(request.id) ?? []).some(
					(capture) => !request.recurring || capture.period === period
				),
				captures: capturesByRequest.get(request.id) ?? [],
				catalogueComponent: requestCatalogues.get(request.component_catalogue_id)!
			})),
			(row) => row.employment_id
		);

		return requestsByEmployment;
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
					.map((request) => request.component_catalogue_id)
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
		options.api.reads.assertComplete(payments, 'source Adhoc catalogue');
		const components: CatalogueComponent[] = [
			...claims.map((row) => ({ ...row, family: 'CLAIM' as const, definition: entryOf(row) })),
			...allowances.map((row) => ({
				...row,
				family: 'ALLOWANCE' as const,
				definition: entryOf(row)
			})),
			...payments.map((row) => ({ ...row, family: 'PAYMENT' as const, definition: entryOf(row) }))
		];
		const settings = yield* options.api.db.jurisdiction_settings.findMany({
			where: { id: { in: [...new Set(components.map((row) => row.settings_id))] }, ...approved },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(settings, 'source catalogue settings');
		const settingsById = new Map(settings.map((row) => [row.id, row]));
		const byId = new Map(components.map((row) => [row.id, row]));
		for (const request of requests) {
			const component = byId.get(request.component_catalogue_id);
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
			if (version.currency !== options.configuration.jurisdiction.currency)
				refuse(`A ${request.family} input's source currency differs from this payroll's currency.`);
		}
		return byId;
	});
}

/** The stored row lifted into the engine's `ENTRY` arm: the flat columns are the definition. */
const entryOf = (row: Pick<WorkspaceRow<'claim_catalogue'>, 'cap'>) =>
	({ source: 'ENTRY', cap: row.cap }) as const;

/** Standing captures exclude single-use requests, including signed corrections, from later runs. */
function requestCaptures(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly requests: readonly PayRequest[];
}): Effect.Effect<ReadonlyMap<string, readonly PayRequestCapture[]>, never, never> {
	return Effect.gen(function* () {
		const captures = new Map<string, PayRequestCapture[]>();
		if (options.requests.length === 0) return captures;
		const idsOf = (family: PayRequestFamily) =>
			options.requests.filter((request) => request.family === family).map((request) => request.id);
		const db = options.api.db;
		const settled = { id: true, settled_payslip_id: true, settled_period: true } as const;
		const [claims, allowances, payments] = yield* Effect.all(
			[
				db.claim_requests.findMany({
					where: { id: { in: idsOf('CLAIM') }, settled_payslip_id: { isNull: false } },
					columns: settled,
					limit: PAGE_LIMIT
				}),
				db.payslip_allowance_request_inputs.findMany({
					where: { allowance_request_id: { in: idsOf('ALLOWANCE') } },
					columns: { id: true, period: true, allowance_request_id: true, payslip_id: true },
					limit: PAGE_LIMIT
				}),
				db.payment_requests.findMany({
					where: { id: { in: idsOf('PAYMENT') }, settled_payslip_id: { isNull: false } },
					columns: settled,
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(claims, 'claim captures');
		options.api.reads.assertComplete(allowances, 'allowance captures');
		options.api.reads.assertComplete(payments, 'payment captures');
		const links = [
			...claims.map((row) => ({
				family: 'CLAIM' as const,
				payslipId: row.settled_payslip_id!,
				period: row.settled_period ?? '',
				sourceId: row.id
			})),
			...allowances.map((row) => ({
				family: 'ALLOWANCE' as const,
				payslipId: row.payslip_id,
				period: row.period,
				sourceId: row.allowance_request_id
			})),
			...payments.map((row) => ({
				family: 'PAYMENT' as const,
				payslipId: row.settled_payslip_id!,
				period: row.settled_period ?? '',
				sourceId: row.id
			}))
		];
		if (links.length === 0) return captures;
		const payslips = yield* db.payslips.findMany({
			where: { id: { in: [...new Set(links.map((row) => row.payslipId))] } },
			columns: { id: true, adjustments: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(payslips, 'captured pay-request outputs');
		const amounts = new Map<string, number>();
		for (const payslip of payslips)
			for (const row of payslip.adjustments) {
				if (!(PAY_REQUEST_FAMILIES as readonly string[]).includes(row.family)) continue;
				const key = `${payslip.id}:${row.source_id}`;
				amounts.set(key, (amounts.get(key) ?? 0) + decodeNumber(row.amount));
			}
		for (const link of links) {
			const rows = captures.get(link.sourceId) ?? [];
			rows.push({
				id: link.payslipId,
				period: link.period,
				amount: amounts.get(`${link.payslipId}:${link.sourceId}`) ?? 0
			});
			captures.set(link.sourceId, rows);
		}
		return captures;
	});
}

import type { ComponentDefinition } from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import type { Measurement, MeasureComponentOptions, PayRange, FamilyStep } from './family.js';
import {
	intersectDays,
	monthKey,
	monthBounds,
	daysBetween
} from '../../collections/payroll_runs/lib/dates.js';
import {
	isEligible,
	personContext,
	type PersonContext
} from '../../collections/payroll_runs/lib/eligibility.js';
import {
	capOccurrenceDate,
	entryCapRefusal,
	resolveEntryCap
} from '../../collections/payroll_runs/lib/entry-cap.js';
import { prorationFraction } from '../../collections/payroll_runs/lib/proration.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import { payRequestTerms } from '../component_entry_cap_subject.js';
import { entryOverConsumedMessage, overConsumesEntry } from '../settlement_refusals.js';
import { termsAt } from './work.js';
import { activeTimeOff } from '../leave/activity.js';
import { termPattern } from '../scheduling/work-pattern.js';
import { resolveSchedule, type ScheduledDay } from '../../collections/payroll_runs/lib/schedule.js';
type EntryCeiling = Readonly<{
	readonly entry: PayRequest;
	readonly componentCode: string;
	readonly consumed: number;
	readonly proposed: number;
	readonly period: string;
}>;

function assertWithinEntry(options: EntryCeiling): void {
	if (!options.entry.depletes) return;
	const consumption = {
		component_entry_id: options.entry.id,
		component_code: options.componentCode,
		entitlement: decodeNumber(options.entry.amount),
		consumed: options.consumed,
		proposed: options.proposed,
		period: options.period
	};
	if (overConsumesEntry(consumption)) throw new Error(entryOverConsumedMessage(consumption));
}

function measureMoneyEntry(options: MeasureComponentOptions): Measurement | null {
	const definition = options.component.definition;
	if (definition.source !== 'ENTRY')
		throw new Error(
			`A ${options.component.family} request must have an ENTRY catalogue definition.`
		);
	if (options.entry == null) return null;
	const nature = options.component.nature;
	const entryFraction = (source: PayRequest): number => {
		const window = source.window;
		// A late one-off allowance retains the source month's proration and employment coverage.
		const sourcePeriod =
			!source.recurring && window != null
				? { start: window.start, end: window.end! }
				: options.salary;
		const employmentRange = employmentDates(options.bundle.employment);
		const covered =
			!source.recurring && window != null
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
		const sourceMonth = !source.recurring && window != null ? monthKey(window.start) : null;
		const allowanceConfiguration =
			sourceMonth == null ? null : options.bundle.allowanceConfigurations?.get(sourceMonth);
		if (sourceMonth != null && !allowanceConfiguration)
			throw new Error('A one-off Allowance has no prepared source-month configuration.');
		return source.prorates
			? prorationFraction({
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

	const measureEntry = (
		definition: Extract<ComponentDefinition, { source: 'ENTRY' }>,
		entry: PayRequest
	): Measurement | null => {
		const subjectOn = (source: PayRequest): PersonContext =>
			personContext({
				employee: options.bundle.employee,
				employment: options.bundle.employment,
				terms: payRequestTerms(
					options.bundle.termsHistory,
					options.bundle.employment,
					source.event_date
				),
				children: options.bundle.children,
				company: options.configuration.company,
				asOf: source.event_date
			});
		const eventDate = entry.recurring ? capOccurrenceDate(options.period) : entry.event_date;
		const subject = subjectOn({ ...entry, event_date: eventDate });
		/**
		 * A skipped request is captured, so it has to be reported.
		 *
		 * The junction row is the settlement lock: a request the run read is consumed whether or not
		 * it paid. Every branch below that decides to pay nothing therefore removes the entry from
		 * the operator's queue and leaves no line to explain it — which is how an approved allowance
		 * disappears between one period and the next with nothing to look at.
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
			return skipped('this employment does not satisfy the component’s eligibility rule');
		const cap =
			definition.cap == null
				? null
				: resolveEntryCap({
						cap: definition.cap,
						component: options.component,
						employmentId: options.bundle.employment.id,
						entry,
						eventDate,
						siblings: options.bundle.payRequests.flatMap(
							(request): Array<PreparedPayRequest & { readonly capAmount: number | null }> => {
								const captures = request.captures.map((capture) => ({
									...request,
									id: request.recurring ? `${request.id}:${capture.id}` : request.id,
									event_date: request.recurring
										? capOccurrenceDate(capture.period)
										: request.event_date,
									capAmount: capture.amount
								}));
								if (!request.recurring)
									return captures.length ? captures : [{ ...request, capAmount: null }];
								return [
									...captures.filter((capture) => capture.event_date < eventDate),
									...(requestIsDue(
										request,
										options.period,
										options.salary,
										decodeNumber(options.configuration.company.pay_cutoff_day),
										{
											company: options.configuration.company,
											payFrequency: options.bundle.payFrequency
										}
									)
										? [
												{
													...request,
													event_date: capOccurrenceDate(options.period),
													capAmount: null
												}
											]
										: [])
								];
							}
						),
						eventDateOf: (row) => row.event_date,
						componentOf: (row) => row.catalogueComponent,
						usedAmountOf: (row) => {
							if (row.capAmount != null) return row.sign * row.capAmount;
							if (!isEligible(row.catalogueComponent.eligibility, subjectOn(row))) return 0;
							const due = requestIsDue(
								row,
								options.period,
								options.salary,
								decodeNumber(options.configuration.company.pay_cutoff_day),
								{
									company: options.configuration.company,
									payFrequency: options.bundle.payFrequency
								}
							);
							const fraction = due ? entryFraction(row) : 1;
							return row.sign * cents(decodeNumber(row.amount) * fraction);
						},
						subject
					});
		// A person no band covers has nothing to draw on: the entry is read and captured, and pays nothing.
		if (definition.cap != null && cap == null)
			return skipped('no entitlement band of the component covers this employment');
		const sign = entry.sign;
		const fraction = entryFraction(entry);
		if (fraction <= 0)
			return skipped('the employment covered none of the period the amount is prorated over');
		// The payable share is an economic fact per entry, so it is rounded per entry.
		let reimbursable = cents(decodeNumber(entry.amount) * fraction);
		if (entry.recurring && entry.sign > 0 && cap != null && definition.cap?.on_exceed === 'BLOCK')
			reimbursable = Math.min(reimbursable, Math.max(0, cents(cap.amount - cap.exceededBy)));
		// One sentence, produced by the same function the write hook refuses with, so a run and a
		// form cannot describe the same ceiling two different ways.
		if (cap != null && definition.cap != null) {
			const refusal = entryCapRefusal({
				cap: definition.cap,
				resolved: cap,
				componentCode: options.component.code,
				subject: String(options.bundle.employment.employee_number),
				proposed: sign * reimbursable
			});
			if (refusal !== null) throw new Error(refusal);
		}
		const amount = cents(sign * reimbursable);
		assertWithinEntry({
			entry,
			componentCode: options.component.code,
			consumed: options.consumedEntries.get(entry.id) ?? 0,
			proposed: amount,
			period: options.period
		});
		return {
			amount,
			base: [],
			proration: [],
			adjustments: [
				{
					input: { family: entry.family, id: entry.id },
					catalogueComponent: options.component,
					nature,
					label: options.component.code,
					amount,
					// A component entry states an amount and nothing else. `quantity` on the adjustment
					// is still fed by the sources that genuinely have one — leave days, work hours —
					// but an entry has no countable unit to report, and the column it used to be
					// copied from priced nothing.
					quantity: null,
					rate: null,
					statutoryRuleKey: null
				}
			]
		};
	};

	return measureEntry(definition, options.entry);
}

export function prepareAllowanceWork(options: Pick<MeasureComponentOptions, 'bundle'>) {
	const { bundle } = options;
	const allowanceWorkDayIds = new Set<string>();
	const allowanceSchedules = new Map<string, Map<IsoDate, ScheduledDay>>();
	const allowanceWorkingDaysIn = (sourceMonth: string, window: PayRange): number => {
		const source = bundle.allowanceConfigurations?.get(sourceMonth);
		if (!source) throw new Error('A one-off Allowance has no prepared source-month configuration.');
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
				const pattern = termPattern(sourceTermsAt(date), source.patternById);
				const row = plannedByDate.get(date);
				// The approved Leave charge preserves the original shift if an absence changed the roster to OFF.
				const leaveShift = leaveCharges.get(date)?.shift_definition_id;
				if (
					pattern.type === 'ROSTERED' &&
					row?.shift_definition_id == null &&
					leaveShift == null &&
					!source.holidays.has(date)
				)
					throw new Error(
						`Allowance working-day proration requires a source-month roster assignment on ${date}.`
					);
				if (row) allowanceWorkDayIds.add(row.id);
				if (leaveCharges.has(date))
					return pattern.type === 'PATTERNED' || leaveShift == null
						? []
						: [{ work_date: date, shift_definition_id: leaveShift }];
				return row == null ? [] : [row];
			});
			schedule = resolveSchedule({
				window: sourceWindow,
				dates,
				workDays: planned,
				configuration: source,
				terms: (date) => ({
					work_pattern: termPattern(sourceTermsAt(date), source.patternById),
					// Only ORDINARY day classification enters this fraction; no clock hours are priced.
					normal_daily_hours: 8
				})
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

export function prepareMoneySteps(
	options: Omit<MeasureComponentOptions, 'component' | 'entry'> & {
		readonly requests: readonly PayRequest[];
	}
): readonly FamilyStep[] {
	return options.configuration.catalogueComponents
		.filter((item) => PAY_REQUEST_FAMILIES.some((family) => item.family === family))
		.flatMap((component) =>
			options.requests
				.filter((request) => request.component_catalogue_id === component.id)
				.map((entry) => ({
					item: component,
					calculate: () => measureMoneyEntry({ ...options, component, entry })
				}))
		);
}

import { pickConfiguration } from '../../collections/payroll_runs/lib/configuration.js';
import type { PayrollWindow, PayFrequency } from '../../collections/payroll_runs/lib/period.js';
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
		return [
			...live(claims).map((row) => ({
				...row,
				family: 'CLAIM' as const,
				definition: entryOf(row)
			})),
			...live(allowances).map((row) => ({
				...row,
				family: 'ALLOWANCE' as const,
				definition: entryOf(row)
			})),
			...live(payments).map((row) => ({
				...row,
				family: 'PAYMENT' as const,
				definition: entryOf(row)
			}))
		];
	});
}
export function prepareAllowanceSources(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly employments: readonly EmploymentBundle['employment'][];
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
			const cadence = cadenceByEmployment.get(employment.id)!;
			const months = new Set(
				(requestsByEmployment.get(employment.id) ?? [])
					.filter(
						(request) =>
							request.family === 'ALLOWANCE' &&
							!request.recurring &&
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
			if (source.jurisdiction.currency !== options.configuration.jurisdiction.currency)
				refuse('An Allowance source month has a different currency from this payroll.');
			allowanceConfigurations.set(sourceMonth, source);
		}

		return { allowanceMonthsByEmployment, allowanceConfigurations };
	});
}

export function prepareMoneyConsumption(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly payslipIds: readonly string[];
}) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const priorPayslipIds = [...options.payslipIds];
		const consumedEntries = new Map<string, number>();
		const [claims, allowanceLinks, payments, payslips] = yield* Effect.all(
			[
				db.claim_requests.findMany({
					where: { settled_payslip_id: { in: priorPayslipIds } },
					columns: { id: true },
					limit: PAGE_LIMIT
				}),
				db.payslip_allowance_request_inputs.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { id: true, allowance_request_id: true },
					limit: PAGE_LIMIT
				}),
				db.payment_requests.findMany({
					where: { settled_payslip_id: { in: priorPayslipIds } },
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
		options.api.reads.assertComplete(allowanceLinks, 'prior allowance captures');
		options.api.reads.assertComplete(payments, 'prior payment captures');
		options.api.reads.assertComplete(payslips, 'prior payslips');
		// A paid capture with no output consumed zero, rather than leaving historical usage unknown.
		for (const row of claims) consumedEntries.set(row.id, 0);
		for (const row of allowanceLinks) consumedEntries.set(row.allowance_request_id, 0);
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

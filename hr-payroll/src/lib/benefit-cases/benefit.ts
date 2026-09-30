import type { Decimal } from '@norbital-ai/std/decimal';
import { Schema } from 'effect';
import * as Predicate from 'effect/Predicate';
import type { BenefitCaseType, PayrollSettings } from '../datatypes/payroll_settings.js';
import { factScalar } from '../datatypes/fact_keys.js';
import { factValuesFault } from '../declared-facts.js';
import { evidenceFault } from '../entity-facts.js';
import { EMPTY_OF } from '../expressions/compile.js';
import { evaluateBoolean, evaluateNumber, expressionEngine } from '../expressions/evaluate.js';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { governed, isInForceCandidate, settingsInForce } from '../jurisdiction_settings.js';
import { readAll, type Reads } from '../reads.js';
import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';

type Amount = number | string | Decimal;
type Scalar = string | number | boolean;

/** A settings version as a case reads it: its lineage, period and payroll settings. */
export type CaseSettingsVersion = {
	readonly id: string;
	readonly code: string;
	readonly name?: string | null | undefined;
	readonly sealed_at?: unknown;
	readonly voided_at?: unknown;
	readonly approval_id?: unknown;
	readonly effective_range: unknown;
	readonly payroll?: unknown;
};

/** The only columns a case reads of a version: whole rows run to megabytes. */
export const CASE_SETTINGS_SELECT = {
	id: true,
	code: true,
	name: true,
	sealed_at: true,
	voided_at: true,
	approval_id: true,
	effective_range: true,
	payroll: true
} as const;

/** A version's declared case types (a stored `payroll` value; `facts` are `json` fact keys). */
export const caseTypesOf = (version: CaseSettingsVersion | null | undefined) =>
	((version?.payroll as PayrollSettings | null | undefined)?.benefit_cases ??
		[]) as readonly BenefitCaseType[];

/** Whether any version of the lineage declares a benefit case: what gates every case read. */
export const declaresBenefitCases = (versions: readonly CaseSettingsVersion[]) =>
	versions.some((version) => caseTypesOf(version).length > 0);

/**
 * The version that governs a case day: the one in force, or the lineage's first version where the
 * day precedes it (an event before the lineage opened is still priced by the rules it transcribes).
 */
export function caseVersionOf(
	versions: readonly CaseSettingsVersion[],
	code: string,
	day: string
): CaseSettingsVersion | null {
	const lineage = versions.filter((row) => row.code === code && isInForceCandidate(row));
	const first = lineage.toSorted((left, right) =>
		(governed(left.effective_range)?.from ?? '').localeCompare(
			governed(right.effective_range)?.from ?? ''
		)
	)[0];
	return (
		settingsInForce(lineage, code, day) ??
		(first != null && day < (governed(first.effective_range)?.from ?? '') ? first : null)
	);
}

/** The case type a lineage declares for a leave code on a day; a lineage that declares none refuses. */
export function benefitCaseTypeOf(
	versions: readonly CaseSettingsVersion[],
	code: string,
	caseType: string,
	day: string
): BenefitCaseType {
	const found = caseTypesOf(caseVersionOf(versions, code, day)).find(
		(row) => row.case_type === caseType
	);
	if (found == null)
		refuse(`The ${code} settings in force on ${day} declare no ${caseType} benefit case.`);
	return found;
}

type Governing = {
	readonly employment_id?: string | null | undefined;
	readonly case_type?: string | null | undefined;
	readonly event_on?: string | null | undefined;
	readonly expected_event_on?: string | null | undefined;
	readonly application_on?: string | null | undefined;
};

/**
 * The lineage of each case's employment, in three reads (employments, their entities, the
 * entities' settings versions): each case's type and currency, as the version its day falls in
 * declares them.
 */
export async function readCaseLineages(
	db: Reads,
	employmentIds: readonly (string | null | undefined)[]
) {
	const ids = [...new Set(employmentIds.filter((id): id is string => id != null))];
	const employments = await readAll<{
		readonly id: string;
		readonly employee_id: string;
		readonly company_id: string;
	}>(db, 'employments', { id: { in: ids } }, undefined, {
		id: true,
		employee_id: true,
		company_id: true
	});
	const companies = await readAll<{ readonly id: string; readonly settings_code: string }>(
		db,
		'companies',
		{ id: { in: [...new Set(employments.map((row) => row.company_id))] } },
		undefined,
		{ id: true, settings_code: true }
	);
	const versions = await readAll<CaseSettingsVersion>(
		db,
		'jurisdiction_settings',
		{ code: { in: [...new Set(companies.map((row) => row.settings_code))] } },
		undefined,
		CASE_SETTINGS_SELECT
	);
	const employment = (id: string | null | undefined) => employments.find((row) => row.id === id);
	const codeOf = (row: Governing) => {
		const company = companies.find((item) => item.id === employment(row.employment_id)?.company_id);
		if (company == null) refuse('A benefit case needs an employment of a known entity.');
		return company.settings_code;
	};
	return {
		employment,
		typeOf: (row: Governing) =>
			benefitCaseTypeOf(versions, codeOf(row), row.case_type ?? '', caseDay(row)),
		currencyOf: (row: Governing) =>
			(caseVersionOf(versions, codeOf(row), caseDay(row))?.payroll as PayrollSettings | undefined)
				?.currency ?? ''
	};
}

/** A case's recorded evidence rows. */
export const readCaseEvidence = async (db: Reads, caseIds: readonly string[]) =>
	caseIds.length === 0
		? []
		: readAll<CaseEvidence & { readonly subject: unknown }>(db, 'fact_evidence', {
				subject: { benefit_cases: { in: [...caseIds] } }
			});

/** The evidence rows of one case among many. */
export const evidenceOf = (
	evidence: readonly (CaseEvidence & { readonly subject: unknown })[],
	caseId: string
) => evidence.filter((row) => (row.subject as { readonly id?: string } | null)?.id === caseId);

/** A case as the engine reads it: its event and its recorded facts. */
export type CaseFacts = {
	readonly event_kind?: string | null | undefined;
	readonly event_on?: string | null | undefined;
	readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
};

/** One `fact_evidence` row of a case. */
export type CaseEvidence = {
	readonly fact_key: string;
	readonly reference?: string | null | undefined;
	readonly file?: unknown;
};

/** The day that governs a case: its event, else its expected event, else its application. */
export const caseDay = (row: {
	readonly event_on?: string | null | undefined;
	readonly expected_event_on?: string | null | undefined;
	readonly application_on?: string | null | undefined;
}) => dateKey(row.event_on ?? row.expected_event_on ?? row.application_on);

/**
 * The case site every case-type expression reads: the event, the declared facts (a missing one
 * reads as its default or empty value) with the qualifications beside them, and the fact keys
 * whose evidence is recorded. `recorded` is the raw record, so an undeclared claim stays apart
 * from a false one.
 */
export function caseSite(
	type: BenefitCaseType,
	row: CaseFacts,
	evidence: readonly CaseEvidence[] = []
) {
	const recorded: Record<string, Scalar> = Object.fromEntries(
		Object.entries(row.facts ?? {}).filter(
			(entry): entry is [string, Scalar] =>
				Predicate.isString(entry[1]) ||
				Predicate.isNumber(entry[1]) ||
				Predicate.isBoolean(entry[1])
		)
	);
	const day = dateKey(row.event_on);
	const date = isCalendarDate(day) ? day : '';
	const event = {
		kind: row.event_kind ?? '',
		date,
		month: date === '' ? 0 : decodeNumber(date.slice(5, 7))
	};
	const facts: Record<string, Scalar> = Object.fromEntries(
		type.facts.map((field) => [
			field.key,
			Object.hasOwn(recorded, field.key)
				? recorded[field.key]!
				: (factScalar(field.default_value) ?? EMPTY_OF[field.type])
		])
	);
	const evidenced = [
		...new Set(
			evidence.flatMap((item) =>
				evidenceFault(type.case_type, item.fact_key, item, type.facts) == null
					? [item.fact_key]
					: []
			)
		)
	];
	const base = { event, facts, evidenced };
	for (const q of type.qualifications ?? [])
		facts[q.key] = evaluateBoolean(expressionEngine, q.when, base);
	return { ...base, recorded };
}
export type CaseSite = ReturnType<typeof caseSite>;

const holds = (site: CaseSite) => (expression: string) =>
	evaluateBoolean(expressionEngine, expression, site);

/**
 * The refusal for a case's recorded facts, or null: every key declared, each value of its type and
 * `valid_when`, what `required_when` demands of the event, and a claimed differential exemption
 * stated whole. Evidence is judged where a qualification reads it, not here.
 */
export function caseFactsFault(type: BenefitCaseType, row: CaseFacts): string | null {
	const raw = row.facts ?? {};
	const unknown = Object.keys(raw).find((key) => !type.facts.some((field) => field.key === key));
	if (unknown != null) return `${type.case_type} declares no case fact ${unknown}.`;
	const fault = factValuesFault(type.facts, raw, true, holds(caseSite(type, row)), () => true);
	if (fault != null) return fault;
	const exemption = type.differential_exemption_facts;
	const stated = exemption.filter((key) => Object.hasOwn(raw, key));
	if (stated.length > 0 && stated.length < exemption.length)
		return `A claimed differential exemption needs every one of ${exemption.join(', ')}.`;
	return null;
}

/** The case's compensable days: the case type's `days` over its site. */
export function compensableDays(type: BenefitCaseType, site: CaseSite): number {
	const days = evaluateNumber(expressionEngine, type.days, site);
	if (!Number.isInteger(days) || days <= 0)
		refuse(`The ${type.case_type} facts establish no whole compensable days.`);
	return days;
}

/** Each qualification's standing for this event. */
export type ClaimStatus =
	| 'NOT_APPLICABLE'
	| 'UNDECLARED'
	| 'NOT_CLAIMED'
	| 'DOCUMENTED_FOR_EVENT'
	| 'DOCUMENT_MISSING_OR_OUTSIDE_EVENT';

/** A claim applies where its fact's `required_when` holds; it counts only where its qualification does. */
export function claimStatuses(type: BenefitCaseType, site: CaseSite): Record<string, ClaimStatus> {
	return Object.fromEntries(
		(type.qualifications ?? []).map((q) => {
			const claim = type.facts.find((field) => field.key === q.claim);
			const applies = claim?.required_when == null || holds(site)(claim.required_when);
			const recorded = site.recorded[q.claim];
			const status: ClaimStatus = !applies
				? 'NOT_APPLICABLE'
				: recorded === undefined
					? 'UNDECLARED'
					: recorded !== true
						? 'NOT_CLAIMED'
						: site.facts[q.key] === true
							? 'DOCUMENTED_FOR_EVENT'
							: 'DOCUMENT_MISSING_OR_OUTSIDE_EVENT';
			return [q.key, status];
		})
	);
}

/** The first claim declared true that its qualification does not prove, as its refusal. */
export function unprovenClaim(type: BenefitCaseType, site: CaseSite): string | null {
	const statuses = claimStatuses(type, site);
	return (
		(type.qualifications ?? []).find((q) => statuses[q.key] === 'DOCUMENT_MISSING_OR_OUTSIDE_EVENT')
			?.message ?? null
	);
}

/** One coverage month on a member's evidenced contribution statement, including an unpaid month. */
export type ContributionMonth = {
	readonly scheme_code?: string | null | undefined;
	readonly coverage_month: string;
	readonly credited_amount: number | string | Decimal;
	readonly paid_on?: string | null | undefined;
	readonly source_reference: string;
};

const centPrecise = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) <= 1e-7;

/** A statement month as recorded: its month, reference, and a credit only where it was paid. `cap` is the case type's. */
export function validateContributionMonth(row: Partial<ContributionMonth>, cap?: number): void {
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.coverage_month ?? ''))
		refuse('A contribution coverage month must be YYYY-MM.');
	if (!(row.scheme_code ?? 'unset').trim()) refuse('A contribution month names its scheme.');
	if (!(row.source_reference ?? '').trim())
		refuse('A contribution month needs its contribution-statement reference.');
	const credit = decodeNumber(row.credited_amount);
	if (
		!Number.isFinite(credit) ||
		credit < 0 ||
		(cap != null && credit > cap) ||
		!centPrecise(credit)
	)
		refuse(
			cap == null
				? 'A monthly credit is a nonnegative amount to the cent.'
				: `A monthly credit is 0–${cap} to the cent.`
		);
	if (row.paid_on == null) {
		if (credit !== 0) refuse('An unpaid contribution month cannot carry a monthly credit.');
	} else if (!isCalendarDate(dateKey(row.paid_on)) || credit <= 0) {
		refuse('A paid contribution month needs a payment day and a positive monthly credit.');
	}
}

/** Frozen paid-month inputs; an attached statement is required before a candidate can fund cash. */
export function snapshotContributionMonths(
	months: readonly (ContributionMonth & {
		readonly id: string;
		readonly evidence_file?: unknown;
	})[],
	from: string,
	through: string
): string {
	const relevant = months
		.filter((row) => row.coverage_month >= from && row.coverage_month <= through)
		.toSorted((left, right) => left.coverage_month.localeCompare(right.coverage_month));
	if (relevant.some((row) => row.evidence_file == null || row.evidence_file === ''))
		refuse(
			'A frozen advance candidate needs an attached contribution statement for each month of its window.'
		);
	return JSON.stringify(
		relevant.map((row) => ({
			id: row.id,
			coverage_month: row.coverage_month,
			credited_amount: decodeNumber(row.credited_amount),
			paid_on: row.paid_on == null ? null : dateKey(row.paid_on),
			source_reference: row.source_reference
		}))
	);
}

const snapshotMonthSchema = Schema.Struct({
	id: Schema.String,
	coverage_month: Schema.String,
	credited_amount: Schema.Finite,
	paid_on: Schema.NullOr(Schema.String),
	source_reference: Schema.String
});

/** The frozen months `snapshotContributionMonths` wrote, read back as their row ids. */
export function readSnapshotMonthIds(snapshot: string): readonly string[] {
	const decoded: unknown = JSON.parse(snapshot);
	if (!Array.isArray(decoded)) refuse('An advance plan has an invalid frozen statement history.');
	return decoded.map(
		(month) =>
			Schema.decodeUnknownSync(snapshotMonthSchema, { onExcessProperty: 'ignore' })(month).id
	);
}

/** `YYYY-MM` `offset` months from a `YYYY-MM-DD` day's month. */
const monthFrom = (day: string, offset: number) =>
	new Date(Date.UTC(decodeNumber(day.slice(0, 4)), decodeNumber(day.slice(5, 7)) - 1 + offset, 1))
		.toISOString()
		.slice(0, 7);

/**
 * The scheme award a complete statement window supports, before any actual award: the highest
 * credits paid before the window closes, times the compensable days over the daily divisor.
 */
export function calculateBenefitCandidate(input: {
	readonly case_type: BenefitCaseType;
	readonly benefit_case: CaseFacts;
	readonly evidence?: readonly CaseEvidence[] | undefined;
	readonly months: readonly ContributionMonth[];
}) {
	const type = input.case_type;
	const date = dateKey(input.benefit_case.event_on);
	if (!isCalendarDate(date)) refuse('A benefit case event needs a real calendar date.');
	if (date < type.min_event_on)
		refuse(`The ${type.case_type} rules price an event on or after ${type.min_event_on}.`);
	if (!type.event_kinds.includes(input.benefit_case.event_kind ?? ''))
		refuse(`Unknown ${type.case_type} event kind.`);
	const factFault = caseFactsFault(type, input.benefit_case);
	if (factFault != null) refuse(factFault);
	const site = caseSite(type, input.benefit_case, input.evidence);
	const unproven = unprovenClaim(type, site);
	if (unproven != null) refuse(unproven);
	const closesBack = evaluateNumber(
		expressionEngine,
		type.credit_window.ends_months_before_event,
		site
	);
	const closes = `${monthFrom(date, -closesBack)}-01`;
	const expected = Array.from({ length: type.credit_window.months }, (_, index) =>
		monthFrom(closes, index - type.credit_window.months)
	);
	const byMonth = new Map<string, ContributionMonth>();
	for (const row of input.months) {
		if ((row.scheme_code ?? type.credit_scheme) !== type.credit_scheme) continue;
		if (row.coverage_month < expected[0]! || row.coverage_month > expected.at(-1)!) continue;
		validateContributionMonth(row, type.credit_cap);
		if (byMonth.has(row.coverage_month)) refuse('Duplicate contribution coverage month.');
		byMonth.set(row.coverage_month, row);
	}
	if (expected.some((month) => !byMonth.has(month)))
		refuse(
			`A benefit cash calculation needs all ${type.credit_window.months} ${type.credit_scheme} contribution months.`
		);
	const paidCredits = expected
		.map((month) => byMonth.get(month)!)
		.filter((row) => row.paid_on != null && dateKey(row.paid_on) < closes)
		.map((row) => Math.round(decodeNumber(row.credited_amount) * 100));
	const qualified = paidCredits.length >= type.credit_min_count;
	const top = paidCredits.sort((a, b) => b - a).slice(0, type.credit_top_count);
	const totalCents = top.reduce((sum, credit) => sum + credit, 0);
	const days = compensableDays(type, site);
	return {
		qualifying_window: { from: expected[0]!, through: expected.at(-1)! },
		window_closes_on: closes,
		paid_months: paidCredits.length,
		contribution_qualified: qualified,
		total_credit: qualified ? totalCents / 100 : 0,
		daily_credit: qualified ? totalCents / (type.daily_divisor * 100) : 0,
		compensable_days: days,
		candidate_benefit: qualified ? Math.round((totalCents * days) / type.daily_divisor) / 100 : 0
	};
}

/** A positive amount to the cent, or NaN. */
export const positiveCents = (value: Amount | null | undefined): number => {
	const amount = value == null ? Number.NaN : decodeNumber(value);
	return Number.isFinite(amount) && amount > 0 && centPrecise(amount) ? amount : Number.NaN;
};

/** A movement kind's direction and component, as its case type declares it. */
export function movementKind(type: BenefitCaseType, kind: string) {
	const declared = type.movement_kinds.find((row) => row.code === kind);
	if (declared == null) refuse(`${type.case_type} declares no cash movement ${kind}.`);
	return declared;
}

/** The movement kinds that are money paid to the employee. */
export const employeePaymentKinds = (type: BenefitCaseType) =>
	type.movement_kinds.flatMap((row) => (row.direction === 'EMPLOYEE_PAYMENT' ? [row.code] : []));

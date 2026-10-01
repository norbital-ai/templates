import type { Decimal } from '@norbital-ai/std/decimal';
import { Schema } from 'effect';
import * as Predicate from 'effect/Predicate';
import type { BenefitCaseType } from '../datatypes/case_types.js';
import type { PayrollSettings } from '../datatypes/payroll_settings.js';
import { factScalar } from '../datatypes/fact_keys.js';
import { factValuesFault } from '../declared-facts.js';
import { evidenceFault } from '../entity-facts.js';
import { EMPTY_OF } from '../expressions/compile.js';
import { EXPRESSION_CONTEXTS } from '../expressions/contexts.js';
import {
	evaluateBoolean,
	evaluateDate,
	evaluateNumber,
	expressionEngine
} from '../expressions/evaluate.js';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { governed, isInForceCandidate, settingsInForce } from '../jurisdiction_settings.js';
import { addDays, inclusiveDays, periodMonth } from '../payroll/run/dates.js';
import { cents } from '../payroll/run/rounding.js';
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

/** A case as the engine reads it: its event, its span and its recorded facts. */
export type CaseFacts = {
	readonly event_kind?: string | null | undefined;
	readonly event_on?: string | null | undefined;
	readonly application_on?: string | null | undefined;
	readonly leave_from?: string | null | undefined;
	readonly leave_through?: string | null | undefined;
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

/** One contribution credit the case reads: a statement month paid before its window closed. */
export type CaseCredit = {
	readonly period: string;
	readonly amount: number;
	readonly paid_on: string;
};
/** One month of saved pay before the event. */
export type CaseEarning = { readonly period: string; readonly amount: number };
/** One earlier case of the same person. */
export type PreviousCase = {
	readonly kind: string;
	readonly started_on: string;
	readonly ended_on: string;
	readonly days: number;
};

/** What a case reads beyond its own row; each is empty (or 0) where the caller has none. */
export type CaseInputs = {
	readonly credits?: readonly CaseCredit[] | undefined;
	readonly earnings?: readonly CaseEarning[] | undefined;
	readonly previous?: readonly PreviousCase[] | undefined;
	/** The actual award recorded for the case. */
	readonly award?: number | undefined;
	/** The monthly salary the case's pay replaces. */
	readonly salary?: number | undefined;
	/** The employee's premium shares over the case, summed. */
	readonly premiums?: number | undefined;
};

const day = (value: string | null | undefined) => {
	const date = dateKey(value);
	return isCalendarDate(date) ? date : '';
};

/**
 * The `case` site every case-type expression reads: `case.*` (the event, the span, the declared
 * facts — a missing one reads as its default or empty value — with the qualifications beside them,
 * the fact keys whose evidence is recorded, and the pay inputs), `phase.*` (blank until a phase is
 * priced), `credits`, `earnings` and `previous`. `recorded` is the raw record, so an undeclared
 * claim stays apart from a false one; it is not an expression root.
 */
export function caseSite(
	type: BenefitCaseType,
	row: CaseFacts,
	evidence: readonly CaseEvidence[] = [],
	inputs: CaseInputs = {}
) {
	const recorded: Record<string, Scalar> = Object.fromEntries(
		Object.entries(row.facts ?? {}).filter(
			(entry): entry is [string, Scalar] =>
				Predicate.isString(entry[1]) ||
				Predicate.isNumber(entry[1]) ||
				Predicate.isBoolean(entry[1])
		)
	);
	const eventOn = day(row.event_on);
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
	const blank = EXPRESSION_CONTEXTS.case.blank as {
		readonly person: object;
		readonly phase: object;
	};
	const site = {
		person: structuredClone(blank.person),
		case: {
			kind: type.case_type,
			event_kind: row.event_kind ?? '',
			event_on: eventOn,
			event_month: eventOn === '' ? 0 : decodeNumber(eventOn.slice(5, 7)),
			application_on: day(row.application_on),
			started_on: day(row.leave_from) || eventOn,
			ended_on: day(row.leave_through),
			facts,
			evidenced,
			award: inputs.award ?? 0,
			salary: inputs.salary ?? 0,
			premiums: inputs.premiums ?? 0
		},
		phase: { ...blank.phase } as Record<string, string | number>,
		credits: inputs.credits ?? [],
		earnings: inputs.earnings ?? [],
		previous: inputs.previous ?? []
	};
	for (const q of type.qualifications ?? [])
		facts[q.key] = evaluateBoolean(expressionEngine, q.when, site);
	return { ...site, recorded };
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

/** One priced phase: its days from the case's first day, and each money figure it declares. */
export type PricedPhase = {
	readonly code: string;
	readonly index: number;
	readonly start: string;
	readonly end: string;
	readonly days: number;
	readonly award: number;
	readonly wage: number;
	/** Signed: a negative figure pays nothing (`employerPays`). */
	readonly employer_pays: number;
	readonly reimbursable: number;
};

/** The phases with days, in order, each running on from the one before; money is not evaluated. */
function phaseSpans(type: BenefitCaseType, site: CaseSite) {
	let start = site.case.started_on;
	const spans: { code: string; index: number; start: string; end: string; days: number }[] = [];
	for (const [position, phase] of type.phases.entries()) {
		const at = { code: phase.code, index: position + 1, start, end: '', days: 0, day_index: 0 };
		const days = evaluateNumber(expressionEngine, phase.days, { ...site, phase: at });
		if (!Number.isInteger(days) || days < 0)
			refuse(`The ${type.case_type} ${phase.code} phase establishes no whole days.`);
		if (days === 0) continue;
		const end = start === '' ? '' : addDays(start, days - 1);
		spans.push({ ...at, end, days });
		start = end === '' ? '' : addDays(end, 1);
	}
	return spans;
}

/** The case's compensable days: the days of its phases. */
export function compensableDays(type: BenefitCaseType, site: CaseSite): number {
	const days = phaseSpans(type, site).reduce((total, span) => total + span.days, 0);
	if (days <= 0) refuse(`The ${type.case_type} facts establish no whole compensable days.`);
	return days;
}

/** Every phase with days, priced: each money expression over the site and the phase so far. */
export function casePhases(
	type: BenefitCaseType,
	site: CaseSite,
	currency?: string
): PricedPhase[] {
	const spans = phaseSpans(type, site);
	if (spans.length === 0)
		refuse(`The ${type.case_type} facts establish no whole compensable days.`);
	return spans.map((span) => {
		const phase = type.phases[span.index - 1]!;
		const priced: Record<string, string | number> = { ...span, day_index: 0 };
		const money = (key: string, expression: string | null | undefined) => {
			priced[key] =
				expression == null
					? 0
					: cents(
							evaluateNumber(expressionEngine, expression, { ...site, phase: priced }),
							currency
						);
		};
		money('award', phase.award);
		money('wage', phase.wage);
		money('employer_pays', phase.employer_pays);
		money('reimbursable', phase.reimbursable);
		return {
			...span,
			award: priced['award'] as number,
			wage: priced['wage'] as number,
			employer_pays: priced['employer_pays'] as number,
			reimbursable: priced['reimbursable'] as number
		};
	});
}

/** A signed employer figure as paid: never below nothing. */
export const employerPays = (signed: number) => Math.max(0, signed);

/** The day the employer must have advanced the award, or '' where the case type declares none. */
export function advanceDue(type: BenefitCaseType, site: CaseSite): string {
	const expression = type.advance_due?.trim();
	return expression ? evaluateDate(expressionEngine, expression, site) : '';
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
						: site.case.facts[q.key] === true
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
 * A case's statement window: its months, its close, and the credits paid before the close. Every
 * month of the window must be recorded; the credits' worth is the phases' `award`, not this.
 */
export function windowCredits(
	type: BenefitCaseType,
	benefitCase: CaseFacts,
	evidence: readonly CaseEvidence[] | undefined,
	months: readonly ContributionMonth[]
) {
	const window = type.credits;
	if (window == null) refuse(`${type.case_type} prices no contribution credits.`);
	const date = dateKey(benefitCase.event_on);
	const closesBack = evaluateNumber(
		expressionEngine,
		window.closes_months_before_event,
		caseSite(type, benefitCase, evidence)
	);
	const closes = `${monthFrom(date, -closesBack)}-01`;
	const expected = Array.from({ length: window.months }, (_, index) =>
		monthFrom(closes, index - window.months)
	);
	const byMonth = new Map<string, ContributionMonth>();
	for (const row of months) {
		if ((row.scheme_code ?? window.scheme) !== window.scheme) continue;
		if (row.coverage_month < expected[0]! || row.coverage_month > expected.at(-1)!) continue;
		validateContributionMonth(row, window.cap);
		if (byMonth.has(row.coverage_month)) refuse('Duplicate contribution coverage month.');
		byMonth.set(row.coverage_month, row);
	}
	if (expected.some((month) => !byMonth.has(month)))
		refuse(
			`A benefit cash calculation needs all ${window.months} ${window.scheme} contribution months.`
		);
	const credits: CaseCredit[] = expected
		.map((month) => byMonth.get(month)!)
		.filter((row) => row.paid_on != null && dateKey(row.paid_on) < closes)
		.map((row) => ({
			period: row.coverage_month,
			amount: decodeNumber(row.credited_amount),
			paid_on: dateKey(row.paid_on)
		}));
	return {
		qualifying_window: { from: expected[0]!, through: expected.at(-1)! },
		window_closes_on: closes,
		credits
	};
}

/** The refusal a case's event and claims earn before any figure is priced, or nothing. */
function assertPriceable(
	type: BenefitCaseType,
	benefitCase: CaseFacts,
	evidence: readonly CaseEvidence[] | undefined
) {
	const date = dateKey(benefitCase.event_on);
	if (!isCalendarDate(date)) refuse('A benefit case event needs a real calendar date.');
	if (date < type.min_event_on)
		refuse(`The ${type.case_type} rules price an event on or after ${type.min_event_on}.`);
	if (!type.event_kinds.includes(benefitCase.event_kind ?? ''))
		refuse(`Unknown ${type.case_type} event kind.`);
	const factFault = caseFactsFault(type, benefitCase);
	if (factFault != null) refuse(factFault);
	const unproven = unprovenClaim(type, caseSite(type, benefitCase, evidence));
	if (unproven != null) refuse(unproven);
}

/**
 * The scheme award a complete statement window supports, before any actual award: the case
 * type's phases priced over the credits paid before the window closes.
 */
export function calculateBenefitCandidate(input: {
	readonly case_type: BenefitCaseType;
	readonly benefit_case: CaseFacts;
	readonly evidence?: readonly CaseEvidence[] | undefined;
	readonly months: readonly ContributionMonth[];
	readonly currency?: string | undefined;
}) {
	const type = input.case_type;
	if (type.credits == null) refuse(`${type.case_type} prices no contribution credits.`);
	assertPriceable(type, input.benefit_case, input.evidence);
	const window = windowCredits(type, input.benefit_case, input.evidence, input.months);
	const phases = casePhases(
		type,
		caseSite(type, input.benefit_case, input.evidence, { credits: window.credits }),
		input.currency
	);
	return {
		qualifying_window: window.qualifying_window,
		window_closes_on: window.window_closes_on,
		paid_months: window.credits.length,
		compensable_days: phases.reduce((total, phase) => total + phase.days, 0),
		candidate_benefit: cents(
			phases.reduce((total, phase) => total + phase.award, 0),
			input.currency
		),
		phases
	};
}

/**
 * The whole case priced from what it reads: every phase's days, award, wage, employer pay and
 * refund, and the employer's outlay and net cost. The employer's outlay is its own pay, plus the
 * award where the case type has the employer advance it (`advance_due`); the refund comes off it.
 */
export function assessCase(input: {
	readonly case_type: BenefitCaseType;
	readonly benefit_case: CaseFacts;
	readonly evidence?: readonly CaseEvidence[] | undefined;
	readonly inputs: CaseInputs;
	readonly currency?: string | undefined;
}) {
	const type = input.case_type;
	assertPriceable(type, input.benefit_case, input.evidence);
	const site = caseSite(type, input.benefit_case, input.evidence, input.inputs);
	const phases = casePhases(type, site, input.currency);
	const total = (pick: (phase: PricedPhase) => number) =>
		cents(
			phases.reduce((sum, phase) => sum + pick(phase), 0),
			input.currency
		);
	const award = total((phase) => phase.award);
	const employer = employerPays(total((phase) => phase.employer_pays));
	const dueOn = advanceDue(type, site);
	const outlay = cents(employer + (dueOn === '' ? 0 : award), input.currency);
	const reimbursable = total((phase) => phase.reimbursable);
	return {
		compensable_days: phases.reduce((sum, phase) => sum + phase.days, 0),
		award,
		wage: total((phase) => phase.wage),
		employer_pays: employer,
		reimbursable,
		advance_due_on: dueOn === '' ? null : dueOn,
		employer_outlay: outlay,
		employer_net_cost: cents(outlay - reimbursable, input.currency),
		phases
	};
}

/** Saved pay per month, over the `months` months before the event's month, oldest first. */
export async function readCaseEarnings(
	db: Reads,
	employmentId: string,
	eventOn: string,
	months: number
): Promise<CaseEarning[]> {
	const from = monthFrom(eventOn, -months);
	const through = monthFrom(eventOn, -1);
	const slips = await readAll<{
		readonly payroll_run_id: string;
		readonly paid_at?: string | null;
		readonly gross: unknown;
	}>(db, 'payslips', { employment_id: { eq: employmentId } }, undefined, {
		payroll_run_id: true,
		paid_at: true,
		gross: true
	});
	const paid = slips.filter((slip) => slip.paid_at != null);
	const runs =
		paid.length === 0
			? []
			: await readAll<{ readonly id: string; readonly period: string }>(
					db,
					'payroll_runs',
					{ id: { in: [...new Set(paid.map((slip) => slip.payroll_run_id))] } },
					undefined,
					{ id: true, period: true }
				);
	const monthOf = new Map(runs.map((run) => [run.id, periodMonth(run.period)]));
	// ponytail: gross by the run's month; read history.slips (wage month, classes) when a case type
	// needs earnings by class or arrears in their own month.
	const byMonth = new Map<string, number>();
	for (const slip of paid) {
		const month = monthOf.get(slip.payroll_run_id);
		if (month == null || month < from || month > through) continue;
		byMonth.set(month, (byMonth.get(month) ?? 0) + (decodeNumber(slip.gross) || 0));
	}
	return [...byMonth]
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([period, amount]) => ({ period, amount }));
}

/** A person's cases before this one, oldest first, as `previous` reads them. */
export function previousCases(
	caseId: string,
	started: string,
	rows: readonly (CaseFacts & { readonly id: string; readonly case_type: string })[]
): PreviousCase[] {
	return rows
		.flatMap((row) => {
			const start = day(row.leave_from) || day(row.event_on);
			if (row.id === caseId || start === '' || (started !== '' && start >= started)) return [];
			const end = day(row.leave_through);
			return [
				{
					kind: row.case_type,
					started_on: start,
					ended_on: end,
					days: end === '' ? 0 : inclusiveDays(start, end)
				}
			];
		})
		.toSorted((left, right) => left.started_on.localeCompare(right.started_on));
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

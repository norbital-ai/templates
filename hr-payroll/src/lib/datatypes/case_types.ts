import { Schema } from 'effect';
import { isCalendarDate } from '../iso-day.js';
import { factKeySchema, type FactKey } from './fact_keys.js';

/**
 * One phase of a case: a run of consecutive calendar days, each figure a stored expression over the
 * `case` site (`case.*`, `phase.*`, `credits`, `earnings`, `previous`, `person.*`). The phases run in
 * order from the case's first day; a phase whose `days` is 0 is skipped. The money figures are
 * evaluated in the order written, each seeing the ones before it on `phase.*`: `award`, then
 * `wage`, then `employer_pays`, then `reimbursable`.
 */
export type CasePhase = {
	readonly code: string;
	/** Whole calendar days of the phase. */
	readonly days: string;
	/** Money a scheme, insurer or government awards for the phase (`phase.award` after it). */
	readonly award: string;
	/** Money: the pay the phase replaces, the base cutoff shares are allocated on (`phase.wage`). */
	readonly wage?: string | null;
	/**
	 * Money the employer itself owes for the phase: a top-up, a differential, wages it keeps paying.
	 * A negative result pays nothing; its signed figure is still reported (`phase.employer_pays`).
	 */
	readonly employer_pays: string;
	/** Money of the employer's outlay (an advanced award, its own pay) a third party refunds it. */
	readonly reimbursable: string;
};

/**
 * A benefit case a leave code opens — maternity, sickness, work injury, a government-paid leave —
 * as stored configuration. The case records its facts and event; every figure it prices is a phase
 * expression. Deadlines beyond the advance are `duty_types` with subject CASE (`caseDutyEvents`).
 */
export type BenefitCaseType = {
	/** The leave catalogue code the case prices; its per-event entries are the case's leave. */
	readonly case_type: string;
	/** The case's recorded facts; `valid_when` and `required_when` are judged on every write. */
	readonly facts: readonly FactKey[];
	/**
	 * Derived booleans added to `case.facts` (and to `event.case.facts` for the leave grant): a claim
	 * fact declared true counts only where `when` holds; otherwise the case refuses with `message`.
	 */
	readonly qualifications?:
		| readonly {
				readonly key: string;
				readonly claim: string;
				readonly when: string;
				readonly message: string;
		  }[]
		| null;
	/** The event kinds a case records; the first is the kind an expected event anticipates. */
	readonly event_kinds: readonly string[];
	/** Dated cash evidence: money paid to the employee, or a third party's refund received by the employer. */
	readonly movement_kinds: readonly {
		readonly code: string;
		readonly direction: 'EMPLOYEE_PAYMENT' | 'EMPLOYER_RECEIPT';
		readonly component: string;
	}[];
	/** The two cash components a payable tranche settles: the phases' award and the employer's pay. */
	readonly components: { readonly award: string; readonly differential: string };
	/** The earliest event the rules price. */
	readonly min_event_on: string;
	/**
	 * The contribution-statement window the award reads as `credits`: `months` coverage months of
	 * `scheme`, ending the month before the window closes, which is `closes_months_before_event` (an
	 * expression) months before the event's month. Every month must be recorded (and each credit at
	 * most `cap`); only credits paid before the close are `credits`. Absent, the case reads none.
	 */
	readonly credits?: {
		readonly scheme: string;
		readonly cap: number;
		readonly months: number;
		readonly closes_months_before_event: string;
	} | null;
	/** The months of saved pay before the event's month the case reads as `earnings`; absent reads none. */
	readonly earnings?: { readonly months: number } | null;
	readonly phases: readonly CasePhase[];
	/** Of the leave span, at least this many days (capped at the case's days) fall on or after the event. */
	readonly min_days_after_event: number;
	/** The day the employer must have advanced the award: a date expression; absent, it advances none. */
	readonly advance_due?: string | null;
	/** The statutory schemes whose employee shares a cutoff records (`case.premiums`), by `statutory_contributions` code. */
	readonly premium_schemes: readonly string[];
	/** The facts a claimed exemption from the employer's pay states together, all or none. */
	readonly differential_exemption_facts: readonly string[];
	readonly authority: string;
};

const count = (value: number, least: number) => Number.isInteger(value) && value >= least;
const blank = (value: string | null | undefined) => (value ?? '').trim() === '';

/** The first fault of one case type, or undefined. */
export function caseTypeFault(row: BenefitCaseType): string | undefined {
	const at = `benefit_cases.${row.case_type || '?'}`;
	if (row.case_type === '' || row.authority === '')
		return `${at}: a case type states its leave code and authority`;
	if (!row.facts.every(Schema.is(factKeySchema))) return `${at}: every fact is a fact key`;
	const keys = new Set(row.facts.map((field) => field.key));
	if (keys.size !== row.facts.length) return `${at}: fact keys are unique`;
	if (
		(row.qualifications ?? []).some(
			(q) =>
				keys.has(q.key) ||
				row.facts.find((field) => field.key === q.claim)?.type !== 'boolean' ||
				blank(q.when) ||
				blank(q.message)
		)
	)
		return `${at}: a qualification names a new key, a boolean claim fact, its condition and message`;
	if (!row.differential_exemption_facts.every((key) => keys.has(key)))
		return `${at}: exemption facts are declared facts`;
	if (row.event_kinds.length === 0 || new Set(row.event_kinds).size !== row.event_kinds.length)
		return `${at}: event kinds are nonempty and unique`;
	const components = [row.components.award, row.components.differential];
	if (
		components.some((code) => code === '') ||
		components[0] === components[1] ||
		row.movement_kinds.some((kind) => kind.code === '' || !components.includes(kind.component)) ||
		new Set(row.movement_kinds.map((kind) => kind.code)).size !== row.movement_kinds.length
	)
		return `${at}: movement kinds are unique and settle a declared component`;
	if (!isCalendarDate(row.min_event_on)) return `${at}: min_event_on is a calendar day`;
	const credits = row.credits;
	if (
		credits != null &&
		(credits.scheme === '' ||
			!(credits.cap > 0) ||
			!count(credits.months, 1) ||
			blank(credits.closes_months_before_event))
	)
		return `${at}: a credit window names its scheme, a positive cap, its months and its close`;
	if (row.earnings != null && !count(row.earnings.months, 1))
		return `${at}: an earnings window reads at least one month`;
	if (row.phases.length === 0) return `${at}: a case type declares at least one phase`;
	const codes = row.phases.map((phase) => phase.code);
	if (codes.some((code) => code === '') || new Set(codes).size !== codes.length)
		return `${at}: phase codes are nonempty and unique`;
	if (
		row.phases.some(
			(phase) =>
				blank(phase.days) ||
				blank(phase.award) ||
				blank(phase.employer_pays) ||
				blank(phase.reimbursable) ||
				(phase.wage != null && blank(phase.wage))
		)
	)
		return `${at}: every phase states its days, award, employer pay and reimbursable amount`;
	if (row.advance_due != null && blank(row.advance_due))
		return `${at}: an advance deadline is a date expression`;
	if (!count(row.min_days_after_event, 0) || row.premium_schemes.some((code) => code === ''))
		return `${at}: the days after the event and the premium schemes are stated`;
	return undefined;
}

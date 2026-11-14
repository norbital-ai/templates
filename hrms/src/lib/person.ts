import { DateTime, Duration } from 'effect';
import { inForce, type Change } from './dated.js';
import type { LeaveDays } from './payroll_engine/attendance.js';
import {
	isDynObject,
	jsonObject,
	type Json,
	type JsonObject
} from './payroll_engine/foundation.js';

/** What was agreed with a person changes by date: a `contract_terms` row holds any of these. */
export const TERM_FIELDS = [
	'rate',
	'normal_hours_per_day',
	'normal_hours_per_week',
	'normal_days_per_week',
	'employer_bears_income_tax',
	'employee_borne_tax_items',
	'job_title',
	'department',
	'statutory_work_category',
	'work_classification',
	'work_region',
	'worksite',
	'shift_pattern_id',
	'notice_period',
	'annual_leave_carry_limit_days',
	'wage_payment_method',
	'allowances',
	'probation_period',
	'engagement',
	'pay_group_id',
	'signed_contract_period'
] as const;

/** What the law is told about a person changes by date: a `statutory_parameters` row holds any of these. */
export const PARAMETER_FIELDS = [
	'residency_status',
	'work_authorisation_category',
	'work_authorisation_expires_on',
	'marital_status',
	'nationality',
	'passport_number',
	'parameters'
] as const;

/** The stint's own fields: what `employmentOn` carries of it as it stands. */
export const STINT_FIELDS = [
	'id',
	'employee_id',
	'entity_id',
	'employee_number',
	'effective_range',
	'service_started_on',
	'exit_ground',
	'encash_leave',
	'final_pay_due_on',
	'reason',
	'events'
] as const;

/** What `employmentOn` and `startsOf` read of the profile. */
export const PROFILE_FIELDS = [
	'id',
	'cumulative_service',
	'date_of_birth',
	'identity_number',
	'gender',
	'birth_city',
	'bank'
] as const;

/** The agreed terms a contract held beside its `terms`. */
const BESIDE_TERMS = ['engagement', 'pay_group_id', 'signed_contract_period'] as const;
/** The parameters a contract held among its `terms`; the others sat under `payroll`, with the person's particulars. */
const AMONG_TERMS = [
	'residency_status',
	'work_authorisation_category',
	'work_authorisation_expires_on'
] as const;
const PARTICULARS = ['date_of_birth', 'identity_number', 'gender', 'birth_city'] as const;
const UNDER_PAYROLL = ['marital_status', 'nationality', 'passport_number'] as const;
const FAMILY = [
	'relation',
	'born_on',
	'expected_on',
	'has_income',
	'disabled',
	'studying',
	'allocations'
] as const;

/** The fields of a row that hold a value. */
const held = (row: JsonObject, fields: readonly string[]): JsonObject =>
	Object.fromEntries(
		fields.flatMap((field) => {
			const value = row[field];
			return value == null ? [] : [[field, value]];
		})
	);

/** A dated row as the fold reads it: the fields it sets, and `null` for each it takes away (`clears`). */
const changeOf =
	(fields: readonly string[]) =>
	(row: JsonObject): Change => ({
		id: String(row.id),
		effective_from: String(row.effective_from),
		patch: {
			...Object.fromEntries(
				(Array.isArray(row.clears) ? row.clears : []).flatMap((name): [string, Json][] =>
					fields.some((field) => field === name) ? [[String(name), null]] : []
				)
			),
			...held(row, fields)
		}
	});

export const termsChange = changeOf(TERM_FIELDS);
export const parametersChange = changeOf(PARAMETER_FIELDS);

/** One stint with everything that says how it stands on a day: its dated rows, its person and their dependants. */
export interface Parts {
	readonly stint: JsonObject;
	readonly terms: readonly JsonObject[];
	readonly parameters: readonly JsonObject[];
	readonly profile: JsonObject;
	readonly dependants: readonly JsonObject[];
}

/** The stints a read holds, each with its own rows: the five roots as read, on plain ids. */
export const partsIn = (
	found: Readonly<Record<string, readonly JsonObject[] | undefined>>
): readonly Parts[] => {
	const terms = Map.groupBy(found.contract_terms ?? [], (row) => String(row.employment_id));
	const parameters = Map.groupBy(found.statutory_parameters ?? [], (row) =>
		String(row.employment_id)
	);
	const profiles = new Map((found.employee_profile ?? []).map((row) => [String(row.id), row]));
	const dependants = Map.groupBy(found.dependant ?? [], (row) => String(row.employee_id));
	return (found.employment ?? []).map((stint) => ({
		stint,
		terms: terms.get(String(stint.id)) ?? [],
		parameters: parameters.get(String(stint.id)) ?? [],
		profile: profiles.get(String(stint.employee_id)) ?? {},
		dependants: dependants.get(String(stint.employee_id)) ?? []
	}));
};

/**
 * A stint on a day, as formulas, rules and the ledger read an employment: its own fields, the terms and parameters in
 * force that day, the person's particulars and their dependants. A term or parameter no row has set is absent.
 */
export const employmentOn = (parts: Parts, day: string): JsonObject => {
	const { stint, profile } = parts;
	const agreed = inForce(parts.terms.map(termsChange), day).state;
	const told = inForce(parts.parameters.map(parametersChange), day).state;
	// the signed date is the row's that last changed a term
	const last = parts.terms
		.filter((row) => String(row.effective_from) <= day)
		.toSorted((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)))
		.at(-1);
	return {
		...Object.fromEntries(STINT_FIELDS.map((field) => [field, stint[field] ?? null])),
		...Object.fromEntries(BESIDE_TERMS.map((field) => [field, agreed[field] ?? null])),
		terms: {
			...Object.fromEntries(
				Object.entries(agreed).filter(([field]) => !BESIDE_TERMS.some((name) => name === field))
			),
			...held(last ?? {}, ['signed_on']),
			...held(told, AMONG_TERMS)
		},
		payroll: { ...held(profile, PARTICULARS), ...held(told, UNDER_PAYROLL) },
		family: parts.dependants.map((row) => held(row, FAMILY)),
		bank: profile.bank ?? null,
		employee_extension_data: told.parameters ?? {}
	};
};

/** A stint as the chain reads it: `id`, `employee_id`, `entity_id`, `effective_range`, `service_started_on`. */
type Stint = Readonly<Record<string, unknown>>;

const rangeOf = (stint: Stint) => {
	const range = isDynObject(stint.effective_range) ? stint.effective_range : {};
	return { from: String(range.from), to: typeof range.to === 'string' ? range.to : null };
};

const dayBefore = (day: string) =>
	DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(day), { days: -1 }));

/**
 * The stretches of a stint between its changes: from its first day and from each later row of either family, each to
 * the day before the next, the last to the stint's last day. Within one, the stint stands on one set of terms and
 * parameters.
 */
export const segmentsOf = (
	parts: Pick<Parts, 'stint' | 'terms' | 'parameters'>
): readonly { readonly from: string; readonly to: string | null }[] => {
	const { from, to } = rangeOf(parts.stint);
	if (to !== null && to < from) return [];
	const starts = [
		...new Set([
			from,
			...[...parts.terms, ...parts.parameters]
				.map((row) => String(row.effective_from))
				.filter((day) => day > from && (to === null || day <= to))
		])
	].toSorted();
	return starts.map((start, index) => {
		const next = starts[index + 1];
		return { from: start, to: next === undefined ? to : dayBefore(next) };
	});
};

/** A stint on the terms agreed by a pay date: a row signed after it is left out. */
export const termsBy = (parts: Parts, payDate: string): Parts => ({
	...parts,
	terms: parts.terms.filter(
		(row) => !(typeof row.signed_on === 'string' && row.signed_on > payDate)
	)
});

/**
 * An exit is read from a person's stints: one with a last day, and no stint of theirs starting after it under the same
 * law. `lawCodeOf` names each entity's `settings_code`.
 */
export const isExit = (
	stint: Stint,
	stints: readonly Stint[],
	lawCodeOf: ReadonlyMap<string, string>
): boolean => {
	const { to } = rangeOf(stint);
	if (to === null) return false;
	const code = lawCodeOf.get(String(stint.entity_id));
	return !stints.some(
		(other) =>
			other.employee_id === stint.employee_id &&
			isDynObject(other.effective_range) &&
			String(other.effective_range.from) > to &&
			lawCodeOf.get(String(other.entity_id)) === code
	);
};

/** When a person's service began, and when their current unbroken employment did, as expressions read them. */
export type Starts = {
	readonly service_started_on: string;
	readonly employment_started_on: string;
};

/**
 * When the person's service began, which anchors their service windows, and when the current unbroken employment under
 * the stint's law began. With `cumulative` (the profile's `cumulative_service`) every stint counts, rehires included: the
 * latest employment's start, less the days of the earlier ones; without it, only the current one. The stint's
 * `service_started_on` wins where it is earlier: service credited from elsewhere.
 */
export const startsOf = (
	stint: Stint,
	stints: readonly Stint[],
	lawCodeOf: ReadonlyMap<string, string>,
	cumulative: boolean
): Starts => {
	const code = lawCodeOf.get(String(stint.entity_id));
	const unbroken: { from: string; to: string | null }[] = [];
	for (const range of [
		stint,
		...stints.filter(
			(other) =>
				other.id !== stint.id &&
				other.employee_id === stint.employee_id &&
				code !== undefined &&
				lawCodeOf.get(String(other.entity_id)) === code &&
				rangeOf(other).from < rangeOf(stint).from
		)
	]
		.map(rangeOf)
		.toSorted((left, right) => left.from.localeCompare(right.from))) {
		const last = unbroken.at(-1);
		// a stint from the day after the last one ends continues its employment; a gap starts a new one
		if (
			last !== undefined &&
			(last.to === null ||
				DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(last.to), { days: 1 })) >=
					range.from)
		)
			last.to = range.to;
		else unbroken.push(range);
	}
	const current = unbroken.at(-1)?.from ?? rangeOf(stint).from;
	const earlier = cumulative
		? unbroken.slice(0, -1).reduce(
				(total, served) =>
					// only the newest employment is open
					total +
					Duration.toDays(
						DateTime.distance(DateTime.makeUnsafe(served.from), DateTime.makeUnsafe(served.to!))
					) +
					1,
				0
			)
		: 0;
	const worked = DateTime.formatIsoDate(
		DateTime.add(DateTime.makeUnsafe(current), { days: -earlier })
	);
	const credited = stint.service_started_on;
	return {
		service_started_on: typeof credited === 'string' && credited < worked ? credited : worked,
		employment_started_on: current
	};
};

/**
 * Stints read with `entity_id` expanded to `{ id, settings_code }`, and optionally `employee_id` to
 * `{ id, cumulative_service }`: the rows back on plain ids, the law code of each entity they name, and the people whose
 * service counts every stint, as `startsOf` takes them.
 */
export const chainOf = (rows: readonly JsonObject[]) => ({
	chain: rows.map((row) => {
		const { entity_id: entity, employee_id: person } = row;
		return jsonObject({
			...row,
			...(isDynObject(entity) ? { entity_id: entity.id } : {}),
			...(isDynObject(person) ? { employee_id: person.id } : {})
		});
	}),
	lineage: new Map(
		rows.flatMap((row) => {
			const entity = row.entity_id;
			return isDynObject(entity)
				? [[String(entity.id), String(entity.settings_code)] as const]
				: [];
		})
	),
	cumulative: new Set(
		rows.flatMap((row) => {
			const person = row.employee_id;
			return isDynObject(person) && person.cumulative_service === true ? [String(person.id)] : [];
		})
	)
});

/** One stint's days as the shared leave check reads them, from the plan rows read beside it: the same on a page and in a write. */
export const leaveDaysOf = (
	held: Pick<Parts, 'stint' | 'terms'>,
	plan: Readonly<Record<string, readonly JsonObject[] | undefined>>
): LeaveDays => {
	const groups = new Map((plan.pay_group ?? []).map((row) => [String(row.id), row]));
	const terms = (date: string) => inForce(held.terms.map(termsChange), date).state;
	return {
		terms,
		employer: (date) => ({
			payment_schedule: groups.get(String(terms(date).pay_group_id))?.payment_schedule ?? null
		}),
		shifts: new Map((plan.shift_definition ?? []).map((row) => [String(row.id), row])),
		patterns: new Map((plan.shift_pattern ?? []).map((row) => [String(row.id), row])),
		roster: new Map(
			(plan.roster_entry ?? [])
				.filter((row) => String(row.employment_id) === String(held.stint.id))
				.map((row) => [String(row.work_date), row])
		),
		holidays: plan.holiday ?? [],
		employee: String(held.stint.employee_id)
	};
};

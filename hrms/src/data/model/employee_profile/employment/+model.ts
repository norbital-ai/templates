import type { CarriedWrites, EffectCtx, Id } from '@norbital-ai/bolt';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
import { DateTime, Effect } from 'effect';
import { model } from '../../../../../.norbital/models/employment.ts';
import { amendmentsFor, type Touched } from '../../../../lib/amendments.js';
import { reachOf } from '../../../../lib/dated.js';
import { reconcile } from '../../../../lib/dependants.js';
import { lawRead, lawsOf, type Law } from '../../../../lib/law.js';
import { assertFactsHold } from '../../../../lib/ledger/service.js';
import {
	PARAMETER_FIELDS,
	PROFILE_FIELDS,
	STINT_FIELDS,
	TERM_FIELDS,
	employmentOn,
	isExit,
	parametersChange,
	partsIn,
	segmentsOf,
	termsChange,
	type Parts
} from '../../../../lib/person.js';
import { syncLedgerOn } from '../../../../lib/payroll_engine/configuration.js';
import {
	isJsonObject,
	jsonObject,
	numberOf,
	stableJson,
	type JsonObject
} from '../../../../lib/payroll_engine/foundation.js';
import { rangeObject, validateRegistered } from '../../../../lib/payroll_engine/registrations.js';
import { idOf, queryRows, type Reader } from '../../../../lib/payroll_engine/reads.js';
import { tap } from '../../../../lib/payroll_engine/taps.js';

type Verb = 'create' | 'update' | 'delete';
type Family = 'contract_terms' | 'statutory_parameters';
/** One written row: as it stood, and as the write leaves it. */
export type Written = { readonly before?: JsonObject; readonly after?: JsonObject };

/** The stint's fields a writer sets; its number is filled in. */
const columns = [
	'employee_id',
	'entity_id',
	'employee_number',
	'effective_range',
	'service_started_on',
	'final_pay_due_on',
	'events',
	'exit_ground',
	'encash_leave',
	'reason'
] as const;
/** What a dated row holds beside the fields of its family. */
const DATED = ['id', 'employment_id', 'effective_from', 'clears'] as const;
/** The agreed terms nothing prices, validates or syncs on: screens and exports only. */
const UNREAD = new Set(['job_title', 'department', 'worksite', 'notice_period']);

const DATES = 'errors.employment_change_date' as const;
const REQUIRED = 'errors.contract_terms_required' as const;
const NO_PAY_GROUP = 'errors.contract_terms_choose_pay_group' as const;
const OTHER_PAY_GROUP = 'errors.contract_terms_pay_group_other_company' as const;
const OVERLONG = 'errors.contract_terms_shift_overlong' as const;

const dayFrom = (day: string, days: number) =>
	DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(day), { days }));
/** A stint with its range as `{ from, to }`: an effect's row holds it as stored, half-open. */
const ranged = (row: JsonObject): JsonObject => ({
	...row,
	effective_range: rangeObject(row.effective_range) ?? null
});
const daysOf = (stint: JsonObject) => {
	const range = rangeObject(stint.effective_range);
	return { from: String(range?.from), to: typeof range?.to === 'string' ? range.to : null };
};
const present = <T>(value: T | undefined): readonly T[] => (value === undefined ? [] : [value]);

/** The two dates answer different questions, but service cannot begin after the stint that records it. */
const startsAfterService = (
	rows: readonly { readonly service_started_on?: unknown; readonly effective_range?: unknown }[]
) =>
	rows.some((row) => {
		const range = isJsonObject(row.effective_range) ? row.effective_range : null;
		const from = range === null ? null : range.from;
		return (
			row.service_started_on != null &&
			from != null &&
			String(row.service_started_on) > String(from)
		);
	});
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const clockMinutes = (clock: string): number =>
	Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** The paid minutes of one shift code, net of its unpaid breaks. */
const shiftMinutes = (variant: unknown): number | null => {
	if (!isJsonObject(variant)) return null;
	if (variant.day_type !== 'WORK') return 0;
	const start = typeof variant.start_time === 'string' ? variant.start_time : null;
	const end = typeof variant.end_time === 'string' ? variant.end_time : null;
	const untimed = typeof variant.untimed_hours === 'number' ? variant.untimed_hours : null;
	if (start === null || end === null || !CLOCK.test(start) || !CLOCK.test(end))
		return untimed === null ? null : Math.round(untimed * 60);
	let span = clockMinutes(end) - clockMinutes(start);
	if (span <= 0 || variant.ends_next_day === true) span += 1440;
	let pause = 0;
	for (const item of Array.isArray(variant.breaks) ? variant.breaks : []) {
		if (!isJsonObject(item) || item.paid === true) continue;
		const pauseStart = typeof item.start_time === 'string' ? item.start_time : null;
		const pauseEnd = typeof item.end_time === 'string' ? item.end_time : null;
		if (
			pauseStart === null ||
			pauseEnd === null ||
			!CLOCK.test(pauseStart) ||
			!CLOCK.test(pauseEnd)
		)
			continue;
		pause += Math.max(0, clockMinutes(pauseEnd) - clockMinutes(pauseStart));
	}
	return Math.max(0, span - pause);
};
const shiftIdsOf = (pattern: unknown): readonly string[] => {
	if (!isJsonObject(pattern)) return [];
	const ids = new Set<string>();
	if (isJsonObject(pattern.days))
		for (const value of Object.values(pattern.days))
			if (typeof value === 'string' && value !== '') ids.add(value);
	if (Array.isArray(pattern.cycle))
		for (const slot of pattern.cycle)
			if (isJsonObject(slot) && typeof slot.shift_definition_id === 'string')
				ids.add(slot.shift_definition_id);
	return [...ids];
};
/** The agreed rate and normal working time against the law's limits, where the law states them. */
const assertTerms = (
	rows: readonly { readonly terms?: unknown }[],
	lookups: readonly unknown[]
):
	| 'errors.contract_terms_rate_positive'
	| 'errors.contract_terms_hours_per_day'
	| 'errors.contract_terms_hours_per_week'
	| 'errors.contract_terms_days_allowed'
	| 'errors.contract_terms_days_per_week'
	| null => {
	const first = (
		lookup: Readonly<Record<string, unknown>>,
		names: readonly string[]
	): number | null => {
		for (const name of names) {
			const value = lookup[name];
			const number = numberOf(value);
			if (number !== null) return number;
			if (isJsonObject(value)) {
				const nested = numberOf(value.maximum ?? value.max);
				if (nested !== null) return nested;
			}
		}
		return null;
	};
	for (const [index, row] of rows.entries()) {
		const terms = isJsonObject(row.terms) ? row.terms : {};
		const rate = isJsonObject(terms.rate) ? terms.rate : null;
		if (rate === null || !(numberOf(rate.amount) !== null && Number(rate.amount) > 0))
			return 'errors.contract_terms_rate_positive';
		const lookup = lookups[index];
		if (!isJsonObject(lookup)) continue;
		const limits = isJsonObject(lookup.limits) ? lookup.limits : {};
		const limit = (names: readonly string[]) =>
			first({ ...lookup, ...limits }, names) ?? first(limits, names);
		const day = numberOf(terms.normal_hours_per_day);
		if (day !== null) {
			const min = limit([
				'normal_hours_per_day_minimum',
				'minimum_daily_hours',
				'hours_per_day_minimum',
				'normal_hours_per_day_min'
			]);
			const max = limit([
				'normal_hours_per_day_maximum',
				'maximum_daily_hours',
				'daily_hours',
				'normal_hours_per_day_max',
				'hours_per_day_maximum'
			]);
			if (!(day > 0) || (min !== null && day < min) || (max !== null && day > max))
				return 'errors.contract_terms_hours_per_day';
		}
		const week = numberOf(terms.normal_hours_per_week);
		if (week !== null) {
			const min = limit([
				'normal_hours_per_week_minimum',
				'hours_per_week_minimum',
				'normal_hours_per_week_min'
			]);
			const max = limit([
				'normal_hours_per_week_maximum',
				'weekly_hours',
				'normal_hours_per_week_max'
			]);
			if (!(week > 0) || (min !== null && week < min) || (max !== null && week > max))
				return 'errors.contract_terms_hours_per_week';
		}
		const days = numberOf(terms.normal_days_per_week);
		if (days !== null) {
			const allowed = lookup.normal_days_per_week;
			if (Array.isArray(allowed) && !allowed.map(Number).includes(days))
				return 'errors.contract_terms_days_allowed';
			const min = limit(['days_per_week_minimum', 'normal_days_per_week_minimum']);
			const max = limit(['days_per_week_maximum', 'normal_days_per_week_maximum']);
			if (days !== Math.trunc(days) || (min !== null && days < min) || (max !== null && days > max))
				return 'errors.contract_terms_days_per_week';
		}
	}
	return null;
};
/** A shift code the terms schedule may not run longer than their normal day. */
const overlongShift = (
	rows: readonly { readonly terms?: unknown }[],
	patterns: readonly JsonObject[],
	shifts: readonly JsonObject[]
) => {
	const patternById = new Map(patterns.map((row) => [String(row.id), row]));
	const shiftById = new Map(shifts.map((row) => [String(row.id), row]));
	for (const row of rows) {
		const terms = isJsonObject(row.terms) ? row.terms : null;
		const patternId = terms?.shift_pattern_id;
		const hours = terms?.normal_hours_per_day;
		if (typeof patternId !== 'string' || typeof hours !== 'number' || !Number.isFinite(hours))
			continue;
		for (const id of shiftIdsOf(patternById.get(patternId)?.pattern)) {
			const shift = shiftById.get(id);
			if (shift === undefined) continue;
			const minutes = shiftMinutes(shift.variant);
			if (minutes !== null && minutes > hours * 60)
				return {
					code: String(shift.code),
					lasts: new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(minutes / 60),
					hours
				};
		}
	}
	return null;
};
/** The terms against the law in force on their day: rate, normal time, category and work region. */
const assertLaw = (rows: readonly JsonObject[], law: readonly (Law | undefined)[]) => {
	const versions = law.map((found) => found?.settings);
	const terms = assertTerms(
		rows,
		versions.map((version) => version?.lookup)
	);
	if (terms !== null) return terms;
	for (const [index, row] of rows.entries()) {
		const version = versions[index];
		const agreed = isJsonObject(row.terms) ? row.terms : {};
		const lookup = isJsonObject(version?.lookup) ? version.lookup : {};
		const categories = lookup.statutory_work_categories;
		const category = agreed.statutory_work_category;
		if (typeof category === 'string' && Array.isArray(categories) && !categories.includes(category))
			return 'errors.contract_terms_work_category' as const;
		const regions = isJsonObject(version?.work_regions) ? Object.keys(version.work_regions) : [];
		const region = agreed.work_region;
		if (
			typeof region === 'string' &&
			region !== '' &&
			regions.length > 0 &&
			!regions.includes(region)
		)
			return 'errors.contract_terms_work_region' as const;
	}
	return null;
};

/**
 * A write callback's read of its act's own rows over the stored ones (`ctx.query.after`): what the model will hold
 * once the act commits.
 */
export interface Staged {
	after(
		model: 'employment',
		where: { readonly id: { readonly in: readonly Id<'employment'>[] } }
	): Effect.Effect<readonly object[], ReadFailed>;
	after(
		model: 'contract_terms' | 'statutory_parameters',
		where: { readonly employment_id: { readonly in: readonly Id<'employment'>[] } }
	): Effect.Effect<readonly object[], ReadFailed>;
}
const rowsOf = (rows: readonly object[]): readonly JsonObject[] =>
	rows.map((row) => jsonObject(row));

/**
 * These stints, each with its dated rows, its person and their dependants, beside every stint of those people and what
 * the checks read of the companies. A write (`staged`) reads its stints and their dated rows as its act leaves them: a
 * hire arrives with its first rows, and a first day moves with the rows dated on it.
 */
const standing = Effect.fnUntraced(function* (
	read: Reader,
	stints: readonly unknown[],
	staged?: Staged
) {
	const ids = [...new Set(stints.flatMap((id) => (id == null ? [] : [String(id)])))];
	const keys = ids.map((id) => idOf('employment', id));
	const act =
		staged === undefined
			? undefined
			: {
					employment: rowsOf(yield* staged.after('employment', { id: { in: keys } })),
					contract_terms: rowsOf(
						yield* staged.after('contract_terms', { employment_id: { in: keys } })
					),
					statutory_parameters: rowsOf(
						yield* staged.after('statutory_parameters', { employment_id: { in: keys } })
					)
				};
	const own =
		act ??
		(yield* queryRows(read, {
			employment: { where: { id: { in: ids } }, fields: [...STINT_FIELDS], limit: 10000 },
			contract_terms: {
				where: { employment_id: { in: ids } },
				fields: [...DATED, 'signed_on', ...TERM_FIELDS],
				limit: 10000
			},
			statutory_parameters: {
				where: { employment_id: { in: ids } },
				fields: [...DATED, ...PARAMETER_FIELDS],
				limit: 10000
			}
		}));
	const held = (own.employment ?? []).map(ranged);
	const people = [...new Set(held.map((row) => String(row.employee_id)))];
	const around = yield* queryRows(read, {
		employment: {
			where: { employee_id: { in: people } },
			fields: ['id', 'employee_id', 'entity_id', 'effective_range'],
			limit: 10000
		},
		employee_profile: { where: { id: { in: people } }, fields: [...PROFILE_FIELDS], limit: 10000 },
		dependant: { where: { employee_id: { in: people } }, limit: 10000 },
		entity: { fields: ['id', 'settings_code'], limit: 10000 },
		pay_group: { fields: ['id', 'entity_id'], limit: 10000 },
		shift_pattern: {
			where: {
				id: {
					in: [
						...new Set(
							(own.contract_terms ?? []).flatMap((row) =>
								typeof row.shift_pattern_id === 'string' ? [row.shift_pattern_id] : []
							)
						)
					]
				}
			},
			fields: ['id', 'pattern'],
			limit: 10000
		}
	});
	// the person's stints as stored, with the written ones as the act leaves them
	const written = new Set(held.map((row) => String(row.id)));
	return {
		parts: partsIn({ ...own, ...around, employment: held }),
		chain: [
			...(around.employment ?? []).map(ranged).filter((row) => !written.has(String(row.id))),
			...held
		],
		lawCodeOf: new Map(
			(around.entity ?? []).map((row) => [String(row.id), String(row.settings_code)])
		),
		groups: around.pay_group ?? [],
		patterns: around.shift_pattern ?? []
	};
});

/**
 * A stint on a day as a registered rule or effect reads it: on the terms and parameters in force that day, from the
 * first day they stood so to the stint's last day. `effective_range.to` is when the employment ends, never when its
 * terms next change.
 */
export const entryOn = (parts: Parts, day: string): JsonObject => {
	const segment = segmentsOf(parts).findLast((held) => held.from <= day);
	return {
		...employmentOn(parts, day),
		effective_range: { from: segment?.from ?? day, to: daysOf(parts.stint).to }
	};
};

/** Nothing is agreed on a day no terms row has reached: such a day is checked by the write that gives it terms. */
const agreedOn = (parts: Parts, day: string) =>
	parts.terms.some((row) => String(row.effective_from) <= day);

/**
 * The stint as it stood on a day without the write, for a rule or effect to read as `before`. Nothing stood where
 * nothing was agreed yet, and a row created on the stint's first day as the first of its family is part of the hire.
 */
const stoodOn = (
	was: Parts,
	key: 'terms' | 'parameters',
	verb: Verb,
	day: string
): JsonObject | undefined =>
	!agreedOn(was, day) ||
	(verb === 'create' &&
		day === daysOf(was.stint).from &&
		!was[key].some((row) => String(row.effective_from) <= day))
		? undefined
		: entryOn(was, day);

/** No row is dated before the stint's first day, and its first terms start on that day. */
const rooted = (parts: Parts): boolean => {
	const { from } = daysOf(parts.stint);
	const first = parts.terms.map((row) => String(row.effective_from)).toSorted()[0];
	return (
		[...parts.terms, ...parts.parameters].every((row) => String(row.effective_from) >= from) &&
		(first === undefined || first === from)
	);
};

/**
 * A write to the dated rows of one family, checked where a seal checked. Each stint is folded as the act leaves it, on
 * the earliest day the write touches and at every later change of the stint, and on each: the terms hold what an
 * employment needs, its pay group is its company's, no scheduled shift outlasts the normal day, the law's limits and
 * registered rules hold, and no fact days were taken under is gone. Answers the amendment rows of the paid periods the
 * write reaches, for the write to carry, and the pay group of a first terms row that named none where its company has
 * one (`filled`, by row id). A string is a refusal.
 */
export const datedWrite = Effect.fnUntraced(function* (
	read: Reader & Staged,
	verb: Verb,
	family: Family,
	changes: readonly Written[]
) {
	const terms = family === 'contract_terms';
	const key = terms ? 'terms' : 'parameters';
	const change = terms ? termsChange : parametersChange;
	const got = yield* standing(
		read,
		changes.flatMap(({ before, after }) => [before?.employment_id, after?.employment_id]),
		read
	);
	const filled = new Map<string, string>();
	if (terms && verb === 'create')
		for (const { after } of changes) {
			const stint = got.parts.find((held) => held.stint.id === after?.employment_id)?.stint;
			if (after === undefined || stint === undefined || after.pay_group_id != null) continue;
			const [only, ...others] = got.groups.filter((group) => group.entity_id === stint.entity_id);
			if (only !== undefined && others.length === 0 && after.effective_from === daysOf(stint).from)
				filled.set(String(after.id), String(only.id));
		}
	const own = new Set(changes.map(({ before, after }) => String((after ?? before)?.id)));
	const rest = (rows: readonly JsonObject[]) => rows.filter((row) => !own.has(String(row.id)));
	const entries: JsonObject[] = [];
	const stood: (JsonObject | undefined)[] = [];
	const checked: { readonly employment: JsonObject; readonly on: string }[] = [];
	const touched: Touched[] = [];
	for (const held of got.parts) {
		const mine = (row: JsonObject | undefined) =>
			row !== undefined && row.employment_id === held.stint.id ? [row] : [];
		const was: Parts = {
			...held,
			[key]: [...rest(held[key]), ...changes.flatMap(({ before }) => mine(before))]
		};
		const now: Parts = {
			...held,
			[key]: [
				...rest(held[key]),
				...changes.flatMap(({ after }) =>
					mine(after).map((row) => {
						const group = filled.get(String(row.id));
						return group === undefined ? row : { ...row, pay_group_id: group };
					})
				)
			]
		};
		const { from: first, to: last } = daysOf(now.stint);
		const dated = changes.flatMap(({ after }) => mine(after).map((row) => row.effective_from));
		if (
			!rooted(now) ||
			dated.some(
				(day) =>
					typeof day !== 'string' ||
					(last !== null && day > last) ||
					!(day === first || day.endsWith('-01'))
			)
		)
			return DATES;
		const prior = new Map(was[key].map((row) => [String(row.id), row]));
		const post = new Map(now[key].map((row) => [String(row.id), row]));
		const written = [...own].flatMap((id) => {
			const a = prior.get(id);
			const b = post.get(id);
			if (a === undefined && b === undefined) return [];
			const before = a === undefined ? undefined : change(a);
			const after = b === undefined ? undefined : change(b);
			// a signed date decides which pay dates the row applies to: moving it reaches all the row sets
			const signed = (a?.signed_on ?? null) !== (b?.signed_on ?? null);
			return before !== undefined &&
				after !== undefined &&
				!signed &&
				before.effective_from === after.effective_from &&
				stableJson(before.patch) === stableJson(after.patch)
				? []
				: [{ id, before, after, signed }];
		});
		const from = written
			.flatMap(({ before, after }) => [before?.effective_from, after?.effective_from])
			.flatMap(present)
			.toSorted()[0];
		if (from === undefined) continue;
		const days = [
			from,
			...segmentsOf(now)
				.map((segment) => segment.from)
				.filter((day) => day > from)
		].filter((day) => agreedOn(now, day));
		for (const day of days) {
			const employment = employmentOn(now, day);
			const agreed = isJsonObject(employment.terms) ? employment.terms : {};
			if (
				employment.engagement == null ||
				agreed.normal_hours_per_day == null ||
				agreed.normal_hours_per_week == null ||
				agreed.normal_days_per_week == null
			)
				return REQUIRED;
			if (employment.pay_group_id == null) return NO_PAY_GROUP;
			if (
				!got.groups.some(
					(group) =>
						group.id === employment.pay_group_id && group.entity_id === employment.entity_id
				)
			)
				return OTHER_PAY_GROUP;
			checked.push({ employment, on: day });
			entries.push(entryOn(now, day));
			stood.push(stoodOn(was, key, verb, day));
		}
		const others = (id: string) => now[key].filter((row) => String(row.id) !== id).map(change);
		const priced = (path: string) => !terms || !UNREAD.has(path);
		touched.push(
			...written
				.flatMap(({ id, before, after, signed }) =>
					signed
						? [
								reachOf(others(id), before, undefined, 1, priced),
								reachOf(others(id), undefined, after, 1, priced)
							]
						: [reachOf(others(id), before, after, 1, priced)]
				)
				.flatMap(present)
				.filter((reach) => last === null || reach.from <= last)
				.map((reach) => ({
					employee: String(now.stint.employee_id),
					from: reach.from,
					to: reach.to === null || (last !== null && reach.to > last) ? last : reach.to
				}))
		);
	}
	yield* validateRegistered(read, 'employment', verb, entries, stood);
	if (terms) {
		const companies = new Set(checked.map(({ employment }) => String(employment.entity_id)));
		const limits = yield* queryRows(read, {
			...lawRead([...companies].flatMap((entity) => present(got.lawCodeOf.get(entity)))),
			shift_definition: {
				where: {
					id: { in: [...new Set(got.patterns.flatMap((row) => shiftIdsOf(row.pattern)))] }
				},
				fields: ['id', 'code', 'variant'],
				limit: 10000
			}
		});
		const views = checked.map(({ employment }) => employment);
		const overlong = overlongShift(views, got.patterns, limits.shift_definition ?? []);
		if (overlong !== null) return { key: OVERLONG, values: overlong };
		const laws = lawsOf(limits);
		const refusal = assertLaw(
			views,
			checked.map(({ employment, on }) => laws(got.lawCodeOf.get(String(employment.entity_id)), on))
		);
		if (refusal !== null) return refusal;
	}
	yield* assertFactsHold(read, checked);
	const carried: CarriedWrites = yield* amendmentsFor(read, touched);
	return { carried, filled };
});

/**
 * After a write to dated rows: the law's registered effects read the stint on each written row's day (a deleted row's
 * own day), as it stood without the write and as it stands with it, and the ledger syncs now for a row in force today,
 * else on the row's day.
 */
export const afterDated = Effect.fnUntraced(function* (
	ctx: EffectCtx,
	verb: Verb,
	family: Family,
	changes: readonly Written[]
) {
	const key = family === 'contract_terms' ? 'terms' : 'parameters';
	const rows = changes.flatMap(({ before, after }) => [...present(before), ...present(after)]);
	const got = yield* standing(
		ctx.query,
		rows.map((row) => row.employment_id)
	);
	const own = new Set(rows.map((row) => String(row.id)));
	yield* tap(
		ctx,
		verb,
		'employment',
		changes.flatMap(({ before, after }) => {
			const row = after ?? before;
			const held = got.parts.find((parts) => parts.stint.id === row?.employment_id);
			if (row === undefined || held === undefined) return [];
			const was: Parts = {
				...held,
				[key]: [
					...held[key].filter((other) => !own.has(String(other.id))),
					...changes.flatMap((change) =>
						change.before?.employment_id === held.stint.id ? [change.before] : []
					)
				]
			};
			const day = String(row.effective_from);
			const stood = stoodOn(was, key, verb, day);
			const stands = agreedOn(held, day) ? entryOn(held, day) : undefined;
			return stood === undefined && stands === undefined
				? []
				: [
						{
							...(stood === undefined ? {} : { before: stood }),
							...(stands === undefined ? {} : { after: stands })
						}
					];
		})
	);
	const today = String(ctx.today);
	const due = new Set(
		rows.flatMap((row) => (String(row.effective_from) <= today ? [String(row.employment_id)] : []))
	);
	const employees = [
		...new Set(
			got.parts.flatMap(({ stint }) =>
				due.has(String(stint.id)) ? [idOf('employee_profile', stint.employee_id)] : []
			)
		)
	];
	if (employees.length > 0) yield* ctx.schedule('ledger', { employees });
	yield* syncLedgerOn(
		ctx,
		rows.map((row) => String(row.effective_from)).filter((day) => day > today)
	);
});

/** The earliest day a change to a stint's events is dated. */
const eventsFrom = (before: unknown, after: unknown): string | undefined => {
	const list = (value: unknown) => (Array.isArray(value) ? value.filter(isJsonObject) : []);
	const [was, now] = [list(before), list(after)];
	const among = (items: readonly JsonObject[]) => new Set(items.map((item) => stableJson(item)));
	return [
		...was.filter((item) => !among(now).has(stableJson(item))),
		...now.filter((item) => !among(was).has(stableJson(item)))
	]
		.map((item) => String(item.opened_on ?? item.on))
		.toSorted()[0];
};

type Reach = { readonly from: string; readonly to: string | null; readonly soft?: true };
/**
 * The days of pay a write to a stint reaches. A new stint reaches all it covers. A first day that moves reaches the
 * days between; a last day that moves, the days it adds or takes away, and an exit answer reaches the last day. A last
 * day that ends the employment is reached itself, because its payslip settles the exit; one another stint continues
 * from the next day is not. Credited service reaches the whole stint, and an event the days from its date. A stint
 * that starts the day after another ended takes the exit away from that last day: softly, as no run settled it yet.
 */
const reached = (
	before: JsonObject | undefined,
	after: JsonObject,
	continues: (day: string) => boolean
): readonly Reach[] => {
	const now = daysOf(after);
	const eve = { from: dayFrom(now.from, -1), to: dayFrom(now.from, -1), soft: true } as const;
	if (before === undefined) return [now, eve];
	const was = daysOf(before);
	const reach: Reach[] = [];
	if (was.from !== now.from) {
		const [earlier, later] = [was.from, now.from].toSorted();
		if (earlier !== undefined && later !== undefined)
			reach.push({ from: earlier, to: dayFrom(later, -1) }, eve);
	}
	if (was.to === now.to) {
		if (was.to !== null) reach.push({ from: was.to, to: was.to });
	} else {
		const earlier = was.to === null || (now.to !== null && now.to < was.to) ? now.to : was.to;
		const later = was.to === null || now.to === null ? null : was.to < now.to ? now.to : was.to;
		if (earlier !== null)
			reach.push({ from: continues(earlier) ? dayFrom(earlier, 1) : earlier, to: later });
	}
	if ((before.service_started_on ?? null) !== (after.service_started_on ?? null)) reach.push(now);
	const event = eventsFrom(before.events, after.events);
	if (event !== undefined) reach.push({ from: event, to: now.to });
	return reach;
};

/**
 * An update to stints, checked on each as the write leaves it. A first day that moves takes the rows dated on it along
 * (`moved`, for the write to carry in its own commit), so the stint is checked with them on its new first day: its rows
 * stay rooted in it, the law's registered rules hold on its first day, and no fact days were taken under is gone.
 * Answers the amendment rows of the paid periods the days that move reach. A string is a refusal.
 */
const stintWrite = Effect.fnUntraced(function* (
	read: Reader & Staged,
	changes: readonly { readonly before: JsonObject; readonly after: JsonObject }[]
) {
	const got = yield* standing(
		read,
		changes.map(({ after }) => after.id),
		read
	);
	const entries: JsonObject[] = [];
	const checked: { readonly employment: JsonObject; readonly on: string }[] = [];
	const touched: Touched[] = [];
	const moves = (rows: readonly JsonObject[], was: string, from: string) =>
		rows.flatMap((row) =>
			was !== from && row.effective_from === was
				? [{ id: String(row.id), revision: Number(row.revision), from }]
				: []
		);
	const moved: { terms: ReturnType<typeof moves>; parameters: ReturnType<typeof moves> } = {
		terms: [],
		parameters: []
	};
	for (const { before, after } of changes) {
		const held = got.parts.find((parts) => parts.stint.id === after.id);
		if (held === undefined) continue;
		const { from } = daysOf(after);
		const was = daysOf(before).from;
		const follows = (rows: readonly JsonObject[]) =>
			rows.map((row) =>
				was !== from && row.effective_from === was ? { ...row, effective_from: from } : row
			);
		const parts: Parts = {
			...held,
			stint: after,
			terms: follows(held.terms),
			parameters: follows(held.parameters)
		};
		// a row the first day moves onto or past would share its day with the stint's first rows, or lie before them
		const days = (rows: readonly JsonObject[]) => rows.map((row) => String(row.effective_from));
		if (
			!rooted(parts) ||
			[parts.terms, parts.parameters].some((rows) => new Set(days(rows)).size < rows.length)
		)
			return DATES;
		moved.terms.push(...moves(held.terms, was, from));
		moved.parameters.push(...moves(held.parameters, was, from));
		if (agreedOn(parts, from)) entries.push(entryOn(parts, from));
		checked.push(
			...segmentsOf(parts)
				.filter((segment) => agreedOn(parts, segment.from))
				.map((segment) => ({ employment: employmentOn(parts, segment.from), on: segment.from }))
		);
		const starts = new Set(
			got.chain
				.filter((other) => other.employee_id === after.employee_id && other.id !== after.id)
				.map((other) => daysOf(other).from)
		);
		touched.push(
			...reached(before, after, (day) => starts.has(dayFrom(day, 1))).map((reach) => ({
				employee: String(after.employee_id),
				...reach
			}))
		);
	}
	yield* validateRegistered(read, 'employment', 'update', entries);
	yield* assertFactsHold(read, checked);
	const carried: CarriedWrites = yield* amendmentsFor(read, touched);
	return { carried, moved };
});

/**
 * Raise `exit` for what a write did to a person's stints, and settle in the same effect what their exits leave besides
 * pay: stale tasks and a cancelled exit's loan (`reconcile`). An exit is read from all of a person's stints, so a write
 * to one can make, move or cancel another's; an unmoved exit raises nothing. The leave is the last payslip's, from the
 * stint's `encash_leave`.
 */
const raiseExits = Effect.fnUntraced(function* (ctx: EffectCtx, changes: readonly Written[]) {
	if (changes.length === 0) return;
	const rows = changes.flatMap(({ before, after }) => [...present(before), ...present(after)]);
	const people = [...new Set(rows.map((row) => String(row.employee_id)))];
	const { employment: stored = [], entity: entities = [] } = yield* queryRows(ctx.query, {
		employment: {
			where: { employee_id: { in: people } },
			fields: [...STINT_FIELDS],
			limit: 10000
		},
		entity: { fields: ['id', 'settings_code'], limit: 10000 }
	});
	const lawCodeOf = new Map(entities.map((row) => [String(row.id), String(row.settings_code)]));
	const written = new Set(rows.map((row) => String(row.id)));
	const now = stored.map(ranged);
	const then = [
		...now.filter((row) => !written.has(String(row.id))),
		...changes.flatMap(({ before }) => present(before).map(ranged))
	];
	const exits = (chain: readonly JsonObject[]) =>
		new Map(
			chain.filter((row) => isExit(row, chain, lawCodeOf)).map((row) => [String(row.id), row])
		);
	const was = exits(then);
	const is = exits(now);
	const moved = [...new Set([...was.keys(), ...is.keys()])].flatMap((id) => {
		const before = was.get(id);
		const after = is.get(id);
		return before !== undefined && after !== undefined && daysOf(before).to === daysOf(after).to
			? []
			: [{ before, after }];
	});
	if (moved.length > 0) {
		const got = yield* standing(
			ctx.query,
			moved.map(({ before, after }) => (after ?? before)?.id)
		);
		// the exit as the law's effects read it: the stint on its last day
		const entry = (stint: JsonObject | undefined) => {
			const held = got.parts.find((parts) => parts.stint.id === stint?.id);
			const { to } = daysOf(stint ?? {});
			return stint === undefined || held === undefined || to === null
				? undefined
				: entryOn({ ...held, stint }, to);
		};
		yield* tap(
			ctx,
			'exit',
			'employment',
			moved.flatMap(({ before, after }) => {
				const stood = entry(before);
				const stands = entry(after);
				return stood === undefined && stands === undefined
					? []
					: [
							{
								...(stood === undefined ? {} : { before: stood }),
								...(stands === undefined ? {} : { after: stands })
							}
						];
			})
		);
		yield* ctx.schedule('ledger', {
			employees: [
				...new Set(
					moved.map(({ before, after }) => idOf('employee_profile', (after ?? before)?.employee_id))
				)
			]
		});
	}
	// every write to a person's stints settles their exit tasks and loans as the stints now stand: a write that lost a
	// race to the next one finds nothing left when it retries
	yield* reconcile(ctx, people);
});

export default model({
	description:
		'One stint of a person with one company: its first and last day, the exit answers and the dated life events. What was agreed and what the law is told change by date, on its terms and statutory parameters. A rehire, and a move to another company, is a new stint.',
	// a reference to a stint reads only its own fields: the person's name shows where the profile is read beside it
	record_label:
		"(has(record.employee_id.name) ? record.employee_id.name + ' · ' : '') + record.employee_number + ' · ' + string(record.effective_range.from)",
	fields: {
		employee_id: { kind: 'ref', to: 'employee_profile', inverse: 'employment' },
		entity_id: { kind: 'ref', to: 'entity', inverse: 'employment' },
		employee_number: { kind: 'text' },
		/** Its first day and its last day; open while employed. */
		effective_range: { kind: 'period', of: 'date' },
		service_started_on: { kind: 'date', optional: true },
		events: {
			kind: 'object',
			many: true,
			optional: true,
			fields: {
				kind: { kind: 'text' },
				on: { kind: 'date' },
				opened_on: { kind: 'date', optional: true },
				ended_on: { kind: 'date', optional: true },
				allocated_days: { kind: 'int', optional: true }
			}
		},
		final_pay_due_on: { kind: 'date', optional: true },
		reason: { kind: 'text', optional: true },
		encash_leave: { kind: 'bool', default: true },
		exit_ground: {
			kind: 'enum',
			optional: true,
			values: [
				'RETRENCHMENT',
				'RETIREMENT',
				'RESIGNATION',
				'DISMISSAL',
				'MISCONDUCT_DISMISSAL',
				'END_OF_CONTRACT',
				'MUTUAL',
				'DEATH',
				'UNILATERAL',
				'BREACH_BY_EMPLOYER'
			]
		}
	},
	constraints: { stints: { no_overlap: 'effective_range', per: ['employee_id'] } },
	// found by its number, or by the person's own search text
	indexes: { search: { text: ['employee_number', 'employee_id'] } },
	outputs: {
		default: {
			fields: 'all',
			employee_id: {
				fields: 'all',
				employment: { fields: 'all', entity_id: { fields: 'all' } },
				dependants: { fields: 'all' }
			},
			entity_id: { fields: 'all' },
			terms: { fields: 'all' },
			parameters: { fields: 'all' },
			leave_catalog_entry: { fields: 'all' }
		},
		kiosk: { fields: ['employee_id', 'entity_id', 'employee_number', 'effective_range'] }
	},
	create: {
		// a hire arrives whole: the stint with its first terms and statutory parameters, each checked by its own model
		columns: {
			fields: columns,
			terms: { fields: ['effective_from', 'signed_on', ...TERM_FIELDS, 'clears'] },
			parameters: { fields: ['effective_from', ...PARAMETER_FIELDS, 'clears'] }
		},
		filled: { fields: ['employee_number'] },
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			if (startsAfterService(rows))
				return yield* ctx.refuse('errors.employment_service_after_start', {
					field: 'service_started_on'
				});
			// a person keeps their number across stints; a new person takes the next one
			const existing = yield* ctx.query({
				employment: { fields: ['employee_id', 'employee_number'], limit: 10000 }
			});
			const numbers = new Map(
				existing.employment.rows.map((row) => [String(row.employee_id), row.employee_number])
			);
			let next =
				existing.employment.rows.reduce((max, row) => {
					const match = /^HR-(\d+)$/.exec(String(row.employee_number ?? ''));
					return match === null ? max : Math.max(max, Number(match[1] ?? 0));
				}, 0) + 1;
			const assigned = new Map<string, string>();
			return {
				sets: rows.map((row) => {
					if (row.employee_number != null && row.employee_number !== '') return row;
					const employee = String(row.employee_id);
					const heldNumber = numbers.get(employee);
					if (heldNumber != null && heldNumber !== '')
						return { ...row, employee_number: heldNumber };
					const assignedNumber = assigned.get(employee);
					if (assignedNumber !== undefined) return { ...row, employee_number: assignedNumber };
					const number = `HR-${new Intl.NumberFormat('en', { minimumIntegerDigits: 4, useGrouping: false }).format(next++)}`;
					assigned.set(employee, number);
					return { ...row, employee_number: number };
				}),
				// a stint over paid periods amends them: the next run works each out again
				on_approved: yield* amendmentsFor(
					ctx.query,
					rows.flatMap((row) =>
						reached(undefined, jsonObject(row), () => false).map((reach) => ({
							employee: String(row.employee_id),
							...reach
						}))
					)
				).pipe(
					Effect.catchTag('Refusal', (error) =>
						ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
					)
				)
			};
		},
		effect: function* (changes, ctx) {
			const rows = changes.map(({ after }) => after);
			yield* ctx.schedule('ledger', {
				employees: [...new Set(rows.map((row) => row.employee_id))]
			});
			// a new stint can cancel its predecessor's exit, and one created with a last day is one
			yield* raiseExits(
				ctx,
				rows.map((after) => ({ after: jsonObject(after) }))
			);
		}
	},
	update: {
		columns: {
			fields: columns.filter(
				(field) => field !== 'employee_id' && field !== 'entity_id' && field !== 'employee_number'
			)
		},
		transform: function* (changes, ctx) {
			const written = changes.map(({ before, after }) => ({
				before: ranged(jsonObject(before)),
				after: ranged(jsonObject(after))
			}));
			if (startsAfterService(written.map(({ after }) => after)))
				return yield* ctx.refuse('errors.employment_service_after_start', {
					field: 'service_started_on'
				});
			const result = yield* stintWrite(ctx.query, written).pipe(
				Effect.catchTag('Refusal', (error) =>
					ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
				)
			);
			if (typeof result === 'string')
				return yield* ctx.refuse(result, { field: 'effective_range' });
			const { terms, parameters } = result.moved;
			return {
				sets: changes.map(({ set }) => set),
				// the rows dated on a first day that moves, in this same write: they are the stint's first rows still
				with: {
					...(terms.length === 0
						? {}
						: {
								contract_terms: {
									update: terms.map(({ id, revision, from }) => ({
										target: { id: idOf('contract_terms', id), revision },
										set: { effective_from: from }
									}))
								}
							}),
					...(parameters.length === 0
						? {}
						: {
								statutory_parameters: {
									update: parameters.map(({ id, revision, from }) => ({
										target: { id: idOf('statutory_parameters', id), revision },
										set: { effective_from: from }
									}))
								}
							})
				},
				on_approved: result.carried
			};
		},
		effect: function* (changes, ctx) {
			const written = changes.map(({ before, after }) => ({
				before: ranged(jsonObject(before)),
				after: ranged(jsonObject(after))
			}));
			const got = yield* standing(
				ctx.query,
				written.map(({ after }) => after.id)
			);
			const entry = (stint: JsonObject) => {
				const held = got.parts.find((parts) => parts.stint.id === stint.id);
				const { from } = daysOf(stint);
				const parts = held === undefined ? undefined : { ...held, stint };
				return parts !== undefined && agreedOn(parts, from) ? entryOn(parts, from) : undefined;
			};
			yield* tap(
				ctx,
				'update',
				'employment',
				written.flatMap(({ before, after }) => {
					const stood = entry(before);
					const stands = entry(after);
					return stood === undefined || stands === undefined
						? []
						: [{ before: stood, after: stands }];
				})
			);
			// only a write that moves a stint's days can make, move or cancel an exit
			yield* raiseExits(
				ctx,
				written.filter((_, index) => changes[index]?.changed('effective_range') === true)
			);
			yield* ctx.schedule('ledger', {
				employees: [...new Set(changes.map(({ after }) => after.employee_id))]
			});
		}
	},
	// a stint with a payslip or an entry is never deleted: their references refuse it
	delete: {
		effect: function* (changes, ctx) {
			// the stint before it becomes the person's last again
			yield* raiseExits(
				ctx,
				changes.map(({ before }) => ({ before: jsonObject(before) }))
			);
			yield* ctx.schedule('ledger', {
				employees: [...new Set(changes.map(({ before }) => before.employee_id))]
			});
		}
	}
});

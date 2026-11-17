import { DateTime, Effect, Schema } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import { evaluate } from './expressions.js';
import { Refusal, isJsonObject, jsonObject, type Json } from './foundation.js';
import { JsonObject, settingsConstants } from './contracts.js';
import { idsOf, queryRows, type Reader } from './reads.js';
import { ruleRead } from './rule_reads.js';
import { programOf } from './programs.js';
import { LAW_ROWS, lawsWith, type Law, type LawFamily } from '../law.js';
import { employerOn } from '../company.js';
import {
	PROFILE_FIELDS,
	STINT_FIELDS,
	chainOf,
	employmentOn,
	partsIn,
	startsOf,
	type Parts,
	type Starts
} from '../person.js';

export type Operation = 'create' | 'update' | 'delete' | 'exit';
const CATALOG_OF: Readonly<Record<string, LawFamily>> = {
	leave_catalog_entry: 'leave_catalog',
	claim_catalog_entry: 'claim_catalog',
	adhoc_catalog_entry: 'adhoc_catalog',
	loan_catalog_entry: 'loan_catalog',
	workplace_case_catalog_entry: 'workplace_case_catalog'
};

const truth = (value: unknown): boolean => value === true;

const pathValue = (value: unknown, path: string): unknown => {
	let current = value;
	for (const part of path.split('.')) {
		if (current === null || current === undefined || typeof current !== 'object') return undefined;
		current = Reflect.get(current, part);
	}
	return current;
};

export const rangeObject = (value: unknown): JsonObject | undefined => {
	if (isJsonObject(value)) return value;
	if (typeof value !== 'string') return undefined;
	const match = /^\[([^,]*),([^)]*)\)$/.exec(value);
	if (match === null) return undefined;
	// a stored daterange is half-open: its exclusive end is the day after the model's inclusive `to`
	return {
		from: match[1] || null,
		to:
			match[2] && /^\d{4}-\d{2}-\d{2}$/.test(match[2])
				? DateTime.formatIsoDate(DateTime.subtract(DateTime.makeUnsafe(match[2]), { days: 1 }))
				: null
	};
};

const refId = (value: unknown): string | undefined =>
	typeof value === 'string'
		? value
		: isJsonObject(value) && typeof value.id === 'string'
			? value.id
			: undefined;

/** A ranged record's first day, from a written row or its stored half-open range. */
export const startOf = (row: JsonObject): unknown => rangeObject(row.effective_range)?.from;

/** A leave's first day, from the slots a written row carries. */
const firstSlot = (row: JsonObject): string | undefined =>
	[row.days, row.leave_catalog_entry_day]
		.flatMap((slots) => (Array.isArray(slots) ? slots : []))
		.flatMap((slot) => {
			const day = isJsonObject(slot) ? (slot.date ?? slot.incurred_on) : null;
			return typeof day === 'string' ? [day] : [];
		})
		.toSorted()[0];
/** The day a dated record is its own: it answers to the law in force then. A payslip's is its run's pay date. */
const OWN_DAY: Readonly<Record<string, (row: JsonObject) => unknown>> = {
	employment: startOf,
	entity: startOf,
	entity_change: startOf,
	payroll_run: (row) => row.pay_date,
	roster: (row) => row.work_date,
	roster_entry: (row) => row.work_date,
	leave_catalog_entry: firstSlot,
	claim_catalog_entry: (row) => row.incurred_on,
	adhoc_catalog_entry: (row) => row.incurred_on,
	loan_catalog_entry: (row) => rangeObject(row.repayment_period)?.from,
	workplace_case_catalog_entry: (row) => row.opened_on,
	work_event: (row) => row.from
};

/** Resolve the small expression language `reads` declarations use; the read it fills is decoded where it is made. */
const expression = (source: string, data: Record<string, unknown>): unknown => {
	const text = source.trim();
	// a number is itself (`add_days(x, 6)`), never a path
	if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
	const variable = /^(?:ctx\.)?([A-Za-z0-9_.]+)$/.exec(text)?.[1];
	if (variable !== undefined) {
		const value = pathValue(data, variable);
		if (isJsonObject(value) && typeof value.id === 'string') return value.id;
		return value ?? null;
	}
	const [, name, inner] = /^(month_start|month_end|add_days|add_months)\((.*)\)$/.exec(text) ?? [];
	if (name !== undefined && inner !== undefined) {
		const args = inner.split(',').map((part) => part.trim());
		const first = args[0] === undefined ? null : expression(args[0], data);
		const second = args[1] === undefined ? null : expression(args[1], data);
		const date =
			typeof first === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(first)
				? DateTime.makeUnsafe(first)
				: null;
		const count = Number(second);
		if (date === null) return null;
		switch (name) {
			case 'month_start':
				return DateTime.formatIsoDate(DateTime.startOf(date, 'month'));
			case 'month_end':
				return DateTime.formatIsoDate(DateTime.endOf(date, 'month'));
			case 'add_days':
				return Number.isFinite(count)
					? DateTime.formatIsoDate(DateTime.add(date, { days: count }))
					: null;
			case 'add_months':
				return Number.isFinite(count)
					? DateTime.formatIsoDate(DateTime.add(date, { months: count }))
					: null;
		}
	}
	return evaluate(`return ${text};`, 'CALCULATION', data, 'reads');
};

export const resolveRead = (value: unknown, data: Record<string, unknown>): unknown => {
	if (Array.isArray(value)) return value.map((item) => resolveRead(item, data));
	if (value !== null && typeof value === 'object') {
		if (Object.keys(value).length === 1 && 'var' in value && typeof value.var === 'string')
			return expression(value.var, data);
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, resolveRead(item, data)])
		);
	}
	if (
		typeof value === 'string' &&
		(value.startsWith('ctx.') || /^(month_start|month_end|add_days|add_months)\(/.test(value))
	)
		return expression(value, data);
	return value;
};

/** What a subject reads of its company. */
const SUBJECT_ENTITY = ['id', 'settings_code', 'time_zone'] as const;
const SUBJECT_PAY_GROUP = ['entity_id', 'name', 'payment_schedule'] as const;
/** A company as read: its plain fields, its dated changes and its pay groups. A subject folds them on its own day. */
type Company = {
	readonly entity: JsonObject;
	readonly changes: readonly JsonObject[];
	readonly groups: readonly JsonObject[];
};
type Layer = { readonly [key: string]: Json };
const whereOf = (layer: Layer): Layer => (isJsonObject(layer.where) ? layer.where : {});
/** A stint as read: what says how it stands on a day, and when its person's service and unbroken employment began. */
type Held = { readonly parts: Parts; readonly starts: Starts };
type SubjectCache = {
	stints: Map<string, Held>;
	employers: Map<string, Company>;
	employees: Map<string, JsonObject>;
};
const SUBJECT_EMPLOYEE = ['id', 'name', 'email', 'phone', 'user_id'] as const;
const idsIn = (values: readonly (string | undefined)[]): readonly string[] => [
	...new Set(values.flatMap((value) => (value === undefined ? [] : [value])))
];
/**
 * The five roots that say how the stints these keys name stand: every stint of their people (the starts count them
 * all), the named stints' dated rows, the people and their dependants. A stint is named by id, person or company.
 */
type StintKeys = {
	readonly id: readonly string[];
	readonly employee_id: readonly string[];
	readonly entity_id: readonly string[];
};
const NO_STINTS: StintKeys = { id: [], employee_id: [], entity_id: [] };
const stintLayers = (keys: StintKeys) => {
	const named = {
		or: [
			{ id: { in: idsOf('employment', keys.id) } },
			{ employee_id: { in: idsOf('employee_profile', keys.employee_id) } },
			{ entity_id: { in: idsOf('entity', keys.entity_id) } }
		]
	};
	return {
		employment: {
			where: { employee_id: { is: { employment: { some: named } } } },
			fields: [...STINT_FIELDS],
			entity_id: { fields: ['settings_code'] as const },
			limit: 10000
		},
		contract_terms: { where: { employment_id: { is: named } }, limit: 10000 },
		statutory_parameters: { where: { employment_id: { is: named } }, limit: 10000 },
		dependant: { where: { employee_id: { is: { employment: { some: named } } } }, limit: 10000 }
	};
};
/** The stints an answer to `stintLayers` holds, by id. */
const stintsIn = (found: Record<string, readonly JsonObject[]>): ReadonlyMap<string, Held> => {
	const { chain, lineage } = chainOf(found.employment ?? []);
	const stints = chain.map((row): JsonObject => ({
		...row,
		effective_range: rangeObject(row.effective_range) ?? null
	}));
	return new Map(
		partsIn({ ...found, employment: stints }).map((parts) => [
			String(parts.stint.id),
			{
				parts,
				starts: startsOf(parts.stint, stints, lineage, parts.profile.cumulative_service === true)
			}
		])
	);
};
/** A stint on a day as a rule, effect or declared read sees it: the employment in force, with its starts. */
const stintOn = ({ parts, starts }: Held, day: string): JsonObject => ({
	...employmentOn(parts, day),
	...starts
});
/**
 * The subjects of a batch, as one request's layers: its stints with all that says how each stands on a day, the changes
 * and pay groups of the employers its rows and `companies` name (`entities`, whose own rows the caller reads) and the
 * people of the stints and of the rows. `primeFrom` fills the cache from the answer, and `subjectsOf` then answers every
 * row from it.
 */
const subjectLayers = (
	rows: readonly JsonObject[],
	cache: SubjectCache,
	companies: readonly string[]
) => {
	const stints = idsIn(rows.map((row) => refId(row.employment_id))).filter(
		(id) => !cache.stints.has(id)
	);
	const held = [...cache.stints.values()].map(({ parts }) => parts.stint);
	const entities = idsIn([
		...[...rows, ...held].map((row) => refId(row.entity_id)),
		...companies
	]).filter((id) => !cache.employers.has(id));
	// an employment row is its own stint: its person is the row's
	const employees = idsIn([...rows, ...held].map((row) => refId(row.employee_id))).filter(
		(id) => !cache.employees.has(id)
	);
	const layers = {
		...stintLayers({ ...NO_STINTS, id: stints }),
		entity_change: { where: { entity_id: { in: idsOf('entity', entities) } }, limit: 10000 },
		pay_group: {
			where: { entity_id: { in: idsOf('entity', entities) } },
			fields: [...SUBJECT_PAY_GROUP],
			limit: 1000
		},
		// the people the rows and the stints already held name, and those of the stints this read names
		employee_profile: {
			where: {
				or: [
					{ id: { in: idsOf('employee_profile', employees) } },
					{ employment: { some: { id: { in: idsOf('employment', stints) } } } }
				]
			},
			fields: [...new Set([...PROFILE_FIELDS, ...SUBJECT_EMPLOYEE])],
			limit: 10000
		}
	};
	return { entities, layers };
};
// ponytail: a rule reads one schedule for the employer, its first pay group by name. A company with several groups
// needs the subject's own group here if a rule ever depends on which.
const withSchedule = (employer: JsonObject, groups: readonly JsonObject[]): JsonObject => {
	const [first] = groups.toSorted((a, b) => String(a['name']).localeCompare(String(b['name'])));
	const schedule = first?.['payment_schedule'];
	return schedule === undefined ? employer : { ...employer, payment_schedule: schedule };
};
/** The companies an answer holds, out of those asked for whole: each with its changes and pay groups. */
const companiesIn = (
	found: Record<string, readonly JsonObject[]>,
	entities: readonly string[]
): readonly (readonly [string, Company])[] => {
	const changes = Map.groupBy(found.entity_change ?? [], (row) => String(refId(row.entity_id)));
	const groups = Map.groupBy(found.pay_group ?? [], (row) => String(refId(row.entity_id)));
	return (found.entity ?? []).flatMap((entity) => {
		const id = String(entity.id);
		return entities.includes(id)
			? [[id, { entity, changes: changes.get(id) ?? [], groups: groups.get(id) ?? [] }] as const]
			: [];
	});
};
const primeFrom = (
	found: Record<string, readonly JsonObject[]>,
	entities: readonly string[],
	cache: SubjectCache
) => {
	for (const [id, stint] of stintsIn(found)) cache.stints.set(id, stint);
	for (const [id, company] of companiesIn(found, entities)) cache.employers.set(id, company);
	for (const row of found.employee_profile ?? [])
		cache.employees.set(
			String(row.id),
			Object.fromEntries(SUBJECT_EMPLOYEE.map((field) => [field, row[field] ?? null]))
		);
};
/** A day after every change: a row with no day of its own reads its company and its employment as they last stand. */
const LATEST = '9999-12-31';

/**
 * Each row's subject on its day (`days`): its stint as it stands then, its company as it stands then and its person, from
 * the cache `lawsFor` primed. Whatever the cache lacks is one read for every row together.
 */
const subjectsOf = Effect.fnUntraced(function* (
	read: Reader,
	collection: string,
	rows: readonly JsonObject[],
	days: readonly string[],
	cache: SubjectCache,
	needs: { employer: boolean; employee: boolean } = { employer: true, employee: true }
) {
	// an employment is its own subject; another row's is the stint it names, as it stands on the row's own day
	const employments = rows.map((row, index) => {
		const held = cache.stints.get(String(refId(row.employment_id)));
		return collection === 'employment'
			? row
			: held === undefined
				? undefined
				: stintOn(held, days[index] ?? LATEST);
	});
	const employerOf = (index: number) =>
		refId(employments[index]?.entity_id) ?? refId(rows[index]?.entity_id);
	const employers = needs.employer
		? idsIn(rows.map((_, index) => employerOf(index))).filter((id) => !cache.employers.has(id))
		: [];
	const employees = needs.employee
		? idsIn(employments.map((employment) => refId(employment?.employee_id))).filter(
				(id) => !cache.employees.has(id)
			)
		: [];
	if (employers.length > 0 || employees.length > 0)
		primeFrom(
			yield* queryRows(read, {
				entity: {
					where: { id: { in: idsOf('entity', employers) } },
					fields: [...SUBJECT_ENTITY],
					limit: 50
				},
				entity_change: { where: { entity_id: { in: idsOf('entity', employers) } }, limit: 10000 },
				pay_group: {
					where: { entity_id: { in: idsOf('entity', employers) } },
					fields: [...SUBJECT_PAY_GROUP],
					limit: 1000
				},
				employee_profile: {
					where: { id: { in: idsOf('employee_profile', employees) } },
					fields: [...SUBJECT_EMPLOYEE],
					limit: 10000
				}
			}),
			employers,
			cache
		);
	return rows.map((_, index) => {
		const day = days[index] ?? LATEST;
		const company = needs.employer ? cache.employers.get(String(employerOf(index))) : undefined;
		const person = refId(employments[index]?.employee_id);
		const employee =
			needs.employee && person !== undefined ? cache.employees.get(person) : undefined;
		return {
			employment: employments[index] ?? {},
			// the company as it stands on the row's own day
			employer:
				company === undefined
					? {}
					: withSchedule(employerOn(company.entity, company.changes, day), company.groups),
			employee: employee ?? {}
		};
	});
});

/** How a declared read names stints: one of these, by `eq`. */
const STINT_KEYS = ['id', 'employee_id', 'entity_id'] as const;
/** The one field and value a declared read of `employment` filters on; no field reads every stint. */
const stintFilter = (layer: Layer) => {
	const entries = Object.entries(whereOf(layer));
	const [field, test] = entries[0] ?? [];
	const key = STINT_KEYS.find((name) => name === field);
	if (
		entries.length > 1 ||
		key === undefined ||
		!isJsonObject(test) ||
		Object.keys(test).length !== 1 ||
		!('eq' in test)
	)
		throw new Refusal({ message: 'employment: an employment is read by id, person or company.' });
	return { key, value: refId(test.eq) };
};
/**
 * Every read a batch of rows declares, for every rule at once (`requests[rule][row]`), in as few requests as their roots
 * allow (a root reads once per request), all sent together. Rows that differ only by `eq` values gather into one `in`,
 * and the answer is dealt back by those values; a shape that cannot gather reads once per distinct layer. A read of
 * `employment` never reaches its table alone: all of a batch's are one request for the stints they name, sent with the
 * others, and each is answered with those stints as they stand on its reading row's own day (`on`), cut to its `fields`
 * and `limit`.
 */
const batchRead = Effect.fnUntraced(function* (
	read: Reader,
	requests: readonly (readonly JsonObject[])[],
	cache: Map<string, readonly JsonObject[]>,
	on: (rule: number, row: number) => string
) {
	const answers = requests.map((rows) =>
		rows.map((): Record<string, readonly JsonObject[]> => ({}))
	);
	const stints: {
		readonly own: Record<string, readonly JsonObject[]>;
		readonly layer: Layer;
		readonly day: string;
	}[] = [];
	const wanted: {
		readonly own: Record<string, readonly JsonObject[]>;
		readonly name: string;
		readonly layer: Layer;
		readonly key: string;
	}[] = [];
	for (const [rule, rows] of requests.entries())
		for (const [index, request] of rows.entries()) {
			const own = answers[rule]?.[index];
			if (own === undefined) continue;
			for (const [name, layer] of Object.entries(request)) {
				if (!isJsonObject(layer)) continue;
				if (name === 'employment') stints.push({ own, layer, day: on(rule, index) });
				else wanted.push({ own, name, layer, key: JSON.stringify({ [name]: layer }) });
			}
		}
	// each distinct read once, all in one typed request
	const fresh = [
		...new Map(
			wanted.filter(({ key }) => !cache.has(key)).map((need) => [need.key, need] as const)
		).values()
	];
	const filters = stints.map(({ layer }) => stintFilter(layer));
	const keys = (key: (typeof STINT_KEYS)[number]) =>
		idsIn(filters.map((filter) => (filter.key === key ? filter.value : undefined)));
	const [found, held] = yield* Effect.all(
		[
			fresh.length === 0
				? Effect.succeed([])
				: ruleRead(
						read,
						fresh.map(({ name, layer }) => ({ model: name, layer }))
					),
			stints.length === 0
				? Effect.succeed(stintsIn({}))
				: queryRows(read, {
						...stintLayers({
							id: keys('id'),
							employee_id: keys('employee_id'),
							entity_id: keys('entity_id')
						}),
						employee_profile: {
							where: {
								employment: {
									some: {
										or: [
											{ id: { in: idsOf('employment', keys('id')) } },
											{ employee_id: { in: idsOf('employee_profile', keys('employee_id')) } },
											{ entity_id: { in: idsOf('entity', keys('entity_id')) } }
										]
									}
								}
							},
							fields: [...new Set([...PROFILE_FIELDS, ...SUBJECT_EMPLOYEE])],
							limit: 10000
						}
					}).pipe(Effect.map(stintsIn))
		],
		{ concurrency: 'unbounded' }
	);
	for (const [index, need] of fresh.entries()) cache.set(need.key, found[index] ?? []);
	for (const { own, name, layer, key } of wanted) {
		const fields = Array.isArray(layer.fields) ? layer.fields : undefined;
		const rows = (cache.get(key) ?? []).map((row) =>
			fields === undefined
				? row
				: Object.fromEntries(
						Object.entries(row).filter(([field]) => field === 'id' || fields.includes(field))
					)
		);
		own[name] = typeof layer.limit === 'number' ? rows.slice(0, layer.limit) : rows;
	}
	for (const [nth, { own, layer, day }] of stints.entries()) {
		const filter = filters[nth];
		const fields = Array.isArray(layer.fields) ? layer.fields : undefined;
		const rows = [...held.values()]
			.filter((stint) => filter !== undefined && stint.parts.stint[filter.key] === filter.value)
			.map((stint) => {
				const row = stintOn(stint, day);
				return fields === undefined
					? row
					: Object.fromEntries(
							Object.entries(row).filter(([key]) => key === 'id' || fields.includes(key))
						);
			});
		own.employment = typeof layer.limit === 'number' ? rows.slice(0, layer.limit) : rows;
	}
	return answers;
});

/**
 * A declared read of a law family never reaches the database: the law in force answers it with the family's rows, those
 * `where.code` names (`eq` or `in`), cut to `fields` and `limit`. The other layers are `stored`.
 */
const readLaw = (law: Law, request: JsonObject) => {
	const stored: Record<string, Json> = {};
	const held: Record<string, readonly JsonObject[]> = {};
	for (const [name, declared] of Object.entries(request)) {
		const family = LAW_ROWS.find((rows) => rows === name);
		if (family === undefined) {
			stored[name] = declared;
			continue;
		}
		const layer = isJsonObject(declared) ? declared : {};
		const { code, ...other } = whereOf(layer);
		const test = isJsonObject(code) ? code : {};
		const codes = Array.isArray(test.in) ? test.in : 'eq' in test ? [test.eq ?? null] : undefined;
		if (Object.keys(other).length > 0 || (code !== undefined && codes === undefined))
			throw new Refusal({ message: `${name}: a law family is read by code.` });
		const fields = Array.isArray(layer.fields) ? layer.fields : undefined;
		const rows = law.rows[family]
			.filter((row) => codes === undefined || codes.includes(row.code ?? null))
			.map((row) =>
				fields === undefined
					? row
					: Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key)))
			);
		held[name] = typeof layer.limit === 'number' ? rows.slice(0, layer.limit) : rows;
	}
	return { stored, held };
};

/** A rule or effect that reads a lookup key it does not hold reads the jurisdiction's. */
const usesGlobalLookup = (row: JsonObject): boolean => {
	const own = isJsonObject(row.lookup) ? row.lookup : {};
	const source = `${String(row.condition ?? '')}\n${String(row.validate ?? row.effects ?? '')}`;
	return [...source.matchAll(/ctx\.lookup\.(\w+)|get\(ctx\.lookup, '(\w+)'/g)].some(
		(match) => !(String(match[1] ?? match[2]) in own)
	);
};

/** Whether a model's rows are dated records: each stands on one day of its own. */
const datedIn = (collection: string) =>
	OWN_DAY[collection] !== undefined || collection === 'payslip';
/** Where a written row stands in the law: a company and a day. */
type Place = { readonly entity: string; readonly on: string };
/**
 * Where each written row stands, whatever its model. A dated record stands at its company on its own day. A record with
 * no day of its own stands where its stint starts, else where each of its person's stints starts, else where each of
 * its company's changes starts. One read: what the rows do not carry, and the law code of every company it names
 * (`codes`).
 */
const placesOf = Effect.fnUntraced(function* (
	read: Reader,
	collection: string,
	operation: Operation,
	rows: readonly JsonObject[]
) {
	const dated = datedIn(collection);
	const entityOf = (row: JsonObject) => refId(collection === 'entity' ? row.id : row.entity_id);
	const personOf = (row: JsonObject) =>
		refId(collection === 'employee_profile' ? row.id : row.employee_id);
	const stintOf = (row: JsonObject) => refId(row.employment_id);
	// an employment answers to the law of its segment's first day; its exit, to the law of its last day
	const ownDay = (row: JsonObject) =>
		operation === 'exit' && collection === 'employment'
			? (rangeObject(row.effective_range)?.to ?? startOf(row))
			: OWN_DAY[collection]?.(row);
	const named = idsIn(rows.filter((row) => !dated || entityOf(row) === undefined).map(stintOf));
	const people = dated ? [] : idsIn(rows.filter((row) => stintOf(row) === undefined).map(personOf));
	const companies = dated
		? []
		: idsIn(
				rows
					.filter((row) => stintOf(row) === undefined && personOf(row) === undefined)
					.map(entityOf)
			);
	const leaves =
		collection === 'leave_catalog_entry'
			? idsIn(rows.filter((row) => ownDay(row) === undefined).map((row) => refId(row.id)))
			: [];
	const runs = collection === 'payslip' ? idsIn(rows.map((row) => refId(row.payroll_run_id))) : [];
	if (rows.length === 0) return { places: [], codes: new Map<string, Json>() };
	const found = yield* queryRows(read, {
		entity: {
			where: { id: { in: idsOf('entity', idsIn(rows.map(entityOf))) } },
			fields: ['settings_code'],
			limit: 50
		},
		employment: {
			where: {
				or: [
					{ id: { in: idsOf('employment', named) } },
					{ employee_id: { in: idsOf('employee_profile', people) } }
				]
			},
			fields: ['id', 'employee_id', 'entity_id', 'effective_range'],
			limit: 10000,
			entity_id: { fields: ['settings_code'] }
		},
		entity_change: {
			where: { entity_id: { in: idsOf('entity', companies) } },
			fields: ['entity_id', 'effective_from'],
			limit: 10000
		},
		leave_catalog_entry_day: {
			where: { leave_entry_id: { in: idsOf('leave_catalog_entry', leaves) } },
			fields: ['leave_entry_id', 'incurred_on'],
			limit: 10000
		},
		payroll_run: {
			where: { id: { in: idsOf('payroll_run', runs) } },
			fields: ['id', 'entity_id', 'pay_date'],
			limit: 10000,
			entity_id: { fields: ['settings_code'] }
		}
	});
	// the law code of each company: the rows' own, and those of the stints and runs they reach
	const codes = new Map<string, Json>([
		...found.entity.map((row) => [String(row.id), row.settings_code ?? null] as const),
		...[...found.employment, ...found.payroll_run].flatMap((row) =>
			isJsonObject(row.entity_id)
				? [[String(row.entity_id.id), row.entity_id.settings_code ?? null] as const]
				: []
		)
	]);
	const stint = new Map(found.employment.map((row) => [String(row.id), row]));
	const stints = Map.groupBy(found.employment, (row) => refId(row.employee_id));
	const changes = Map.groupBy(found.entity_change, (row) => refId(row.entity_id));
	const slots = Map.groupBy(found.leave_catalog_entry_day, (row) => refId(row.leave_entry_id));
	const run = new Map(found.payroll_run.map((row) => [String(row.id), row]));
	const at = (entity: unknown, on: unknown): readonly Place[] => {
		const company = refId(entity);
		return company !== undefined && typeof on === 'string' ? [{ entity: company, on }] : [];
	};
	const places = rows.map((row): readonly Place[] => {
		const held = stint.get(String(stintOf(row)));
		if (collection === 'payslip') {
			const paid = run.get(String(refId(row.payroll_run_id)));
			return at(row.entity_id ?? paid?.entity_id, paid?.pay_date);
		}
		if (dated)
			return at(
				entityOf(row) ?? held?.entity_id,
				ownDay(row) ?? firstSlot({ days: slots.get(refId(row.id)) ?? [] })
			);
		if (stintOf(row) !== undefined)
			return held === undefined ? [] : at(held.entity_id, startOf(held));
		const person = personOf(row);
		return person !== undefined
			? (stints.get(person) ?? []).flatMap((own) => at(own.entity_id, startOf(own)))
			: (changes.get(entityOf(row)) ?? []).flatMap((change) =>
					at(change.entity_id, change.effective_from)
				);
	});
	return { places, codes };
});

/** A law and the rows of a batch that stand under it, by their place in the batch. */
type UnderLaw = { readonly law: Law; readonly at: number[] };
/**
 * The laws a batch of written rows answers to, each with the rows under it, the day each row is its own (`on`; a row
 * with none reads what last stands) and the rows' subjects primed into the cache: two reads, where the rows stand with
 * their companies' law codes, then those laws (unless the invocation has read them) with the subjects. A law is its
 * company's jurisdiction as it stands on the row's day; rows on either side of a change in the law stand under
 * different laws.
 */
const lawsFor = Effect.fnUntraced(function* (
	read: Reader,
	collection: string,
	operation: Operation,
	rows: readonly JsonObject[],
	cache: SubjectCache
) {
	// a law's rows are one object for every day between two changes
	const groups = new Map<Law['rows'], UnderLaw>();
	const { places, codes } = yield* placesOf(read, collection, operation, rows);
	const on = (index: number) =>
		(datedIn(collection) ? places[index]?.[0]?.on : undefined) ?? LATEST;
	const companies = idsIn(places.flatMap((own) => own.map(({ entity }) => entity)));
	if (companies.length === 0) return { laws: [...groups.values()], on };
	const subject = subjectLayers(rows, cache, [...codes.keys()]);
	const { got, laws } = yield* lawsWith(
		read,
		companies.flatMap((id) => {
			const code = codes.get(id);
			return typeof code === 'string' ? [code] : [];
		}),
		(law) =>
			queryRows(read, {
				entity: {
					where: { id: { in: idsOf('entity', subject.entities) } },
					fields: [...SUBJECT_ENTITY],
					limit: 50
				},
				...law,
				...subject.layers
			})
	);
	primeFrom(got, subject.entities, cache);
	for (const [index, own] of places.entries())
		for (const { entity, on } of own) {
			const law = laws(codes.get(entity), on);
			if (law === undefined) continue;
			const group: UnderLaw = groups.get(law.rows) ?? { law, at: [] };
			if (!group.at.includes(index)) group.at.push(index);
			groups.set(law.rows, group);
		}
	return { laws: [...groups.values()], on };
});

/** A law's rules or effects registered for a collection and operation. */
const registered = (
	rows: readonly JsonObject[],
	side: 'target_collection' | 'source_collection',
	collection: string,
	operation: Operation
) =>
	rows.filter(
		(row) => row[side] === collection && Array.isArray(row.events) && row.events.includes(operation)
	);

/** The law family an entry's `catalog_code` names. */
const CATALOG: Readonly<Record<string, keyof Law['rows']>> = {
	adhoc_catalog_entry: 'adhoc_catalog',
	claim_catalog_entry: 'claim_catalog',
	leave_catalog_entry: 'leave_catalog',
	loan_catalog_entry: 'loan_catalog',
	workplace_case_catalog_entry: 'workplace_case_catalog',
	work_event: 'work_event_catalog'
};
/** The days of an entry payroll prices by date, and whether one after the stint's last day may stand. */
const PRICED_DAYS: Readonly<
	Record<
		string,
		{ readonly days: (row: JsonObject) => readonly unknown[]; readonly after: boolean }
	>
> = {
	// a bonus or correction may be paid after the last day, by an off-cycle run
	adhoc_catalog_entry: { days: (row) => [row.incurred_on], after: true },
	claim_catalog_entry: { days: (row) => [row.incurred_on], after: false },
	leave_catalog_entry: {
		// a cash-out's days are placeholders
		days: (row) =>
			row.encashment === true || !Array.isArray(row.days)
				? []
				: row.days.map((day) => (isJsonObject(day) ? day.date : undefined)),
		after: false
	}
};
/**
 * An entry names a row its company's law holds, and the days payroll prices fall in its stint: an entry on neither
 * would save and post nothing. The stints are those `lawsFor` primed: no read.
 */
const assertPlaced = Effect.fnUntraced(function* (
	collection: string,
	rows: readonly JsonObject[],
	laws: readonly UnderLaw[],
	cache: SubjectCache
) {
	const family = Object.hasOwn(CATALOG, collection) ? CATALOG[collection] : undefined;
	if (family === undefined) return;
	for (const { law, at } of laws) {
		const codes = new Set(law.rows[family].map((row) => String(row.code)));
		const unknown = at.find((index) => !codes.has(String(rows[index]?.catalog_code)));
		if (unknown !== undefined)
			return yield* new Refusal({
				message: `${String(rows[unknown]?.catalog_code)} is not a row of the law this company follows (${law.code}).`
			});
	}
	const priced = PRICED_DAYS[collection];
	if (priced === undefined) return;
	for (const row of rows) {
		const stint = rangeObject(
			cache.stints.get(String(refId(row.employment_id)))?.parts.stint.effective_range
		);
		const from = typeof stint?.from === 'string' ? stint.from : undefined;
		if (from === undefined) continue;
		const to = typeof stint?.to === 'string' ? stint.to : null;
		const outside = priced
			.days(row)
			.find(
				(day) =>
					typeof day === 'string' && (day < from || (!priced.after && to !== null && day > to))
			);
		if (outside !== undefined)
			return yield* new Refusal({
				message: `${String(outside)} is outside this employment (${from} to ${to ?? 'now'}).`
			});
	}
});

/**
 * Every rule the law in force registers for this collection and operation validates the proposed rows, for the whole
 * batch in three trips: `lawsFor`'s two (where the rows stand; the law, its lookups and the rows' subjects), then every
 * rule's declared reads together; a subject neither reached is one more. `before` holds each row as it stood without
 * the write, none for a row that is new; without it a rule reads the row.
 */
export const validateRegistered = Effect.fn('payroll.validateRegistered')(function* (
	read: Reader,
	collection: string,
	operation: Operation,
	rows: readonly JsonObject[],
	before?: readonly (JsonObject | undefined)[]
) {
	if (rows.length === 0) return [];
	const cache: SubjectCache = { stints: new Map(), employers: new Map(), employees: new Map() };
	const { laws, on } = yield* lawsFor(read, collection, operation, rows, cache);
	if (operation === 'create' || operation === 'update')
		yield* assertPlaced(collection, rows, laws, cache);
	const applied = laws.flatMap(({ law, at }) =>
		registered(law.rows.registered_rule, 'target_collection', collection, operation)
			.toSorted((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
			.map((rule) => ({ rule, law, at }))
	);
	if (applied.length === 0) return [];
	const source = applied
		.map(
			({ rule }) =>
				`${JSON.stringify(rule.reads ?? {})}\n${rule.condition ?? ''}\n${rule.validate ?? ''}`
		)
		.join('\n');
	const needs = {
		employer: source.includes('ctx.subject.employer'),
		employee: source.includes('ctx.subject.employee')
	};
	const subjects = yield* subjectsOf(
		read,
		collection,
		rows,
		rows.map((_, index) => on(index)),
		cache,
		needs
	);
	const declared = applied.map(({ rule, law, at }) => {
		const stated = isJsonObject(rule.reads) ? rule.reads : {};
		return at.map((index) =>
			readLaw(
				law,
				jsonObject(resolveRead(stated, { entry: rows[index], subject: subjects[index] }))
			)
		);
	});
	const readCache = new Map<string, readonly JsonObject[]>();
	const reads = yield* batchRead(
		read,
		declared.map((own) => own.map(({ stored }) => stored)),
		readCache,
		(rule, row) => on(applied[rule]?.at[row] ?? -1)
	);
	// a row stops at its first refusing rule, in rule order; the other rows go on
	const refused = new Map<number, string>();
	for (const [nth, { rule, law, at }] of applied.entries()) {
		const code = String(rule.code ?? '');
		for (const [own, index] of at.entries()) {
			const row = rows[index];
			if (row === undefined || refused.has(index)) continue;
			const context = {
				entry: row,
				before: before === undefined ? row : (before[index] ?? null),
				event: { operation, collection },
				subject: subjects[index] ?? {},
				reads: { ...reads[nth]?.[own], ...declared[nth]?.[own]?.held },
				lookup: {
					...(usesGlobalLookup(rule) ? settingsConstants(law.settings) : {}),
					...(isJsonObject(rule.lookup) ? rule.lookup : {})
				}
			};
			const condition = rule.condition;
			if (typeof condition === 'string' && condition.trim() !== '') {
				const gate = evaluate(condition, 'CALCULATION', context, `${code}.condition`);
				if (!truth(gate)) continue;
			}
			const validate = rule.validate;
			if (typeof validate !== 'string' || validate.trim() === '')
				throw new Refusal({
					message: `${code}: a registered rule needs its validation expression.`
				});
			const answer = evaluate(validate, 'CALCULATION', context, `${code}.validate`);
			if (!truth(answer)) refused.set(index, code);
		}
	}
	// owner, 2026-11-15: for now a rule that answers no warns and the write stands. Each warning names its row.
	const warnings = [...refused]
		.toSorted(([left], [right]) => left - right)
		.map(([index, code]) => {
			const key = [pathValue(subjects[index], 'employment.employee_number'), rows[index]?.work_date]
				.filter((part) => typeof part === 'string' && part !== '')
				.join(' ');
			return {
				index,
				code,
				message: `${key === '' ? '' : `${key}: `}${code}: outside its registered rule.`
			};
		});
	if (warnings.length > 0)
		yield* Effect.logWarning(warnings.map((warning) => warning.message).join('\n'));
	return warnings;
});

/**
 * A catalogue row's own `eligibility` decides whether an entry may be raised on it. It reads what a rule reads: the
 * entry, its subject and the row's lookup over its law's constants, within the family's declared roots.
 */
export const refuseIneligible = Effect.fn('payroll.refuseIneligible')(function* (
	read: Reader,
	collection: string,
	rows: readonly JsonObject[]
) {
	const catalog = CATALOG_OF[collection];
	if (catalog === undefined) return;
	const cache: SubjectCache = { stints: new Map(), employers: new Map(), employees: new Map() };
	// each row with the catalogue row its code names in its law, where that row has an eligibility rule
	const { laws, on } = yield* lawsFor(read, collection, 'create', rows, cache);
	const gated = laws.flatMap(({ law, at }) =>
		at.flatMap((index) => {
			const row = rows[index];
			const item = law.rows[catalog].find((held) => held.code === row?.catalog_code);
			return row !== undefined &&
				item !== undefined &&
				typeof item.eligibility === 'string' &&
				item.eligibility.trim() !== ''
				? [{ row, item, law, day: on(index) }]
				: [];
		})
	);
	const roots = programOf(catalog)?.roots;
	const subjects = yield* subjectsOf(
		read,
		collection,
		gated.map(({ row }) => row),
		gated.map(({ day }) => day),
		cache
	);
	const refused: string[] = [];
	for (const [index, { row, item, law }] of gated.entries()) {
		const code = String(item.code ?? '');
		const subject = subjects[index] ?? {};
		const answer = evaluate(
			String(item.eligibility),
			'CALCULATION',
			{
				entry: row,
				subject,
				lookup: {
					...settingsConstants(law.settings),
					...(isJsonObject(item.lookup) ? item.lookup : {})
				}
			},
			`${code}.eligibility`,
			roots
		);
		if (typeof answer !== 'boolean')
			throw new Refusal({ message: `${code}.eligibility: must return a boolean.` });
		if (!answer) {
			const who = pathValue(subject, 'employment.employee_number');
			const why = typeof item.description === 'string' ? ` (${item.description})` : '';
			refused.push(
				`${typeof who === 'string' ? `${who}: ` : ''}${code}${why} is not allowed here: its eligibility rule says no. ` +
					'Open the row under Settings → Catalog to see what it needs, correct the entry or the company and employee facts it reads, then save again.'
			);
		}
	}
	if (refused.length > 0) throw new Refusal({ message: refused.join('\n') });
});

/**
 * A registered effect runs after the commit: its expression returns the records its declared
 * target action writes. Models call it through `tap`.
 */
export const applyRegisteredEffects = Effect.fn('payroll.applyRegisteredEffects')(function* (
	// a model effect and the automation that runs held effects both give it these two
	ctx: Pick<EffectCtx, 'query' | 'act'>,
	operation: Operation,
	collection: string,
	changes: readonly { readonly before?: object; readonly after?: object }[]
) {
	const written = (change: { readonly before?: object; readonly after?: object }): JsonObject => {
		const row: JsonObject = {
			...(isJsonObject(change.before) ? change.before : {}),
			...(isJsonObject(change.after) ? change.after : {})
		};
		return Object.fromEntries(
			Object.entries(row).map(([key, value]) => [key, rangeObject(value) ?? value])
		);
	};
	const entries = changes.map(written);
	const cache: SubjectCache = { stints: new Map(), employers: new Map(), employees: new Map() };
	// the effects the law in force registers, its lookups and the subjects of the rows: two reads
	const { laws, on } = yield* lawsFor(ctx.query, collection, operation, entries, cache);
	const applied = laws.flatMap(({ law, at }) =>
		registered(law.rows.registered_effect, 'source_collection', collection, operation).map(
			(effect) => ({ effect, law, at })
		)
	);
	if (applied.length === 0) return;
	const source = applied
		.map(
			({ effect: row }) =>
				`${JSON.stringify(row.reads ?? {})}\n${row.condition ?? ''}\n${row.effects ?? ''}`
		)
		.join('\n');
	const needs = {
		employer: source.includes('subject.employer'),
		employee: source.includes('subject.employee')
	};
	const subjects = yield* subjectsOf(
		ctx.query,
		collection,
		entries,
		entries.map((_, index) => on(index)),
		cache,
		needs
	);
	// every effect's declared reads for the whole batch, together
	const declared = applied.map(({ effect, law, at }) => {
		const stated = isJsonObject(effect.reads) ? effect.reads : {};
		// a task is known by its key: an effect that reads tasks reads the key, whatever fields it lists
		const tasks = stated.obligation;
		const keyed =
			isJsonObject(tasks) && Array.isArray(tasks.fields) && !tasks.fields.includes('occurrence_key')
				? { ...stated, obligation: { ...tasks, fields: [...tasks.fields, 'occurrence_key'] } }
				: stated;
		return at.map((index) =>
			readLaw(
				law,
				jsonObject(resolveRead(keyed, { entry: entries[index], subject: subjects[index] }))
			)
		);
	});
	const allReads = yield* batchRead(
		ctx.query,
		declared.map((own) => own.map(({ stored }) => stored)),
		new Map(),
		(rule, row) => on(applied[rule]?.at[row] ?? -1)
	);
	const writes: Record<string, JsonObject[]> = {};
	for (const [nth, { effect, law, at }] of applied.entries()) {
		const code = String(effect.code ?? '');
		const action = effect.target_action;
		const target = effect.target_collection;
		if (action !== 'create' && action !== 'update' && action !== 'delete') continue;
		if (typeof target !== 'string' || target === '') continue;
		const reads = allReads[nth] ?? [];
		const lookup = {
			...(usesGlobalLookup(effect) ? settingsConstants(law.settings) : {}),
			...(isJsonObject(effect.lookup) ? effect.lookup : {})
		};
		const condition = effect.condition;
		const body = effect.effects;
		if (typeof body !== 'string' || body.trim() === '')
			throw new Refusal({ message: `${code}: a registered effect needs its expression.` });
		const input: JsonObject[] = [];
		for (const [own, index] of at.entries()) {
			const change = changes[index];
			const context = {
				entry: entries[index],
				before: change?.before ?? null,
				after: change?.after ?? null,
				event: { operation, collection },
				subject: subjects[index],
				reads: { ...reads[own], ...declared[nth]?.[own]?.held },
				lookup
			};
			if (typeof condition === 'string' && condition.trim() !== '') {
				if (!truth(evaluate(condition, 'CALCULATION', context, `${code}.condition`))) continue;
			}
			const result = evaluate(body, 'CALCULATION', context, `${code}.effects`);
			if (Array.isArray(result))
				input.push(...Schema.decodeUnknownSync(Schema.Array(JsonObject))(result));
		}
		if (input.length > 0) (writes[`${target}.${action}`] ??= []).push(...input);
	}
	// A task is raised once, whatever fires its effect again (a retried run, a host that replays, two effects of one
	// save): the import keeps one whose key is on file. One write for every effect together.
	const { 'obligation.create': raised = [], ...rest } = writes;
	const tasks = [...new Map(raised.map((row) => [row.occurrence_key, row])).values()];
	const acts: Record<string, Json> = { ...rest };
	if (tasks.length > 0) acts['obligation.import'] = { rows: tasks, on_conflict: 'keep' };
	if (Object.keys(acts).length === 0) return;
	yield* ctx.act(acts);
});

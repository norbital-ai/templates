import { DateTime, Effect } from 'effect';
import { evaluate } from './expressions.js';
import { Refusal, isJsonObject, type Json } from '../../../../lib/foundation.js';
import { JsonObject } from '../../../../lib/contracts.js';
import { idsOf, queryRows, type Reader } from '../../../../lib/reads.js';
import { ruleRead } from './rule_reads.js';
import { LAW_ROWS, lawsWith, type Law, type LawFamily } from './law.js';
import { employerOn } from '../../entity/service/company.js';
import {
	PROFILE_FIELDS,
	STINT_FIELDS,
	chainOf,
	employmentOn,
	partsIn,
	startsOf,
	type Parts,
	type Starts
} from '../../employee_profile/service/person.js';

export type Operation = 'create' | 'update' | 'delete' | 'exit';
export const CATALOG_OF: Readonly<Record<string, LawFamily>> = {
	leave_catalog_entry: 'leave_catalog',
	claim_catalog_entry: 'claim_catalog',
	adhoc_catalog_entry: 'adhoc_catalog',
	loan_catalog_entry: 'loan_catalog',
	workplace_case_catalog_entry: 'workplace_case_catalog'
};

export const truth = (value: unknown): boolean => value === true;

export const pathValue = (value: unknown, path: string): unknown => {
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

export const refId = (value: unknown): string | undefined =>
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
export const expression = (source: string, data: Record<string, unknown>): unknown => {
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
export type SubjectCache = {
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
export const subjectsOf = Effect.fnUntraced(function* (
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
export const batchRead = Effect.fnUntraced(function* (
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
export const readLaw = (law: Law, request: JsonObject) => {
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
export const usesGlobalLookup = (row: JsonObject): boolean => {
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
		...found.entity.map((row) => [row.id, row.settings_code ?? null] as const),
		...[...found.employment, ...found.payroll_run].flatMap((row) =>
			isJsonObject(row.entity_id)
				? [[row.entity_id.id, row.entity_id.settings_code ?? null] as const]
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
export type UnderLaw = { readonly law: Law; readonly at: number[] };
/**
 * The laws a batch of written rows answers to, each with the rows under it, the day each row is its own (`on`; a row
 * with none reads what last stands) and the rows' subjects primed into the cache: two reads, where the rows stand with
 * their companies' law codes, then those laws (unless the invocation has read them) with the subjects. A law is its
 * company's jurisdiction as it stands on the row's day; rows on either side of a change in the law stand under
 * different laws.
 */
export const lawsFor = Effect.fnUntraced(function* (
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
export const registered = (
	rows: readonly JsonObject[],
	side: 'target_collection' | 'source_collection',
	collection: string,
	operation: Operation
) =>
	rows.filter(
		(row) => row[side] === collection && Array.isArray(row.events) && row.events.includes(operation)
	);

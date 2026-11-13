import { DateTime, Effect, Schema } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import { evaluate } from './expressions.js';
import { Refusal, isJsonObject, jsonObject, type Json } from './foundation.js';
import { JsonObject, settingsConstants } from './contracts.js';
import { queryRows, type Reader } from './reads.js';
import { programOf } from './programs.js';
import { chainOf, startsOf } from './contract_change.js';
import { LAW_ROWS, lawReadOf, lawsOf, type Law, type LawFamily } from '../law.js';
import { employerOn } from '../company.js';
import { ReadRequestJson } from '@norbital-ai/bolt/protocol';

export type Operation = 'create' | 'update' | 'delete' | 'seal' | 'exit';
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

/** A contract's first day, from a written row or its stored half-open range. */
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
	employee_contract: startOf,
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

/** Resolve the small expression language `reads` declarations use. */
const expression = (source: string, data: Record<string, unknown>): Json => {
	const text = source.trim();
	const variable = /^(?:ctx\.)?([A-Za-z0-9_.]+)$/.exec(text);
	if (variable !== null) {
		const value = pathValue(data, variable[1]!);
		if (isJsonObject(value) && typeof value.id === 'string') return value.id;
		return (value ?? null) as Json;
	}
	const call = /^(month_start|month_end|add_days|add_months)\((.*)\)$/.exec(text);
	if (call !== null) {
		const args = call[2]!.split(',').map((part) => part.trim());
		const first = args[0] === undefined ? null : expression(args[0], data);
		const second = args[1] === undefined ? null : expression(args[1], data);
		const date =
			typeof first === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(first)
				? DateTime.makeUnsafe(first)
				: null;
		const count = Number(second);
		if (date === null) return null;
		switch (call[1]) {
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
	return evaluate(`return ${text};`, 'CALCULATION', data, 'reads') as Json;
};

export const resolveRead = (value: Json, data: Record<string, unknown>): Json => {
	if (Array.isArray(value)) return value.map((item) => resolveRead(item as Json, data));
	if (value !== null && typeof value === 'object') {
		const keys = Object.keys(value);
		if (keys.length === 1 && typeof (value as Record<string, Json>).var === 'string')
			return expression(String((value as Record<string, Json>).var), data);
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, resolveRead(item as Json, data)])
		);
	}
	if (
		typeof value === 'string' &&
		(value.startsWith('ctx.') || /^(month_start|month_end|add_days|add_months)\(/.test(value))
	)
		return expression(value, data);
	return value;
};

const SUBJECT_CONTRACT = [
	'id',
	'employee_number',
	'employee_id',
	'entity_id',
	'effective_range',
	'terms',
	'payroll',
	'engagement',
	'events',
	'family',
	'employee_extension_data',
	'exit_ground'
] as const;
/** What a subject reads of its company; `settings_code` names the law the same read looks up. */
const SUBJECT_ENTITY = ['id', 'settings_code', 'time_zone'] as const;
const SUBJECT_PAY_GROUP = ['entity_id', 'name', 'payment_schedule'] as const;
/** A company as read: its plain fields, its dated changes and its pay groups. A subject folds them on its own day. */
type Company = {
	readonly entity: JsonObject;
	readonly changes: readonly JsonObject[];
	readonly groups: readonly JsonObject[];
};
type SubjectCache = {
	contracts: Map<string, JsonObject>;
	employers: Map<string, Company>;
	employees: Map<string, JsonObject>;
};
const idsIn = (values: readonly (string | undefined)[]): readonly string[] => [
	...new Set(values.flatMap((value) => (value === undefined ? [] : [value])))
];
/**
 * The subjects of a batch, as one request's layers: its contracts, the changes and pay groups of the employers its rows
 * name (`entities`, whose own rows the caller reads) and the contracts' people. `primeFrom` fills the cache from the
 * answer, and `subjectValue` then answers every row from it.
 */
const subjectLayers = (rows: readonly JsonObject[], cache: SubjectCache) => {
	const contracts = idsIn(rows.map((row) => refId(row.employment_id))).filter(
		(id) => !cache.contracts.has(id)
	);
	const held = [...cache.contracts.values()];
	const entities = idsIn([...rows, ...held].map((row) => refId(row.entity_id))).filter(
		(id) => !cache.employers.has(id)
	);
	const employees = idsIn(held.map((row) => refId(row.employee_id))).filter(
		(id) => !cache.employees.has(id)
	);
	// a person through their contract: employee_profile declares that layer
	const through = { employee_contract: { some: { id: { in: [...contracts] } } } };
	const direct = employees.length === 0 ? undefined : { id: { in: [...employees] } };
	const employee =
		contracts.length === 0 ? direct : direct === undefined ? through : { or: [direct, through] };
	const layers = {
		...(contracts.length === 0
			? {}
			: {
					employee_contract: {
						where: { id: { in: [...contracts] } },
						fields: [...SUBJECT_CONTRACT],
						limit: 10000
					}
				}),
		...(entities.length === 0
			? {}
			: {
					entity_change: { where: { entity_id: { in: [...entities] } }, limit: 10000 },
					pay_group: {
						where: { entity_id: { in: [...entities] } },
						fields: [...SUBJECT_PAY_GROUP],
						limit: 10000
					}
				}),
		...(employee === undefined
			? {}
			: {
					employee_profile: {
						where: employee,
						fields: ['id', 'name', 'email', 'phone', 'user_id'],
						limit: 10000
					}
				})
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
	for (const row of found.employee_contract ?? []) cache.contracts.set(String(row.id), row);
	for (const [id, company] of companiesIn(found, entities)) cache.employers.set(id, company);
	for (const row of found.employee_profile ?? []) cache.employees.set(String(row.id), row);
};
/** A day after every change: a row with no day of its own reads its company as it last stands. */
const LATEST = '9999-12-31';

const subjectValue = Effect.fnUntraced(function* (
	read: Reader,
	collection: string,
	row: JsonObject,
	cache: SubjectCache,
	needs: { employer: boolean; employee: boolean } = { employer: true, employee: true }
) {
	let employment: JsonObject | undefined = collection === 'employee_contract' ? row : undefined;
	const employmentId = refId(row.employment_id);
	if (employment === undefined && employmentId !== undefined) {
		employment = cache.contracts.get(employmentId);
		if (employment === undefined) {
			const found = yield* queryRows(read, {
				employee_contract: {
					where: { id: { eq: employmentId } },
					fields: [...SUBJECT_CONTRACT],
					limit: 1
				}
			});
			employment = found.employee_contract?.[0];
			if (employment !== undefined) cache.contracts.set(employmentId, employment);
		}
	}
	const employerId = refId(employment?.entity_id) ?? refId(row.entity_id);
	let employer: JsonObject | undefined;
	if (needs.employer && typeof employerId === 'string') {
		let company = cache.employers.get(employerId);
		if (company === undefined) {
			const found = yield* queryRows(read, {
				entity: { where: { id: { eq: employerId } }, fields: [...SUBJECT_ENTITY], limit: 1 },
				entity_change: { where: { entity_id: { eq: employerId } }, limit: 10000 },
				pay_group: {
					where: { entity_id: { eq: employerId } },
					fields: [...SUBJECT_PAY_GROUP],
					limit: 100
				}
			});
			company = companiesIn(found, [employerId])[0]?.[1];
			if (company !== undefined) cache.employers.set(employerId, company);
		}
		// the company as it stands on the row's own day
		const day = OWN_DAY[collection]?.(row);
		if (company !== undefined)
			employer = withSchedule(
				employerOn(company.entity, company.changes, typeof day === 'string' ? day : LATEST),
				company.groups
			);
	}
	const employeeId = refId(employment?.employee_id);
	let employee: JsonObject | undefined;
	if (needs.employee && typeof employeeId === 'string') {
		employee = cache.employees.get(employeeId);
		if (employee === undefined) {
			const found = yield* queryRows(read, {
				employee_profile: {
					where: { id: { eq: employeeId } },
					fields: ['id', 'name', 'email', 'phone', 'user_id'],
					limit: 1
				}
			});
			employee = found.employee_profile?.[0];
			if (employee !== undefined) cache.employees.set(employeeId, employee);
		}
	}
	return { employment: employment ?? {}, employer: employer ?? {}, employee: employee ?? {} };
});

type Layer = { readonly [key: string]: Json };
const whereOf = (layer: Layer): Layer => (isJsonObject(layer.where) ? layer.where : {});
const STINT = ['id', 'employee_id', 'status', 'effective_range', 'entity_id'];
/** Worked out from the stints, never stored: a read asks for it as a field and gets it beside the service start. */
const EMPLOYMENT_START = 'employment_started_on';
/** A contract read that asks for service reads the person's stints beside it, in the same request. */
const withStints = (layer: Layer): Record<string, Layer> =>
	Array.isArray(layer.fields) &&
	!layer.fields.includes('service_started_on') &&
	!layer.fields.includes(EMPLOYMENT_START)
		? { employee_contract: layer }
		: {
				employee_contract: {
					...(Array.isArray(layer.fields)
						? {
								...layer,
								fields: [
									...new Set([
										...layer.fields.filter((field) => field !== EMPLOYMENT_START),
										'service_started_on',
										...STINT
									])
								]
							}
						: layer),
					employee_id: {
						fields: ['id', 'cumulative_service'],
						employee_contract: {
							where: { status: { eq: 'SEALED' } },
							fields: STINT,
							entity_id: { fields: ['settings_code'] }
						}
					}
				}
			};
/** A contract read with its stints carries the service and employment starts sync and the run work out, on its plain person id. */
const serviced = (row: JsonObject): JsonObject => {
	const person = row.employee_id;
	if (!isJsonObject(person)) return row;
	const stints = person.employee_contract;
	const { chain, lineage } = chainOf(Array.isArray(stints) ? stints.filter(isJsonObject) : []);
	const contract = { ...row, employee_id: person.id ?? null };
	return { ...contract, ...startsOf(contract, chain, lineage, person.cumulative_service === true) };
};
/**
 * Every read a batch of rows declares, for every rule at once (`requests[rule][row]`), in as few requests as their roots
 * allow (a root reads once per request), all sent together. Rows that differ only by `eq` values gather into one `in`,
 * and the answer is dealt back by those values; a shape that cannot gather reads once per distinct layer.
 */
const batchRead = Effect.fnUntraced(function* (
	read: Reader,
	requests: readonly (readonly JsonObject[])[],
	cache: Map<string, readonly JsonObject[]>
) {
	const needs = new Map<string, { readonly name: string; readonly layer: Layer }>();
	const need = (name: string, layer: Layer) => {
		const key = JSON.stringify({ [name]: layer });
		if (!cache.has(key)) needs.set(key, { name, layer });
		return key;
	};
	const answers = requests.map((rows) =>
		rows.map((): Record<string, readonly JsonObject[]> => ({}))
	);
	const deals: (() => void)[] = [];
	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
	const eqOf = (layer: Layer, field: string): Json | undefined => {
		const test = whereOf(layer)[field];
		return isJsonObject(test) && Object.keys(test).length === 1 ? test.eq : undefined;
	};
	for (const [rule, rows] of requests.entries()) {
		const answer = answers[rule] ?? [];
		for (const name of new Set(rows.flatMap((request) => Object.keys(request)))) {
			const layers = rows.map((request) => {
				const layer = request[name];
				return isJsonObject(layer) ? layer : {};
			});
			const first = layers[0] ?? {};
			const fields = Object.keys(whereOf(first));
			const varying = fields.filter((field) =>
				layers.some((layer) => !same(whereOf(layer)[field], whereOf(first)[field]))
			);
			const gathers =
				varying.length > 0 &&
				varying.every((field) => layers.every((layer) => eqOf(layer, field) !== undefined));
			if (!gathers) {
				const keys = layers.map((layer) => need(name, layer));
				deals.push(() => {
					for (const [index, key] of keys.entries()) {
						const own = answer[index];
						if (own !== undefined) own[name] = cache.get(key) ?? [];
					}
				});
				continue;
			}
			const where = Object.fromEntries(
				fields.map((field) => [
					field,
					varying.includes(field)
						? {
								in: [
									...new Set(
										layers.flatMap((layer) => {
											const value = eqOf(layer, field);
											return value === undefined ? [] : [value];
										})
									)
								]
							}
						: (whereOf(first)[field] ?? null)
				])
			);
			const { limit: _limit, ...rest } = first;
			const declared = Array.isArray(first.fields) ? first.fields : undefined;
			const key = need(name, {
				...rest,
				where,
				limit: 10000,
				...(declared === undefined ? {} : { fields: [...new Set([...declared, ...varying])] })
			});
			deals.push(() => {
				const byValues = Map.groupBy(cache.get(key) ?? [], (row) =>
					JSON.stringify(varying.map((field) => row[field]))
				);
				for (const [index, layer] of layers.entries()) {
					const own = answer[index];
					if (own === undefined) continue;
					const found =
						byValues.get(JSON.stringify(varying.map((field) => eqOf(layer, field)))) ?? [];
					own[name] = typeof layer.limit === 'number' ? found.slice(0, layer.limit) : found;
				}
			});
		}
	}
	// a root reads once per request: as many requests as the most-read root needs, sent together
	const packs: { request: Record<string, Layer>; keys: Record<string, string> }[] = [];
	for (const [key, { name, layer }] of needs) {
		let pack = packs.find((candidate) => !(name in candidate.request));
		if (pack === undefined) packs.push((pack = { request: {}, keys: {} }));
		Object.assign(
			pack.request,
			name === 'employee_contract' ? withStints(layer) : { [name]: layer }
		);
		pack.keys[name] = key;
	}
	const found = yield* Effect.forEach(
		packs,
		({ request }) => queryRows(read, Schema.decodeUnknownSync(ReadRequestJson)(request)),
		{ concurrency: 'unbounded' }
	);
	for (const [index, rows] of found.entries())
		for (const [name, key] of Object.entries(packs[index]?.keys ?? {}))
			cache.set(
				key,
				name === 'employee_contract' ? (rows[name] ?? []).map(serviced) : (rows[name] ?? [])
			);
	for (const deal of deals) deal();
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

/** Where a written row stands in the law: a company and a day. */
type Place = { readonly entity: string; readonly on: string };
/**
 * Where each written row stands, whatever its model. A dated record stands at its company on its own day. A record with
 * no day of its own stands where its contract starts, else where each of its person's contracts starts, else where each
 * of its company's changes starts. One read, and only for what the rows do not carry.
 */
const placesOf = Effect.fnUntraced(function* (
	read: Reader,
	collection: string,
	operation: Operation,
	rows: readonly JsonObject[]
) {
	const dated = OWN_DAY[collection] !== undefined || collection === 'payslip';
	const entityOf = (row: JsonObject) => refId(collection === 'entity' ? row.id : row.entity_id);
	const personOf = (row: JsonObject) =>
		refId(collection === 'employee_profile' ? row.id : row.employee_id);
	const contractOf = (row: JsonObject) => refId(row.employment_id);
	// a contract answers to the law of its first day; its exit, to the law of its last
	const ownDay = (row: JsonObject) =>
		operation === 'exit' && collection === 'employee_contract'
			? (rangeObject(row.effective_range)?.to ?? startOf(row))
			: OWN_DAY[collection]?.(row);
	const contracts = idsIn(
		rows.filter((row) => !dated || entityOf(row) === undefined).map(contractOf)
	);
	const people = dated
		? []
		: idsIn(rows.filter((row) => contractOf(row) === undefined).map(personOf));
	const companies = dated
		? []
		: idsIn(
				rows
					.filter((row) => contractOf(row) === undefined && personOf(row) === undefined)
					.map(entityOf)
			);
	const leaves =
		collection === 'leave_catalog_entry'
			? idsIn(rows.filter((row) => ownDay(row) === undefined).map((row) => refId(row.id)))
			: [];
	const runs = collection === 'payslip' ? idsIn(rows.map((row) => refId(row.payroll_run_id))) : [];
	const byId = contracts.length === 0 ? undefined : { id: { in: [...contracts] } };
	const byPerson = people.length === 0 ? undefined : { employee_id: { in: [...people] } };
	const linked =
		byId === undefined ? byPerson : byPerson === undefined ? byId : { or: [byId, byPerson] };
	const request = {
		...(linked === undefined
			? {}
			: {
					employee_contract: {
						where: linked,
						fields: ['id', 'employee_id', 'entity_id', 'effective_range'],
						limit: 10000
					}
				}),
		...(companies.length === 0
			? {}
			: {
					entity_change: {
						where: { entity_id: { in: [...companies] } },
						fields: ['entity_id', 'effective_from'],
						limit: 10000
					}
				}),
		...(leaves.length === 0
			? {}
			: {
					leave_catalog_entry_day: {
						where: { leave_entry_id: { in: [...leaves] } },
						fields: ['leave_entry_id', 'incurred_on'],
						limit: 10000
					}
				}),
		...(runs.length === 0
			? {}
			: {
					payroll_run: {
						where: { id: { in: [...runs] } },
						fields: ['id', 'entity_id', 'pay_date'],
						limit: 10000
					}
				})
	};
	const found: Record<string, readonly JsonObject[]> =
		Object.keys(request).length === 0 ? {} : yield* queryRows(read, request);
	const contract = new Map((found.employee_contract ?? []).map((row) => [String(row.id), row]));
	const stints = Map.groupBy(found.employee_contract ?? [], (row) => refId(row.employee_id));
	const changes = Map.groupBy(found.entity_change ?? [], (row) => refId(row.entity_id));
	const slots = Map.groupBy(found.leave_catalog_entry_day ?? [], (row) =>
		refId(row.leave_entry_id)
	);
	const run = new Map((found.payroll_run ?? []).map((row) => [String(row.id), row]));
	const at = (entity: unknown, on: unknown): readonly Place[] => {
		const company = refId(entity);
		return company !== undefined && typeof on === 'string' ? [{ entity: company, on }] : [];
	};
	return rows.map((row): readonly Place[] => {
		const held = contract.get(String(contractOf(row)));
		if (collection === 'payslip') {
			const paid = run.get(String(refId(row.payroll_run_id)));
			return at(row.entity_id ?? paid?.entity_id, paid?.pay_date);
		}
		if (dated)
			return at(
				entityOf(row) ?? held?.entity_id,
				ownDay(row) ?? firstSlot({ days: slots.get(refId(row.id)) ?? [] })
			);
		if (contractOf(row) !== undefined)
			return held === undefined ? [] : at(held.entity_id, startOf(held));
		const person = personOf(row);
		return person !== undefined
			? (stints.get(person) ?? []).flatMap((stint) => at(stint.entity_id, startOf(stint)))
			: (changes.get(entityOf(row)) ?? []).flatMap((change) =>
					at(change.entity_id, change.effective_from)
				);
	});
});

/** A law and the rows of a batch that stand under it, by their place in the batch. */
type UnderLaw = { readonly law: Law; readonly at: number[] };
/**
 * The laws a batch of written rows answers to, each with the rows under it, and the rows' subjects primed into the
 * cache: one read. A law is its company's jurisdiction as it stands on the row's day; rows on either side of a change
 * in the law stand under different laws.
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
	const places = yield* placesOf(read, collection, operation, rows);
	const companies = idsIn(places.flatMap((own) => own.map(({ entity }) => entity)));
	if (companies.length === 0) return [...groups.values()];
	const subject = subjectLayers(rows, cache);
	const first = yield* queryRows(read, {
		entity: {
			where: { id: { in: [...new Set([...companies, ...subject.entities])] } },
			fields: [...SUBJECT_ENTITY],
			limit: 10000
		},
		...(yield* lawReadOf(read, { id: { in: [...companies] } })),
		...subject.layers
	});
	primeFrom(first, subject.entities, cache);
	const laws = lawsOf(first);
	const code = new Map((first.entity ?? []).map((row) => [String(row.id), row.settings_code]));
	for (const [index, own] of places.entries())
		for (const { entity, on } of own) {
			const law = laws(code.get(entity), on);
			if (law === undefined) continue;
			const group: UnderLaw = groups.get(law.rows) ?? { law, at: [] };
			if (!group.at.includes(index)) group.at.push(index);
			groups.set(law.rows, group);
		}
	return [...groups.values()];
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

/**
 * Every rule the law in force registers for this collection and operation validates the proposed rows, for the whole
 * batch in two reads: the law, its lookups and the rows' subjects together, then every rule's declared reads together.
 */
export const validateRegistered = Effect.fn('payroll.validateRegistered')(function* (
	read: Reader,
	collection: string,
	operation: Operation,
	rows: readonly JsonObject[]
) {
	if (rows.length === 0) return;
	const cache: SubjectCache = { contracts: new Map(), employers: new Map(), employees: new Map() };
	const applied = (yield* lawsFor(read, collection, operation, rows, cache)).flatMap(
		({ law, at }) =>
			registered(law.rows.registered_rule, 'target_collection', collection, operation)
				.toSorted((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
				.map((rule) => ({ rule, law, at }))
	);
	if (applied.length === 0) return;
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
	const subjects: Record<string, unknown>[] = [];
	for (const row of rows) subjects.push(yield* subjectValue(read, collection, row, cache, needs));
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
		readCache
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
				before: row,
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
	// every refused row, each named by its person and day, so a batch is fixed in one pass
	if (refused.size > 0)
		return yield* new Refusal({
			message: [...refused]
				.toSorted(([left], [right]) => left - right)
				.map(([index, code]) => {
					const key = [
						pathValue(subjects[index], 'employment.employee_number'),
						rows[index]?.work_date
					]
						.filter((part) => typeof part === 'string' && part !== '')
						.join(' ');
					return `${key === '' ? '' : `${key}: `}${code}: the row is refused by its registered rule.`;
				})
				.join('\n')
		});
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
	const cache: SubjectCache = { contracts: new Map(), employers: new Map(), employees: new Map() };
	// each row with the catalogue row its code names in its law, where that row has an eligibility rule
	const gated = (yield* lawsFor(read, collection, 'create', rows, cache)).flatMap(({ law, at }) =>
		at.flatMap((index) => {
			const row = rows[index];
			const item = law.rows[catalog].find((held) => held.code === row?.catalog_code);
			return row !== undefined &&
				item !== undefined &&
				typeof item.eligibility === 'string' &&
				item.eligibility.trim() !== ''
				? [{ row, item, law }]
				: [];
		})
	);
	const roots = programOf(catalog)?.roots;
	const refused: string[] = [];
	for (const { row, item, law } of gated) {
		const code = String(item.code ?? '');
		const subject = yield* subjectValue(read, collection, row, cache);
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
	const cache: SubjectCache = { contracts: new Map(), employers: new Map(), employees: new Map() };
	// the effects the law in force registers, its lookups and the subjects of the rows: one read
	const applied = (yield* lawsFor(ctx.query, collection, operation, entries, cache)).flatMap(
		({ law, at }) =>
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
	const subjects: { employment: JsonObject; employer: JsonObject; employee: JsonObject }[] = [];
	for (const entry of entries)
		subjects.push(yield* subjectValue(ctx.query, collection, entry, cache, needs));
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
		new Map()
	);
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
		if (input.length === 0) continue;
		// A task is raised once, whatever fires its effect again (a retried run, a host that replays): one with its key
		// already on file, or twice in this batch, is left out.
		const keyed = target === 'obligation' && action === 'create';
		const keys = keyed
			? input.flatMap((row) => (typeof row.occurrence_key === 'string' ? [row.occurrence_key] : []))
			: [];
		const onFile = new Set(
			keys.length === 0
				? []
				: (
						(yield* queryRows(ctx.query, {
							obligation: {
								where: { occurrence_key: { in: [...new Set(keys)] } },
								fields: ['occurrence_key'],
								limit: 10000
							}
						})).obligation ?? []
					).map((row) => String(row.occurrence_key))
		);
		const fresh = !keyed
			? input
			: input.filter((row) => {
					if (typeof row.occurrence_key !== 'string') return true;
					if (onFile.has(row.occurrence_key)) return false;
					onFile.add(row.occurrence_key);
					return true;
				});
		if (fresh.length > 0) yield* ctx.act({ [`${target}.${action}`]: fresh });
	}
});

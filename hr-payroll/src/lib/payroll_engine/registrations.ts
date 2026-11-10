import { Effect, Schema } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import { evaluate } from './expressions.js';
import { Refusal, isJsonObject, jsonObject, type Json } from './foundation.js';
import { JsonObject, settingsConstants } from './contracts.js';
import { queryRows, type Reader } from './reads.js';
import { chainOf, startsOf, versionOn } from './contract_change.js';
import { ReadRequestSchema } from '@norbital-ai/bolt/protocol';

export type Operation = 'create' | 'update' | 'delete' | 'seal' | 'exit';
const CATALOG_OF: Readonly<Record<string, string>> = {
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
		to: match[2] ? addDays(match[2], -1) : null
	};
};

const refId = (value: unknown): string | undefined =>
	typeof value === 'string'
		? value
		: isJsonObject(value) && typeof value.id === 'string'
			? value.id
			: undefined;

/**
 * The law each asker answers to: the sealed version of its entity's lineage (`settings_code`) in force on its day, all
 * from one read. Nothing stores a contract's version.
 */
export const lawOn = Effect.fn('payroll.lawOn')(function* (
	read: Reader,
	asked: readonly { readonly entity: unknown; readonly on: unknown }[]
) {
	const entities = [...new Set(asked.flatMap(({ entity }) => refId(entity) ?? []))];
	if (entities.length === 0) return asked.map((): JsonObject | undefined => undefined);
	const { entity = [], jurisdiction_settings: versions = [] } = yield* queryRows(read, {
		entity: { where: { id: { in: entities } }, fields: ['id', 'settings_code'], limit: 10000 },
		jurisdiction_settings: {
			where: { status: { eq: 'SEALED' } },
			fields: ['id', 'code', 'effective_range'],
			limit: 10000
		}
	});
	const code = new Map(entity.map((row) => [String(row.id), row.settings_code]));
	return asked.map(({ entity, on }) =>
		versionOn(versions, code.get(String(refId(entity))), String(on))
	);
});
/** A contract's first day, from a written row or its stored half-open range. */
export const startOf = (row: JsonObject): unknown => rangeObject(row.effective_range)?.from;

const dateText = (value: unknown): string | null =>
	typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

const monthStart = (value: unknown): string | null => {
	const date = dateText(value);
	return date === null ? null : `${date.slice(0, 7)}-01`;
};
const monthEnd = (value: unknown): string | null => {
	const date = dateText(value);
	if (date === null) return null;
	const at = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
	at.setUTCMonth(at.getUTCMonth() + 1);
	at.setUTCDate(0);
	return at.toISOString().slice(0, 10);
};
const addDays = (value: unknown, days: unknown): string | null => {
	const date = dateText(value);
	const count = Number(days);
	if (date === null || !Number.isFinite(count)) return null;
	const at = new Date(`${date}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + count);
	return at.toISOString().slice(0, 10);
};
const addMonths = (value: unknown, months: unknown): string | null => {
	const date = dateText(value);
	const count = Number(months);
	if (date === null || !Number.isFinite(count)) return null;
	const at = new Date(`${date}T00:00:00Z`);
	at.setUTCMonth(at.getUTCMonth() + count);
	return at.toISOString().slice(0, 10);
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
		switch (call[1]) {
			case 'month_start':
				return monthStart(first);
			case 'month_end':
				return monthEnd(first);
			case 'add_days':
				return addDays(first, second);
			case 'add_months':
				return addMonths(first, second);
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
const SUBJECT_EMPLOYER = [
	'id',
	'entity_id',
	'effective_range',
	'time_zone',
	'entity_extension_data'
] as const;
const SUBJECT_PAY_GROUP = ['entity_id', 'name', 'payment_schedule'] as const;
const latestVersion = (rows: readonly JsonObject[]): JsonObject | undefined => {
	const start = (row: JsonObject): string =>
		isJsonObject(row.effective_range) && typeof row.effective_range.from === 'string'
			? row.effective_range.from
			: '';
	return rows.toSorted((a, b) => start(a).localeCompare(start(b))).at(-1);
};
type SubjectCache = {
	contracts: Map<string, JsonObject>;
	employers: Map<string, JsonObject>;
	employees: Map<string, JsonObject>;
};
const idsIn = (values: readonly (string | undefined)[]): readonly string[] => [
	...new Set(values.flatMap((value) => (value === undefined ? [] : [value])))
];
/**
 * The subjects of a batch, as one request's layers: its contracts, the sealed versions of the employers its rows name
 * and the contracts' people. `primeFrom` fills the cache from the answer, and `subjectValue` then
 * answers every row from it.
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
	const employer = entities.length === 0 ? undefined : { entity_id: { in: [...entities] } };
	const direct = employees.length === 0 ? undefined : { id: { in: [...employees] } };
	const employee =
		contracts.length === 0 ? direct : direct === undefined ? through : { or: [direct, through] };
	return {
		...(contracts.length === 0
			? {}
			: {
					employee_contract: {
						where: { id: { in: [...contracts] } },
						fields: [...SUBJECT_CONTRACT],
						limit: 10000
					}
				}),
		...(employer === undefined
			? {}
			: {
					entity_profile_version: {
						where: { ...employer, status: { eq: 'SEALED' } },
						fields: [...SUBJECT_EMPLOYER],
						limit: 10000
					},
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
};
// ponytail: a rule reads one schedule for the employer, its first pay group by name. A company with several groups
// needs the subject's own group here if a rule ever depends on which.
const withEntity = (version: JsonObject, groups: readonly JsonObject[]): JsonObject => {
	const [first] = groups.toSorted((a, b) => String(a['name']).localeCompare(String(b['name'])));
	const schedule = first?.['payment_schedule'];
	return schedule === undefined ? version : { ...version, payment_schedule: schedule };
};
const primeFrom = (found: Record<string, readonly JsonObject[]>, cache: SubjectCache) => {
	for (const row of found.employee_contract ?? []) cache.contracts.set(String(row.id), row);
	const groups = Map.groupBy(found.pay_group ?? [], (row) => String(refId(row.entity_id)));
	for (const [id, versions] of Map.groupBy(found.entity_profile_version ?? [], (row) =>
		String(refId(row.entity_id))
	)) {
		const version = latestVersion(versions);
		if (version !== undefined) cache.employers.set(id, withEntity(version, groups.get(id) ?? []));
	}
	for (const row of found.employee_profile ?? []) cache.employees.set(String(row.id), row);
};

const subjectValue = Effect.fnUntraced(function* (
	read: Reader,
	collection: string,
	row: JsonObject,
	cache: {
		contracts: Map<string, JsonObject>;
		employers: Map<string, JsonObject>;
		employees: Map<string, JsonObject>;
	},
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
		employer = cache.employers.get(employerId);
		if (employer === undefined) {
			const found = yield* queryRows(read, {
				entity_profile_version: {
					where: { entity_id: { eq: employerId }, status: { eq: 'SEALED' } },
					fields: [...SUBJECT_EMPLOYER],
					limit: 100
				},
				pay_group: {
					where: { entity_id: { eq: employerId } },
					fields: [...SUBJECT_PAY_GROUP],
					limit: 100
				}
			});
			const version = latestVersion(found.entity_profile_version ?? []);
			employer = version === undefined ? undefined : withEntity(version, found.pay_group ?? []);
			if (employer !== undefined) cache.employers.set(employerId, employer);
		}
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
				employee_contract: Array.isArray(layer.fields)
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
					: layer,
				'employee_contract.employee_id': { fields: ['id', 'cumulative_service'] },
				'employee_contract.employee_id.employee_contract': {
					where: { status: { eq: 'SEALED' } },
					fields: STINT
				},
				'employee_contract.employee_id.employee_contract.entity_id': {
					fields: ['settings_code']
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
		({ request }) => queryRows(read, Schema.decodeUnknownSync(ReadRequestSchema)(request)),
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

/** A rule or effect that reads a lookup key it does not hold reads the jurisdiction's. */
const usesGlobalLookup = (row: JsonObject): boolean => {
	const own = isJsonObject(row.lookup) ? row.lookup : {};
	const source = `${String(row.condition ?? '')}\n${String(row.validate ?? row.effects ?? '')}`;
	return [...source.matchAll(/ctx\.lookup\.(\w+)|get\(ctx\.lookup, '(\w+)'/g)].some(
		(match) => !(String(match[1] ?? match[2]) in own)
	);
};

/**
 * Every sealed rule registered for this collection and operation validates the proposed rows, for the whole batch in
 * two reads: the rules the law registers, its lookups and the rows' subjects together, then every rule's declared reads
 * together.
 */
export const validateRegistered = Effect.fn('payroll.validateRegistered')(function* (
	read: Reader,
	collection: string,
	operation: Operation,
	rows: readonly JsonObject[]
) {
	if (rows.length === 0) return;
	const cache: SubjectCache = {
		contracts: new Map<string, JsonObject>(),
		employers: new Map<string, JsonObject>(),
		employees: new Map<string, JsonObject>()
	};
	const settings = new Set<string>();
	for (const row of rows) {
		const id = refId(row.settings_id ?? row.input_schema_version_id);
		if (id !== undefined) settings.add(id);
	}
	// a contract answers to the law in force on its first day
	if (collection === 'employee_contract')
		for (const version of yield* lawOn(
			read,
			rows.map((row) => ({ entity: row.entity_id, on: startOf(row) }))
		))
			if (version !== undefined) settings.add(String(version.id));
	// the law a write answers to: named on its rows, or reached through what they name
	let law: JsonObject | undefined;
	if (settings.size === 0 && collection === 'payslip') {
		const runIds = [
			...new Set(
				rows.flatMap((row) => (typeof row.payroll_run_id === 'string' ? [row.payroll_run_id] : []))
			)
		];
		if (runIds.length > 0) {
			const found = yield* queryRows(read, {
				payroll_run: {
					where: { id: { in: runIds } },
					fields: ['id', 'settings_id'],
					limit: 10000
				}
			});
			for (const row of found.payroll_run ?? [])
				if (typeof row.settings_id === 'string') settings.add(row.settings_id);
		}
	}
	if (settings.size === 0) {
		const catalog = CATALOG_OF[collection];
		if (catalog !== undefined) {
			const ids = [
				...new Set(
					rows.flatMap((row) => (typeof row.catalog_id === 'string' ? [row.catalog_id] : []))
				)
			];
			if (ids.length === 0) return;
			law = { [catalog]: { some: { id: { in: ids } } } };
		} else if (collection === 'roster' || collection === 'roster_entry') {
			const ids = [
				...new Set(
					rows.flatMap((row) => (typeof row.employment_id === 'string' ? [row.employment_id] : []))
				)
			];
			if (ids.length === 0) return;
			const found = yield* queryRows(read, {
				employee_contract: {
					where: { id: { in: ids } },
					fields: [...SUBJECT_CONTRACT],
					limit: 10000
				}
			});
			const contracts = new Map(
				(found.employee_contract ?? []).map((row) => [String(row.id), row])
			);
			for (const row of contracts.values()) cache.contracts.set(String(row.id), row);
			// a day sheet answers to the law in force on its work date
			for (const version of yield* lawOn(
				read,
				rows.map((row) => ({
					entity: contracts.get(String(row.employment_id))?.entity_id,
					on: row.work_date
				}))
			))
				if (version !== undefined) settings.add(String(version.id));
		}
	}
	law ??= settings.size === 0 ? undefined : { id: { in: [...settings] } };
	if (law === undefined) return;
	const first = yield* queryRows(read, {
		registered_rule: {
			where: {
				target_collection: { eq: collection },
				events: { has: operation },
				settings_id: { is: law }
			},
			limit: 10000
		},
		jurisdiction_settings: {
			where: law,
			fields: ['id', 'lookup', 'conversions', 'ledger'],
			limit: 10000
		},
		...subjectLayers(rows, cache)
	});
	const rules = (first.registered_rule ?? []).toSorted(
		(left, right) => Number(left.order ?? 0) - Number(right.order ?? 0)
	);
	if (rules.length === 0) return;
	primeFrom(first, cache);
	const globals = new Map(
		(first.jurisdiction_settings ?? []).map((row) => [String(row.id), settingsConstants(row)])
	);
	const source = rules
		.map(
			(rule) =>
				`${JSON.stringify(rule.reads ?? {})}\n${rule.condition ?? ''}\n${rule.validate ?? ''}`
		)
		.join('\n');
	const needs = {
		employer: source.includes('ctx.subject.employer'),
		employee: source.includes('ctx.subject.employee')
	};
	const subjects: Record<string, unknown>[] = [];
	for (const row of rows) subjects.push(yield* subjectValue(read, collection, row, cache, needs));
	const readCache = new Map<string, readonly JsonObject[]>();
	const reads = yield* batchRead(
		read,
		rules.map((rule) => {
			const declared = isJsonObject(rule.reads) ? rule.reads : {};
			return rows.map((row, index) =>
				jsonObject(resolveRead(declared, { entry: row, subject: subjects[index] }))
			);
		}),
		readCache
	);
	// a row stops at its first refusing rule, in rule order; the other rows go on
	const refused = new Map<number, string>();
	for (const [at, rule] of rules.entries()) {
		const code = String(rule.code ?? '');
		for (const [index, row] of rows.entries()) {
			if (refused.has(index)) continue;
			const context = {
				entry: row,
				before: row,
				event: { operation, collection },
				subject: subjects[index] ?? {},
				reads: reads[at]?.[index] ?? {},
				lookup: {
					...(usesGlobalLookup(rule) ? globals.get(String(rule.settings_id)) : {}),
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
		throw new Refusal({
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

const CATALOG_ENTRY = /^(.*_catalog)_entry$/;
/**
 * The versions of the law a write answers to, whatever its model: its own, the catalog row it was raised on, its
 * contract, the person's contracts, or its employer's sealed version. Every model dispatches through this one path.
 */
const versionsOf = Effect.fn('payroll.versionsOf')(function* (
	read: Reader,
	collection: string,
	rows: readonly JsonObject[],
	operation: Operation
) {
	const ids = (field: string) => [
		...new Set(
			rows.flatMap((row) =>
				typeof refId(row[field]) === 'string' ? [String(refId(row[field]))] : []
			)
		)
	];
	const direct = [...ids('settings_id'), ...ids('input_schema_version_id')];
	if (direct.length > 0) return new Set(direct);
	const catalog = CATALOG_ENTRY.exec(collection)?.[1];
	if (catalog !== undefined && ids('catalog_id').length > 0) {
		const found = yield* queryRows(read, {
			[catalog]: { where: { id: { in: ids('catalog_id') } }, fields: ['settings_id'], limit: 10000 }
		});
		return new Set((found[catalog] ?? []).map((row) => String(row.settings_id)));
	}
	const employees = collection === 'employee_profile' ? ids('id') : ids('employee_id');
	const contract =
		ids('employment_id').length > 0
			? { id: { in: ids('employment_id') } }
			: employees.length > 0
				? { employee_id: { in: employees } }
				: null;
	const contracts =
		collection === 'employee_contract'
			? rows
			: contract === null
				? null
				: ((yield* queryRows(read, {
						employee_contract: {
							where: contract,
							fields: ['entity_id', 'effective_range'],
							limit: 10000
						}
					})).employee_contract ?? []);
	if (contracts !== null) {
		// a contract answers to the law of its first day; its exit, to the law of its last
		const law = yield* lawOn(
			read,
			contracts.map((row) => ({
				entity: row.entity_id,
				on:
					operation === 'exit' && collection === 'employee_contract'
						? (rangeObject(row.effective_range)?.to ?? startOf(row))
						: startOf(row)
			}))
		);
		return new Set(law.flatMap((version) => (version === undefined ? [] : [String(version.id)])));
	}
	const entities = collection === 'entity' ? ids('id') : ids('entity_id');
	if (entities.length === 0) return new Set<string>();
	const { entity_profile_version: found = [] } = yield* queryRows(read, {
		entity_profile_version: {
			where: { entity_id: { in: entities }, status: { eq: 'SEALED' } },
			fields: ['input_schema_version_id'],
			limit: 10000
		}
	});
	return new Set(found.map((row) => String(row.input_schema_version_id)));
});

/**
 * A registered effect runs after the commit: its expression returns the records its declared
 * target action writes. Models call it through `tap`.
 */
export const applyRegisteredEffects = Effect.fn('payroll.applyRegisteredEffects')(function* (
	ctx: EffectCtx,
	operation: Operation,
	collection: string,
	changes: readonly { readonly before?: object; readonly after?: object }[]
) {
	const rows = changes.map((change) =>
		jsonObject({
			...(isJsonObject(change.before) ? change.before : {}),
			...(isJsonObject(change.after) ? change.after : {})
		})
	);
	const settings = yield* versionsOf(ctx.query, collection, rows, operation);
	if (settings.size === 0) return;
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
	const cache = {
		contracts: new Map<string, JsonObject>(),
		employers: new Map<string, JsonObject>(),
		employees: new Map<string, JsonObject>()
	};
	// the effects the law registers, its lookups and the subjects of the rows: one read
	const first = yield* queryRows(ctx.query, {
		registered_effect: {
			where: {
				source_collection: { eq: collection },
				events: { has: operation },
				settings_id: { in: [...settings] }
			},
			limit: 10000
		},
		jurisdiction_settings: {
			where: { id: { in: [...settings] } },
			fields: ['id', 'lookup', 'conversions', 'ledger'],
			limit: 10000
		},
		...subjectLayers(entries, cache)
	});
	const effects = first.registered_effect ?? [];
	if (effects.length === 0) return;
	primeFrom(first, cache);
	const lookups = new Map(
		(first.jurisdiction_settings ?? []).map((row) => [String(row.id), settingsConstants(row)])
	);
	const globals = new Map(
		effects
			.filter(usesGlobalLookup)
			.map((effect) => [String(effect.settings_id), lookups.get(String(effect.settings_id)) ?? {}])
	);
	const source = effects
		.map(
			(row) => `${JSON.stringify(row.reads ?? {})}\n${row.condition ?? ''}\n${row.effects ?? ''}`
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
	const allReads = yield* batchRead(
		ctx.query,
		effects.map((effect) => {
			const declared = isJsonObject(effect.reads) ? effect.reads : {};
			return entries.map((entry, index) =>
				jsonObject(resolveRead(declared, { entry, subject: subjects[index] }))
			);
		}),
		new Map()
	);
	for (const [at, effect] of effects.entries()) {
		const code = String(effect.code ?? '');
		const action = effect.target_action;
		const target = effect.target_collection;
		if (action !== 'create' && action !== 'update' && action !== 'delete') continue;
		if (typeof target !== 'string' || target === '') continue;
		const reads = allReads[at] ?? [];
		const lookup = {
			...globals.get(String(effect.settings_id)),
			...(isJsonObject(effect.lookup) ? effect.lookup : {})
		};
		const condition = effect.condition;
		const body = effect.effects;
		if (typeof body !== 'string' || body.trim() === '')
			throw new Refusal({ message: `${code}: a registered effect needs its expression.` });
		const input: JsonObject[] = [];
		for (const [index, entry] of entries.entries()) {
			const change = changes[index];
			const context = {
				entry,
				before: change?.before ?? null,
				after: change?.after ?? null,
				event: { operation, collection },
				subject: subjects[index],
				reads: reads[index] ?? {},
				lookup
			};
			if (typeof condition === 'string' && condition.trim() !== '') {
				if (!truth(evaluate(condition, 'CALCULATION', context, `${code}.condition`))) continue;
			}
			const result = evaluate(body, 'CALCULATION', context, `${code}.effects`);
			if (Array.isArray(result))
				input.push(...Schema.decodeUnknownSync(Schema.Array(JsonObject))(result));
		}
		if (input.length > 0) yield* ctx.act.checked([{ callable: `${target}.${action}`, input }]);
	}
});

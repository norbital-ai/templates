import { Effect, Schema } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import { evaluate } from './expressions.js';
import { Refusal, isJsonObject, type Json } from './foundation.js';
import type { JsonObject } from './contracts.js';
import { queryRows, type Reader } from './reads.js';
import { ReadRequestSchema } from '@norbital-ai/bolt/protocol';

type Operation = 'create' | 'update' | 'delete';
const CATALOG_OF: Readonly<Record<string, string>> = {
	leave_catalog_entry: 'leave_catalog',
	claim_catalog_entry: 'claim_catalog',
	adhoc_catalog_entry: 'adhoc_catalog',
	loan_catalog_entry: 'loan_catalog',
	work_interruption_catalog_entry: 'work_interruption_catalog',
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

const rangeObject = (value: unknown): JsonObject | undefined => {
	if (isJsonObject(value)) return value;
	if (typeof value !== 'string') return undefined;
	const match = /^\[([^,]*),([^)]*)\)$/.exec(value);
	if (match === null) return undefined;
	return { from: match[1] || null, to: match[2] || null };
};

const refId = (value: unknown): string | undefined =>
	typeof value === 'string'
		? value
		: isJsonObject(value) && typeof value.id === 'string'
			? value.id
			: undefined;

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
					fields: [
						'id',
						'employee_id',
						'entity_id',
						'input_schema_version_id',
						'effective_range',
						'terms',
						'payroll',
						'employee_extension_data'
					],
					limit: 1
				}
			});
			employment = found.employee_contract?.[0];
			if (employment !== undefined) cache.contracts.set(employmentId, employment);
		}
	}
	const employerId = refId(employment?.entity_id) ?? refId(row.entity_id);
	let employer: JsonObject | undefined;
	if (collection === 'entity_profile_version') employer = row;
	if (needs.employer && employer === undefined && typeof employerId === 'string') {
		employer = cache.employers.get(employerId);
		if (employer === undefined) {
			const found = yield* queryRows(read, {
				entity_profile_version: {
					where: { entity_id: { eq: employerId }, status: { eq: 'SEALED' } },
					fields: [
						'id',
						'entity_id',
						'effective_range',
						'time_zone',
						'payment_schedule',
						'pay_cutoff_day',
						'entity_extension_data',
						'registrations'
					],
					limit: 100
				}
			});
			const start = (row: JsonObject): string =>
				isJsonObject(row.effective_range) && typeof row.effective_range.from === 'string'
					? row.effective_range.from
					: '';
			employer = found.entity_profile_version
				?.toSorted((a, b) => start(a).localeCompare(start(b)))
				.at(-1);
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

/** Every sealed rule registered for this collection and operation validates the proposed rows. */
export const validateRegistered = Effect.fn('payroll.validateRegistered')(function* (
	read: Reader,
	collection: string,
	operation: Operation,
	rows: readonly JsonObject[]
) {
	if (rows.length === 0) return;
	const cache = {
		contracts: new Map<string, JsonObject>(),
		employers: new Map<string, JsonObject>(),
		employees: new Map<string, JsonObject>()
	};
	const settings = new Set<string>();
	for (const row of rows) {
		const id = refId(row.settings_id ?? row.input_schema_version_id);
		if (id !== undefined) settings.add(id);
	}
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
			const found = yield* queryRows(read, {
				[catalog]: { where: { id: { in: ids } }, fields: ['id', 'settings_id'], limit: 10000 }
			});
			for (const row of found[catalog] ?? [])
				if (typeof row.settings_id === 'string') settings.add(row.settings_id);
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
					fields: [
						'id',
						'employee_id',
						'entity_id',
						'input_schema_version_id',
						'effective_range',
						'terms',
						'payroll',
						'employee_extension_data'
					],
					limit: 10000
				}
			});
			for (const row of found.employee_contract ?? []) {
				if (typeof row.input_schema_version_id === 'string')
					settings.add(row.input_schema_version_id);
				if (typeof row.id === 'string') cache.contracts.set(row.id, row);
			}
		}
	}
	if (settings.size === 0) return;
	const data = yield* queryRows(read, {
		registered_rule: {
			where: {
				target_collection: { eq: collection },
				events: { has: operation },
				settings_id: { in: [...settings] }
			},
			limit: 10000
		}
	});
	const rules = (data.registered_rule ?? []).toSorted(
		(left, right) => Number(left.order ?? 0) - Number(right.order ?? 0)
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
	const subjects = new Map<JsonObject, Record<string, unknown>>();
	for (const row of rows)
		subjects.set(row, yield* subjectValue(read, collection, row, cache, needs));
	const readCache = new Map<string, readonly JsonObject[]>();
	for (const rule of rules) {
		const code = String(rule.code ?? '');
		for (const row of rows) {
			const subject = subjects.get(row) ?? {};
			const declared = isJsonObject(rule.reads) ? rule.reads : {};
			const resolved = resolveRead(declared, { entry: row, subject });
			const request =
				isJsonObject(resolved) && Object.keys(resolved).length === 0
					? {}
					: Schema.decodeUnknownSync(ReadRequestSchema)(resolved);
			const keyOf = (name: string, layer: unknown): string => JSON.stringify({ [name]: layer });
			const reads: Record<string, readonly JsonObject[]> = {};
			const missing: Record<string, unknown> = {};
			for (const [name, layer] of Object.entries(request)) {
				const cached = readCache.get(keyOf(name, layer));
				if (cached === undefined) missing[name] = layer;
				else reads[name] = cached;
			}
			if (Object.keys(missing).length > 0) {
				const fetched = yield* queryRows(
					read,
					Schema.decodeUnknownSync(ReadRequestSchema)(missing)
				);
				for (const [name, rows] of Object.entries(fetched)) {
					reads[name] = rows;
					readCache.set(keyOf(name, missing[name]), rows);
				}
			}
			const context = {
				entry: row,
				before: row,
				event: { operation, collection },
				subject,
				reads,
				lookup: isJsonObject(rule.lookup) ? rule.lookup : {}
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
			if (!truth(answer))
				throw new Refusal({ message: `${code}: the row is refused by its registered rule.` });
		}
	}
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
	const settings = new Set<string>();
	for (const change of changes) {
		const row = {
			...(isJsonObject(change.before) ? change.before : {}),
			...(isJsonObject(change.after) ? change.after : {})
		} as JsonObject;
		const id = refId(row.settings_id ?? row.input_schema_version_id);
		if (id !== undefined) settings.add(id);
	}
	if (settings.size === 0) return;
	const data = yield* queryRows(ctx.query, {
		registered_effect: {
			where: {
				source_collection: { eq: collection },
				events: { has: operation },
				settings_id: { in: [...settings] }
			},
			limit: 10000
		}
	});
	const effectCache = {
		contracts: new Map<string, JsonObject>(),
		employers: new Map<string, JsonObject>(),
		employees: new Map<string, JsonObject>()
	};
	for (const effect of data.registered_effect ?? []) {
		const code = String(effect.code ?? '');
		const action = effect.target_action;
		if (action !== 'create' && action !== 'update' && action !== 'delete') continue;
		const target = effect.target_collection;
		if (typeof target !== 'string' || target === '') continue;
		for (const change of changes) {
			const rawEntry: JsonObject = {
				...(isJsonObject(change.before) ? change.before : {}),
				...(isJsonObject(change.after) ? change.after : {})
			};
			const normalized: Record<string, Json> = {};
			for (const [key, value] of Object.entries(rawEntry)) {
				const range = rangeObject(value);
				normalized[key] = range ?? value;
			}
			const entry: JsonObject = normalized;
			const subject = yield* subjectValue(ctx.query, collection, entry, effectCache);
			const declared = isJsonObject(effect.reads) ? effect.reads : {};
			const resolved = resolveRead(declared, { entry, subject });
			const request =
				isJsonObject(resolved) && Object.keys(resolved).length === 0
					? {}
					: Schema.decodeUnknownSync(ReadRequestSchema)(resolved);
			const reads = Object.keys(request).length === 0 ? {} : yield* queryRows(ctx.query, request);
			const context = {
				entry,
				before: change.before ?? null,
				after: change.after ?? null,
				event: { operation, collection },
				subject,
				reads,
				lookup: isJsonObject(effect.lookup) ? effect.lookup : {}
			};
			const condition = effect.condition;
			if (typeof condition === 'string' && condition.trim() !== '') {
				const gate = evaluate(condition, 'CALCULATION', context, `${code}.condition`);
				if (!truth(gate)) continue;
			}
			const source = effect.effects;
			if (typeof source !== 'string' || source.trim() === '')
				throw new Refusal({ message: `${code}: a registered effect needs its expression.` });
			const result = evaluate(source, 'CALCULATION', context, `${code}.effects`);
			if (!Array.isArray(result) || result.length === 0) continue;
			yield* ctx.act.checked([{ callable: `${target}.${action}`, input: result }]);
		}
	}
});

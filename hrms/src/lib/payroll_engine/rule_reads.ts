import { Effect } from 'effect';
import { isJsonObject, Refusal, type Json, type JsonObject } from './foundation.js';
import { idsOf, queryRows, type Reader } from './reads.js';

/**
 * The reads a law's registered rules and effects may declare. A rule states its reads as data (`reads`, a layer per
 * model), so the models and the keys a read may be found by are fixed here: each model's `KEYS` are the paths of its
 * `where` an `eq` or `in` may key it by. A read with none of them has no key and is refused, when the law is written
 * and when it is read. Every declared read of a batch is one typed request: each model once, by the keys its rules
 * named, and each rule's own `where` then picks its rows from the answer.
 */
const KEYS = {
	contract_terms: ['employment_id', 'employment_id.is.employee_id'],
	employee_balance: ['id', 'employee_id', 'employee_id.is.employment.some.entity_id'],
	entity: ['id'],
	entity_change: ['entity_id'],
	holiday: ['entity_id'],
	leave_catalog_entry: ['id', 'employment_id', 'employment_id.is.employee_id', 'entity_id'],
	leave_catalog_entry_day: [
		'leave_entry_id',
		'leave_entry_id.is.employment_id',
		'leave_entry_id.is.employment_id.is.employee_id'
	],
	obligation: ['occurrence_key', 'employment_id', 'entity_id', 'employee_id'],
	payroll_run: ['id'],
	payslip: ['payroll_run_id', 'employment_id', 'employee_id', 'payroll_run_id.is.entity_id'],
	roster_entry: ['employment_id', 'employment_id.is.employee_id'],
	shift_definition: ['id', 'entity_id'],
	workplace_case_catalog_entry: ['employment_id', 'entity_id']
} as const;
type Model = keyof typeof KEYS;
const isModel = (name: string): name is Model => Object.hasOwn(KEYS, name);

/** The ref fields a typed read answers as their row, for a `where` that reaches through them. */
const THROUGH: Partial<Record<Model, readonly string[]>> = {
	contract_terms: ['employment_id'],
	employee_balance: ['employee_id'],
	leave_catalog_entry: ['employment_id'],
	leave_catalog_entry_day: ['leave_entry_id'],
	payslip: ['payroll_run_id'],
	roster_entry: ['employment_id']
};

const whereOf = (layer: JsonObject): JsonObject => (isJsonObject(layer.where) ? layer.where : {});
/** The test a `where` holds at a dotted path (`employment_id.is.employee_id`), if it holds one. */
const testAt = (where: JsonObject, path: string): JsonObject | undefined => {
	let at: Json | undefined = where;
	for (const key of path.split('.')) at = isJsonObject(at) ? at[key] : undefined;
	return isJsonObject(at) ? at : undefined;
};
/** The key a declared read is found by: its model's first key path the `where` tests with `eq` or `in`. */
export const keyOf = (
	model: string,
	layer: JsonObject
): { readonly path: string; readonly values: readonly Json[] } | undefined => {
	if (!isModel(model)) return undefined;
	const where = whereOf(layer);
	for (const path of KEYS[model]) {
		const test = testAt(where, path);
		if (test === undefined) continue;
		if (test.eq !== undefined) return { path, values: [test.eq] };
		if (Array.isArray(test.in)) return { path, values: test.in };
		// a hole not yet filled (`{ var: … }`) still names the key
		if (isJsonObject(test.in)) return { path, values: [] };
	}
	return undefined;
};
/** Why a law may not declare this read, if it may not. */
export const unreadable = (model: string, layer: JsonObject): string | undefined =>
	!isModel(model)
		? `${model}: a registered read may not read this model.`
		: keyOf(model, layer) === undefined
			? `${model}: a registered read needs a key: one of ${KEYS[model].join(', ')} by eq or in.`
			: undefined;

const TESTS = new Set(['eq', 'ne', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'is_null', 'like']);
const idOrValue = (value: Json | undefined): Json | undefined =>
	isJsonObject(value) && value.id !== undefined ? value.id : value;
const tested = (value: Json | undefined, test: JsonObject): boolean =>
	Object.entries(test).every(([op, wanted]) => {
		const held = idOrValue(value) ?? null;
		switch (op) {
			case 'eq':
				return held === wanted;
			case 'ne':
				return held !== wanted;
			case 'in':
				return Array.isArray(wanted) && wanted.includes(held);
			case 'not_in':
				return Array.isArray(wanted) && !wanted.includes(held);
			case 'is_null':
				return (held === null) === wanted;
			case 'like':
				return (
					typeof held === 'string' &&
					typeof wanted === 'string' &&
					new RegExp(
						`^${wanted
							.split('%')
							.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
							.join('.*')}$`
					).test(held)
				);
			default:
				if (held === null || wanted === null) return false;
				return op === 'gt'
					? held > wanted
					: op === 'gte'
						? held >= wanted
						: op === 'lt'
							? held < wanted
							: held <= wanted;
		}
	});
/** Whether a row answers a declared `where`: its tests, `or`, and `is` through a ref the read answered as its row. */
const matches = (row: JsonObject, where: JsonObject): boolean =>
	Object.entries(where).every(([key, test]) => {
		if (key === 'or')
			return Array.isArray(test) && test.some((one) => isJsonObject(one) && matches(row, one));
		if (!isJsonObject(test)) return false;
		if (isJsonObject(test.some)) {
			const children = row[key];
			const some = test.some;
			return (
				Array.isArray(children) &&
				children.some((child) => isJsonObject(child) && matches(child, some))
			);
		}
		if (isJsonObject(test.is)) {
			const through = row[key];
			return isJsonObject(through) && matches(through, test.is);
		}
		if (!Object.keys(test).every((op) => TESTS.has(op)))
			throw new Refusal({
				message: `${key}: a registered read cannot test ${Object.keys(test).join(', ')}.`
			});
		return tested(row[key], test);
	});

export type Need = { readonly model: string; readonly layer: JsonObject };
/**
 * Every declared read of a batch, in one typed request. Each answer is its need's rows: those its own `where` picks,
 * a ref the read reached through given back as its id.
 */
export const ruleRead = Effect.fnUntraced(function* (read: Reader, needs: readonly Need[]) {
	const keyed = new Map<string, Set<string>>();
	for (const { model, layer } of needs) {
		const problem = unreadable(model, layer);
		if (problem !== undefined) return yield* Effect.fail(new Refusal({ message: problem }));
		const key = keyOf(model, layer);
		if (key === undefined) continue;
		const at = `${model}/${key.path}`;
		const held = keyed.get(at) ?? new Set<string>();
		for (const value of key.values) if (typeof value === 'string') held.add(value);
		keyed.set(at, held);
	}
	const by = (model: Model, path: string) => [...(keyed.get(`${model}/${path}`) ?? [])];
	const found = yield* queryRows(read, {
		contract_terms: {
			where: {
				or: [
					{ employment_id: { in: idsOf('employment', by('contract_terms', 'employment_id')) } },
					{
						employment_id: {
							is: {
								employee_id: {
									in: idsOf(
										'employee_profile',
										by('contract_terms', 'employment_id.is.employee_id')
									)
								}
							}
						}
					}
				]
			},
			limit: 10000,
			employment_id: { fields: ['employee_id', 'entity_id'] }
		},
		employee_balance: {
			where: {
				or: [
					{ id: { in: idsOf('employee_balance', by('employee_balance', 'id')) } },
					{ employee_id: { in: idsOf('employee_profile', by('employee_balance', 'employee_id')) } },
					{
						employee_id: {
							is: {
								employment: {
									some: {
										entity_id: {
											in: idsOf(
												'entity',
												by('employee_balance', 'employee_id.is.employment.some.entity_id')
											)
										}
									}
								}
							}
						}
					}
				]
			},
			limit: 10000,
			employee_id: { fields: ['id'], employment: { fields: ['entity_id'] } }
		},
		entity: { where: { id: { in: idsOf('entity', by('entity', 'id')) } }, limit: 50 },
		entity_change: {
			where: { entity_id: { in: idsOf('entity', by('entity_change', 'entity_id')) } },
			limit: 10000
		},
		holiday: {
			where: { entity_id: { in: idsOf('entity', by('holiday', 'entity_id')) } },
			limit: 10000
		},
		leave_catalog_entry: {
			where: {
				or: [
					{ id: { in: idsOf('leave_catalog_entry', by('leave_catalog_entry', 'id')) } },
					{
						employment_id: { in: idsOf('employment', by('leave_catalog_entry', 'employment_id')) }
					},
					{
						employment_id: {
							is: {
								employee_id: {
									in: idsOf(
										'employee_profile',
										by('leave_catalog_entry', 'employment_id.is.employee_id')
									)
								}
							}
						}
					},
					{ entity_id: { in: idsOf('entity', by('leave_catalog_entry', 'entity_id')) } }
				]
			},
			limit: 10000,
			employment_id: { fields: ['employee_id', 'entity_id'] }
		},
		leave_catalog_entry_day: {
			where: {
				or: [
					{
						leave_entry_id: {
							in: idsOf('leave_catalog_entry', by('leave_catalog_entry_day', 'leave_entry_id'))
						}
					},
					{
						leave_entry_id: {
							is: {
								employment_id: {
									in: idsOf(
										'employment',
										by('leave_catalog_entry_day', 'leave_entry_id.is.employment_id')
									)
								}
							}
						}
					},
					{
						leave_entry_id: {
							is: {
								employment_id: {
									is: {
										employee_id: {
											in: idsOf(
												'employee_profile',
												by(
													'leave_catalog_entry_day',
													'leave_entry_id.is.employment_id.is.employee_id'
												)
											)
										}
									}
								}
							}
						}
					}
				]
			},
			limit: 10000,
			leave_entry_id: {
				fields: ['id', 'employment_id', 'catalog_code', 'payroll_run_id'],
				employment_id: { fields: ['employee_id'] }
			}
		},
		obligation: {
			where: {
				or: [
					{ occurrence_key: { in: by('obligation', 'occurrence_key') } },
					{ employment_id: { in: idsOf('employment', by('obligation', 'employment_id')) } },
					{ entity_id: { in: idsOf('entity', by('obligation', 'entity_id')) } },
					{ employee_id: { in: idsOf('employee_profile', by('obligation', 'employee_id')) } }
				]
			},
			limit: 10000
		},
		payroll_run: {
			where: { id: { in: idsOf('payroll_run', by('payroll_run', 'id')) } },
			limit: 1000
		},
		payslip: {
			where: {
				or: [
					{ payroll_run_id: { in: idsOf('payroll_run', by('payslip', 'payroll_run_id')) } },
					{ employment_id: { in: idsOf('employment', by('payslip', 'employment_id')) } },
					{ employee_id: { in: idsOf('employee_profile', by('payslip', 'employee_id')) } },
					{
						payroll_run_id: {
							is: {
								entity_id: { in: idsOf('entity', by('payslip', 'payroll_run_id.is.entity_id')) }
							}
						}
					}
				]
			},
			limit: 10000,
			payroll_run_id: { fields: ['entity_id', 'pay_date'] }
		},
		roster_entry: {
			where: {
				or: [
					{ employment_id: { in: idsOf('employment', by('roster_entry', 'employment_id')) } },
					{
						employment_id: {
							is: {
								employee_id: {
									in: idsOf('employee_profile', by('roster_entry', 'employment_id.is.employee_id'))
								}
							}
						}
					}
				]
			},
			limit: 10000,
			employment_id: { fields: ['employee_id', 'entity_id'] }
		},
		shift_definition: {
			where: {
				or: [
					{ id: { in: idsOf('shift_definition', by('shift_definition', 'id')) } },
					{ entity_id: { in: idsOf('entity', by('shift_definition', 'entity_id')) } }
				]
			},
			limit: 1000
		},
		workplace_case_catalog_entry: {
			where: {
				or: [
					{
						employment_id: {
							in: idsOf('employment', by('workplace_case_catalog_entry', 'employment_id'))
						}
					},
					{ entity_id: { in: idsOf('entity', by('workplace_case_catalog_entry', 'entity_id')) } }
				]
			},
			limit: 10000
		}
	});
	return needs.map(({ model, layer }): readonly JsonObject[] => {
		if (!isModel(model)) return [];
		const through = THROUGH[model] ?? [];
		const where = whereOf(layer);
		return found[model]
			.filter((row) => matches(row, where))
			.map((row) =>
				through.length === 0
					? row
					: {
							...row,
							...Object.fromEntries(through.map((field) => [field, idOrValue(row[field]) ?? null]))
						}
			);
	});
});

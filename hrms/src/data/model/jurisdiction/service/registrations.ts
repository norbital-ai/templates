import { Effect, Schema } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import { evaluate } from './expressions.js';
import { Refusal, isJsonObject, jsonObject, type Json } from '../../../../lib/foundation.js';
import { JsonObject, settingsConstants } from '../../../../lib/contracts.js';
import { type Reader } from '../../../../lib/reads.js';
import { programOf } from './programs.js';
import { type Law } from './law.js';
import {
	CATALOG_OF,
	batchRead,
	expression,
	lawsFor,
	pathValue,
	rangeObject,
	readLaw,
	refId,
	registered,
	resolveRead,
	subjectsOf,
	truth,
	usesGlobalLookup,
	type Operation,
	type SubjectCache,
	type UnderLaw
} from './registration_context.js';

export { rangeObject, resolveRead, startOf, type Operation } from './registration_context.js';

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

/** Resolves subjects and declared reads once for a batch of registered rules or effects. */
const loadRegisteredReads = Effect.fnUntraced(function* <
	T extends { readonly law: Law; readonly at: readonly number[] }
>(
	read: Reader,
	collection: string,
	rows: readonly JsonObject[],
	applied: readonly T[],
	on: (index: number) => string,
	cache: SubjectCache,
	sourceOf: (item: T) => string,
	statedOf: (item: T) => JsonObject
) {
	const source = applied.map(sourceOf).join('\n');
	const needs = {
		employer: source.includes('subject.employer'),
		employee: source.includes('subject.employee')
	};
	const subjects = yield* subjectsOf(
		read,
		collection,
		rows,
		rows.map((_, index) => on(index)),
		cache,
		needs
	);
	const declared = applied.map((item) => {
		const stated = statedOf(item);
		return item.at.map((index) =>
			readLaw(
				item.law,
				jsonObject(resolveRead(stated, { entry: rows[index], subject: subjects[index] }))
			)
		);
	});
	const reads = yield* batchRead(
		read,
		declared.map((own) => own.map(({ stored }) => stored)),
		new Map(),
		(rule, row) => on(applied[rule]?.at[row] ?? -1)
	);
	return { subjects, declared, reads };
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
	const { subjects, declared, reads } = yield* loadRegisteredReads(
		read,
		collection,
		rows,
		applied,
		on,
		cache,
		({ rule }) =>
			`${JSON.stringify(rule.reads ?? {})}\n${rule.condition ?? ''}\n${rule.validate ?? ''}`,
		({ rule }) => (isJsonObject(rule.reads) ? rule.reads : {})
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
	const {
		subjects,
		declared,
		reads: allReads
	} = yield* loadRegisteredReads(
		ctx.query,
		collection,
		entries,
		applied,
		on,
		cache,
		({ effect: row }) =>
			`${JSON.stringify(row.reads ?? {})}\n${row.condition ?? ''}\n${row.effects ?? ''}`,
		({ effect }) => {
			const stated = isJsonObject(effect.reads) ? effect.reads : {};
			// a task is known by its key: an effect that reads tasks reads the key, whatever fields it lists
			const tasks = stated.obligation;
			return isJsonObject(tasks) &&
				Array.isArray(tasks.fields) &&
				!tasks.fields.includes('occurrence_key')
				? { ...stated, obligation: { ...tasks, fields: [...tasks.fields, 'occurrence_key'] } }
				: stated;
		}
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

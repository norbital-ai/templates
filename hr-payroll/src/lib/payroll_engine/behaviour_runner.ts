import type { Act } from '@norbital-ai/bolt';
import { monthOf } from '@norbital-ai/std/date';
import { Effect, Result, Schema } from 'effect';
import {
	actBehaviourWrite,
	behavioursOf,
	effectWrites,
	planBehaviours,
	resolveWhere,
	triggerMatches
} from './behaviours.js';
import { type HostRead, isJsonObject, Reads, readsFrom, type Refusal } from './foundation.js';
import { governingVersion, headcountOn } from './services.js';

export type Row = Readonly<Record<string, unknown>>;
const Record_ = Schema.Record(Schema.String, Schema.Unknown);
export const rowOf = (value: unknown): Row | undefined =>
	Schema.is(Record_)(value) ? value : undefined;
const isString = Schema.is(Schema.String);
export const text = (value: unknown): string | null =>
	isString(value) && value !== '' ? value : null;

/** Who a trigger row is about: the entity whose jurisdiction it settles under, and the employment and person. */
export type Subject = {
	readonly company_id: string;
	readonly employment_id: string | null;
	readonly employee_id: string | null;
};

/** An entry collection's catalogue. */
const CATALOGS = {
	leave_catalog_entry: 'leave_catalog',
	claim_catalog_entry: 'claim_catalog',
	adhoc_catalog_entry: 'adhoc_catalog',
	loan_catalog_entry: 'loan_catalog'
} as const;
const isEntry = (collection: string): collection is keyof typeof CATALOGS => collection in CATALOGS;

/**
 * A trigger row as the rules read it (`event.row`): a payslip carries the day it was paid (`paid_on`, the UTC day of
 * `paid_at`) and its line codes (`line_codes`, base and adjustments); an entry carries its class (`catalog_code`, and the class row as `catalog`).
 */
export const describeTrigger = async (
	collection: string,
	row: Row,
	read: HostRead
): Promise<Row> => {
	if (collection === 'payslip') {
		const paid = text(row['paid_at']);
		const lines = rowOf(
			(
				await read('payslip', {
					where: { id: { eq: row['id'] } },
					select: { base: true, adjustments: true },
					limit: 1
				})
			).rows[0]
		);
		const codes = [lines?.['base'], lines?.['adjustments']]
			.flatMap((list) => (Array.isArray(list) ? list : []))
			.map((line) => text(rowOf(line)?.['component_code']))
			.filter((code) => code != null);
		return {
			...row,
			line_codes: [...new Set(codes)],
			...(paid == null ? {} : { paid_on: paid.slice(0, 10) })
		};
	}
	const catalogId = text(row['catalog_id']);
	if (!isEntry(collection) || catalogId == null) return row;
	const catalog = rowOf(
		(await read(CATALOGS[collection], { where: { id: { eq: catalogId } }, limit: 1 })).rows[0]
	);
	return { ...row, catalog_code: catalog?.['code'] ?? null, catalog: catalog ?? null };
};

/** A `where` clause over an empty list: it matches nothing. */
const emptyIn = (clause: unknown): boolean =>
	isJsonObject(clause) && Array.isArray(clause['in']) && clause['in'].length === 0;

const engine = <A>(effect: Effect.Effect<A, Refusal, Reads>, read: HostRead) =>
	Effect.runPromise(Effect.result(effect.pipe(Effect.provideService(Reads, readsFrom(read)))));

/** The version governing one entity on one day, read once per run. */
export const versionLookup = (read: HostRead) => {
	const versions = new Map<string, Row | null>();
	return async (company_id: string, day: string): Promise<Row | null> => {
		const key = `${company_id}:${day}`;
		if (versions.has(key)) return versions.get(key) ?? null;
		const entity = (
			await read('entity', {
				where: { id: { eq: company_id } },
				select: { settings_code: true },
				limit: 1
			})
		).rows[0];
		const settings_code = text(entity?.settings_code);
		const outcome =
			settings_code == null ? null : await engine(governingVersion({ settings_code }, day), read);
		const version = outcome == null || Result.isFailure(outcome) ? null : rowOf(outcome.success);
		versions.set(key, version ?? null);
		return version ?? null;
	};
};

/** The entity's contracts in force on a day; a read that fails counts none. */
const headcount = async (company_id: string, day: string, read: HostRead): Promise<number> => {
	const outcome = await engine(headcountOn(company_id, day), read);
	return Result.isFailure(outcome) ? 0 : outcome.success;
};

/**
 * One trigger row through the governing version's behaviour rules, for each of its subjects: plan the rules whose
 * trigger is this collection and event, evaluate each `when`, load its declared reads and apply the writes its
 * `effect` returns, in order. Every `entity` row a rule reads carries its `headcount` on the event day, as does
 * `event`. Nothing here knows what any behaviour means; the row taps and the daily tick share it.
 */
export const runBehaviours = async (input: {
	readonly collection: string;
	readonly action: string;
	readonly row: Row;
	readonly day: string;
	readonly subjects: readonly Subject[];
	/** The trigger row's extra fields the rules name, as the trigger collection carries them. */
	readonly fields: (names: readonly string[]) => Promise<Row>;
	readonly versionFor: (company_id: string, day: string) => Promise<Row | null>;
	readonly read: HostRead;
	readonly act: Act;
	readonly run?: unknown;
	readonly leave_balances?: readonly unknown[];
}): Promise<void> => {
	const { collection, action, day, read } = input;
	const trigger = { kind: 'row' as const, collection, event: action };
	for (const subject of input.subjects) {
		const version = await input.versionFor(subject.company_id, day);
		const behaviours = behavioursOf(version?.['behaviours']);
		if (version == null || behaviours == null) continue;
		const candidates = behaviours.rules.filter((rule) => triggerMatches(rule, trigger));
		if (candidates.length === 0) continue;
		const extra = [...new Set(candidates.flatMap((rule) => rule.fields ?? []))];
		const row = extra.length === 0 ? input.row : { ...input.row, ...(await input.fields(extra)) };
		const context = {
			event: {
				collection,
				action,
				row,
				settings_id: version['id'],
				day,
				headcount: await headcount(subject.company_id, day, read),
				leave_balances: input.leave_balances ?? [],
				period: {
					key: day.slice(0, 7),
					from: String(monthOf(day).from),
					to: String(monthOf(day).to)
				},
				...subject
			},
			...(input.run === undefined ? {} : { run: input.run })
		};
		for (const rule of planBehaviours(behaviours, trigger, context)) {
			const reads: Record<string, unknown> = {};
			for (const [name, declared] of Object.entries(rule.reads ?? {})) {
				const where = resolveWhere(declared.where, context);
				// A clause over an empty list matches nothing: the subject has no such row.
				if (isJsonObject(where) && Object.values(where).some(emptyIn)) {
					reads[name] = [];
					continue;
				}
				const { rows } = await read(declared.collection, {
					...(where !== undefined && isJsonObject(where) ? { where } : {}),
					...(declared.select === undefined
						? {}
						: { select: Object.fromEntries(declared.select.map((field) => [field, true])) }),
					all: true
				});
				reads[name] =
					declared.collection !== 'entity'
						? rows
						: await Promise.all(
								rows.map(async (held) => ({
									...held,
									headcount: await headcount(String(held.id), day, read)
								}))
							);
			}
			const writes = effectWrites(rule, { ...context, ...reads });
			for (const write of writes) await actBehaviourWrite(input.act, write);
		}
	}
};

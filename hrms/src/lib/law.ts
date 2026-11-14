import type { ReadRequestJson } from '@norbital-ai/bolt';
import { inForce, type Change } from './dated.js';
import { Effect } from 'effect';
import { isJsonObject, type JsonObject } from './payroll_engine/foundation.js';
import { queryRows, type Reader } from './payroll_engine/reads.js';

/** The families of a law whose members are rows, each keyed by its code. Every other family is a value per key. */
export const LAW_ROWS = [
	'subtotal',
	'allowance_catalog',
	'overtime_catalog',
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'work_event_catalog',
	'workplace_case_catalog',
	'registered_rule',
	'registered_effect'
] as const;
export type LawFamily = (typeof LAW_ROWS)[number];

/** A law document is read three keys deep: family, row code, field. Below that a value is replaced whole. */
export const LAW_DEPTH = 3;

/**
 * A law as it stands on a day. `settings` is the jurisdiction with the law's own blocks (`conversions`, `ledger`,
 * `lookup`, `work_regions`, the two extension schemas); `rows` are each family's rows, every one carrying its `code`.
 * A row names another by code: `subtotal`, `previous`, `employer_cost_subtotal`. Nothing in a law has an id.
 */
export interface Law {
	readonly code: string;
	readonly on: string;
	readonly settings: JsonObject;
	readonly rows: Readonly<Record<LawFamily, readonly JsonObject[]>>;
	/** The change that last set each path (`family/code/field`): a value wrong since then is corrected on that row. */
	readonly set_by: Readonly<Record<string, string>>;
}

/**
 * What `lawsOf` reads, to spread into a request. Name the codes: a law's chain is about 400 KB, and a workspace holds
 * every seeded jurisdiction, so only a sync over every company reads them all.
 */
export const lawRead = (codes?: readonly string[]): ReadRequestJson => ({
	jurisdiction: {
		...(codes === undefined ? {} : { where: { code: { in: [...new Set(codes)] } } }),
		limit: 1000
	},
	jurisdiction_change: {
		...(codes === undefined ? {} : { where: { jurisdiction_code: { in: [...new Set(codes)] } } }),
		fields: ['id', 'jurisdiction_code', 'effective_from', 'finding_id', 'law'],
		limit: 10000,
		finding_id: { fields: ['status'] }
	}
});

/** A change written by research is in force only while its finding is confirmed. */
export const standing = (row: JsonObject): boolean =>
	row.finding_id == null || (isJsonObject(row.finding_id) && row.finding_id.status === 'CONFIRMED');

const changeOf = (row: JsonObject): Change => ({
	id: String(row.id),
	effective_from: String(row.effective_from),
	patch: isJsonObject(row.law) ? row.law : {}
});

/** The subtotals in the order of their chain: each after the one it names as `previous`. */
const chained = (rows: readonly JsonObject[]): readonly JsonObject[] => {
	const after = new Map(rows.map((row) => [row.previous ?? null, row]));
	const out: JsonObject[] = [];
	for (let next = after.get(null); next !== undefined && out.length < rows.length;)
		(out.push(next), (next = after.get(String(next.code))));
	return out.length === rows.length ? out : rows;
};

/**
 * The laws these rows hold, by code and day. A day before a law's first change answers to that first change, so a
 * record dated before the seed's start is still read under a law.
 */
export const lawsOf = (read: {
	readonly jurisdiction?: readonly JsonObject[];
	readonly jurisdiction_change?: readonly JsonObject[];
}): ((code: unknown, day: string) => Law | undefined) => {
	const heads = new Map((read.jurisdiction ?? []).map((row) => [String(row.code), row]));
	const chains = Map.groupBy((read.jurisdiction_change ?? []).filter(standing), (row) =>
		String(row.jurisdiction_code)
	);
	const held = new Map<string, Law | undefined>();
	return (code, day) => {
		const head = heads.get(String(code));
		const chain = (chains.get(String(code)) ?? []).map(changeOf);
		if (head === undefined || chain.length === 0) return undefined;
		const first = chain.map((row) => row.effective_from).toSorted()[0] ?? day;
		const on = day < first ? first : day;
		// one fold per stretch between two changes, however many days ask
		const key = `${String(code)}/${chain.filter((row) => row.effective_from <= on).length}`;
		if (held.has(key)) {
			const law = held.get(key);
			return law === undefined ? undefined : { ...law, on: day };
		}
		const { state, set_by } = inForce(chain, on, LAW_DEPTH);
		const family = (name: LawFamily): readonly JsonObject[] => {
			const rows = isJsonObject(state[name]) ? state[name] : {};
			return Object.entries(rows).flatMap(([code, row]) =>
				isJsonObject(row) ? [{ ...row, code }] : []
			);
		};
		const { id: _id, ...jurisdiction } = head;
		const law: Law = {
			code: String(code),
			on: day,
			settings: {
				...jurisdiction,
				...Object.fromEntries(
					Object.entries(state).filter(([name]) => !LAW_ROWS.some((rows) => rows === name))
				)
			},
			rows: {
				subtotal: chained(family('subtotal')),
				allowance_catalog: family('allowance_catalog'),
				overtime_catalog: family('overtime_catalog'),
				statutory_contribution_catalog: family('statutory_contribution_catalog'),
				leave_catalog: family('leave_catalog'),
				claim_catalog: family('claim_catalog'),
				adhoc_catalog: family('adhoc_catalog'),
				loan_catalog: family('loan_catalog'),
				work_event_catalog: family('work_event_catalog'),
				workplace_case_catalog: family('workplace_case_catalog'),
				registered_rule: family('registered_rule'),
				registered_effect: family('registered_effect')
			},
			set_by
		};
		held.set(key, law);
		return law;
	};
};

/** `lawRead` for the laws of the companies a filter names: one small read of their codes first. */
export const lawReadOf = Effect.fn('payroll.lawReadOf')(function* (
	read: Reader,
	where: JsonObject
) {
	const { entity = [] } = yield* queryRows(read, {
		entity: { where, fields: ['settings_code'], limit: 10000 }
	});
	return lawRead(entity.map((row) => String(row.settings_code)));
});

const refId = (value: unknown): string | undefined =>
	typeof value === 'string' ? value : isJsonObject(value) ? String(value.id) : undefined;

/** The law each asker answers to: its company's jurisdiction as it stands on its day, all from one read. */
export const lawOn = Effect.fn('payroll.lawOn')(function* (
	read: Reader,
	asked: readonly { readonly entity: unknown; readonly on: unknown }[]
) {
	const entities = [...new Set(asked.flatMap(({ entity }) => refId(entity) ?? []))];
	if (entities.length === 0) return asked.map((): Law | undefined => undefined);
	const got = yield* queryRows(read, {
		entity: { where: { id: { in: entities } }, fields: ['id', 'settings_code'], limit: 10000 },
		...(yield* lawReadOf(read, { id: { in: entities } }))
	});
	const code = new Map((got.entity ?? []).map((row) => [String(row.id), row.settings_code]));
	const laws = lawsOf(got);
	return asked.map(({ entity, on }) => laws(code.get(String(refId(entity))), String(on)));
});

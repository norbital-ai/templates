import { inForce, type Change } from './dated.js';
import { Deferred, Effect, Exit } from 'effect';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
import { isJsonObject, type JsonObject, type Refusal } from './payroll_engine/foundation.js';
import { idOf, queryRows, type Reader } from './payroll_engine/reads.js';

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

/**
 * A law document is read three keys deep: family, row code, field. A row's `lookup` is read one key deeper, so a change
 * names only the lookup keys it changes. Below that a value is replaced whole.
 */
export const LAW_DEPTH = (path: readonly string[]): boolean =>
	path.length < 3 ||
	(path.length === 3 && path[2] === 'lookup' && LAW_ROWS.some((rows) => rows === path[0]));

/**
 * A law as it stands on a day. `settings` is the jurisdiction with the law's own blocks (`conversions`, `ledger`,
 * `lookup`, `work_regions`, the two statutory parameter declarations); `rows` are each family's rows, every one carrying its `code`.
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
export const lawRead = (codes: readonly string[]) =>
	({
		jurisdiction: { where: { code: { in: [...new Set(codes)] } }, limit: 20 },
		jurisdiction_change: {
			where: { jurisdiction_code: { in: [...new Set(codes)] } },
			fields: ['id', 'jurisdiction_code', 'effective_from', 'finding_id', 'law'],
			limit: 500,
			finding_id: { fields: ['status'] }
		}
	}) as const;

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

type LawRows = Readonly<Record<'jurisdiction' | 'jurisdiction_change', readonly JsonObject[]>>;
type LawFailure = ReadFailed | Refusal;
type Laws = ReturnType<typeof lawsOf>;
const NO_LAW: LawRows = { jurisdiction: [], jurisdiction_change: [] };
/**
 * The laws each reader has read, by code, each folded once. A reader is one invocation's `ctx.query`: whoever asks again
 * in the invocation, beside the first asker or after it, reuses its read and folds, and nothing reaches the next one.
 */
const readLaws = new WeakMap<Reader, Map<string, Deferred.Deferred<Laws, LawFailure>>>();
/**
 * The laws these codes name, read and folded once per invocation. `ask` sends the caller's own request with `law`:
 * `lawRead` of `fresh`, the codes no asker of this reader has asked for. A code another asker reads is its answer. A
 * read that fails takes its codes back, so the next asker reads them again.
 */
export const lawsWith = Effect.fnUntraced(function* <A extends LawRows>(
	read: Reader,
	codes: Iterable<unknown>,
	ask: (law: ReturnType<typeof lawRead>, fresh: readonly string[]) => Effect.Effect<A, LawFailure>
) {
	const held = readLaws.get(read) ?? new Map<string, Deferred.Deferred<Laws, LawFailure>>();
	readLaws.set(read, held);
	const wanted = [...new Set([...codes].map(String))];
	const fresh = wanted.filter((code) => !held.has(code));
	const own = Deferred.makeUnsafe<Laws, LawFailure>();
	for (const code of fresh) held.set(code, own);
	const answers = wanted.map((code) => [code, held.get(code) ?? own] as const);
	const got = yield* Effect.suspend(() => ask(lawRead(fresh), fresh)).pipe(
		Effect.onExit((exit) => {
			if (Exit.isFailure(exit)) for (const code of fresh) held.delete(code);
			return Effect.asVoid(Deferred.done(own, Exit.map(exit, lawsOf)));
		})
	);
	const folds = new Map<string, Laws>();
	for (const [code, answer] of answers) folds.set(code, yield* Deferred.await(answer));
	return { got, laws: (code: unknown, day: string) => folds.get(String(code))?.(code, day) };
});
/** `lawsWith` with nothing else to read: no trip when every code is already read. */
export const lawsAt = (read: Reader, codes: Iterable<unknown>) =>
	lawsWith(read, codes, (law, fresh): Effect.Effect<LawRows, LawFailure> =>
		fresh.length === 0 ? Effect.succeed(NO_LAW) : queryRows(read, law)
	).pipe(Effect.map(({ laws }) => laws));

/** `lawRead` for the laws of these companies: one small read of their codes first. */
export const lawReadOf = Effect.fn('payroll.lawReadOf')(function* (
	read: Reader,
	entities: readonly string[]
) {
	const { entity } = yield* queryRows(read, {
		entity: {
			where: { id: { in: entities.map((id) => idOf('entity', id)) } },
			fields: ['settings_code'],
			limit: 50
		}
	});
	return lawRead(entity.map((row) => String(row.settings_code)));
});

const refId = (value: unknown): string | undefined =>
	typeof value === 'string' ? value : isJsonObject(value) ? String(value.id) : undefined;

/**
 * The law each asker answers to: its company's jurisdiction as it stands on its day. Two reads, the companies' codes and
 * then their laws; one when the invocation has read those laws already.
 */
export const lawOn = Effect.fn('payroll.lawOn')(function* (
	read: Reader,
	asked: readonly { readonly entity: unknown; readonly on: unknown }[]
) {
	const entities = [...new Set(asked.flatMap(({ entity }) => refId(entity) ?? []))];
	if (entities.length === 0) return asked.map((): Law | undefined => undefined);
	const { entity: companies } = yield* queryRows(read, {
		entity: {
			where: { id: { in: entities.map((id) => idOf('entity', id)) } },
			fields: ['id', 'settings_code'],
			limit: 50
		}
	});
	const code = new Map(companies.map((row) => [String(row.id), row.settings_code]));
	const laws = yield* lawsAt(read, code.values());
	return asked.map(({ entity, on }) => laws(code.get(String(refId(entity))), String(on)));
});

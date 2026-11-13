import type { CarriedWrites, EffectCtx } from '@norbital-ai/bolt';
import type { ReadRequestJson } from '@norbital-ai/bolt/protocol';
import { DateTime, Effect, Schema } from 'effect';
import { amendmentsOf } from '../amendments.js';
import { reachOf, type Change } from '../dated.js';
import {
	LAW_DEPTH,
	LAW_ROWS,
	lawRead,
	lawsOf,
	standing,
	type Law,
	type LawFamily
} from '../law.js';
import { paidShareOf, statutoryOrder, subtotalChain } from './engine.js';
import { checkExpression } from './expressions.js';
import {
	getErrorMessage,
	isJsonObject,
	Refusal,
	stableJson,
	type JsonObject
} from './foundation.js';
import { paramsFor } from './params.js';
import { programOf } from './programs.js';
import { queryRows, type Reader } from './reads.js';

/** A conversion arm is a union in use: only FIXED owns its divisor; no other arm may carry it. */
const conversionArmError = (row: {
	readonly conversions?: unknown;
	readonly code?: unknown;
}): string | undefined => {
	if (
		row.conversions === null ||
		typeof row.conversions !== 'object' ||
		Array.isArray(row.conversions)
	)
		return undefined;
	const conversions = row.conversions as Record<string, unknown>;
	for (const [name, unit] of [
		['day', 'days'],
		['hour', 'hours']
	] as const) {
		const arm = conversions[name];
		if (arm === null || typeof arm !== 'object' || Array.isArray(arm)) continue;
		const value = arm as Record<string, unknown>;
		const fixed = value.basis === 'FIXED';
		const divisor = value[unit];
		const code = String(row.code ?? 'settings');
		if (fixed && (typeof divisor !== 'number' || divisor <= 0))
			return `${code}: conversions.${name} FIXED requires a positive ${unit}.`;
		if (!fixed && divisor !== undefined)
			return `${code}: conversions.${name}.${unit} belongs only to FIXED.`;
	}
	return undefined;
};

/** The families whose expressions run on the chain: a subtotal one of them reads is a subtotal of this law. */
const ON_CHAIN: readonly LawFamily[] = [
	'subtotal',
	'allowance_catalog',
	'overtime_catalog',
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog'
];

const checkRow = (family: LawFamily, row: JsonObject, subtotals: ReadonlySet<string>): void => {
	const code = String(row.code ?? 'row');
	if (row.lookup !== undefined && (row.lookup === null || typeof row.lookup !== 'object'))
		throw new Refusal({ message: `${family}: ${code}: lookup must be an object.` });
	const program = programOf(family);
	for (const field of [
		'calculation',
		'eligibility',
		'conversion',
		'paid_share',
		'payout',
		'employee_amount',
		'employer_amount',
		'condition',
		'validate',
		'effects'
	] as const) {
		const source = row[field];
		if (typeof source !== 'string' || source.trim() === '') continue;
		try {
			checkExpression(
				source,
				'CALCULATION',
				ON_CHAIN.includes(family) ? subtotals : undefined,
				program?.roots
			);
		} catch (error) {
			throw new Refusal({ message: `${family}: ${code}.${field}: ${getErrorMessage(error)}` });
		}
	}
	// a stated share is refused here, before any run: a leave day pays 0 to 1 of a normal day
	if (family === 'leave_catalog' && Number.isFinite(Number(row.paid_share)))
		paidShareOf(row, () => ({}));
	const schema = paramsFor(family, code);
	if (schema !== undefined) {
		try {
			Schema.decodeUnknownSync(schema)(row.lookup ?? {});
		} catch (error) {
			throw new Refusal({
				message: `${family}: ${code}: params do not match the family shape: ${String(error)}`
			});
		}
	}
	// a row posts to a checkpoint of its own law: no key holds this, so the write does
	if (family !== 'subtotal')
		for (const field of ['subtotal', 'employer_cost_subtotal'] as const)
			if (row[field] != null && !subtotals.has(String(row[field])))
				throw new Refusal({
					message: `${family}: ${code}: ${field} ${String(row[field])} is not a subtotal of this law.`
				});
};

/**
 * A law as it stands on one day holds together: expressions parse and read only their family's roots, the subtotal
 * chain is linear, statutory dependencies are acyclic, row params match their family's shape, a leave share is 0 to 1,
 * the conversion arms agree, and every row posts to a subtotal of the law. Throws the first `Refusal`. `seen` carries
 * the rows already checked, so a row a later day leaves as it was is checked once.
 */
export const checkLaw = (law: Law, seen: Set<string> = new Set()): void => {
	const arm = conversionArmError({ conversions: law.settings.conversions, code: law.code });
	if (arm !== undefined) throw new Refusal({ message: arm });
	const subtotals = new Set(subtotalChain(law.rows.subtotal).map((row) => String(row.code)));
	statutoryOrder(law.rows.statutory_contribution_catalog);
	const chain = [...subtotals].join();
	for (const family of LAW_ROWS)
		for (const row of law.rows[family]) {
			const key = `${family}/${chain}/${JSON.stringify(row)}`;
			if (seen.has(key)) continue;
			checkRow(family, row, subtotals);
			seen.add(key);
		}
};

/** What payroll never prices from: a row's citations and wording, and the two extension schemas. */
const priced = (path: string): boolean => {
	const [family, , field] = path.split('/');
	if (family === 'employee_extension_schema' || family === 'entity_extension_schema') return false;
	return !(
		LAW_ROWS.some((rows) => rows === family) &&
		(field === 'references' || field === 'description' || field === 'name')
	);
};

/** The entries that name a catalogue row by code, and how each is dated on or after a day. */
const ENTRIES: Partial<
	Record<LawFamily, readonly [model: string, since: (day: string) => JsonObject]>
> = {
	leave_catalog: [
		'leave_catalog_entry',
		(day) => ({ leave_catalog_entry_day: { some: { incurred_on: { gte: day } } } })
	],
	claim_catalog: ['claim_catalog_entry', (day) => ({ incurred_on: { gte: day } })],
	adhoc_catalog: ['adhoc_catalog_entry', (day) => ({ incurred_on: { gte: day } })],
	loan_catalog: [
		'loan_catalog_entry',
		(day) => ({ repayment_period: { overlaps: { from: day, to: null } } })
	],
	workplace_case_catalog: ['workplace_case_catalog_entry', (day) => ({ opened_on: { gte: day } })],
	work_event_catalog: [
		'work_event',
		(day) => ({ or: [{ to: { gte: day } }, { to: { is_null: true } }] })
	]
};

const changeOf = (row: JsonObject): Change => ({
	id: String(row.id),
	effective_from: String(row.effective_from),
	patch: isJsonObject(row.law) ? row.law : {}
});
const firstOf = (rows: readonly Change[]): string | undefined =>
	rows.toSorted(
		(a, b) => a.effective_from.localeCompare(b.effective_from) || a.id.localeCompare(b.id)
	)[0]?.id;

/**
 * A write to the changes of these laws, checked where a seal checked. `rewrite` turns the stored changes (as
 * `lawRead` answers them) into the changes the write leaves. Each law is folded on the earliest day the write
 * touches and at every later change date and must hold on each (`checkLaw`); its first change stays its first; and no
 * catalogue code an entry dated in that span names is taken away. Answers the amendment rows of the paid periods the
 * write reaches, for the write to carry. A change not in force (research's, until its finding is confirmed) is neither
 * checked nor reaches anything.
 */
export const lawWrite = Effect.fn('payroll.lawWrite')(function* (
	read: Reader,
	codes: readonly string[],
	rewrite: (stored: readonly JsonObject[]) => readonly JsonObject[]
) {
	const got = yield* queryRows(read, {
		...lawRead(codes),
		entity: {
			where: { settings_code: { in: [...new Set(codes)] } },
			fields: ['id', 'settings_code'],
			limit: 10000
		}
	});
	const stored = got.jurisdiction_change ?? [];
	const next = rewrite(stored);
	const was = lawsOf(got);
	const now = lawsOf({ ...got, jurisdiction_change: next });
	const seen = new Set<string>();
	type Carried = NonNullable<NonNullable<CarriedWrites['pay_amendment']>['create']>;
	const carried: Carried[number][] = [];
	for (const code of new Set(codes)) {
		const of = (rows: readonly JsonObject[]) =>
			rows.filter((row) => row.jurisdiction_code === code && standing(row)).map(changeOf);
		const before = of(stored);
		const after = of(next);
		const prior = new Map(before.map((row) => [row.id, row]));
		const post = new Map(after.map((row) => [row.id, row]));
		const written = [...new Set([...prior.keys(), ...post.keys()])].filter((id) => {
			const a = prior.get(id);
			const b = post.get(id);
			return (
				a === undefined ||
				b === undefined ||
				a.effective_from !== b.effective_from ||
				stableJson(a.patch) !== stableJson(b.patch)
			);
		});
		if (written.length === 0) continue;
		if (before.length > 0 && after.length > 0 && firstOf(before) !== firstOf(after))
			return yield* Effect.fail(
				new Refusal({
					message:
						'The first change of a law holds the whole law. It stays the first while later ones exist.'
				})
			);
		const from = written
			.flatMap((id) => [prior.get(id), post.get(id)])
			.flatMap((row) => (row === undefined ? [] : [row.effective_from]))
			.toSorted()[0];
		if (from === undefined) continue;
		const days = [
			...new Set([from, ...after.map((row) => row.effective_from).filter((day) => day > from)])
		].toSorted();
		const entities = (got.entity ?? [])
			.filter((row) => row.settings_code === code)
			.map((row) => String(row.id));
		// the codes each entry family loses, from the first day it loses one
		const lost = new Map<LawFamily, { readonly codes: Set<string>; readonly from: string }>();
		for (const day of days) {
			const law = now(code, day);
			// ponytail: a whole fold and check per change date (a law has a handful); check only the families the
			// write touches if a save's latency shows it
			if (law !== undefined)
				yield* Effect.try({
					try: () => checkLaw(law, seen),
					catch: (cause) =>
						cause instanceof Refusal ? cause : new Refusal({ message: getErrorMessage(cause) })
				});
			const old = was(code, day);
			for (const family of LAW_ROWS) {
				if (ENTRIES[family] === undefined) continue;
				const kept = new Set((law?.rows[family] ?? []).map((row) => String(row.code)));
				for (const row of old?.rows[family] ?? [])
					if (!kept.has(String(row.code))) {
						const held = lost.get(family) ?? { codes: new Set<string>(), from: day };
						lost.set(family, { codes: held.codes.add(String(row.code)), from: held.from });
					}
			}
		}
		if (lost.size > 0 && entities.length > 0) {
			// ponytail: every lost code of a family is asked from the family's first lost day; ask per code if a
			// write ever takes two codes away on different days
			const asked: Record<string, ReadRequestJson[string]> = {};
			for (const [family, { codes: gone, from: since }] of lost) {
				const entry = ENTRIES[family];
				if (entry !== undefined)
					asked[entry[0]] = {
						where: {
							entity_id: { in: entities },
							catalog_code: { in: [...gone] },
							...entry[1](since)
						},
						fields: ['catalog_code'],
						limit: 1
					};
			}
			const named = yield* queryRows(read, asked);
			const [model, rows] = Object.entries(named).find(([, rows]) => rows.length > 0) ?? [];
			if (model !== undefined)
				return yield* Effect.fail(
					new Refusal({
						message: `${String(rows?.[0]?.catalog_code)}: ${model} rows dated on or after this change name it. Move or delete them before taking the row away.`
					})
				);
		}
		const amended: CarriedWrites = yield* amendmentsOf(
			read,
			entities,
			written.flatMap(
				(id) =>
					reachOf(
						after.filter((row) => row.id !== id),
						prior.get(id),
						post.get(id),
						LAW_DEPTH,
						priced
					) ?? []
			)
		);
		carried.push(...(amended.pay_amendment?.create ?? []));
	}
	const writes: CarriedWrites = carried.length === 0 ? {} : { pay_amendment: { create: carried } };
	return writes;
});

/** An entitlement may have changed: the ledger syncs now for a change in force today, else on the change's day. */
export const syncLedgerOn = Effect.fnUntraced(function* (ctx: EffectCtx, days: readonly string[]) {
	const today = String(ctx.today);
	for (const day of new Set(days.map((day) => (day > today ? day : today))))
		yield* ctx.schedule(
			'ledger',
			{},
			day > today
				? {
						at: DateTime.formatIso(DateTime.makeUnsafe(`${day}T00:00:00Z`)),
						key: `ledger:${day}`
					}
				: { key: 'ledger' }
		);
});

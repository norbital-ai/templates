import { loadPack, openPglite, readPack, type Pack } from '@norbital-ai/bolt/engine';
import { workspace } from './kit.ts';

type Db = Awaited<ReturnType<typeof openPglite>>['db'];

/** One host read round trip: the collections its statements read, in order (`sys_*` are the engine's own). */
export type Trip = readonly string[];
export type Measured = {
	/** Round trips to the database (`TenantDb.read` calls): one per crossing batch, plus the engine's own. */
	readonly trips: number;
	/** Statements across those trips. */
	readonly statements: number;
	/** Each trip's shape. */
	readonly shapes: readonly Trip[];
	/** Trips that read a workspace collection (the guest's and the act's own row reads), not only `sys_*`. */
	readonly reads: number;
	/** Rows those reads answered (a composed statement's members' rows counted one by one) and their JSON bytes. */
	readonly rows: number;
	readonly bytes: number;
	/** Write statements (`TenantDb.write`: commits and outcome records). */
	readonly writes: number;
	/** Wall time of `fn`, in ms. */
	readonly ms: number;
	/** The statement that answered the most bytes, for `EXPLAIN`. */
	readonly heaviest?: {
		readonly text: string;
		readonly params: readonly unknown[];
		readonly bytes: number;
	};
};

type Answer = { readonly [column: string]: unknown };
const isAnswer = (value: unknown): value is Answer =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
/** Leaf rows of one answered row: a composed statement's `{ m, j: [...] }` and a fingerprint's `{ fp, r }` unwrap. */
const leaves = (row: Answer): number => {
	const keys = Object.keys(row);
	if (keys.length === 2 && 'm' in row && Array.isArray(row['j']))
		return row['j'].reduce<number>((n, child) => n + (isAnswer(child) ? leaves(child) : 1), 0);
	if (keys.length === 2 && 'fp' in row)
		return row['fp'] === true ? 0 : isAnswer(row['r']) ? leaves(row['r']) : 1;
	return 1;
};

/** The tables one statement reads, `+`-joined (a composed read names every member's). */
const tableOf = (text: string): string => {
	const tables = [
		...new Set(
			[...text.matchAll(/\bFROM\s+"?([a-z_][a-z0-9_]*)"?(?=[\s),]|$)/gi)]
				.map((match) => match[1]!)
				.filter((table) => table.length > 1 && table !== 'unnest')
		)
	];
	return tables.length === 0 ? text.slice(0, 40) : tables.join('+');
};

/**
 * The template on the test kit with every host read recorded: `measure(fn)` reports the database round trips `fn`
 * caused and the collections each read. `pack` filters the sample pack before it loads (a smaller company).
 */
export async function recorded(options: {
	readonly now: string;
	readonly pack?: (pack: Pack) => Pack;
}) {
	const inner = (await openPglite()).db as Db;
	let log: Trip[] | undefined;
	let tally = { rows: 0, bytes: 0, writes: 0, heaviest: undefined as Measured['heaviest'] };
	const db: Db = {
		read: async (statements, signal) => {
			log?.push(statements.map((s) => tableOf(s.text)));
			const answer = await inner.read(statements, signal);
			if (log !== undefined)
				answer.forEach((result, i) => {
					const bytes = JSON.stringify(result.rows).length;
					tally.rows += result.rows.reduce((n, row) => n + leaves(row), 0);
					tally.bytes += bytes;
					if (bytes > (tally.heaviest?.bytes ?? -1))
						tally.heaviest = { text: statements[i]!.text, params: statements[i]!.params, bytes };
				});
			return answer;
		},
		write: (statement, lock, signal) => {
			if (log !== undefined) tally.writes++;
			return inner.write(statement, lock, signal);
		},
		transaction: (body, lock) => inner.transaction(body, lock)
	};
	const t = await workspace({ seed: 'none', now: options.now, db });
	const sample = readPack(`${process.cwd()}/.norbital/seed/sample`);
	await loadPack(t.db, t.manifest, options.pack ? options.pack(sample) : sample, t.clock.now());
	await t.engine.refreshMessaging();
	await t.engine.runs!.reconfigure();
	const measure = async <A>(fn: () => Promise<A>): Promise<{ value: A } & Measured> => {
		const trips: Trip[] = [];
		log = trips;
		tally = { rows: 0, bytes: 0, writes: 0, heaviest: undefined };
		const started = performance.now();
		try {
			const value = await fn();
			return {
				value,
				ms: Math.round(performance.now() - started),
				rows: tally.rows,
				bytes: tally.bytes,
				writes: tally.writes,
				...(tally.heaviest === undefined ? {} : { heaviest: tally.heaviest }),
				trips: trips.length,
				statements: trips.reduce((n, trip) => n + trip.length, 0),
				shapes: trips,
				reads: trips.filter((trip) =>
					trip.some((tables) => tables.split('+').some((table) => !table.startsWith('sys_')))
				).length
			};
		} finally {
			log = undefined;
		}
	};
	return { t, measure };
}

/** The sample pack cut to one company's first `n` employments (their profiles, entries and roster days). */
export const company =
	(companyId: string, n: number) =>
	(pack: Pack): Pack => {
		const kept = (pack.rows['employment_contract'] ?? [])
			.filter((row) => row['company_id'] === companyId)
			.slice(0, n);
		const contracts = new Set(kept.map((row) => row['id']));
		const people = new Set(kept.map((row) => row['employee_id']));
		const rows = Object.fromEntries(
			Object.entries(pack.rows).map(([name, list]) => {
				if (name === 'entity') return [name, list.filter((row) => row['id'] === companyId)];
				if (name === 'employment_contract') return [name, kept];
				if (name === 'employment_profile')
					return [name, list.filter((row) => people.has(row['id']))];
				if (list.some((row) => 'employment_id' in row))
					return [name, list.filter((row) => contracts.has(row['employment_id']))];
				if (list.some((row) => 'company_id' in row))
					return [name, list.filter((row) => row['company_id'] === companyId)];
				return [name, list];
			})
		);
		return {
			...pack,
			rows,
			meta: {
				...pack.meta,
				rows: Object.fromEntries(Object.entries(rows).map(([name, list]) => [name, list.length]))
			}
		};
	};

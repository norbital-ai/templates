/**
 * First-match ladders and band tables: which rungs can never govern, and which values no rung
 * matches.
 *
 * A rung's `when` is read as the conjunction it is: each comparison of one subject with a number
 * (`base > 3000.0`, `age < 60`) narrows that subject's interval, every other conjunct is a guard
 * compared by its canonical text. A rung is unreachable when an interval is empty, or when an
 * earlier rung's guards are a subset of its own and each of the earlier rung's intervals contains
 * its interval. Rungs with the same guards and one subject are one ladder over that subject, and a
 * value between two rungs is a hole — for a money subject, one cent is the grain: a `> 100.01`
 * after a `<= 100.00` misses 100.01 itself.
 */

// ponytail: guards compare by text, so `a && b` and an equivalent `!(!a || !b)` are two guards;
// a hole across rungs with different guards is not seen. Normalise guards if that ever bites.

import { children, numberOf, parse, textOf, type Node } from './ast.js';
import * as Predicate from 'effect/Predicate';

/** A cent: the grain of a money value. */
const CENT = 1 / 100;
const EPSILON = 1e-9;

export type Interval = {
	readonly lo: number;
	readonly loIn: boolean;
	readonly hi: number;
	readonly hiIn: boolean;
};
const ALL: Interval = { lo: -Infinity, loIn: false, hi: Infinity, hiIn: false };

const isEmpty = (range: Interval): boolean =>
	range.lo > range.hi || (range.lo === range.hi && !(range.loIn && range.hiIn));

/** Whether `outer` holds every value of `inner`. */
const containsInterval = (outer: Interval, inner: Interval): boolean =>
	(outer.lo < inner.lo || (outer.lo === inner.lo && (outer.loIn || !inner.loIn))) &&
	(outer.hi > inner.hi || (outer.hi === inner.hi && (outer.hiIn || !inner.hiIn)));

function intersect(left: Interval, right: Interval): Interval {
	const lo =
		left.lo > right.lo
			? { lo: left.lo, loIn: left.loIn }
			: right.lo > left.lo
				? { lo: right.lo, loIn: right.loIn }
				: { lo: left.lo, loIn: left.loIn && right.loIn };
	const hi =
		left.hi < right.hi
			? { hi: left.hi, hiIn: left.hiIn }
			: right.hi < left.hi
				? { hi: right.hi, hiIn: right.hiIn }
				: { hi: left.hi, hiIn: left.hiIn && right.hiIn };
	return { ...lo, ...hi };
}

const FLIP: Readonly<Record<string, string>> = {
	'<': '>',
	'<=': '>=',
	'>': '<',
	'>=': '<=',
	'==': '=='
};

function bound(op: string, value: number): Interval | null {
	if (op === '<') return { ...ALL, hi: value, hiIn: false };
	if (op === '<=') return { ...ALL, hi: value, hiIn: true };
	if (op === '>') return { ...ALL, lo: value, loIn: false };
	if (op === '>=') return { ...ALL, lo: value, loIn: true };
	if (op === '==') return { lo: value, loIn: true, hi: value, hiIn: true };
	return null;
}

export type Rung = {
	readonly guards: ReadonlySet<string>;
	readonly guardKey: string;
	readonly intervals: ReadonlyMap<string, Interval>;
	/** The node each subject was first read from, so the caller can judge its unit. */
	readonly subjects: ReadonlyMap<string, Node>;
	/** A conjunct is the literal `false`, or an interval is empty. */
	readonly never: boolean;
};

const conjuncts = (node: Node): readonly Node[] =>
	node.op === '&&' ? children(node).flatMap(conjuncts) : [node];

/** A rung's reading of its `when`; empty is every value. Null where it does not parse. */
export function readRung(expression: string): Rung | null {
	const written = expression.trim();
	if (written === '')
		return {
			guards: new Set(),
			guardKey: '',
			intervals: new Map(),
			subjects: new Map(),
			never: false
		};
	const ast = parse(written);
	if (ast == null) return null;
	const guards = new Set<string>();
	const intervals = new Map<string, Interval>();
	const subjects = new Map<string, Node>();
	let never = false;
	for (const part of conjuncts(ast)) {
		if (part.op === 'value' && Predicate.isBoolean(part.args)) {
			if (!part.args) never = true;
			continue;
		}
		const [left, right] = children(part);
		const constraint =
			left == null || right == null || FLIP[part.op] == null
				? null
				: numberOf(right) != null && numberOf(left) == null
					? { subject: left, range: bound(part.op, numberOf(right)!) }
					: numberOf(left) != null && numberOf(right) == null
						? { subject: right, range: bound(FLIP[part.op]!, numberOf(left)!) }
						: null;
		if (constraint?.range == null) {
			guards.add(textOf(part));
			continue;
		}
		const subject = textOf(constraint.subject);
		if (!subjects.has(subject)) subjects.set(subject, constraint.subject);
		intervals.set(subject, intersect(intervals.get(subject) ?? ALL, constraint.range));
	}
	if ([...intervals.values()].some(isEmpty)) never = true;
	return { guards, guardKey: [...guards].sort().join('\u0000'), intervals, subjects, never };
}

export type LadderFinding = {
	readonly index: number;
	readonly kind: 'unreachable' | 'hole';
	readonly message: string;
};

const show = (value: number) => String(Number(value.toFixed(6)));
const describe = (subject: string, range: Interval) =>
	[
		range.lo === -Infinity ? null : `${subject} ${range.loIn ? '>=' : '>'} ${show(range.lo)}`,
		range.hi === Infinity ? null : `${subject} ${range.hiIn ? '<=' : '<'} ${show(range.hi)}`
	]
		.filter((part) => part != null)
		.join(' and ');

/**
 * Holes between one ladder's rungs, sorted by their lower bound. Only a money subject is judged on
 * the cent grain; any other subject only where one value is excluded by both neighbours.
 */
function holes(
	subject: string,
	money: boolean,
	rungs: readonly { readonly index: number; readonly range: Interval }[]
): LadderFinding[] {
	const out: LadderFinding[] = [];
	const sorted = rungs.toSorted(
		(a, b) => a.range.lo - b.range.lo || (b.range.loIn ? 1 : 0) - (a.range.loIn ? 1 : 0)
	);
	let reach: Interval | null = null;
	for (const { index, range } of sorted) {
		if (reach == null) {
			reach = range;
			continue;
		}
		const touches = range.lo < reach.hi || (range.lo === reach.hi && (reach.hiIn || range.loIn));
		if (!touches) {
			const first = money ? (reach.hiIn ? reach.hi + CENT : reach.hi) : reach.hi;
			const missed =
				range.lo === reach.hi
					? `${subject} = ${show(reach.hi)}`
					: money && first < range.lo - EPSILON
						? `${subject} from ${show(first)} below ${show(range.lo)}`
						: money && Math.abs(first - range.lo) <= EPSILON && !range.loIn
							? `${subject} = ${show(range.lo)} (a one-cent seam: the rung above starts after it)`
							: !money && (!reach.hiIn || !range.loIn)
								? `${subject} between ${show(reach.hi)} and ${show(range.lo)}`
								: null;
			if (missed != null) out.push({ index, kind: 'hole', message: `No rung matches ${missed}.` });
		}
		reach =
			range.hi > reach.hi || (range.hi === reach.hi && range.hiIn)
				? { ...reach, hi: range.hi, hiIn: range.hiIn }
				: reach;
	}
	return out;
}

/**
 * What a first-match ladder's rungs say about themselves: each rung that can never govern, and
 * each hole between rungs of one ladder. `isMoney` judges a subject node's unit.
 */
export function ladderFindings(
	whens: readonly string[],
	isMoney: (subject: Node) => boolean
): LadderFinding[] {
	const rungs = whens.map(readRung);
	const out: LadderFinding[] = [];
	const live: number[] = [];
	for (const [index, rung] of rungs.entries()) {
		if (rung == null) continue;
		if (rung.never) {
			const [subject, range] =
				[...rung.intervals.entries()].find(([, interval]) => isEmpty(interval)) ?? [];
			out.push({
				index,
				kind: 'unreachable',
				message:
					subject == null || range == null
						? 'Its condition can never hold.'
						: `Its condition can never hold: ${describe(subject, range)}.`
			});
			continue;
		}
		const shadow = live.find((earlier) => {
			const prior = rungs[earlier]!;
			if (prior.guards.size > rung.guards.size) return false;
			for (const guard of prior.guards) if (!rung.guards.has(guard)) return false;
			for (const [subject, range] of prior.intervals) {
				const own = rung.intervals.get(subject);
				if (own == null || !containsInterval(range, own)) return false;
			}
			return true;
		});
		if (shadow != null)
			out.push({
				index,
				kind: 'unreachable',
				message: `Rule ${shadow + 1} matches every case it does, and the first match governs.`
			});
		else live.push(index);
	}
	const ladders = new Map<
		string,
		{ index: number; range: Interval; node: Node; subject: string }[]
	>();
	for (const index of live) {
		const rung = rungs[index]!;
		if (rung.intervals.size !== 1) continue;
		const [subject, range] = [...rung.intervals.entries()][0]!;
		const key = `${rung.guardKey}\u0001${subject}`;
		ladders.set(key, [
			...(ladders.get(key) ?? []),
			{ index, range, node: rung.subjects.get(subject)!, subject }
		]);
	}
	for (const ladder of ladders.values())
		if (ladder.length > 1) out.push(...holes(ladder[0]!.subject, isMoney(ladder[0]!.node), ladder));
	return out.toSorted((a, b) => a.index - b.index);
}

/** One band row's bounds; null is unbounded. */
export type BandBounds = {
	readonly code: string;
	readonly from: number | null;
	readonly to: number | null;
};

/**
 * The seams of one band table's rows in force together, per the table's declared inclusivity:
 * `(from, to]` and `[from, to)` rows meet where one's `to` is the next one's `from`; `[from, to]`
 * rows step by at most a cent; `(from, to)` rows always miss the seam value. Overlaps are the
 * seal's (`referenceRowsFault`).
 */
export function bandSeams(
	range: { readonly from_inclusive: boolean; readonly to_inclusive: boolean },
	rows: readonly BandBounds[]
): readonly string[] {
	const out: string[] = [];
	const sorted = rows.toSorted((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity));
	for (const [index, next] of sorted.entries()) {
		const prior = sorted[index - 1];
		if (prior == null || prior.to == null || next.from == null) continue;
		if (next.from < prior.to) continue;
		const seam = `${prior.code} (to ${show(prior.to)}) and ${next.code} (from ${show(next.from)})`;
		if (range.from_inclusive && range.to_inclusive) {
			if (next.from - prior.to > CENT + EPSILON)
				out.push(`${seam}: no band holds the values between them.`);
		} else if (!range.from_inclusive && !range.to_inclusive) {
			out.push(
				next.from === prior.to
					? `${seam}: both bounds exclude ${show(next.from)}, so no band holds it.`
					: `${seam}: no band holds the values between them.`
			);
		} else if (next.from !== prior.to) {
			out.push(
				Math.abs(next.from - prior.to - CENT) <= EPSILON
					? `${seam}: a one-cent seam — ${show(range.from_inclusive ? prior.to : next.from)} matches no band, since one bound of the seam excludes it.`
					: `${seam}: no band holds the values between them.`
			);
		}
	}
	return out;
}

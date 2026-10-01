/**
 * The expression core: stepped rounding, variadic `min`/`max`, and list totals.
 *
 * Every figure these take — the step, the mode, the list — is written in the stored expression;
 * the functions only evaluate it. `round`'s mode must be a literal, which `compile.ts` checks.
 */

import { ROUND_MODES, roundStep, type RoundMode } from '../../payroll/run/rounding.js';
import type { ExpressionFunctionEntry } from './index.js';

const numbers = (list: unknown): number[] => (Array.isArray(list) ? list.map(Number) : []);

const isRoundMode = (mode: string): mode is RoundMode =>
	(ROUND_MODES as readonly string[]).includes(mode);

/** `min(a, b, …)` / `max(a, b, …)` for two to eight arguments: CEL has no variadic overload. */
const VARIADIC_ARITY = [2, 3, 4, 5, 6, 7, 8];
const variadic = (name: 'min' | 'max', pick: (...values: number[]) => number) =>
	VARIADIC_ARITY.map((arity, index): ExpressionFunctionEntry => ({
		signature: `${name}(${Array.from({ length: arity }, () => 'dyn').join(', ')}): double`,
		handler: (_engine, ...values) => pick(...values.map(Number)),
		...(index === 0
			? {
					doc: {
						path: `${name}(a, b, …)`,
						description: `The ${name === 'min' ? 'smallest' : 'largest'} of two to eight values`
					}
				}
			: {})
	}));

export const CORE_FUNCTIONS: readonly ExpressionFunctionEntry[] = [
	{
		signature: 'round(dyn, dyn, string): double',
		handler: (engine, value, step, mode) => {
			const written = String(mode);
			if (!isRoundMode(written))
				throw new Error(`round() mode must be one of ${ROUND_MODES.join(', ')}; got ${written}.`);
			// A caller that rounds a blend once binds `round` (a conversion month's statuses).
			return engine.round != null
				? engine.round(Number(value), { step: Number(step), mode: written })
				: roundStep(Number(value), Number(step), written);
		},
		doc: {
			path: "round(value, step, 'MODE')",
			description:
				'Round to a multiple of step (0.01, 0.05, 1, 10, 100, …). MODE is a literal: HALF_UP (a half away from zero), HALF_EVEN (a half to the even multiple), UP (toward +∞), DOWN (toward −∞) or TRUNCATE (toward zero)'
		}
	},
	...variadic('min', Math.min),
	...variadic('max', Math.max),
	{
		signature: 'sum(list): double',
		handler: (_engine, list) => numbers(list).reduce((total, value) => total + value, 0),
		doc: { path: 'sum(list)', description: 'The total of a list of numbers; 0 for an empty list' }
	},
	{
		signature: 'avg(list): double',
		handler: (_engine, list) => {
			const values = numbers(list);
			return values.length === 0
				? 0
				: values.reduce((total, value) => total + value, 0) / values.length;
		},
		doc: { path: 'avg(list)', description: 'The mean of a list of numbers; 0 for an empty list' }
	},
	{
		signature: 'count(list): double',
		handler: (_engine, list) => (Array.isArray(list) ? list.length : 0),
		doc: { path: 'count(list)', description: 'How many items a list holds' }
	},
	{
		signature: 'max_of(list): double',
		handler: (_engine, list) => {
			const values = numbers(list);
			return values.length === 0 ? 0 : Math.max(...values);
		},
		doc: { path: 'max_of(list)', description: 'The largest number in a list; 0 for an empty list' }
	},
	{
		signature: 'min_of(list): double',
		handler: (_engine, list) => {
			const values = numbers(list);
			return values.length === 0 ? 0 : Math.min(...values);
		},
		doc: { path: 'min_of(list)', description: 'The smallest number in a list; 0 for an empty list' }
	},
	{
		signature: 'list.top(int): list',
		handler: (_engine, list, n) =>
			numbers(list)
				.sort((a, b) => b - a)
				.slice(0, Math.max(0, Number(n))),
		doc: {
			path: 'list.top(n)',
			description:
				'The n largest numbers of a list, largest first — `sum(credits.map(c, c.amount).top(6))`'
		}
	}
];

/**
 * The slot `expressions/evaluate.ts` reads once per evaluation: null outside a `traceLine` scope
 * (`lib/trace/record.ts`), else the observer that evaluates in its place. Its own module, with no
 * imports, so the evaluator depends on nothing the recorder imports.
 */

/** What `run` calls instead of evaluating while a scope is open; `evaluate` is the untraced evaluation. */
export type EvaluationObserver = <E extends object>(
	engine: E,
	expression: string,
	context: object,
	evaluate: (engine: E) => unknown
) => unknown;

let observer: EvaluationObserver | null = null;

export const evaluationObserver = (): EvaluationObserver | null => observer;

/** Install `next`; returns the observer it replaced, which the caller restores. */
export function observeEvaluations(next: EvaluationObserver | null): EvaluationObserver | null {
	const previous = observer;
	observer = next;
	return previous;
}

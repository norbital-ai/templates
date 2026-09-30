/**
 * The function modules every expression environment registers.
 *
 * A module is one file of this directory exporting a list of entries; adding a module is one
 * import and one line in `FUNCTION_MODULES`. `evaluate.ts` registers every entry once, so the
 * write-time compiler and the run evaluate with the same functions; `contexts.ts` lists each
 * documented entry on the Fields panel of the sites it names.
 */

import type { ExpressionSite } from '../contexts.js';
import type { ExpressionEngine } from '../evaluate.js';
import { COMPANY_FUNCTIONS } from './company.js';
import { CORE_FUNCTIONS } from './core.js';
import { HISTORY_FUNCTIONS } from './history.js';
import { SPAN_FUNCTIONS } from './spans.js';
import { TABLE_FUNCTIONS } from './tables.js';

export type ExpressionFunctionEntry = {
	/** A cel-js overload signature: `round(dyn, dyn, string): double`, `map.days(): list`. */
	readonly signature: string;
	/** Called with the engine bound to this evaluation, then the CEL arguments (receiver first). */
	readonly handler: (engine: ExpressionEngine, ...args: unknown[]) => unknown;
	/** The Fields panel entry; carried by one overload of a family. */
	readonly doc?: { readonly path: string; readonly description: string } | undefined;
	/** The sites whose panel lists it; every site where omitted. Every site can call it. */
	readonly sites?: readonly ExpressionSite[] | undefined;
};

export const FUNCTION_MODULES: readonly (readonly ExpressionFunctionEntry[])[] = [
	CORE_FUNCTIONS,
	SPAN_FUNCTIONS,
	TABLE_FUNCTIONS,
	HISTORY_FUNCTIONS,
	COMPANY_FUNCTIONS
];

export const REGISTERED_FUNCTIONS: readonly ExpressionFunctionEntry[] = FUNCTION_MODULES.flat();

import { compileExpression } from '../expressions/compile.js';

/**
 * The entitlement ceiling of one catalogue band: how much, over what window. `BLOCK` refuses an
 * entry past the ceiling; `ALLOW` only reports it. `amount` is money over the entry context.
 */
export type Entitlement = {
	readonly period: 'CALENDAR_YEAR' | 'MONTH' | 'LIFETIME' | 'PER_EVENT';
	readonly on_exceed: 'BLOCK' | 'ALLOW';
	readonly amount: string;
};

export const entitlementFault = (limit: Entitlement): string | undefined =>
	limit.amount === ''
		? 'amount: is required'
		: (compileExpression({ expression: limit.amount, site: 'entry', type: 'money' }) ?? undefined);

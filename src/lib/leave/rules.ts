import type { LeaveSettlement } from '../../datatypes/leave_settlement/+definition.js';
import type { LeaveExitSettlement } from '../../datatypes/leave_exit_settlement/+definition.js';

/**
 * The two rules an entitlement was sealed with, in one line each: the same data the reconciler
 * acts on, so what the row says is what will happen.
 */
const basis = (payBasis: 'ORDINARY_DIV26' | 'MONTHLY_DIV30' | 'DAILY_WAGE'): string =>
	payBasis === 'ORDINARY_DIV26'
		? 'monthly pay ÷ 26'
		: payBasis === 'MONTHLY_DIV30'
			? 'monthly pay ÷ 30'
			: 'daily wage';

export function describeYearEnd(rule: LeaveSettlement): string {
	switch (rule.settlement) {
		case 'FORFEIT':
			return 'At year end: unused days lapse';
		case 'COMMUTE':
			return `At year end: unused days are paid out at ${basis(rule.pay_basis)}`;
		case 'CARRY': {
			const amount =
				rule.limit_days == null ? 'the whole balance' : `up to ${Number(rule.limit_days)} days`;
			const expiry =
				Number(rule.expiry_months) === 0
					? 'never expires'
					: `expires after ${Number(rule.expiry_months)} months`;
			return `At year end: carry ${amount}, ${expiry}`;
		}
	}
}

export function describeExit(rule: LeaveExitSettlement): string {
	if (rule.exit === 'FORFEIT') return 'On exit: unused days lapse';
	return `On exit: paid out at ${basis(rule.pay_basis)}${rule.misconduct_forfeits ? ', forfeited on dismissal for misconduct' : ''}`;
}

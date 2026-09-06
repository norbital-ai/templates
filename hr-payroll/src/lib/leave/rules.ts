import type { LeaveSettlement } from '../../datatypes/leave_settlement/+definition.js';
import type { LeaveExitSettlement } from '../../datatypes/leave_exit_settlement/+definition.js';

/**
 * The two rules an account was compiled with, in one line each, with who decided them — the
 * same data the reconciler acts on, so what the row says is what will happen.
 */
/** The stored source column is an enum the row types widen to `string`; anything but STATUTE is the plan. */
type Source = string;

const by = (source: Source, statute: string | null): string =>
	source === 'STATUTE' ? `statute${statute == null ? '' : ` ${statute}`}` : 'company plan';

const basis = (
	payBasis: LeaveExitSettlement extends infer T
		? T extends { pay_basis: infer B }
			? B
			: never
		: never
): string =>
	payBasis === 'ORDINARY_DIV26'
		? 'monthly pay ÷ 26'
		: payBasis === 'MONTHLY_DIV30'
			? 'monthly pay ÷ 30'
			: 'daily wage';

export function describeYearEnd(
	rule: LeaveSettlement,
	source: Source,
	statute: string | null = null
): string {
	const who = by(source, statute);
	switch (rule.settlement) {
		case 'FORFEIT':
			return `At year end: unused days lapse (${who})`;
		case 'COMMUTE':
			return `At year end: unused days are paid out at ${basis(rule.pay_basis)} (${who})`;
		case 'CARRY': {
			const amount =
				rule.limit_days == null ? 'the whole balance' : `up to ${Number(rule.limit_days)} days`;
			const expiry =
				Number(rule.expiry_months) === 0
					? 'never expires'
					: `expires after ${Number(rule.expiry_months)} months`;
			return `At year end: carry ${amount}, ${expiry} (${who})`;
		}
	}
}

export function describeExit(
	rule: LeaveExitSettlement,
	source: Source,
	statute: string | null = null
): string {
	const who = by(source, statute);
	if (rule.exit === 'FORFEIT') return `On exit: unused days lapse (${who})`;
	return `On exit: paid out at ${basis(rule.pay_basis)}${rule.misconduct_forfeits ? ', forfeited on dismissal for misconduct' : ''} (${who})`;
}

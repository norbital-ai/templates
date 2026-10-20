import { moneyNumber } from '../../payroll_engine/foundation.js';

/** A configured principal and the generated repayments payroll has or has not captured. */
type Loan = {
	readonly id: string;
	readonly principal_amount?: unknown;
	readonly repayments: readonly {
		readonly amount?: unknown;
		readonly activity?: unknown;
		readonly payslip_id?: unknown;
	}[];
};

/** Outstanding principal after payroll-captured repayments; a future scheduled repayment changes no balance. */
export function loanBalances(rows: readonly Loan[]): ReadonlyMap<string, number | null> {
	return new Map(
		rows.map((row) => {
			const principal = moneyNumber(row.principal_amount);
			const recovered = row.repayments.reduce((total, repayment) => {
				if (repayment.payslip_id == null) return total;
				const amount = moneyNumber(repayment.amount) ?? 0;
				return total + (repayment.activity === 'REVERSAL' ? -amount : amount);
			}, 0);
			return [row.id, principal == null ? null : Math.round((principal - recovered) * 100) / 100];
		})
	);
}

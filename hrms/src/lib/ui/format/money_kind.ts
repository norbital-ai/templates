/**
 * How a list shows a stored money total: to the smallest unit its currency has (two decimals for most, none for
 * yen or rupiah). A payslip keeps every decimal its lines made; a list does not show them.
 */
export const moneyKind = (currency: string | null | undefined) =>
	({
		kind: 'decimal',
		scale:
			currency == null
				? 2
				: (new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
						.maximumFractionDigits ?? 2)
	}) as const;

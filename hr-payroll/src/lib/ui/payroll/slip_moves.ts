/** The payslip states a move leaves from: hold a draft, release a held slip, pay a draft or a held one. */
const FROM: { readonly [to: string]: readonly string[] } = {
	ON_HOLD: ['DRAFT'],
	DRAFT: ['ON_HOLD'],
	PAID: ['DRAFT', 'ON_HOLD']
};

/** The selected slips a move applies to: one already in the target state (a paid slip) is skipped, not refused. */
export const movable = <I extends string>(
	to: 'DRAFT' | 'ON_HOLD' | 'PAID',
	selected: readonly I[],
	statusOf: (id: I) => string | undefined
): I[] => selected.filter((id) => FROM[to]!.includes(statusOf(id) ?? ''));

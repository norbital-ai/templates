/**
 * The days a controller owes a decision about time off in lieu.
 *
 * OIL is never issued automatically, and that is the owner's decision, not a limitation: whether a
 * worked public holiday is paid at the premium or banked as a day off is a conversation with the
 * person, and reversing a credit they have already spent is refused. So the system's whole job here
 * is to stop the decision going unnoticed — a rest day somebody worked with `PAY` chosen simply
 * paid overtime and said nothing, and a credit left standing on a day that is no longer a worked
 * premium day sat in the ledger with nothing behind it.
 *
 * This is a derived reading of days that already exist. It writes nothing, and the ledger stays
 * manual: the controller creates or removes the credit themselves, from the day sheet.
 */

/** One work day, as this reading needs it. */
export type OilCandidate = {
	readonly id: string;
	readonly employment_id: string;
	readonly work_date: string;
	/** `PAY` or `LIEU`, as the day sheet recorded the choice. */
	readonly compensation: string;
	/** Whether the person actually worked: any recorded interval at all. */
	readonly worked: boolean;
	/** Whether the day carries a premium — a rest day or a published holiday. */
	readonly premium: boolean;
};

export type OilException = {
	readonly work_day_id: string;
	readonly employment_id: string;
	readonly work_date: string;
	/**
	 * `CREATE`: a premium day was worked and paid, so a lieu day may be owed and nobody has said.
	 * `REMOVE`: a lieu credit stands on a day that is no longer a worked premium day, so the credit
	 * has nothing behind it.
	 */
	readonly action: 'CREATE' | 'REMOVE';
};

/**
 * The exceptions among `days`, in date then employment order so two readings of one month agree.
 *
 * An ordinary day is never an exception whichever way it is marked: `PAY` on an ordinary day is
 * simply the ordinary case, and `LIEU` on one is refused at the write.
 */
export function oilExceptions(days: readonly OilCandidate[]): OilException[] {
	const exceptions: OilException[] = [];
	for (const day of days) {
		const action =
			day.compensation === 'LIEU'
				? !day.worked || !day.premium
					? ('REMOVE' as const)
					: null
				: day.worked && day.premium
					? ('CREATE' as const)
					: null;
		if (action == null) continue;
		exceptions.push({
			work_day_id: day.id,
			employment_id: day.employment_id,
			work_date: day.work_date,
			action
		});
	}
	return exceptions.toSorted(
		(left, right) =>
			left.work_date.localeCompare(right.work_date) ||
			left.employment_id.localeCompare(right.employment_id)
	);
}

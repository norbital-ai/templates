/** A period key as HR reads it: a month, a half-month (`-1`/`-2`), or a day; unknown keys stay verbatim. */
export const periodLabel = (
	period: string,
	halves: { readonly first: string; readonly second: string } = {
		first: 'first half',
		second: 'second half'
	}
): string => {
	const half = /^(\d{4})-(\d{2})-([12])$/.exec(period);
	const month = half ?? /^(\d{4})-(\d{2})$/.exec(period);
	if (month != null) {
		const name = new Date(`${month[1]}-${month[2]}-01T00:00:00Z`).toLocaleDateString(undefined, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
		if (half == null) return name;
		return `${name} · ${half[3] === '1' ? halves.first : halves.second}`;
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(period))
		return new Date(`${period}T00:00:00Z`).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	return period;
};

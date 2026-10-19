/** A join row is named by its two sides, with a visible separator when either is missing. */
export const joinName = (left: string | undefined, right: string | undefined): string =>
	`${left ?? '—'} · ${right ?? '—'}`;

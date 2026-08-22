const DOC_NO_SEQUENCE_WIDTH = 4;

/** The LIKE pattern every document number of a series matches. */
export function docNoSeriesPattern(prefix: string, year: number): string {
	return `${prefix}-${year}-%`;
}

/** The next zero-padded sequence in a yearly document-number series. */
export function nextDocNo(
	existingNumbers: readonly string[],
	prefix: string,
	year: number
): string {
	const seriesPrefix = `${prefix}-${year}-`;
	let highest = 0;
	for (const number of existingNumbers) {
		if (!number.startsWith(seriesPrefix)) continue;
		const sequence = Number.parseInt(number.slice(seriesPrefix.length), 10);
		if (Number.isNaN(sequence)) continue;
		if (sequence > highest) highest = sequence;
	}
	return `${seriesPrefix}${String(highest + 1).padStart(DOC_NO_SEQUENCE_WIDTH, '0')}`;
}

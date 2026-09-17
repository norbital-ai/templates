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

/**
 * Hands out document numbers to one batch, each past the last: a transform that creates several
 * documents in one call numbers them consecutively from what the series already holds.
 */
export function docNoSeries(
	existingNumbers: readonly string[],
	prefix: string,
	year: number
): () => string {
	const issued = [...existingNumbers];
	return () => {
		const number = nextDocNo(issued, prefix, year);
		issued.push(number);
		return number;
	};
}

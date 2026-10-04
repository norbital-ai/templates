/** Mean of enrollment captures, L2-normalized — the stored descriptor. */
export const meanEmbedding = (vectors: ReadonlyArray<readonly number[]>): number[] => {
	const dim = vectors[0]?.length ?? 0;
	const mean = new Array<number>(dim).fill(0);
	for (const vector of vectors) {
		for (let i = 0; i < dim; i += 1) mean[i] = (mean[i] ?? 0) + (vector[i] ?? 0);
	}
	for (let i = 0; i < dim; i += 1) mean[i] = (mean[i] ?? 0) / vectors.length;
	const norm = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0));
	if (norm === 0) return mean;
	return mean.map((value) => value / norm);
};
/** Conservative cosine operating points; validate on the enrolled population and camera. */
export const KIOSK_MATCH_THRESHOLD = 0.25;
export const KIOSK_MATCH_MARGIN = 0.05;
/** Human faceres descriptor width. */
export const KIOSK_EMBEDDING_DIMENSIONS = 1024;

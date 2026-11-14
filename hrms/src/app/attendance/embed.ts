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
/** Cosine distance between two descriptors; `NaN` when either is unusable. */
export const faceDistance = (left: readonly number[], right: readonly number[]): number => {
	if (left.length === 0 || left.length !== right.length) return Number.NaN;
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (const [i, a] of left.entries()) {
		const b = right[i];
		if (b === undefined) return Number.NaN;
		dot += a * b;
		leftNorm += a * a;
		rightNorm += b * b;
	}
	const norm = leftNorm * rightNorm;
	return Number.isFinite(norm) && norm > 0 ? 1 - dot / Math.sqrt(norm) : Number.NaN;
};
/** Conservative cosine operating points; validate on the enrolled population and camera. */
export const KIOSK_MATCH_THRESHOLD = 0.25;

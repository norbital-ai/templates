export function parse(
	bytes: Uint8Array,
	format: 'jpeg' | 'png',
	options?: Parameters<typeof import('exifr').parse>[1]
): Promise<unknown>;

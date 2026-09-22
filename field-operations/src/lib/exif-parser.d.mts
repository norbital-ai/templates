export function parse(
	bytes: Uint8Array,
	format: 'jpeg' | 'png' | 'heic',
	options?: Parameters<typeof import('exifr').parse>[1]
): Promise<unknown>;

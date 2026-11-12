import type { Id } from '@norbital-ai/bolt';
import * as Base64 from 'effect/encoding/Base64';
import { Result } from 'effect';

export const SIGNATURE_BYTES = 128 * 1024;
export const SIGNATURE_BASE64 = 4 * Math.ceil(SIGNATURE_BYTES / 3);
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];

export function signatureUri(signature: string) {
	if (signature.length > SIGNATURE_BASE64) return null;
	const decoded = Base64.decode(signature);
	if (Result.isFailure(decoded)) return null;
	const bytes = decoded.success;
	if (
		bytes.length < 33 ||
		bytes.length > SIGNATURE_BYTES ||
		!png.every((byte, index) => bytes[index] === byte)
	)
		return null;
	const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = header.getUint32(16);
	const height = header.getUint32(20);
	if (width === 0 || height === 0 || width > 2048 || height > 2048) return null;
	let data = false;
	for (let offset = 33; offset + 12 <= bytes.length;) {
		const length = header.getUint32(offset);
		const kind = header.getUint32(offset + 4);
		offset += length + 12;
		if (offset > bytes.length) return null;
		if (kind === 0x49444154 && length > 0) data = true;
		if (kind === 0x49454e44)
			return data && length === 0 && offset === bytes.length
				? `data:image/png;base64,${Base64.encode(bytes)}`
				: null;
	}
	return null;
}

export const contractSignatureRead = (signing: {
	owner: Id<'sys_user'>;
	version: Id<'salesperson_signatures'>;
}) =>
	({
		salesperson_signatures: {
			where: { id: { eq: signing.version }, owner: { eq: signing.owner } },
			fields: ['signature'],
			limit: 1
		}
	}) as const;

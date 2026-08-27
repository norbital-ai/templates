import { parse as parseExif } from 'exifr/src/core.mjs';
import 'exifr/src/file-parsers/jpeg.mjs';
import 'exifr/src/file-parsers/tiff.mjs';
import 'exifr/src/segment-parsers/tiff-exif.mjs';
import 'exifr/src/dicts/tiff-ifd0-keys.mjs';
import 'exifr/src/dicts/tiff-exif-keys.mjs';
import 'exifr/src/dicts/tiff-gps-keys.mjs';
import 'exifr/src/dicts/tiff-revivers.mjs';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_EXIF_CHUNK = 0x65584966;

const uint32 = (bytes, offset) =>
	(bytes[offset] * 0x1_00_00_00 +
		bytes[offset + 1] * 0x1_00_00 +
		bytes[offset + 2] * 0x1_00 +
		bytes[offset + 3]) >>>
	0;

/** Returns the TIFF payload of a PNG eXIf chunk without loading its unrelated compressed ICC data. */
const pngExif = (bytes) => {
	if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return undefined;
	let offset = PNG_SIGNATURE.length;
	while (offset + 12 <= bytes.length) {
		const length = uint32(bytes, offset);
		if (length > bytes.length - offset - 12) return undefined;
		if (uint32(bytes, offset + 4) === PNG_EXIF_CHUNK)
			return bytes.subarray(offset + 8, offset + 8 + length);
		offset += length + 12;
	}
	return undefined;
};

/**
 * The exact static Exifr surface used by photo evidence.
 *
 * Inputs are already bytes, so URL, filesystem and Blob readers do not belong in the guest. PNG
 * eXIf is an uncompressed TIFF payload; extracting it here avoids Exifr's full PNG parser, whose ICC
 * support dynamically loads Node's `zlib` and cannot run in the tenant isolate.
 */
export const parse = (bytes, format, options) => {
	const input = format === 'png' ? pngExif(bytes) : bytes;
	return input === undefined ? Promise.resolve(undefined) : parseExif(input, options);
};

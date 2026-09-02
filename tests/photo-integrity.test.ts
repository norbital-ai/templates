import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { Effect } from 'effect';
import {
	assertPhotoEvidenceProvenanceUnchanged,
	decodePhotoInspection,
	evaluateCaptureGeolocation,
	inspectPhoto
} from '../src/collections/photo_evidence/photo-integrity.js';
import { parse as parseExif } from '../src/lib/exif-parser.mjs';

/** A `file()` value, which is what `photo` holds — the whole file, not a pointer to one. */
const photoFile = (name: string) => ({
	storage_key: `photos/${name}.jpg`,
	file_name: `${name}.jpg`,
	file_size: 1024,
	mime_type: 'image/jpeg'
});

const settledProvenance = {
	job_assignment_id: 'assignment-a',
	variation_request_id: null,
	photo: photoFile('asset-a'),
	source_key: 'whatsapp:conversation:attachment-a',
	source: {
		kind: 'channel',
		provider: 'whatsapp',
		conversation_id: 'conversation',
		attachment_id: 'attachment-a'
	}
};

test('keeps a settled photo, parent, and source immutable', () => {
	assert.doesNotThrow(() =>
		assertPhotoEvidenceProvenanceUnchanged({ job_assignment_id: 'assignment-a' }, settledProvenance)
	);
	for (const change of [
		{ job_assignment_id: 'assignment-b' },
		{ job_assignment_id: null, variation_request_id: 'variation-a' },
		{ photo: photoFile('asset-b') },
		{ source_key: 'workspace:asset-a' },
		{ source: { kind: 'workspace_upload' } }
	]) {
		assert.throws(
			() => assertPhotoEvidenceProvenanceUnchanged(change, settledProvenance),
			/provenance is immutable/
		);
	}
});

// A deterministic 3024x4032 JPEG (solid RGB 80/120/160). Gzip collapses the intentionally uniform
// fixture to a few hundred bytes while jpeg-js still has to exercise the full 12 MP decode envelope.
const canonical12MegapixelJpeg = gunzipSync(
	Buffer.from(
		'H4sIAAAAAAAAA+3NTU7CYBSG0e8D2kIlSkMtWDUQCVqMJOyAgXt0PQxcgEN/duKkwlB04tScM3zz5N72tf0IjyHtJWnSS9MkzbK0n4/yfDDIy9Oz4WhSTqeTsqrq6+WsvlxcVdX8Yb64vVvdry5m68262SybVXM4ErMsy/v5OM/HTV3VzZ+1u1D0z3YnL914EzpF7BaxfQ7nIcbwXbKfy9HxGg5x/D0ufsbvYdiN+zfdImzDU+ezOS4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+q2379gV8f33kHhgBAA==',
		'base64'
	)
);

const writeIfdEntry = (
	view: DataView,
	offset: number,
	tag: number,
	type: number,
	count: number,
	value: number
) => {
	view.setUint16(offset, tag, true);
	view.setUint16(offset + 2, type, true);
	view.setUint32(offset + 4, count, true);
	view.setUint32(offset + 8, value, true);
};

const writeAscii = (bytes: Uint8Array, offset: number, value: string) => {
	bytes.set(new TextEncoder().encode(`${value}\0`), offset);
};

const exifTiff = (latitudeRef: 'N' | 'S', longitudeRef: 'E' | 'W') => {
	const bytes = new Uint8Array(232);
	const view = new DataView(bytes.buffer);
	const ifd0 = 8;
	const software = 50;
	const exif = 60;
	const originalDate = 90;
	const createDate = 110;
	const gps = 130;
	const latitude = 184;
	const longitude = 208;

	bytes.set([0x49, 0x49], 0);
	view.setUint16(2, 42, true);
	view.setUint32(4, ifd0, true);
	view.setUint16(ifd0, 3, true);
	writeIfdEntry(view, ifd0 + 2, 0x0131, 2, 9, software);
	writeIfdEntry(view, ifd0 + 14, 0x8769, 4, 1, exif);
	writeIfdEntry(view, ifd0 + 26, 0x8825, 4, 1, gps);
	writeAscii(bytes, software, 'FieldCam');

	view.setUint16(exif, 2, true);
	writeIfdEntry(view, exif + 2, 0x9003, 2, 20, originalDate);
	writeIfdEntry(view, exif + 14, 0x9004, 2, 20, createDate);
	writeAscii(bytes, originalDate, '2026:08:27 01:02:03');
	writeAscii(bytes, createDate, '2026:08:27 01:02:04');

	view.setUint16(gps, 4, true);
	writeIfdEntry(view, gps + 2, 0x0001, 2, 2, latitudeRef.charCodeAt(0));
	writeIfdEntry(view, gps + 14, 0x0002, 5, 3, latitude);
	writeIfdEntry(view, gps + 26, 0x0003, 2, 2, longitudeRef.charCodeAt(0));
	writeIfdEntry(view, gps + 38, 0x0004, 5, 3, longitude);
	for (const [offset, values] of [
		[latitude, [1, 21, 0]],
		[longitude, [103, 49, 0]]
	] as const) {
		values.forEach((value, index) => {
			view.setUint32(offset + index * 8, value, true);
			view.setUint32(offset + index * 8 + 4, 1, true);
		});
	}
	return bytes;
};

const jpegWithExif = (tiff: Uint8Array) => {
	const bytes = new Uint8Array(tiff.length + 14);
	const segmentLength = tiff.length + 8;
	bytes.set([0xff, 0xd8, 0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff], 0);
	bytes.set(new TextEncoder().encode('Exif\0\0'), 6);
	bytes.set(tiff, 12);
	bytes.set([0xff, 0xd9], bytes.length - 2);
	return bytes;
};

const pngWithExif = (tiff: Uint8Array) => {
	const bytes = new Uint8Array(tiff.length + 32);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	new DataView(bytes.buffer).setUint32(8, tiff.length);
	bytes.set(new TextEncoder().encode('eXIf'), 12);
	bytes.set(tiff, 16);
	const iend = 20 + tiff.length;
	bytes.set(new TextEncoder().encode('IEND'), iend + 4);
	return bytes;
};

const exifOptions = {
	ifd0: { pick: ['Software'] },
	exif: { pick: ['DateTimeOriginal', 'CreateDate'] },
	gps: { pick: ['GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude'] }
};

test('uses one static byte-only EXIF graph for signed JPEG and PNG facts', async () => {
	const [northEast, southWest] = await Promise.all([
		parseExif(jpegWithExif(exifTiff('N', 'E')), 'jpeg', exifOptions),
		parseExif(pngWithExif(exifTiff('S', 'W')), 'png', exifOptions)
	]);
	for (const [facts, sign] of [
		[northEast, 1],
		[southWest, -1]
	] as const) {
		assert.ok(facts != null && typeof facts === 'object');
		assert.equal(Reflect.get(facts, 'Software'), 'FieldCam');
		assert.ok(Reflect.get(facts, 'DateTimeOriginal') instanceof Date);
		assert.equal(Reflect.get(facts, 'latitude'), sign * 1.35);
		assert.equal(Reflect.get(facts, 'longitude'), sign * (103 + 49 / 60));
	}
});

test('inspects the canonical 12 MP phone-photo envelope deterministically', async () => {
	const inspection = await Effect.runPromise(
		inspectPhoto({
			bytes: canonical12MegapixelJpeg,
			mimeType: 'image/jpeg'
		})
	);

	assert.deepEqual(
		{
			sha256: inspection.sha256,
			perceptualHash: inspection.perceptualHash,
			width: inspection.width,
			height: inspection.height,
			flags: inspection.flags
		},
		{
			sha256: 'fd41dba0ff371735328979ec3b80992623b513173986e79c18b6323861e229d4',
			perceptualHash: '13a0113411341134000082001134000011341134554b2c4b2c4b11342c4b0000',
			width: 3024,
			height: 4032,
			flags: ['low_quality']
		}
	);
});

test('accepts only the immutable fact shape supplied by the host inspection cache', () => {
	assert.deepEqual(
		decodePhotoInspection({
			sha256: 'a'.repeat(64),
			perceptualHash: 'b'.repeat(64),
			width: 1440,
			height: 1920,
			captureLocation: null,
			flags: []
		}),
		{
			sha256: 'a'.repeat(64),
			perceptualHash: 'b'.repeat(64),
			width: 1440,
			height: 1920,
			captureLocation: null,
			flags: []
		}
	);
	assert.throws(() =>
		decodePhotoInspection({
			sha256: 'not-a-digest',
			perceptualHash: 'b'.repeat(64),
			width: 0,
			height: 1920,
			captureLocation: null,
			flags: ['invented-policy']
		})
	);
});

test('records missing and contradictory GPS as evidence without inventing a verdict', () => {
	assert.deepEqual(evaluateCaptureGeolocation(null, { lat: 1.3, lon: 103.8 }), [
		'missing_geolocation'
	]);
	assert.deepEqual(
		evaluateCaptureGeolocation({ lat: 1.3521, lon: 103.8198 }, { lat: 1.3001, lon: 103.8001 }),
		['location_mismatch']
	);
});

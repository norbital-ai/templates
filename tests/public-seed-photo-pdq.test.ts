import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode as decodeJpeg } from 'jpeg-js';
import { Effect } from 'effect';
import { hashPdq, pdqHashToHex } from '../src/collections/photo_evidence/pdq.js';

const PUBLIC_SEED_ASSETS = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/seed/assets');

const PHOTO_A = 'pub-photo-a.jpg';
const PHOTO_B = 'pub-photo-b.jpg';

/** Stable Meta PDQ hex of the committed 64×64 public-seed pair (invented; not bank filenames). */
const EXPECTED_PDQ_HEX_A = '585e8200554b2c4b13a00000113400002c4b00005e011134113411342c4b1134';
const EXPECTED_PDQ_HEX_B = '466c191b133911338200ce646644b1116644666411936644391b6e4c466c1133';
const EXPECTED_HAMMING_DISTANCE = 120;

const DESCRIPTOR_PAYLOAD_MAX_BYTES = 1024 * 1024;

type PhotoDescriptor = {
	readonly storage_key: string;
	readonly file_name: string;
	readonly mime_type: string;
	readonly file_size: number;
};

function popcountByte(byte: number): number {
	let bits = byte;
	let count = 0;
	while (bits > 0) {
		count += bits & 1;
		bits >>>= 1;
	}
	return count;
}

function hammingDistance(left: Uint8Array, right: Uint8Array): number {
	if (left.length !== right.length) {
		throw new Error(`PDQ hash length mismatch: ${left.length} vs ${right.length}`);
	}
	let distance = 0;
	for (let i = 0; i < left.length; i++) {
		distance += popcountByte(left[i] ^ right[i]);
	}
	return distance;
}

function decodePublicJpegRgb(bytes: Uint8Array) {
	const decoded = decodeJpeg(bytes, {
		useTArray: true,
		formatAsRGBA: false
	});
	const data = decoded.data instanceof Uint8Array ? decoded.data : new Uint8Array(decoded.data);
	return {
		data,
		width: decoded.width,
		height: decoded.height,
		channels: 3 as const
	};
}

async function hashPublicJpeg(fileName: string) {
	const bytes = new Uint8Array(readFileSync(join(PUBLIC_SEED_ASSETS, fileName)));
	const image = decodePublicJpegRgb(bytes);
	const pdq = await Effect.runPromise(hashPdq(image));
	return {
		bytes,
		hash: pdq.hash,
		hex: pdqHashToHex(pdq.hash)
	};
}

function descriptorFor(fileName: string, fileSize: number): PhotoDescriptor {
	return {
		storage_key: `public-seed/${fileName}`,
		file_name: fileName,
		mime_type: 'image/jpeg',
		file_size: fileSize
	};
}

/**
 * T16: public-seed JPEGs exist with a known PDQ Hamming distance.
 * B8 closable half: descriptor-only pair JSON stays under 1 MiB. Live inference stays parked.
 */
test('public seed JPEGs hash to a known PDQ pair and descriptor JSON stays under 1 MiB', async () => {
	const photoA = await hashPublicJpeg(PHOTO_A);
	const photoB = await hashPublicJpeg(PHOTO_B);

	assert.equal(photoA.hex.length, 64);
	assert.equal(photoB.hex.length, 64);
	assert.match(photoA.hex, /^[0-9a-f]{64}$/);
	assert.match(photoB.hex, /^[0-9a-f]{64}$/);
	assert.equal(photoA.hex, EXPECTED_PDQ_HEX_A);
	assert.equal(photoB.hex, EXPECTED_PDQ_HEX_B);
	assert.equal(hammingDistance(photoA.hash, photoB.hash), EXPECTED_HAMMING_DISTANCE);

	const pair: readonly PhotoDescriptor[] = [
		descriptorFor(PHOTO_A, photoA.bytes.byteLength),
		descriptorFor(PHOTO_B, photoB.bytes.byteLength)
	];
	const payload = JSON.stringify(pair);
	for (const descriptor of pair) {
		assert.equal(typeof descriptor.storage_key, 'string');
		assert.equal(typeof descriptor.file_name, 'string');
		assert.equal(typeof descriptor.mime_type, 'string');
		assert.equal(typeof descriptor.file_size, 'number');
		assert.equal('bytes' in descriptor, false);
		assert.equal(descriptor.storage_key.startsWith('data:'), false);
	}
	assert.doesNotMatch(payload, /base64|data:/);
	assert.ok(new TextEncoder().encode(payload).byteLength < DESCRIPTOR_PAYLOAD_MAX_BYTES);
});

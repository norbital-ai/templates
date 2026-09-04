import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';
import { Effect } from 'effect';
import {
	asRecord,
	mutationPush,
	pageOf,
	postGuestCommand,
	recordedAi,
	requireAccepted,
	requireOk,
	rowsOf,
	type RecordedGenerated
} from '@norbital-ai/test-utilities';
import { hashPdq, pdqHashToHex } from '../src/collections/photo_evidence/pdq.js';
import { PUBLIC_ASSIGNMENT_ID, bootPublicSeedGuest } from './helpers/public-seed-guest.js';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 120_000;
const MUTATE_COMMAND = 'collections.mutate';
const START_COMMAND = 'automations.start';
const SUSPICION_AUTOMATION = 'review_job_assignment_suspicion';

const REFERENCE_ASSIGNMENT_ID = '01990000-0000-7000-8005-000000000002';
const AMBER_QUAY_SITE_ID = '01990000-0000-7000-8003-000000000001';

const REFERENCE_PHOTO_ID = '01990000-0000-7000-8005-000000000401';
const SUSPECT_PHOTO_ID = '01990000-0000-7000-8005-000000000402';
const REFERENCE_STORAGE_KEY = 'public-seed/ref.jpg';
const SUSPECT_STORAGE_KEY = 'public-seed/suspect.jpg';

const JPEG_WIDTH = 640;
const JPEG_HEIGHT = 480;
const VISUAL_DUPLICATE_MAX_HAMMING = 31;

const sessionHeaders = (credential: string): Readonly<Record<string, string>> => ({
	authorization: `Bearer ${credential}`
});

const sessionFindMany = async (
	baseUrl: string,
	credential: string,
	input: Record<string, unknown>
): Promise<unknown> =>
	requireOk(
		await postGuestCommand(baseUrl, 'collections.findMany', input, sessionHeaders(credential)),
		'collections.findMany'
	);

const recordedEmptyPhotoClear: RecordedGenerated = {
	_tag: 'Generated',
	result: {
		_tag: 'Object',
		value: {
			job_site_review: {
				suspicious: false,
				reason: 'The evidence does not justify a suspicion.',
				evidence_asset_name: ''
			},
			similar_photo_reviews: []
		}
	},
	observation: {
		callId: 'call-1',
		provider: 'fixture',
		model: 'provider/model',
		operation: 'language',
		charge: { currency: 'USD', coefficient: '125', scale: 6 },
		chargeSource: 'provider'
	}
};

const SUSPICION_AI_TRANSCRIPT_LENGTH = 8;

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

const exifTiff = (latitudeRef: 'N' | 'S', longitudeRef: 'E' | 'W', captureDate: string) => {
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
	writeAscii(bytes, originalDate, captureDate);
	writeAscii(bytes, createDate, captureDate);

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

const mergeExifIntoJpeg = (jpegBytes: Uint8Array, tiff: Uint8Array): Uint8Array => {
	assert.equal(jpegBytes[0], 0xff);
	assert.equal(jpegBytes[1], 0xd8);
	const segmentLength = tiff.length + 8;
	const app1 = new Uint8Array(segmentLength + 2);
	app1[0] = 0xff;
	app1[1] = 0xe1;
	app1[2] = (segmentLength >> 8) & 0xff;
	app1[3] = segmentLength & 0xff;
	app1.set(new TextEncoder().encode('Exif\0\0'), 4);
	app1.set(tiff, 10);
	const merged = new Uint8Array(jpegBytes.length + app1.length);
	merged.set(jpegBytes.subarray(0, 2), 0);
	merged.set(app1, 2);
	merged.set(jpegBytes.subarray(2), 2 + app1.length);
	return merged;
};

const solidRgbJpegPair = (
	width: number,
	height: number
): { readonly reference: Uint8Array; readonly suspectBase: Uint8Array } => {
	const data = new Uint8Array(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = (y * width + x) * 3;
			data[index] = 80 + (x % 64);
			data[index + 1] = 120 + (y % 64);
			data[index + 2] = 160;
		}
	}
	const referenceData = Uint8Array.from(data);
	const suspectData = Uint8Array.from(data);
	suspectData[0] ^= 0x01;
	return {
		reference: encodeJpeg({ data: referenceData, width, height }, 90).data,
		suspectBase: encodeJpeg({ data: suspectData, width, height }, 90).data
	};
};

const popcountByte = (byte: number): number => {
	let bits = byte;
	let count = 0;
	while (bits > 0) {
		count += bits & 1;
		bits >>>= 1;
	}
	return count;
};

const hammingDistance = (left: Uint8Array, right: Uint8Array): number => {
	assert.equal(left.length, right.length);
	let distance = 0;
	for (let index = 0; index < left.length; index++) {
		distance += popcountByte(left[index] ^ right[index]);
	}
	return distance;
};

const hashJpegRgb = async (bytes: Uint8Array) => {
	const image = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: false });
	const data = image.data instanceof Uint8Array ? image.data : new Uint8Array(image.data);
	const pdq = await Effect.runPromise(
		hashPdq({
			data,
			width: image.width,
			height: image.height,
			channels: 3
		})
	);
	return { hash: pdq.hash, hex: pdqHashToHex(pdq.hash) };
};

const photoDescriptor = (
	storageKey: string,
	fileName: string,
	fileSize: number
): {
	readonly storage_key: string;
	readonly file_name: string;
	readonly mime_type: string;
	readonly file_size: number;
} => ({
	storage_key: storageKey,
	file_name: fileName,
	mime_type: 'image/jpeg',
	file_size: fileSize
});

const pushMutation = async (
	baseUrl: string,
	credential: string,
	schemaFingerprint: string,
	graph: Readonly<Record<string, unknown>>,
	baseVersions: ReadonlyArray<Readonly<Record<string, unknown>>> = [],
	label = 'collections.mutate'
): Promise<void> => {
	const mutated = await postGuestCommand(
		baseUrl,
		MUTATE_COMMAND,
		mutationPush(schemaFingerprint, graph, baseVersions),
		sessionHeaders(credential)
	);
	assert.ok(
		mutated.status >= 200 && mutated.status < 300,
		`${label} returned ${mutated.status}: ${JSON.stringify(mutated.value)}`
	);
	requireAccepted(mutated.value, label);
};

const writeAsset = async (
	rootDirectory: string,
	storageKey: string,
	bytes: Uint8Array
): Promise<void> => {
	const absolutePath = join(rootDirectory, storageKey);
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, bytes);
};

const amberQuayLocation = {
	type: 'Point' as const,
	srid: 4326,
	formatted_address: 'Amber Quay',
	geometry: { lat: 1.3001, lon: 103.8001 }
};

/**
 * P2: near-duplicate photo with wrong capture date and off-site GPS yields three integrity flags,
 * then `review_job_assignment_suspicion` stamps `suspicion_checked_at`.
 */
test(
	'public seed suspicion flags metadata, location, and visual duplicate then runs review',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-public-seed-suspicion',
			releaseId: 'field-ops-public-seed-suspicion',
			gatewaySecret: 'field-ops-public-seed-suspicion-gateway',
			founderEmail: 'field-ops-suspicion-founder@example.test',
			founderClaimId: 'field-ops-public-seed-suspicion-founder',
			secretsKey: 'field-ops-public-seed-suspicion-secrets-key',
			invocationTimeoutMillis: 90_000,
			files: true,
			ai: recordedAi(
				Array.from({ length: SUSPICION_AI_TRANSCRIPT_LENGTH }, () => recordedEmptyPhotoClear)
			)
		});
		try {
			if (guest.files === undefined) {
				throw new Error('bootPublicSeedGuest must return files when files: true');
			}

			const siteListed = pageOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'sites',
					where: { id: { eq: AMBER_QUAY_SITE_ID } },
					limit: 1,
					columns: { id: true, row_version: true, location: true }
				}),
				'amber quay site'
			);
			assert.equal(siteListed.rows.length, 1);
			const siteRow = siteListed.rows[0];
			assert.ok(siteRow !== undefined);
			const siteRowVersion = Number(siteRow.row_version);
			assert.ok(Number.isFinite(siteRowVersion) && siteRowVersion > 0);

			await pushMutation(
				guest.baseUrl,
				guest.credential,
				guest.schemaFingerprint,
				{
					action: 'mutate',
					collection: 'sites',
					rows: [
						{ action: 'update', values: { id: AMBER_QUAY_SITE_ID, location: amberQuayLocation } }
					]
				},
				[
					{ row: { collection: 'sites', recordId: AMBER_QUAY_SITE_ID }, rowVersion: siteRowVersion }
				],
				'update amber quay site location'
			);

			const { reference: referenceJpeg, suspectBase: suspectBaseJpeg } = solidRgbJpegPair(
				JPEG_WIDTH,
				JPEG_HEIGHT
			);

			const referenceHash = await hashJpegRgb(referenceJpeg);
			const suspectBaseHash = await hashJpegRgb(suspectBaseJpeg);
			const pdqHamming = hammingDistance(referenceHash.hash, suspectBaseHash.hash);
			assert.ok(
				pdqHamming <= VISUAL_DUPLICATE_MAX_HAMMING,
				`near-duplicate PDQ Hamming ${pdqHamming} exceeds ${VISUAL_DUPLICATE_MAX_HAMMING}`
			);

			const suspectTiff = exifTiff('N', 'E', '2099:01:01 00:00:00');
			const suspectJpeg = mergeExifIntoJpeg(suspectBaseJpeg, suspectTiff);

			await writeAsset(guest.files.rootDirectory, REFERENCE_STORAGE_KEY, referenceJpeg);
			await writeAsset(guest.files.rootDirectory, SUSPECT_STORAGE_KEY, suspectJpeg);
			await access(join(guest.files.rootDirectory, REFERENCE_STORAGE_KEY));
			await access(join(guest.files.rootDirectory, SUSPECT_STORAGE_KEY));

			await pushMutation(
				guest.baseUrl,
				guest.credential,
				guest.schemaFingerprint,
				{
					action: 'mutate',
					collection: 'photo_evidence',
					rows: [
						{
							action: 'create',
							values: {
								id: REFERENCE_PHOTO_ID,
								job_assignment_id: REFERENCE_ASSIGNMENT_ID,
								photo: photoDescriptor(REFERENCE_STORAGE_KEY, 'ref.jpg', referenceJpeg.byteLength)
							}
						}
					]
				},
				[],
				'create reference photo_evidence'
			);

			await pushMutation(
				guest.baseUrl,
				guest.credential,
				guest.schemaFingerprint,
				{
					action: 'mutate',
					collection: 'photo_evidence',
					rows: [
						{
							action: 'create',
							values: {
								id: SUSPECT_PHOTO_ID,
								job_assignment_id: PUBLIC_ASSIGNMENT_ID,
								photo: photoDescriptor(SUSPECT_STORAGE_KEY, 'suspect.jpg', suspectJpeg.byteLength)
							}
						}
					]
				},
				[],
				'create suspect photo_evidence'
			);

			const evidenceRows = rowsOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'photo_evidence',
					where: { job_assignment_id: { eq: PUBLIC_ASSIGNMENT_ID } },
					limit: 10,
					columns: {
						id: true,
						flags: true,
						sha256: true,
						matched_evidence_ids: true
					}
				}),
				'suspect photo_evidence'
			);
			assert.equal(evidenceRows.length, 1, JSON.stringify(evidenceRows));
			const suspectEvidence = evidenceRows[0];
			assert.ok(suspectEvidence !== undefined);
			const flags = suspectEvidence.flags;
			assert.ok(Array.isArray(flags), JSON.stringify(flags));
			const flagSet = new Set(flags.filter((flag): flag is string => typeof flag === 'string'));
			assert.ok(flagSet.has('metadata_anomaly'), `flags: ${JSON.stringify([...flagSet])}`);
			assert.ok(flagSet.has('location_mismatch'), `flags: ${JSON.stringify([...flagSet])}`);
			assert.ok(flagSet.has('visual_duplicate'), `flags: ${JSON.stringify([...flagSet])}`);

			const started = await postGuestCommand(
				guest.baseUrl,
				START_COMMAND,
				{
					name: SUSPICION_AUTOMATION,
					input: { assignment_id: PUBLIC_ASSIGNMENT_ID }
				},
				sessionHeaders(guest.credential)
			);
			assert.ok(
				started.status >= 200 && started.status < 300,
				`${START_COMMAND} HTTP ${started.status}: ${JSON.stringify(started.value)}`
			);
			const startedRecord = asRecord(started.value, START_COMMAND);
			assert.equal(typeof startedRecord.taskId, 'string');
			assert.ok(String(startedRecord.taskId).length > 0);

			const reloaded = rowsOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'job_assignments',
					where: { id: { eq: PUBLIC_ASSIGNMENT_ID } },
					limit: 1,
					columns: { id: true, suspicion_checked_at: true }
				}),
				'assignment after suspicion review'
			);
			assert.equal(reloaded.length, 1);
			const assignment = reloaded[0];
			assert.ok(assignment !== undefined);
			assert.equal(typeof assignment.suspicion_checked_at, 'string');
			assert.ok(String(assignment.suspicion_checked_at).length > 0);
		} finally {
			await guest.stop();
		}
	}
);

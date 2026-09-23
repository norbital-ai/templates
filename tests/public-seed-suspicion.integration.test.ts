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
	recordedSubmission,
	requireAccepted,
	requireOk,
	rowsOf,
	type RecordedGenerated
} from '@norbital-ai/test-utilities';
import { hashPdq, digestToHex } from '../src/collections/photo_evidence/pdq.js';
import { PUBLIC_ASSIGNMENT_ID, bootPublicSeedGuest } from './helpers/public-seed-guest.js';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 120_000;
const WRITE_COMMAND = 'collections.write';
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

const recordedEmptyPhotoClear: RecordedGenerated = recordedSubmission(
	{
		job_site_review: {
			suspicious: false,
			reason: 'The evidence does not justify a suspicion.',
			evidence_asset_name: ''
		},
		similar_photo_reviews: []
	},
	{
		callId: 'call-1',
		provider: 'fixture',
		model: 'provider/model',
		operation: 'language',
		charge: { currency: 'USD', coefficient: '125', scale: 6 },
		chargeSource: 'provider'
	}
);

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
	return { hash: pdq.hash, hex: digestToHex(pdq.hash) };
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
	label = 'collections.write'
): Promise<void> => {
	const mutated = await postGuestCommand(
		baseUrl,
		WRITE_COMMAND,
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
 * P2: a near-duplicate photo with the wrong capture date and off-site GPS is filed uninspected;
 * the suspicion review's opening pass writes its three integrity flags, then the review judges the
 * assignment and stamps `suspicion_checked_at`.
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
					collection: 'sites',
					action: 'update',
					inputs: [{ id: AMBER_QUAY_SITE_ID, location: amberQuayLocation }]
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
					collection: 'photo_evidence',
					action: 'create',
					inputs: [
						{
							id: REFERENCE_PHOTO_ID,
							job_assignment_id: REFERENCE_ASSIGNMENT_ID,
							photo: photoDescriptor(REFERENCE_STORAGE_KEY, 'ref.jpg', referenceJpeg.byteLength)
						}
					]
				},
				[],
				'create reference photo_evidence'
			);
			// A run inspects one photo, so the reference is inspected on its own run first.
			const referenceRun = await postGuestCommand(
				guest.baseUrl,
				START_COMMAND,
				{ name: SUSPICION_AUTOMATION, input: { assignment_id: PUBLIC_ASSIGNMENT_ID } },
				sessionHeaders(guest.credential)
			);
			assert.ok(
				referenceRun.status >= 200 && referenceRun.status < 300,
				JSON.stringify(referenceRun.value)
			);

			await pushMutation(
				guest.baseUrl,
				guest.credential,
				guest.schemaFingerprint,
				{
					collection: 'photo_evidence',
					action: 'create',
					inputs: [
						{
							id: SUSPECT_PHOTO_ID,
							job_assignment_id: PUBLIC_ASSIGNMENT_ID,
							photo: photoDescriptor(SUSPECT_STORAGE_KEY, 'suspect.jpg', suspectJpeg.byteLength)
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
			const filed = evidenceRows[0];
			assert.ok(filed !== undefined);
			// A filed photo is born uninspected: the facts need the bytes, which no write can read.
			assert.equal(filed.sha256, '', 'a filed photo is born uninspected');
			assert.deepEqual(filed.flags, [], 'no facts before the run');

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

			// The run's opening pass inspected the photo: hash, flags and the duplicate match it made.
			const inspectedRows = rowsOf(
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
				'suspect photo_evidence after review'
			);
			assert.equal(inspectedRows.length, 1, JSON.stringify(inspectedRows));
			const suspectEvidence = inspectedRows[0];
			assert.ok(suspectEvidence !== undefined);
			assert.equal(typeof suspectEvidence.sha256, 'string');
			assert.ok(String(suspectEvidence.sha256).length > 0, 'the review wrote the hash');
			const flags = suspectEvidence.flags;
			assert.ok(Array.isArray(flags), JSON.stringify(flags));
			const flagSet = new Set(flags.filter((flag): flag is string => typeof flag === 'string'));
			assert.ok(flagSet.has('metadata_anomaly'), `flags: ${JSON.stringify([...flagSet])}`);
			assert.ok(flagSet.has('location_mismatch'), `flags: ${JSON.stringify([...flagSet])}`);
			assert.ok(flagSet.has('visual_duplicate'), `flags: ${JSON.stringify([...flagSet])}`);

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

/**
 * The log itself.
 *
 * P2 above proves the automation runs and stamps the assignment; it stubs a *clear* judgement, so
 * `suspicious_activity_logs` — the row the whole automation exists to write, and the only thing a
 * controller ever acts on — stays empty and unexamined. Nothing else in this workspace asserts
 * that row lands in the database. The judgement here is affirmative and cites the asset actually
 * supplied to the model, because a citation the prompt never carried is rejected as invented and
 * collapses back to "not suspicious" (`tests/suspicion-review.test.ts`).
 */
const recordedPhotoSuspicious = (assetName: string): RecordedGenerated =>
	recordedSubmission(
		{
			job_site_review: {
				suspicious: true,
				reason: 'The photo shows an empty bay while the summary reports completed works.',
				evidence_asset_name: assetName
			},
			similar_photo_reviews: []
		},
		{
			callId: 'call-suspicious',
			provider: 'fixture',
			model: 'provider/model',
			operation: 'language',
			charge: { currency: 'USD', coefficient: '125', scale: 6 },
			chargeSource: 'provider'
		}
	);

const LOG_PHOTO_ID = '01990000-0000-7000-8005-000000000403';
const LOG_STORAGE_KEY = 'public-seed/flagged.jpg';
const LOG_ASSET_NAME = 'flagged.jpg';

test(
	'an affirmative review writes one suspicious activity log, and a second run writes no other',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-suspicion-log',
			releaseId: 'field-ops-suspicion-log',
			gatewaySecret: 'field-ops-suspicion-log-gateway',
			founderEmail: 'field-ops-suspicion-log@example.test',
			founderClaimId: 'field-ops-suspicion-log-founder',
			secretsKey: 'field-ops-suspicion-log-secrets-key',
			invocationTimeoutMillis: 90_000,
			files: true,
			ai: recordedAi(
				Array.from({ length: SUSPICION_AI_TRANSCRIPT_LENGTH * 2 }, () =>
					recordedPhotoSuspicious(LOG_ASSET_NAME)
				)
			)
		});
		try {
			if (guest.files === undefined) {
				throw new Error('bootPublicSeedGuest must return files when files: true');
			}
			const { reference: photoJpeg } = solidRgbJpegPair(JPEG_WIDTH, JPEG_HEIGHT);
			await writeAsset(guest.files.rootDirectory, LOG_STORAGE_KEY, photoJpeg);
			await pushMutation(
				guest.baseUrl,
				guest.credential,
				guest.schemaFingerprint,
				{
					collection: 'photo_evidence',
					action: 'create',
					inputs: [
						{
							id: LOG_PHOTO_ID,
							job_assignment_id: PUBLIC_ASSIGNMENT_ID,
							photo: photoDescriptor(LOG_STORAGE_KEY, LOG_ASSET_NAME, photoJpeg.byteLength)
						}
					]
				},
				[],
				'create flagged photo_evidence'
			);

			const runReview = async (label: string): Promise<void> => {
				const started = await postGuestCommand(
					guest.baseUrl,
					START_COMMAND,
					{ name: SUSPICION_AUTOMATION, input: { assignment_id: PUBLIC_ASSIGNMENT_ID } },
					sessionHeaders(guest.credential)
				);
				assert.ok(
					started.status >= 200 && started.status < 300,
					`${label}: ${START_COMMAND} HTTP ${started.status}: ${JSON.stringify(started.value)}`
				);
			};

			await runReview('first review');
			const logs = rowsOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'suspicious_activity_logs',
					where: { job_assignment_id: { eq: PUBLIC_ASSIGNMENT_ID } },
					limit: 10,
					columns: { id: true, origin: true, reason: true, review_id: true, resolved_at: true }
				}),
				'suspicious activity logs'
			);
			assert.equal(logs.length, 1, `expected exactly one log, got ${JSON.stringify(logs)}`);
			const log = logs[0];
			assert.ok(log !== undefined);
			assert.equal(log.origin, 'automation', 'the automation is recorded as the log author');
			assert.equal(typeof log.review_id, 'string');
			assert.ok(String(log.review_id).length > 0, 'the log names the review it stands on');
			assert.equal(log.resolved_at, null, 'a new log is open');
			assert.match(String(log.reason), /empty bay/);

			// The schedule runs hourly. A second pass over the same assignment must find the standing
			// log rather than open a second one.
			await runReview('second review');
			const after = rowsOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'suspicious_activity_logs',
					where: { job_assignment_id: { eq: PUBLIC_ASSIGNMENT_ID } },
					limit: 10,
					columns: { id: true }
				}),
				'suspicious activity logs after a second review'
			);
			assert.equal(after.length, 1, `a second run opened another log: ${JSON.stringify(after)}`);
		} finally {
			await guest.stop();
		}
	}
);

/**
 * Who sees a log, and what makes a reviewed assignment unread again.
 *
 * The log above is read back by the founder, an administrator, which proves nothing about the
 * policies. Here the seeded people read it under their own team's policy: a controller sees the
 * log and the review it stands on; the contractor who holds the assignment sees neither. Then the
 * contractor's own report on the assignment clears its review stamp, and the next run judges it
 * afresh — which is how new evidence reaches the review.
 */
const ADA_QUILL_CONTROLLER = 'ada.quill@example.test';
const BEN_VOSS_CONTRACTOR = 'ben.voss@example.test';
const VISIBILITY_PHOTO_ID = '01990000-0000-7000-8005-000000000404';

test(
	'a suspicion log is visible to controllers only, and a change makes the assignment unread',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const guest = await bootPublicSeedGuest({
			// Seeded people can only be signed in inside the tenant their rows name.
			tenantId: 'field-ops-public-seed',
			releaseId: 'field-ops-suspicion-visibility',
			gatewaySecret: 'field-ops-suspicion-visibility-gateway',
			founderEmail: 'field-ops-suspicion-visibility@example.test',
			founderClaimId: 'field-ops-suspicion-visibility-founder',
			secretsKey: 'field-ops-suspicion-visibility-secrets-key',
			invocationTimeoutMillis: 90_000,
			files: true,
			ai: recordedAi(
				Array.from({ length: SUSPICION_AI_TRANSCRIPT_LENGTH * 2 }, () =>
					recordedPhotoSuspicious(LOG_ASSET_NAME)
				)
			)
		});
		const signIn = async (email: string): Promise<string> => {
			const started = await guest.guestCommand('identity.continueSession', { email }, 'system');
			const credential = (started.value as { readonly credential?: unknown }).credential;
			assert.equal(typeof credential, 'string', JSON.stringify(started.value));
			return String(credential);
		};
		const checkedAt = async (): Promise<unknown> =>
			(
				(await guest.query(`select suspicion_checked_at from job_assignments where id = $1::uuid`, [
					PUBLIC_ASSIGNMENT_ID
				])) as ReadonlyArray<{ readonly suspicion_checked_at: unknown }>
			)[0]?.suspicion_checked_at;
		const runReview = async (label: string): Promise<void> => {
			const started = await postGuestCommand(
				guest.baseUrl,
				START_COMMAND,
				{ name: SUSPICION_AUTOMATION, input: { assignment_id: PUBLIC_ASSIGNMENT_ID } },
				sessionHeaders(guest.credential)
			);
			assert.ok(
				started.status >= 200 && started.status < 300,
				`${label}: ${START_COMMAND} HTTP ${started.status}: ${JSON.stringify(started.value)}`
			);
		};
		const read = (credential: string, collection: string) =>
			postGuestCommand(
				guest.baseUrl,
				'collections.findMany',
				{ collection, where: { job_assignment_id: { eq: PUBLIC_ASSIGNMENT_ID } }, limit: 10 },
				sessionHeaders(credential)
			);
		try {
			if (guest.files === undefined) throw new Error('files: true must return files');
			const { reference: photoJpeg } = solidRgbJpegPair(JPEG_WIDTH, JPEG_HEIGHT);
			await writeAsset(guest.files.rootDirectory, LOG_STORAGE_KEY, photoJpeg);
			await pushMutation(
				guest.baseUrl,
				guest.credential,
				guest.schemaFingerprint,
				{
					collection: 'photo_evidence',
					action: 'create',
					inputs: [
						{
							id: VISIBILITY_PHOTO_ID,
							job_assignment_id: PUBLIC_ASSIGNMENT_ID,
							photo: photoDescriptor(LOG_STORAGE_KEY, LOG_ASSET_NAME, photoJpeg.byteLength)
						}
					]
				},
				[],
				'file the photo the review judges'
			);
			await runReview('first review');
			assert.equal(typeof (await checkedAt()), 'string', 'the review stamps the assignment');

			// The controller team reads the log and the review behind it.
			const controller = await signIn(ADA_QUILL_CONTROLLER);
			const controllerLogs = rowsOf(
				requireOk(await read(controller, 'suspicious_activity_logs'), 'controller logs'),
				'controller logs'
			);
			assert.equal(controllerLogs.length, 1, JSON.stringify(controllerLogs));
			assert.match(String(controllerLogs[0]?.reason), /empty bay/);
			assert.equal(
				rowsOf(
					requireOk(await read(controller, 'suspicion_reviews'), 'controller reviews'),
					'controller reviews'
				).length,
				1
			);

			// The contractor holding this very assignment is refused both.
			const contractor = await signIn(BEN_VOSS_CONTRACTOR);
			for (const collection of ['suspicious_activity_logs', 'suspicion_reviews']) {
				const refused = await read(contractor, collection);
				const visible =
					refused.status >= 200 && refused.status < 300
						? rowsOf(refused.value, collection).length
						: 0;
				assert.equal(visible, 0, `${collection}: ${JSON.stringify(refused.value)}`);
			}

			// The contractor reports on the work: the reviewed assignment is unread again.
			const [{ row_version: rowVersion }] = (await guest.query(
				`select row_version from job_assignments where id = $1::uuid`,
				[PUBLIC_ASSIGNMENT_ID]
			)) as ReadonlyArray<{ readonly row_version: number }>;
			await pushMutation(
				guest.baseUrl,
				contractor,
				guest.schemaFingerprint,
				{
					collection: 'job_assignments',
					action: 'update',
					inputs: [{ id: PUBLIC_ASSIGNMENT_ID, summary: 'Two grab bars installed.' }]
				},
				[
					{
						row: { collection: 'job_assignments', recordId: PUBLIC_ASSIGNMENT_ID },
						rowVersion: Number(rowVersion)
					}
				],
				'contractor report'
			);
			assert.equal(await checkedAt(), null, 'a change clears the review stamp');

			// The next run judges it again, on the new evidence.
			await runReview('second review');
			assert.equal(typeof (await checkedAt()), 'string', 'the re-review stamps it again');
			assert.equal(
				rowsOf(
					requireOk(await read(controller, 'suspicion_reviews'), 'reviews after the change'),
					'reviews after the change'
				).length,
				2,
				'the changed assignment is reviewed a second time'
			);
		} finally {
			await guest.stop();
		}
	}
);

/**
 * The inspection pass's two row facts, written through the real `photo_evidence` update rather
 * than a stub: a byte-identical foreign file lands as `exact_duplicate`, and a photo filed as a
 * WhatsApp document (`application/octet-stream`) is inspected by its bytes and stored as the
 * image it is.
 */
const EXACT_REFERENCE_PHOTO_ID = '01990000-0000-7000-8005-000000000405';
const EXACT_COPY_PHOTO_ID = '01990000-0000-7000-8005-000000000406';
const DOCUMENT_PHOTO_ID = '01990000-0000-7000-8005-000000000407';

test(
	'the inspection pass stores exact_duplicate and a byte-detected mime through the collection',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-public-seed-exact',
			releaseId: 'field-ops-public-seed-exact',
			gatewaySecret: 'field-ops-public-seed-exact-gateway',
			founderEmail: 'field-ops-exact-founder@example.test',
			founderClaimId: 'field-ops-public-seed-exact-founder',
			secretsKey: 'field-ops-public-seed-exact-secrets-key',
			invocationTimeoutMillis: 90_000,
			files: true,
			ai: recordedAi(
				Array.from({ length: SUSPICION_AI_TRANSCRIPT_LENGTH }, () => recordedEmptyPhotoClear)
			)
		});
		try {
			if (guest.files === undefined) throw new Error('files: true must return files');
			const { reference, suspectBase } = solidRgbJpegPair(JPEG_WIDTH, JPEG_HEIGHT);
			await writeAsset(guest.files.rootDirectory, 'public-seed/exact.jpg', reference);
			await writeAsset(guest.files.rootDirectory, 'public-seed/exact-copy.jpg', reference);
			await writeAsset(guest.files.rootDirectory, 'public-seed/document.bin', suspectBase);
			const file = (id: string, assignmentId: string, photo: Record<string, unknown>) =>
				pushMutation(
					guest.baseUrl,
					guest.credential,
					guest.schemaFingerprint,
					{
						collection: 'photo_evidence',
						action: 'create',
						inputs: [{ id, job_assignment_id: assignmentId, photo }]
					},
					[],
					`create ${id}`
				);
			const run = () =>
				postGuestCommand(
					guest.baseUrl,
					START_COMMAND,
					{ name: SUSPICION_AUTOMATION, input: { assignment_id: PUBLIC_ASSIGNMENT_ID } },
					sessionHeaders(guest.credential)
				);
			await file(
				EXACT_REFERENCE_PHOTO_ID,
				REFERENCE_ASSIGNMENT_ID,
				photoDescriptor('public-seed/exact.jpg', 'exact.jpg', reference.byteLength)
			);
			// One photo per run: the reference first, then the two filed against the public assignment.
			await run();
			await file(
				EXACT_COPY_PHOTO_ID,
				PUBLIC_ASSIGNMENT_ID,
				photoDescriptor('public-seed/exact-copy.jpg', 'exact-copy.jpg', reference.byteLength)
			);
			await file(DOCUMENT_PHOTO_ID, PUBLIC_ASSIGNMENT_ID, {
				...photoDescriptor('public-seed/document.bin', 'document.bin', suspectBase.byteLength),
				mime_type: 'application/octet-stream'
			});

			await run();
			const started = await run();

			// Row ids are minted by the write path, so the rows are found by the file they hold.
			const rows = (await guest.query(
				`select photo ->> 'storage_key' as key, sha256, flags, photo from photo_evidence where photo ->> 'storage_key' = any($1::text[])`,
				[['public-seed/exact-copy.jpg', 'public-seed/document.bin']]
			)) as ReadonlyArray<{
				readonly key: string;
				readonly sha256: string;
				readonly flags: ReadonlyArray<string>;
				readonly photo: { readonly mime_type: string } | string;
			}>;
			const byKey = new Map(rows.map((row) => [row.key, row]));
			const copy = byKey.get('public-seed/exact-copy.jpg');
			const document = byKey.get('public-seed/document.bin');
			assert.ok(copy !== undefined && document !== undefined, JSON.stringify(rows));
			assert.ok(
				copy.flags.includes('exact_duplicate'),
				`copy flags: ${JSON.stringify(copy.flags)}`
			);
			assert.notEqual(document.sha256, '', 'the document was inspected');
			const documentPhoto =
				typeof document.photo === 'string' ? JSON.parse(document.photo) : document.photo;
			assert.equal(documentPhoto.mime_type, 'image/jpeg');
			assert.ok(started.status >= 200 && started.status < 300, JSON.stringify(started.value));
		} finally {
			await guest.stop();
		}
	}
);

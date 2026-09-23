import test from 'node:test';
import assert from 'node:assert/strict';
import {
	mutationPush,
	mutationResolution,
	pageOf,
	postGuestCommand,
	requireOk
} from '@norbital-ai/test-utilities';
import { siteKey } from '../src/lib/site-key.mjs';
import { bootPublicSeedGuest } from './helpers/public-seed-guest.js';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 120_000;

/**
 * Addresses as they are typed, geocoded or not. The generated column computes the key in SQL, the
 * pipeline and the transform compute it in JavaScript, and a lookup is only as good as the two
 * agreeing — so each is written through the real engine and read back.
 */
const ADDRESSES: ReadonlyArray<readonly [name: string, formatted?: string]> = [
	['58 Kismis Avenue, Singapore 598235', '58 KISMIS AVENUE CHENG SOON GARDEN SINGAPORE 598235'],
	['Edelweiss 119 #02-06, Singapore'],
	['950 Dunearn Road #05-03, Singapore 589474', '950 DUNEARN ROAD GARDENVISTA SINGAPORE 589474'],
	["78 King's Road, Singapore 266461"],
	['38 Mount Sinai Rise, Singapore'],
	['Blk 133 Bedok North Ave 3 # 5 - 12', 'Blk 133 Bedok North Avenue 3, Singapore 460133']
];

test(
	'site keys match in SQL and JavaScript, and work filed by address reuses or creates its site',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-sites-upsert',
			releaseId: 'field-ops-sites-upsert',
			gatewaySecret: 'field-ops-sites-upsert-gateway',
			founderEmail: 'field-ops-sites-upsert@example.test',
			founderClaimId: 'field-ops-sites-upsert-founder',
			secretsKey: 'field-ops-sites-upsert-secrets-key'
		});
		const headers = { authorization: `Bearer ${guest.credential}` };
		const command = async (name: string, input: Record<string, unknown>) =>
			requireOk(await postGuestCommand(guest.baseUrl, name, input, headers), name);
		const write = async (graph: Record<string, unknown>) => {
			const pushed = await postGuestCommand(
				guest.baseUrl,
				'collections.write',
				mutationPush(guest.schemaFingerprint, graph),
				headers
			);
			assert.ok(pushed.status < 300, JSON.stringify(pushed.value));
			return mutationResolution(pushed.value);
		};
		const rows = async (collection: string, where: Record<string, unknown> = {}) =>
			pageOf(await command('collections.findMany', { collection, where, limit: 500 }), collection)
				.rows;

		try {
			assert.equal(
				await write({
					collection: 'sites',
					action: 'create',
					inputs: ADDRESSES.map(([name, formatted]) => ({
						name,
						...(formatted === undefined
							? {}
							: {
									location: {
										type: 'Point',
										srid: 4326,
										formatted_address: formatted,
										geometry: { lat: 1.33, lon: 103.9 }
									}
								})
					}))
				}),
				'accepted'
			);
			const byName = new Map((await rows('sites')).map((site) => [site.name, site]));
			for (const [name, formatted] of ADDRESSES)
				assert.equal(byName.get(name)?.site_key, siteKey(name, formatted), name);
			const siteCount = byName.size;
			const kismis = byName.get(ADDRESSES[0]![0])!;

			// Work at a filed address, spelled another way: the site is reused, the job lands on it.
			assert.equal(
				await write({
					collection: 'sites',
					action: 'create',
					inputs: [
						{
							name: '58 Kismis Ave, S598235',
							site_assignments: {
								create: [
									{
										title: 'Upsert — reuse',
										scheduled_for: '2026-10-01T00:00:00.000Z',
										description: 'Filed by address'
									}
								]
							}
						}
					]
				}),
				'accepted'
			);
			// Work at a new address: the site is created with it, once, however often it is filed.
			for (const title of ['Upsert — create', 'Upsert — create again'])
				assert.equal(
					await write({
						collection: 'sites',
						action: 'create',
						inputs: [
							{
								name: '6 Sunset Vale, Singapore 597232',
								site_assignments: {
									create: [
										{ title, scheduled_for: '2026-10-02T00:00:00.000Z', description: 'New address' }
									]
								}
							}
						]
					}),
					'accepted'
				);

			const sites = await rows('sites');
			assert.equal(sites.length, siteCount + 1);
			const sunset = sites.find((site) => site.site_key === '597232');
			assert.ok(sunset !== undefined);
			const [reused] = await rows('job_assignments', { title: { eq: 'Upsert — reuse' } });
			assert.equal(reused?.site_id, kismis.id);
			assert.equal(reused?.status, 'unassigned');
			assert.equal(reused?.search_text, `Upsert — reuse, ${kismis.name}`);
			const created = await rows('job_assignments', { site_id: { eq: sunset.id } });
			assert.equal(created.length, 2);

			// A bare create of a filed address is refused rather than filed twice.
			assert.equal(
				await write({
					collection: 'sites',
					action: 'create',
					inputs: [{ name: '6 SUNSET VALE 597232' }]
				}),
				'rejected'
			);

			// The import pipeline files a sheet once, however often it is imported.
			const sheet = {
				rows: [
					{
						site: '58 Kismis Ave',
						postal_code: '598235',
						scheduled_for: '2026-10-05',
						title: 'Imported survey'
					},
					{
						site: '17 Springside Place',
						postal_code: '786420',
						scheduled_for: '2026-10-06',
						title: 'Imported install',
						external_ref: 'UPSERT-1'
					}
				]
			};
			const imported = [];
			for (let round = 0; round < 2; round++)
				imported.push(
					await command('collections.import', {
						records: [{ collection: 'job_assignments', id: crypto.randomUUID(), values: sheet }]
					})
				);
			assert.equal((await rows('sites')).length, siteCount + 2, JSON.stringify(imported));
			assert.equal(
				(await rows('job_assignments', { title: { in: ['Imported survey', 'Imported install'] } }))
					.length,
				2
			);
		} finally {
			await guest.stop();
		}
	}
);

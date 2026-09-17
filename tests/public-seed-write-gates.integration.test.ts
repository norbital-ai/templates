import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	postGuestCommand,
	requireAccepted,
	requireOk
} from '@norbital-ai/test-utilities';
import { graphOf, writeGraph } from './helpers/write.ts';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

/**
 * The write contract, end to end through the same guest command the app uses: a
 * scheme's `assessed_on` formula may name only catalogue rows of its own settings version, and a
 * scheme rule may name only a `produced.<code>` this version carries. Both refusals happen at the
 * write; the accepted control proves the gate is not simply refusing everything.
 */
test(
	'the write gates refuse a formula naming a row the version lacks and an unknown producer, and accept the version’s own',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 2 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-write-gates');
		try {
			const command = (body: Parameters<typeof graphOf>[0], bases = []) =>
				writeGraph(session, body, bases);
			const rowVersion = async (collection: string, id: string): Promise<number> => {
				const [row] = (await session.query(`select row_version from ${collection} where id = $1`, [
					id
				])) as ReadonlyArray<{ readonly row_version: number }>;
				assert.ok(row, `${collection} ${id} exists`);
				return row.row_version;
			};

			const draftId = String(
				asRecord(
					requireOk(
						await postGuestCommand(
							session.host.baseUrl,
							'invoke.new_settings_version',
							{ input: { settings_id: JURISDICTION_ID, starts_on: '2026-03-01' } },
							bearerHeaders(session.credential)
						),
						'new_settings_version'
					),
					'new_settings_version'
				).id
			);
			const [draftScheme] = (await session.query(
				'select id, assessed_on from statutory_contributions where settings_id = $1 and code = $2',
				[draftId, 'PUB-EPF']
			)) as ReadonlyArray<{ readonly id: string; readonly assessed_on: string }>;
			const [draftLeave] = (await session.query(
				'select id from leave_catalogue where settings_id = $1 and code = $2',
				[draftId, 'ANNUAL']
			)) as Row[];
			assert.ok(draftScheme && draftLeave, 'the draft carries the scheme and catalogue row');

			const withEntry = (code: string) =>
				`${draftScheme.assessed_on} + catalog('ALLOWANCE', {'pick': ['${code}']})`;
			const baseWrite = async (code: string) =>
				command(
					{
						action: 'mutate',
						collection: 'statutory_contributions',
						rows: [
							{ action: 'update', values: { id: draftScheme.id, assessed_on: withEntry(code) } }
						]
					},
					[
						{
							row: { collection: 'statutory_contributions', recordId: draftScheme.id },
							rowVersion: await rowVersion('statutory_contributions', draftScheme.id)
						}
					]
				);

			// An allowance code this version does not carry. The write refuses it by name.
			const foreign = asRecord(
				(await baseWrite('NOT_A_LEAVE_OF_THIS_VERSION')).value,
				'unknown entry'
			);
			assert.equal(foreign.resolution, 'rejected', JSON.stringify(foreign));
			assert.match(String(foreign.message ?? ''), /not a row of its settings version/);

			// A rule naming a producer this version does not carry is refused at the write, by name.
			const ghost = asRecord(
				(
					await command({
						action: 'mutate',
						collection: 'statutory_contributions',
						rows: [
							{
								action: 'create',
								values: {
									settings_id: draftId,
									code: 'GHOST_DEP',
									name: 'Ghost dependency',
									assessed_on: 'BASE',
									rules: [{ when: 'true', employee: 'produced.NOPE.employee', employer: '0.0' }]
								}
							}
						]
					})
				).value,
				'unknown producer'
			);
			assert.equal(ghost.resolution, 'rejected', JSON.stringify(ghost));
			assert.match(String(ghost.message ?? ''), /NOPE/);

			// The draft's own allowance row is accepted.
			requireAccepted((await baseWrite('TRANSPORT')).value, 'own-version entry');
		} finally {
			await session.stop();
		}
	}
);

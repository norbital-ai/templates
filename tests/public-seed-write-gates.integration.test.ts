import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted,
	requireOk
} from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

const MUTATE = 'collections.mutate';

/**
 * The RFC 0003 §1.4 write contract, end to end through the same guest command the app uses: a
 * scheme's base may name only catalogue rows of its own settings version, and a scheme rule may
 * name only a `produced.<code>` this version carries. Both refusals happen at the write; the
 * accepted control proves the gate is not simply refusing everything.
 */
test(
	'the write gates refuse a base entry the version lacks and an unknown producer, and accept the version’s own',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 2 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-write-gates');
		try {
			const command = (
				body: Parameters<typeof mutationPush>[1],
				bases: Parameters<typeof mutationPush>[2] = []
			) =>
				postGuestCommand(
					session.host.baseUrl,
					MUTATE,
					mutationPush(session.schemaFingerprint, body, bases),
					bearerHeaders(session.credential)
				);
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
				'select id, base from statutory_contributions where settings_id = $1 and code = $2',
				[draftId, 'PUB-EPF']
			)) as ReadonlyArray<{ readonly id: string; readonly base: Record<string, unknown> }>;
			const [draftLeave] = (await session.query(
				'select id from leave_catalogue where settings_id = $1 and code = $2',
				[draftId, 'ANNUAL']
			)) as Row[];
			assert.ok(draftScheme && draftLeave, 'the draft carries the scheme and catalogue row');

			const withEntry = (code: string) => ({
				...draftScheme.base,
				entries: [{ family: 'LEAVE', code }]
			});
			const baseWrite = async (code: string) =>
				command(
					{
						action: 'mutate',
						collection: 'statutory_contributions',
						rows: [{ action: 'update', values: { id: draftScheme.id, base: withEntry(code) } }]
					},
					[
						{
							row: { collection: 'statutory_contributions', recordId: draftScheme.id },
							rowVersion: await rowVersion('statutory_contributions', draftScheme.id)
						}
					]
				);

			// A leave code this version does not carry. The write refuses it by name.
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
									id: crypto.randomUUID(),
									settings_id: draftId,
									code: 'GHOST_DEP',
									name: 'Ghost dependency',
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

			// The draft's own leave row is accepted.
			requireAccepted((await baseWrite('ANNUAL')).value, 'own-version entry');
		} finally {
			await session.stop();
		}
	}
);

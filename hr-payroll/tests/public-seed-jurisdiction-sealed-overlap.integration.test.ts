import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

/**
 * HR16: two sealed versions of one law cannot overlap.
 *
 * The hook says it in a sentence; the `jurisdiction_settings_sealed_no_overlap` exclusion holds it
 * in the database for a write that never met the hook. A draft may overlap freely, and a sealed
 * version whose range ends before the other begins is adjacent, not overlapping.
 */
const sealedCopy = async (session: Session, overrides: Row): Promise<Row> => {
	const [pub] = (await session.query(
		'select code, jurisdiction_code, name, currency, tax_year_start_month from jurisdiction_settings where id = $1',
		[JURISDICTION_ID]
	)) as ReadonlyArray<Row>;
	assert.ok(pub, 'the public PUB profile is seeded');
	return { ...pub, sealed_at: '2026-04-01T00:00:00.000Z', research_urls: null, ...overrides };
};

const create = (session: Session, values: Row) =>
	postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection: 'jurisdiction_settings',
			rows: [{ action: 'create', values: { id: crypto.randomUUID(), ...values } }]
		}),
		bearerHeaders(session.credential)
	);

test(
	'a second sealed PUB row overlapping the first is refused, in a sentence and by the exclusion',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-hr16-sealed-overlap');
		try {
			const overlapping = await sealedCopy(session, {
				name: 'PUB overlapping',
				effective_range: { start: '2026-04-01T00:00:00.000Z', end: null }
			});
			const refused = await create(session, overlapping);
			const body = asRecord(refused.value, 'overlapping sealed create');
			assert.equal(body.resolution, 'rejected', JSON.stringify(refused.value));
			assert.match(
				String(body.message ?? ''),
				/Sealed PUB versions cannot overlap/,
				JSON.stringify(refused.value)
			);

			// The same row through raw SQL never meets the hook; the database exclusion is the backstop.
			await assert.rejects(
				session.query(
					`insert into jurisdiction_settings (id, code, jurisdiction_code, name, sealed_at, currency, tax_year_start_month, effective_range)
					 select gen_random_uuid(), code, jurisdiction_code, 'PUB by sql', now(), currency, tax_year_start_month,
					        '{"start":"2026-04-01","end":null}'::jsonb
					   from jurisdiction_settings where id = $1`,
					[JURISDICTION_ID]
				),
				/jurisdiction_settings_sealed_no_overlap/
			);

			const draft = await create(session, { ...overlapping, name: 'PUB draft', sealed_at: null });
			requireAccepted(draft.value, 'an overlapping draft is not the law yet');

			const earlier = await create(
				session,
				await sealedCopy(session, {
					name: 'PUB 2019',
					effective_range: { start: '2019-01-01T00:00:00.000Z', end: '2020-01-01T00:00:00.000Z' }
				})
			);
			requireAccepted(
				earlier.value,
				'a sealed version ending the day the other begins is adjacent'
			);

			const sealed = (await session.query(
				`select name from jurisdiction_settings where code = 'PUB' and sealed_at is not null and voided_at is null order by name`
			)) as ReadonlyArray<Row>;
			assert.deepEqual(
				sealed.map((row) => row.name),
				['PUB 2019', 'Public fixture profile'].toSorted()
			);
		} finally {
			await session.stop();
		}
	}
);

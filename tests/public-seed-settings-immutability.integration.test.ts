import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asRecord, bearerHeaders, requireAccepted } from '@norbital-ai/test-utilities';
import { createdIds, observedVersion, writeGraph, writeRows } from './helpers/write.ts';
import {
	ANNUAL_LEAVE_CATALOGUE_ID,
	COMPANY_ID,
	JANUARY_2026,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	STATUTORY_PUB_EPF_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { markRunPaid } from './helpers/mark-paid.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;
type Headers = Readonly<Record<string, string>>;

const CONTROLLER = 'HQ Payroll HR';
const MANAGER = 'HR Manager';
const SEALED =
	/is sealed, so it cannot be created, changed or deleted|is sealed, so \w+ cannot change|is never unsealed/;

const teamHeaders = (session: Session, team?: string): Headers => ({
	...bearerHeaders(session.credential),
	...(team === undefined ? {} : { 'x-colony-impersonated-team': team })
});

const rowVersion = async (session: Session, collection: string, id: string): Promise<number> => {
	const [row] = (await session.query(`select row_version from ${collection} where id = $1`, [
		id
	])) as ReadonlyArray<{ readonly row_version: number }>;
	assert.ok(row, `${collection} ${id} exists`);
	return row.row_version;
};

const stored = async (session: Session, collection: string, id: string): Promise<Row> => {
	const [row] = (await session.query(`select * from ${collection} where id = $1`, [
		id
	])) as ReadonlyArray<Row>;
	assert.ok(row, `${collection} ${id} exists`);
	return row;
};

/** One write through the guest, as one team; the whole response comes back for the assertion. */
const write = async (
	session: Session,
	headers: Headers,
	collection: string,
	row: { action: 'create' | 'update'; values: Row },
	baseVersion?: number
) => {
	const id = String(row.values.id);
	return writeGraph(
		session,
		{ action: 'mutate', collection, rows: [row] },
		baseVersion === undefined ? [] : [observedVersion(collection, id, baseVersion)],
		headers
	);
};

const remove = async (session: Session, headers: Headers, collection: string, id: string) =>
	writeRows(session, collection, 'delete', [{ id }], headers, [
		observedVersion(collection, id, await rowVersion(session, collection, id))
	]);

const refusedWith = (response: { readonly value: unknown }, what: string, pattern: RegExp) => {
	const body = asRecord(response.value, what);
	assert.equal(body.resolution, 'rejected', `${what}: ${JSON.stringify(response.value)}`);
	assert.match(
		String(body.message ?? body.error ?? ''),
		pattern,
		`${what}: ${JSON.stringify(body)}`
	);
};

const seedRow = (collection: string): Row => {
	const rows = JSON.parse(
		readFileSync(new URL(`./fixtures/seed/${collection}.json`, import.meta.url), 'utf8')
	) as Row[];
	assert.ok(rows[0], `${collection} has a public fixture`);
	return rows[0];
};
const LOAN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';
const CATALOGUES = [
	'leave_catalogue',
	'claim_catalogue',
	'allowance_catalogue',
	'loan_catalogue'
] as const;
const catalogueRows = new Map<string, Row>(
	CATALOGUES.map((collection) => [
		collection,
		collection === 'loan_catalogue'
			? (({ settings_id, bands, eligibility }) => ({
					id: LOAN_ID,
					settings_id,
					code: 'FIXTURE_LOAN',
					loan_type: 'STAFF',
					bands,
					eligibility
				}))(seedRow('claim_catalogue'))
			: seedRow(collection)
	])
);
const HOLIDAY = seedRow('jurisdiction_holidays');
const SEEDED_WORK_RULES = seedRow('jurisdiction_settings').work_rules as Readonly<
	Record<string, unknown>
>;

/** Valid source shapes from the synthetic seed, with new codes so only the seal prevents creation. */
const CREATES: ReadonlyArray<{ readonly collection: string; readonly values: Row }> = [
	{
		collection: 'statutory_contributions',
		values: {
			settings_id: JURISDICTION_ID,
			code: 'PUB_NEW',
			name: 'A scheme nobody may add',
			authority: 'Public fixture',
			assessment_period: 'PAY_PERIOD',
			employee_share_annual_cap: null,
			shared_cap_group: null,
			project_relief_annually: false,
			rules: [{ when: 'base >= 0.0', employee: '0.0', employer: '0.0' }]
		}
	},
	...CATALOGUES.map((collection) => {
		const { id: _id, ...values } = catalogueRows.get(collection)!;
		// Work has no code: one row per version, and a second one under the seal is refused as well.
		return {
			collection,
			values: { ...values, code: `NEW_${collection.toUpperCase()}` }
		};
	})
];

/** Every family is edited and deleted under its version seal; published calendars own their seal. */
const STORED: ReadonlyArray<{
	readonly collection: string;
	readonly id: string;
	readonly change: Row;
	readonly pattern?: RegExp;
}> = [
	{
		collection: 'statutory_contributions',
		id: STATUTORY_PUB_EPF_ID,
		change: { employee_share_annual_cap: 99 }
	},
	{
		collection: 'statutory_contributions',
		id: STATUTORY_PUB_EPF_ID,
		change: { name: 'Edited under seal' }
	},
	{
		collection: 'leave_catalogue',
		id: ANNUAL_LEAVE_CATALOGUE_ID,
		change: { name: 'Annual leave (edited)' }
	},
	...(['claim_catalogue', 'allowance_catalogue', 'loan_catalogue'] as const).map((collection) => ({
		collection,
		id: String(catalogueRows.get(collection)!.id),
		change: { name: 'Edited under seal' }
	}))
];

const COUNTED = ['statutory_contributions', ...CATALOGUES, 'jurisdiction_holidays'];
const counts = (session: Session) =>
	session.query(
		`select ${COUNTED.map((collection) => `(select count(*) from ${collection})::int as ${collection}`).join(', ')}`
	);

/** Every root column, with a value that differs from the seeded one. */
const ROOT_CHANGES: ReadonlyArray<Row> = [
	{ code: 'PUB2' },
	{ jurisdiction_code: 'TEST-OTHER' },
	{ name: 'Public fixture profile (edited)' },
	{ work_rules: { ...structuredClone(SEEDED_WORK_RULES), authority: 'Edited under seal' } },
	{
		work_rules: {
			...structuredClone(SEEDED_WORK_RULES),
			wages: { by_region: { 'EDIT-REGION': 1234 } }
		}
	},
	{ sources: { urls: ['https://example.test/law'] } },
	{
		payroll: {
			currency: 'SGD',
			timezone: 'Asia/Singapore',
			tax_year_start_month: 7,
			allowance_npl_prorates: false
		}
	},
	{ effective_range: { start: '2019-01-01T00:00:00.000Z', end: null } },
	{ cloned_from_id: '22222222-2222-4222-8222-222222222299' },
	{ sealed_at: null }
];

/**
 * HR24 (a): a sealed version and everything under it is immutable, for every rank.
 *
 * The public fixture's PUB version is sealed by the seed. The controller and the HR manager each
 * try to create, edit and delete a row on every child collection and to edit every root column;
 * each write is refused with the sentence naming the version. A void succeeds once, with a
 * reason, and changes nothing else; it is never undone.
 */
test(
	'a sealed settings version refuses every write under it, for the controller and the manager, then voids once',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 3 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-hr24-settings-immutability');
		try {
			// Loan has no agreement fixture; install a valid catalogue sibling beneath the existing seal.
			const loan = catalogueRows.get('loan_catalogue')!;
			await session.query(
				`insert into loan_catalogue (id, settings_id, code, loan_type, bands, eligibility) values ($1,$2,$3,$4,$5,$6)`,
				[loan.id, loan.settings_id, loan.code, loan.loan_type, loan.bands, loan.eligibility]
			);
			// Holidays are independent of settings: both operators can add one even here.
			for (const [index, team] of [CONTROLLER, MANAGER].entries()) {
				const added = await write(session, teamHeaders(session, team), 'jurisdiction_holidays', {
					action: 'create',
					values: {
						company_id: HOLIDAY.company_id,
						date: `203${index}-01-01`,
						name: 'Fixture holiday'
					}
				});
				requireAccepted(added.value, `${team} adds an independent holiday`);
				const [id] = createdIds(added.value);
				assert.equal((await stored(session, 'jurisdiction_holidays', id)).published_at, null);
			}
			const countsBefore = await counts(session);
			const before = new Map<string, Row>();
			for (const { collection, id } of STORED)
				before.set(`${collection}:${id}`, await stored(session, collection, id));
			before.set('root', await stored(session, 'jurisdiction_settings', JURISDICTION_ID));

			for (const team of [CONTROLLER, MANAGER]) {
				const headers = teamHeaders(session, team);
				for (const { collection, values } of CREATES) {
					const created = await write(session, headers, collection, {
						action: 'create',
						values
					});
					refusedWith(created, `${team} create ${collection}`, SEALED);
				}
				for (const { collection, id, change, pattern } of STORED) {
					const version = await rowVersion(session, collection, id);
					const edited = await write(
						session,
						headers,
						collection,
						{ action: 'update', values: { id, ...change } },
						version
					);
					refusedWith(edited, `${team} update ${collection}`, pattern ?? SEALED);
					// A delete has no transform: the grant's `authorize` reads the seal and refuses.
					const deleted = await remove(session, headers, collection, id);
					refusedWith(deleted, `${team} delete ${collection}`, /sealed|authoriz|refused/i);
				}
				for (const change of ROOT_CHANGES) {
					const version = await rowVersion(session, 'jurisdiction_settings', JURISDICTION_ID);
					const edited = await write(
						session,
						headers,
						'jurisdiction_settings',
						{ action: 'update', values: { id: JURISDICTION_ID, ...change } },
						version
					);
					const column = Object.keys(change)[0];
					// The controller's authority stops at drafts, so the policy refuses ahead of the
					// transform for the root; the manager reaches the transform and gets the sentence.
					refusedWith(
						edited,
						`${team} update root ${column}`,
						team === MANAGER ? SEALED : /sealed|allow|authoriz|refused/i
					);
				}
				const deletedRoot = await remove(
					session,
					headers,
					'jurisdiction_settings',
					JURISDICTION_ID
				);
				refusedWith(deletedRoot, `${team} delete root`, /sealed|allow|authoriz|refused|restrict/i);
			}
			for (const [key, row] of before) {
				const [collection, id] =
					key === 'root' ? ['jurisdiction_settings', JURISDICTION_ID] : key.split(':');
				assert.deepEqual(await stored(session, collection!, id!), row, `${key} unchanged`);
			}
			assert.deepEqual(
				await counts(session),
				countsBefore,
				'refused writes create or delete no family or calendar rows'
			);

			// A paid run cites the version, so voiding it states a reason.
			const founder = teamHeaders(session);
			const january = await write(session, founder, 'payroll_runs', {
				action: 'create',
				values: { company_id: COMPANY_ID, period: JANUARY_2026 }
			});
			requireAccepted(january.value, 'January run');
			const [runId] = createdIds(january.value);
			await markRunPaid(session, runId);
			const [run] = (await session.query('select settings_id from payroll_runs where id = $1', [
				runId
			])) as ReadonlyArray<Row>;
			assert.equal(
				run?.settings_id,
				JURISDICTION_ID,
				'the run cites the version it priced against'
			);
			refusedWith(
				await write(
					session,
					founder,
					'jurisdiction_settings',
					{
						action: 'update',
						values: { id: JURISDICTION_ID, voided_at: new Date().toISOString() }
					},
					await rowVersion(session, 'jurisdiction_settings', JURISDICTION_ID)
				),
				'void without a reason',
				/priced the paid 2026-01 payroll run, so voiding it states a reason/
			);
			const voidedAt = '2026-09-07T00:00:00.000Z';
			requireAccepted(
				(
					await write(
						session,
						founder,
						'jurisdiction_settings',
						{
							action: 'update',
							values: {
								id: JURISDICTION_ID,
								voided_at: voidedAt,
								void_reason: 'wrong PUB_EPF ceiling'
							}
						},
						await rowVersion(session, 'jurisdiction_settings', JURISDICTION_ID)
					)
				).value,
				'void with a reason'
			);
			const voided = await stored(session, 'jurisdiction_settings', JURISDICTION_ID);
			const root = before.get('root')!;
			for (const [column, value] of Object.entries(voided)) {
				if (
					['voided_at', 'void_reason', 'updated_at', 'row_version', 'sys_period'].includes(column)
				)
					continue;
				assert.deepEqual(value, root[column], `void changed nothing but the void: ${column}`);
			}
			assert.equal(voided.void_reason, 'wrong PUB_EPF ceiling');
			assert.ok(voided.voided_at != null);
			// Void is one action: never undone, never re-reasoned, and still sealed.
			refusedWith(
				await write(
					session,
					founder,
					'jurisdiction_settings',
					{ action: 'update', values: { id: JURISDICTION_ID, voided_at: null } },
					await rowVersion(session, 'jurisdiction_settings', JURISDICTION_ID)
				),
				'unvoid',
				/a void is one action, never undone/
			);
			refusedWith(
				await write(
					session,
					founder,
					'jurisdiction_settings',
					{ action: 'update', values: { id: JURISDICTION_ID, void_reason: 'changed my mind' } },
					await rowVersion(session, 'jurisdiction_settings', JURISDICTION_ID)
				),
				're-reason',
				/its reason is part of the record/
			);
			refusedWith(
				await write(
					session,
					founder,
					'leave_catalogue',
					{ action: 'update', values: { id: ANNUAL_LEAVE_CATALOGUE_ID, name: 'still frozen' } },
					await rowVersion(session, 'leave_catalogue', ANNUAL_LEAVE_CATALOGUE_ID)
				),
				'a voided version stays sealed',
				SEALED
			);
			// And nothing governs the company any more: the next run is refused by name.
			refusedWith(
				await write(session, founder, 'payroll_runs', {
					action: 'create',
					values: { id: crypto.randomUUID(), company_id: COMPANY_ID, period: '2026-02' }
				}),
				'run after void',
				/operates under jurisdiction settings PUB, which has no sealed version covering 2026-02-28/
			);
		} finally {
			await session.stop();
		}
	}
);

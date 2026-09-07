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
	ANNUAL_LEAVE_CATALOGUE_ID,
	BASIC_COMPONENT_CATALOGUE_ID,
	COMPANY_ID,
	JANUARY_2026,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	STATUTORY_PUB_EPF_ID,
	STATUTORY_PUB_EPF_RATE_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

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
	return postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(
			session.schemaFingerprint,
			{ action: 'mutate', collection, rows: [row] },
			baseVersion === undefined
				? []
				: [{ row: { collection, recordId: id }, rowVersion: baseVersion }]
		),
		headers
	);
};

const remove = async (session: Session, headers: Headers, collection: string, id: string) =>
	postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(session.schemaFingerprint, { action: 'delete', collection, ids: [id] }, [
			{ row: { collection, recordId: id }, rowVersion: await rowVersion(session, collection, id) }
		]),
		headers
	);

const refusedWith = (response: { readonly value: unknown }, what: string, pattern: RegExp) => {
	const body = asRecord(response.value, what);
	assert.equal(body.resolution, 'rejected', `${what}: ${JSON.stringify(response.value)}`);
	assert.match(
		String(body.message ?? body.error ?? ''),
		pattern,
		`${what}: ${JSON.stringify(body)}`
	);
};

/** The rows a create on each child collection would need, all valid but for the seal. */
const CREATES: ReadonlyArray<{ readonly collection: string; readonly values: Row }> = [
	{
		collection: 'statutory_contributions',
		values: {
			settings_id: JURISDICTION_ID,
			code: 'PUB-NEW',
			name: 'A scheme nobody may add',
			is_statutory: true,
			authority: 'Public fixture',
			payer: 'BOTH',
			keyed_by: 'WAGE',
			rounding: 'NEAREST_CENT',
			relief_for: [],
			sequence: 9,
			special_rules: []
		}
	},
	{
		collection: 'contribution_rates',
		values: {
			statutory_contribution_id: STATUTORY_PUB_EPF_ID,
			selector: { by: 'WAGE', from: 100_000, to: null },
			award: { kind: 'PERCENT', employee: 1, employer: 1 }
		}
	},
	{
		collection: 'leave_catalogue',
		values: {
			settings_id: JURISDICTION_ID,
			code: 'STUDY',
			name: 'Study leave',
			is_statutory: false,
			eligibility: '',
			entitlement: { layers: [{ level: 'ORGANISATION', band_from: 0, days: 3 }] },
			accrual: { kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } },
			exit_settlement: { exit: 'FORFEIT' },
			payroll_effect: { kind: 'PAID' }
		}
	},
	{
		collection: 'component_catalogue',
		values: {
			settings_id: JURISDICTION_ID,
			code: 'PHONE',
			is_statutory: false,
			policy: { kind: 'EARNING', settlement: 'ADD' },
			contribution_treatments: {},
			sequence: 60,
			eligibility: '',
			definition: {
				source: 'ENTRY',
				unit: 'MONEY',
				evidence: 'NONE',
				cap: null,
				settlement: 'PAYROLL'
			}
		}
	},
	{
		collection: 'company_holidays',
		values: {
			settings_id: JURISDICTION_ID,
			date: '2026-08-31',
			substitutes_date: null,
			name: 'National Day',
			scope: { kind: 'NATIONAL' },
			is_statutory: true
		}
	}
];

/** One stored row per child collection to edit and delete under the seal. */
const HOLIDAY_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff0';
const STORED: ReadonlyArray<{
	readonly collection: string;
	readonly id: string;
	readonly change: Row;
}> = [
	{ collection: 'statutory_contributions', id: STATUTORY_PUB_EPF_ID, change: { sequence: 99 } },
	{
		collection: 'contribution_rates',
		id: STATUTORY_PUB_EPF_RATE_ID,
		change: { award: { kind: 'PERCENT', employee: 12, employer: 13 } }
	},
	{
		collection: 'leave_catalogue',
		id: ANNUAL_LEAVE_CATALOGUE_ID,
		change: { name: 'Annual leave (edited)' }
	},
	{ collection: 'component_catalogue', id: BASIC_COMPONENT_CATALOGUE_ID, change: { sequence: 11 } },
	{ collection: 'company_holidays', id: HOLIDAY_ID, change: { name: 'Christmas (edited)' } }
];

/** Every root column, with a value that differs from the seeded one. */
const ROOT_CHANGES: ReadonlyArray<Row> = [
	{ code: 'PUB2' },
	{ name: 'Public fixture profile (edited)' },
	{ currency: 'SGD' },
	{ tax_year_start_month: 7 },
	{ proration: { by: 'WORKING_DAYS' } },
	{ ordinary_rate: { per: 'HOUR', divisor: 173 } },
	{
		regime: {
			overtime_coverage: null,
			overtime_rules: [],
			overtime_limits: [],
			rest_break_rules: []
		}
	},
	{ research_urls: ['https://example.test/law'] },
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
			// A holiday to edit and delete: the fixture seeds none, so one lands under the seal by SQL,
			// which never meets a hook.
			await session.query(
				`insert into company_holidays (id, settings_id, date, name, scope, is_statutory)
				 values ($1, $2, $3, $4, $5, $6)`,
				[HOLIDAY_ID, JURISDICTION_ID, '2026-12-25', 'Christmas Day', { kind: 'NATIONAL' }, true]
			);
			const before = new Map<string, Row>();
			for (const { collection, id } of STORED)
				before.set(`${collection}:${id}`, await stored(session, collection, id));
			before.set('root', await stored(session, 'jurisdiction_settings', JURISDICTION_ID));

			for (const team of [CONTROLLER, MANAGER]) {
				const headers = teamHeaders(session, team);
				for (const { collection, values } of CREATES) {
					const created = await write(session, headers, collection, {
						action: 'create',
						values: { id: crypto.randomUUID(), ...values }
					});
					refusedWith(created, `${team} create ${collection}`, SEALED);
				}
				for (const { collection, id, change } of STORED) {
					const version = await rowVersion(session, collection, id);
					const edited = await write(
						session,
						headers,
						collection,
						{ action: 'update', values: { id, ...change } },
						version
					);
					refusedWith(edited, `${team} update ${collection}`, SEALED);
					const deleted = await remove(session, headers, collection, id);
					refusedWith(deleted, `${team} delete ${collection}`, SEALED);
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
					// The controller's authority stops at drafts, so the policy refuses ahead of the hook
					// for the root; the manager reaches the hook and gets the sentence.
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
			const counts = (await session.query(
				`select (select count(*) from statutory_contributions)::int as schemes,
				        (select count(*) from contribution_rates)::int as rates,
				        (select count(*) from leave_catalogue)::int as types,
				        (select count(*) from component_catalogue)::int as components,
				        (select count(*) from company_holidays)::int as holidays`
			)) as ReadonlyArray<Row>;
			// Seven components: five the engine feeds, plus the two entry-taking ones the arm-pairing
			// rule needs — a CLAIM component and a MANUAL_ADJUSTMENT one, since an entry may only be
			// raised against a component declaring its own arm.
			assert.deepEqual(counts[0], { schemes: 2, rates: 2, types: 3, components: 7, holidays: 1 });

			// A paid run cites the version, so voiding it states a reason.
			const founder = teamHeaders(session);
			const runId = crypto.randomUUID();
			requireAccepted(
				(
					await write(session, founder, 'payroll_runs', {
						action: 'create',
						values: { id: runId, company_id: COMPANY_ID, period: JANUARY_2026 }
					})
				).value,
				'January run'
			);
			requireAccepted(
				(
					await write(
						session,
						founder,
						'payroll_runs',
						{ action: 'update', values: { id: runId, lifecycle: 'PAID' } },
						await rowVersion(session, 'payroll_runs', runId)
					)
				).value,
				'January paid'
			);
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
								void_reason: 'wrong PUB-EPF ceiling'
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
			assert.equal(voided.void_reason, 'wrong PUB-EPF ceiling');
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

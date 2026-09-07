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
	COMPANY_ID,
	JANUARY_2026,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	SHIFT_OFF_ID,
	SHIFT_REST_ID,
	SHIFT_WORK_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
type Row = Readonly<Record<string, unknown>>;

const CHILDREN = [
	'statutory_contributions',
	'leave_catalogue',
	'component_catalogue',
	'company_holidays'
] as const;

const command = (
	session: Session,
	body: Parameters<typeof mutationPush>[1],
	bases: Parameters<typeof mutationPush>[2] = []
) =>
	postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(session.schemaFingerprint, body, bases),
		bearerHeaders(session.credential)
	);

const rowVersion = async (session: Session, collection: string, id: string): Promise<number> => {
	const [row] = (await session.query(`select row_version from ${collection} where id = $1`, [
		id
	])) as ReadonlyArray<{
		readonly row_version: number;
	}>;
	assert.ok(row, `${collection} ${id} exists`);
	return row.row_version;
};

const childRows = async (session: Session, settingsId: string): Promise<Record<string, Row[]>> => {
	const out: Record<string, Row[]> = {};
	for (const table of CHILDREN)
		out[table] = (await session.query(
			`select * from ${table} where settings_id = $1 order by created_at, id`,
			[settingsId]
		)) as Row[];
	out.contribution_rates = (await session.query(
		`select r.* from contribution_rates r join statutory_contributions s on s.id = r.statutory_contribution_id where s.settings_id = $1 order by r.id`,
		[settingsId]
	)) as Row[];
	return out;
};

/**
 * HR24 (b) and (d): a new version clones every row under the chosen one into a draft, sealing it
 * ends the previous version's range the day before, an overlapping seal is refused, and two
 * companies on one lineage price against the same version id.
 */
test(
	'a new settings version clones every child, sealing it ends the predecessor, overlap is refused, and two entities share it',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 3 },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-hr24-settings-version');
		try {
			await session.query(
				`insert into company_holidays (id, settings_id, date, name, scope, is_statutory) values ($1, $2, $3, $4, $5, $6)`,
				[
					crypto.randomUUID(),
					JURISDICTION_ID,
					'2026-12-25',
					'Christmas Day',
					{ kind: 'NATIONAL' },
					true
				]
			);
			const before = await childRows(session, JURISDICTION_ID);

			// (b) clone: every child count equal, every id new, every settings_id the new version's.
			const created = requireOk(
				await postGuestCommand(
					session.host.baseUrl,
					'invoke.new_settings_version',
					{ input: { settings_id: JURISDICTION_ID, starts_on: '2026-03-01' } },
					bearerHeaders(session.credential)
				),
				'new_settings_version'
			);
			const result = asRecord(created, 'new_settings_version');
			const newId = String(result.id);
			assert.equal(result.code, 'PUB');
			assert.equal(result.cloned_from_id, JURISDICTION_ID);
			const [draft] = (await session.query('select * from jurisdiction_settings where id = $1', [
				newId
			])) as Row[];
			assert.ok(draft);
			assert.equal(draft.sealed_at, null, 'a new version is a draft');
			assert.equal(draft.cloned_from_id, JURISDICTION_ID);
			assert.deepEqual(draft.effective_range, { start: '2026-03-01T00:00:00.000Z', end: null });
			const after = await childRows(session, newId);
			for (const table of [...CHILDREN, 'contribution_rates']) {
				assert.equal(after[table]!.length, before[table]!.length, `${table}: counts equal`);
				const oldIds = new Set(before[table]!.map((row) => row.id));
				for (const row of after[table]!) {
					assert.equal(oldIds.has(row.id), false, `${table}: ids differ`);
					if (table !== 'contribution_rates')
						assert.equal(row.settings_id, newId, `${table}: under the new version`);
				}
			}
			const codes = (table: string, rows: Row[]) =>
				rows.map((row) => row[table === 'company_holidays' ? 'name' : 'code']).toSorted();
			for (const table of CHILDREN)
				assert.deepEqual(codes(table, after[table]!), codes(table, before[table]!), table);
			// The clone is a draft: its rows are editable while the sealed original's are not.
			const [clonedAnnual] = after.leave_catalogue!.filter((row) => row.code === 'ANNUAL');
			assert.ok(clonedAnnual);
			requireAccepted(
				(
					await command(
						session,
						{
							action: 'mutate',
							collection: 'leave_catalogue',
							rows: [
								{
									action: 'update',
									values: { id: clonedAnnual.id, name: 'Annual leave (2026 draft)' }
								}
							]
						},
						[
							{
								row: { collection: 'leave_catalogue', recordId: String(clonedAnnual.id) },
								rowVersion: await rowVersion(session, 'leave_catalogue', String(clonedAnnual.id))
							}
						]
					)
				).value,
				'draft child edit'
			);

			// A bare seal overlaps the open-ended original and is refused by name.
			const bareSeal = await command(
				session,
				{
					action: 'mutate',
					collection: 'jurisdiction_settings',
					rows: [{ action: 'update', values: { id: newId, sealed_at: new Date().toISOString() } }]
				},
				[
					{
						row: { collection: 'jurisdiction_settings', recordId: newId },
						rowVersion: await rowVersion(session, 'jurisdiction_settings', newId)
					}
				]
			);
			const bare = asRecord(bareSeal.value, 'bare seal');
			assert.equal(bare.resolution, 'rejected', JSON.stringify(bareSeal.value));
			assert.match(
				String(bare.message ?? ''),
				/Sealed PUB versions cannot overlap: Public fixture profile already governs 2020-01-01 to open/
			);

			// The timeline's seal: end the predecessor the day before, then seal, in one write.
			const sealed = await command(
				session,
				{
					action: 'mutate',
					collection: 'jurisdiction_settings',
					rows: [
						{
							action: 'update',
							values: {
								id: JURISDICTION_ID,
								effective_range: {
									start: '2020-01-01T00:00:00.000Z',
									end: '2026-03-01T00:00:00.000Z'
								}
							}
						},
						{ action: 'update', values: { id: newId, sealed_at: new Date().toISOString() } }
					]
				},
				[
					{
						row: { collection: 'jurisdiction_settings', recordId: JURISDICTION_ID },
						rowVersion: await rowVersion(session, 'jurisdiction_settings', JURISDICTION_ID)
					},
					{
						row: { collection: 'jurisdiction_settings', recordId: newId },
						rowVersion: await rowVersion(session, 'jurisdiction_settings', newId)
					}
				]
			);
			requireAccepted(sealed.value, 'seal with the predecessor ended');
			const versions = (await session.query(
				`select id, sealed_at is not null as sealed, effective_range from jurisdiction_settings where code = 'PUB' order by created_at`
			)) as Row[];
			const day = (value: unknown) => (value == null ? null : String(value).slice(0, 10));
			assert.deepEqual(
				versions.map((row) => {
					const range = row.effective_range as { start: unknown; end: unknown };
					return [row.id, row.sealed, day(range.start), day(range.end)];
				}),
				[
					[JURISDICTION_ID, true, '2020-01-01', '2026-03-01'],
					[newId, true, '2026-03-01', null]
				],
				'the predecessor ends the day the successor begins (half-open), both sealed'
			);
			// Sealed now: the clone's rows are frozen too.
			const frozen = await command(
				session,
				{
					action: 'mutate',
					collection: 'leave_catalogue',
					rows: [{ action: 'update', values: { id: clonedAnnual.id, name: 'no longer editable' } }]
				},
				[
					{
						row: { collection: 'leave_catalogue', recordId: String(clonedAnnual.id) },
						rowVersion: await rowVersion(session, 'leave_catalogue', String(clonedAnnual.id))
					}
				]
			);
			assert.match(
				String(asRecord(frozen.value, 'frozen').message ?? ''),
				/is sealed, so it cannot be created, changed or deleted/
			);

			// A third sealed version overlapping the second is refused, and the exclusion backs the hook.
			const overlapping = await command(session, {
				action: 'mutate',
				collection: 'jurisdiction_settings',
				rows: [
					{
						action: 'create',
						values: {
							id: crypto.randomUUID(),
							code: 'PUB',
							name: 'PUB overlapping',
							sealed_at: new Date().toISOString(),
							currency: 'MYR',
							tax_year_start_month: 1,
							proration: { by: 'CALENDAR_DAYS' },
							ordinary_rate: { per: 'DAY', divisor: 26 },
							regime: { overtime_coverage: null, overtime_rules: [], overtime_limits: [] },
							effective_range: { start: '2026-06-01T00:00:00.000Z', end: null }
						}
					}
				]
			});
			assert.match(
				String(asRecord(overlapping.value, 'overlap').message ?? ''),
				/Sealed PUB versions cannot overlap/
			);

			// (d) a second entity on the same lineage prices against the same version id.
			const companyId = crypto.randomUUID();
			await session.query(
				`insert into companies (id, settings_code, name, registration_number, pay_cutoff_day, pay_frequency, effective_range) values ($1, 'PUB', 'Public Sibling Co', 'PUB-CO-0003', 21, 'MONTHLY', $2)`,
				[companyId, { start: '2020-01-01', end: null }]
			);
			const shiftIds = new Map(
				[SHIFT_WORK_ID, SHIFT_REST_ID, SHIFT_OFF_ID].map((id) => [id, crypto.randomUUID()])
			);
			for (const [fixtureId, id] of shiftIds)
				await session.query(
					`insert into shift_definitions (id, company_id, code, name, variant, effective_range) select $1, $2, code, name, variant, effective_range from shift_definitions where id = $3`,
					[id, companyId, fixtureId]
				);
			// The sibling entity gets its own copy of the named pattern, with its own roster codes
			// inside the cycle, and its terms point at that copy.
			const [terms] = (await session.query(
				'select shift_pattern_id from employment_terms where employment_id = $1',
				['44444444-4444-4444-8444-444444444444']
			)) as Row[];
			const [sourcePattern] = (await session.query(
				'select code, name, pattern, effective_range from shift_patterns where id = $1',
				[terms!.shift_pattern_id]
			)) as Row[];
			const pattern = JSON.parse(
				JSON.stringify(sourcePattern!.pattern).replaceAll(
					/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa[123]/g,
					(id) => shiftIds.get(id) ?? id
				)
			) as unknown;
			const siblingPatternId = crypto.randomUUID();
			await session.query(
				`insert into shift_patterns (id, company_id, code, name, pattern, effective_range) values ($1, $2, $3, $4, $5, $6)`,
				[
					siblingPatternId,
					companyId,
					sourcePattern!.code,
					sourcePattern!.name,
					pattern,
					sourcePattern!.effective_range
				]
			);
			const employeeId = crypto.randomUUID();
			const employmentId = crypto.randomUUID();
			await session.query(
				`insert into employees (id, name, date_of_birth, gender, marital_status, spouse_status, dependents_count) values ($1, 'Sibling Employee', '1990-05-05', 'MALE', 'SINGLE', 'NONE', 0)`,
				[employeeId]
			);
			await session.query(
				`insert into employments (id, employee_id, company_id, employee_number, hire_date, effective_range) values ($1, $2, $3, 'PUB-SIB-0001', '2022-03-01', $4)`,
				[employmentId, employeeId, companyId, { start: '2022-03-01', end: null }]
			);
			await session.query(
				`insert into employment_terms (id, employment_id, base_salary, pay_frequency, work_classification, statutory_work_category, employment_type, job_title, shift_pattern_id, effective_range)
				 values ($1, $2, $3, 'MONTHLY', 'EA_COVERED', 'NON_MANUAL', 'PERMANENT', 'Operator', $4, $5)`,
				[
					crypto.randomUUID(),
					employmentId,
					{ value: 3000, currency: 'MYR' },
					siblingPatternId,
					{ start: '2022-03-01', end: null }
				]
			);
			const runs: Array<{ company: string; id: string }> = [];
			for (const company of [COMPANY_ID, companyId]) {
				const id = crypto.randomUUID();
				requireAccepted(
					(
						await command(session, {
							action: 'mutate',
							collection: 'payroll_runs',
							rows: [
								{ action: 'create', values: { id, company_id: company, period: JANUARY_2026 } }
							]
						})
					).value,
					`January run for ${company}`
				);
				runs.push({ company, id });
			}
			const cited = (await session.query(
				`select r.company_id, r.settings_id, (select count(*) from payslips p where p.payroll_run_id = r.id)::int as payslips from payroll_runs r where r.id = any($1::uuid[]) order by r.company_id`,
				[runs.map((run) => run.id)]
			)) as Row[];
			assert.equal(cited.length, 2);
			assert.ok(
				cited.every((row) => row.settings_id === JURISDICTION_ID),
				`January is priced by the first version: ${JSON.stringify(cited)}`
			);
			assert.equal(
				new Set(cited.map((row) => row.settings_id)).size,
				1,
				'both entities cite one version id'
			);
			assert.ok(
				cited.every((row) => Number(row.payslips) > 0),
				JSON.stringify(cited)
			);
		} finally {
			await session.stop();
		}
	}
);

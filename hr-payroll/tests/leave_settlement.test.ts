// Service runs from the current unbroken stint, or from every stint at the employer, rehires included, where the
// profile's `cumulative_service` says so.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { entitlementOf, type LeavePerson, type LeaveRow } from '../src/lib/ledger/entitlement.ts';
import { startsOf } from '../src/lib/payroll_engine/contract_change.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import { accountsIn, pack, read, syncAll, uuid, workspace } from './kit.ts';

const annual = (code: string): LeaveRow => {
	const root = join('seed/public/jurisdiction', code);
	const version = readdirSync(root)
		.filter((name) => /^version_\d+$/.test(name))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)))
		.at(-1);
	const row = read(join(root, String(version), 'leave_catalog.json')).find(
		(item) => item.code === 'ANNUAL_LEAVE'
	);
	assert.ok(row !== undefined);
	return { code: 'ANNUAL_LEAVE', lookup: objectValue(row.lookup) };
};
const joiner = (started: string): LeavePerson => ({
	started,
	partTime: false,
	gender: null,
	maritalStatus: null,
	terms: { statutory_work_category: 'GENERAL' },
	employment: {
		engagement: 'EMPLOYEE',
		service_started_on: started,
		effective_range: { from: started, to: null },
		terms: { statutory_work_category: 'GENERAL' }
	}
});

describe('service runs from the current stint, or every stint', () => {
	const contract = (id: string, entity: string, from: string, to: string | null) => ({
		id,
		employee_id: 'person',
		status: 'SEALED',
		entity_id: entity,
		effective_range: { from, to }
	});
	const lineage = new Map([
		['my-1', 'MY'],
		['my-2', 'MY'],
		['sg-1', 'SG']
	]);
	const first = contract('a', 'my-1', '2017-08-03', '2025-06-29');
	const rehired = contract('b', 'my-1', '2025-07-04', '2026-01-31');
	const promoted = contract('c', 'my-2', '2026-02-01', null);
	const chain = [first, rehired, promoted];
	const served = (
		contract: Parameters<typeof startsOf>[0],
		stints: Parameters<typeof startsOf>[1] = chain,
		cumulative = true
	) => startsOf(contract, stints, lineage, cumulative).service_started_on;

	it('a rehire takes back the service before the gap only where every stint counts', () => {
		assert.equal(served(promoted), '2017-08-07');
		assert.equal(served(rehired), '2017-08-07');
		assert.equal(served(first), '2017-08-03');
		// off, the statutory continuous service: the rehire starts it again
		assert.equal(served(promoted, chain, false), '2025-07-04');
		assert.equal(served(rehired, chain, false), '2025-07-04');
		assert.equal(served(first, chain, false), '2017-08-03');
	});

	it('another jurisdiction, a void stint and a later credit do not move it; an earlier credit does', () => {
		const abroad = { ...first, entity_id: 'sg-1' };
		assert.equal(served(promoted, [abroad, rehired, promoted]), '2025-07-04');
		assert.equal(served(promoted, [{ ...first, status: 'VOID' }, rehired, promoted]), '2025-07-04');
		assert.equal(served({ ...promoted, service_started_on: '2025-07-04' }), '2017-08-07');
		assert.equal(served({ ...promoted, service_started_on: '2015-01-01' }), '2015-01-01');
		assert.equal(
			served({ ...promoted, service_started_on: '2015-01-01' }, chain, false),
			'2015-01-01'
		);
	});

	it('the employment start is the current unbroken stint, whatever the flag or a credit', () => {
		assert.deepEqual(startsOf(promoted, chain, lineage, true), {
			service_started_on: '2017-08-07',
			employment_started_on: '2025-07-04'
		});
		assert.deepEqual(
			startsOf({ ...promoted, service_started_on: '2015-01-01' }, chain, lineage, false),
			{
				service_started_on: '2015-01-01',
				employment_started_on: '2025-07-04'
			}
		);
		assert.equal(startsOf(first, chain, lineage, true).employment_started_on, '2017-08-03');
	});

	/** What the fixture's own row grants a service year that opens on `opens`, for service counted from `started`. */
	const owed = (started: string, opens: string) =>
		entitlementOf(annual('MY').lookup, joiner(started), opens);
	const EVERY = owed('2017-08-07', '2026-08-07');
	const REHIRE = owed('2025-07-04', '2026-07-04');
	it('the fixture row grants the two service lengths different days', () => {
		assert.ok(EVERY !== null && REHIRE !== null && EVERY > REHIRE && REHIRE > 0);
	});

	const rehire = (cumulative: boolean) => {
		const base = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{ rate: { amount: 3120, unit: 'MONTHLY' }, statutory_work_category: 'GENERAL' },
			{},
			[],
			[],
			'2026-11-06'
		);
		// each stint records its own start, as replacements once copied it: no credit reaches back past the gap
		const stints = (base.employee_contract ?? []).flatMap((held) => [
			{
				...held,
				id: uuid(60),
				service_started_on: '2017-08-03',
				effective_range: { from: '2017-08-03', to: '2025-06-29' }
			},
			{
				...held,
				service_started_on: '2025-07-04',
				effective_range: { from: '2025-07-04', to: null }
			}
		]);
		const profiles = (base.employee_profile ?? []).map((row) => ({
			...row,
			cumulative_service: cumulative
		}));
		return workspace({
			seed: { ...base, employee_profile: profiles, employee_contract: stints },
			now: '2026-11-06T02:00:00.000Z'
		});
	};

	it.live('sync anchors and bands the leave on every stint where the profile counts them', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const leave = (yield* accountsIn(t)).leave?.['ANNUAL_LEAVE'];
			assert.equal(leave?.['MY.S.2026-08-07']?.entitled, EVERY);
		}).pipe(Effect.provide(rehire(true)))
	);

	it.live('turning it off syncs the person again: the rehire opens its own service year', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* t
				.as(t.member(['hr_controller']))
				.act('employee_profile.update', [
					{ target: idOf('employee_profile', uuid(4)), set: { cumulative_service: false } }
				]);
			yield* t.runDue();
			const leave = (yield* accountsIn(t)).leave?.['ANNUAL_LEAVE'];
			assert.equal(leave?.['MY.S.2026-07-04']?.entitled, REHIRE);
		}).pipe(Effect.provide(rehire(true)))
	);

	it.live('without it, only the rehire counts', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const leave = (yield* accountsIn(t)).leave?.['ANNUAL_LEAVE'];
			assert.equal(leave?.['MY.S.2026-08-07'], undefined);
			assert.equal(leave?.['MY.S.2026-07-04']?.entitled, REHIRE);
		}).pipe(Effect.provide(rehire(false)))
	);
});

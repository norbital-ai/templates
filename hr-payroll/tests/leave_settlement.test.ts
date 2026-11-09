// A window that closes settles once, as the next opens: its rule as of its last day, where a share by completed months
// counts that day as served and the service band stays the one the day itself reaches. Service runs from the current
// unbroken stint, or from every stint at the employer, rehires included, where the profile's `cumulative_service` says so.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { apply, diff, type Accounts, type Movement } from '../src/lib/ledger/core.ts';
import { entitlementOf, type LeavePerson, type LeaveRow } from '../src/lib/ledger/entitlement.ts';
import { entitlementPlans } from '../src/lib/ledger/service.ts';
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

type Held = { readonly accounts: Accounts; readonly ledger: readonly Movement[] };
const EMPTY: Held = { accounts: {}, ledger: [] };
/** One sync on a day, over the ledger's pure core: what each source should stand at, less what it posted. */
const sync = (row: LeaveRow, person: LeavePerson, scope: string, held: Held, on: string): Held => {
	const moves = entitlementPlans(
		[{ ...row, account: 'leave' }],
		person,
		{ scope, started: person.started, events: [] },
		'balance',
		held.accounts,
		on
	).flatMap((plan) =>
		diff(
			plan.source,
			plan.wanted,
			held.ledger.filter((item) => item.source === plan.source)
		)
	);
	return { accounts: apply(held.accounts, moves), ledger: [...held.ledger, ...moves] };
};
const across = (row: LeaveRow, person: LeavePerson, scope: string, days: readonly string[]) =>
	days.reduce((held, day) => sync(row, person, scope, held, day), EMPTY);
const windowOf = (held: Held, period: string) => held.accounts.leave?.['ANNUAL_LEAVE']?.[period];

describe('a closing window settles on its last day', () => {
	it('Malaysia: the first year closes at 8, and the second stays in its band', () => {
		// the seeded rule counts the day itself for its share
		const row = annual('MY');
		const person = joiner('2025-05-21');
		const before = across(row, person, 'MY', ['2026-05-01']);
		assert.equal(windowOf(before, 'MY.S.2025-05-21')?.entitled, 7);
		const turned = sync(row, person, 'MY', before, '2026-05-21');
		assert.equal(windowOf(turned, 'MY.S.2025-05-21')?.entitled, 8);
		// the settled year carries: the statutory grant carries in full
		assert.deepEqual(windowOf(turned, 'MY.S.2026-05-21'), { entitled: 8, carried: 8 });
		// once: the next sync leaves the closed year alone
		assert.deepEqual(sync(row, person, 'MY', turned, '2026-05-22').ledger, turned.ledger);
		const second = across(row, person, 'MY', ['2027-05-01', '2027-05-21']).accounts.leave;
		assert.equal(second?.['ANNUAL_LEAVE']?.['MY.S.2026-05-21']?.entitled, 8);
		assert.equal(second?.['ANNUAL_LEAVE']?.['MY.S.2027-05-21']?.entitled, 12);
	});

	it('Vietnam: a calendar year closes with the month that ends on its last day', () => {
		const row = annual('VN');
		const person = joiner('2025-07-01');
		const before = across(row, person, 'VN', ['2025-12-01']);
		assert.equal(windowOf(before, 'VN.Y.2025-01-01')?.entitled, 5);
		const turned = sync(row, person, 'VN', before, '2026-01-01');
		assert.equal(windowOf(turned, 'VN.Y.2025-01-01')?.entitled, 6);
		assert.equal(windowOf(turned, 'VN.Y.2026-01-01')?.entitled, 12);
	});

	it('Singapore: the first-year figure prorates before the first band', () => {
		const seeded = annual('SG');
		const row = {
			...seeded,
			lookup: {
				...seeded.lookup,
				proration: 'COMPLETED_MONTHS',
				first_year_days: 7,
				service_bands: [12, 24, 36, 48, 60, 72, 84].map((months, at) => ({
					service_months: months,
					days: 8 + at
				}))
			}
		};
		const person = joiner('2025-05-21');
		const on = (day: string) => entitlementOf(row.lookup, person, day);
		// months 3 to 11 match the statute's table
		assert.deepEqual(
			[
				'2025-08-21',
				'2025-09-21',
				'2025-10-21',
				'2025-11-21',
				'2025-12-21',
				'2026-01-21',
				'2026-02-21',
				'2026-03-21',
				'2026-04-21'
			].map(on),
			[2, 2, 3, 4, 4, 5, 5, 6, 6]
		);
		// eligible once three months are served, the day itself counting
		assert.deepEqual(['2025-08-19', '2025-08-20'].map(on), [0, 2]);
		const turned = across(row, person, 'SG', ['2026-05-01', '2026-05-21']);
		assert.equal(windowOf(turned, 'SG.S.2025-05-21')?.entitled, 7);
		assert.deepEqual(windowOf(turned, 'SG.S.2026-05-21'), { entitled: 8, carried: 7 });
		const second = across(row, person, 'SG', ['2027-05-01', '2027-05-21']);
		assert.equal(windowOf(second, 'SG.S.2026-05-21')?.entitled, 8);
		// a part-timer's first-year share is the full-time share by their hours
		const part = {
			...person,
			partTime: true,
			terms: { ...person.terms, normal_hours_per_week: 22 }
		};
		const halved = { ...row.lookup, part_time_pro_rata: true, full_time_weekly_hours: 44 };
		assert.equal(entitlementOf(halved, part, '2026-05-20'), 3.5);
	});
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
		assert.equal(entitlementOf(annual('MY').lookup, joiner('2017-08-07'), '2026-11-09'), 16);
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

	it.live(
		'sync anchors and bands Malaysian leave on every stint where the profile counts them',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const leave = (yield* accountsIn(t)).leave?.['ANNUAL_LEAVE'];
				assert.equal(leave?.['MY.S.2026-08-07']?.entitled, 16);
			}).pipe(Effect.provide(rehire(true)))
	);

	it.live('turning it off syncs the person again: the rehire opens its own service year at 8', () =>
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
			assert.equal(leave?.['MY.S.2026-07-04']?.entitled, 8);
		}).pipe(Effect.provide(rehire(true)))
	);

	it.live('without it, only the rehire counts: a second year below two years of service', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const leave = (yield* accountsIn(t)).leave?.['ANNUAL_LEAVE'];
			assert.equal(leave?.['MY.S.2026-08-07'], undefined);
			assert.equal(leave?.['MY.S.2026-07-04']?.entitled, 8);
		}).pipe(Effect.provide(rehire(false)))
	);
});

// @ts-nocheck -- focused arithmetic tests use the smallest AutomationApi surface each path reads.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	accountSettlement,
	commuteDailyRate,
	coverageInputs,
	entitlementEntries,
	ensureAccount,
	expireCarry,
	mergedSettlement,
	profileAt,
	reconcileEmploymentLeave,
	reconcileTarget,
	requireStatutoryMappings,
	resolveStatutoryCoverage,
	retireDueLeavePlanPredecessors,
	transferCarry
} from '../src/lib/leave/reconcile.ts';
import { eventAllocationDays } from '../src/collections/leave_accounts/+hooks.ts';
import leaveEntryHooks from '../src/collections/leave_entries/+hooks.ts';
import leaveAccountHooks from '../src/collections/leave_accounts/+hooks.ts';
import leavePlanHooks from '../src/collections/leave_plans/+hooks.ts';

const plan = (id, start, transition = 'NEXT_LEAVE_YEAR') => ({
	id,
	lifecycle: 'ACTIVE',
	effective_range: { start, end: null },
	transition
});

const profile = (id, start, days, transition = 'NEXT_LEAVE_YEAR') => ({
	id,
	code: 'SG',
	lifecycle: 'SEALED',
	effective_range: { start, end: null },
	statutory_leave: [
		{
			kind: 'ANNUAL',
			ladder: [{ band_from: 0, days }],
			per_child: null,
			max_days: null,
			transition,
			settlement: { settlement: 'FORFEIT' }
		}
	]
});

const type = (
	companyDays = 0,
	accrual = { kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } }
) => ({
	id: 'type',
	code: 'ANNUAL',
	name: 'Annual leave',
	statutory_kind: 'ANNUAL',
	entitlement: { layers: companyDays === 0 ? [] : [{ band_from: 0, days: companyDays }] },
	accrual,
	eligibility: []
});

const employment = { id: 'employment', hire_date: '2020-01-01' };
const account = {
	id: 'account',
	opening_plan_id: 'plan-old',
	opening_statutory_profile_id: 'law-old',
	starts_on: '2026-01-01',
	ends_on: '2026-12-31',
	status: 'OPEN',
	settlement: { settlement: 'FORFEIT' }
};
const opening = {
	id: 'opening',
	leave_account_id: account.id,
	kind: 'OPENING_ENTITLEMENT',
	effective_on: '2026-01-01',
	days: 10,
	source_key: 'opening',
	leave_plan_id: 'plan-old',
	statutory_profile_id: 'law-old',
	approval_id: null
};

function eventProfile(id, start, end, days) {
	const row = profile(id, start, days, 'NEXT_LEAVE_YEAR');
	row.effective_range.end = end;
	row.statutory_leave[0] = {
		...row.statutory_leave[0],
		kind: 'SHARED_PARENTAL',
		account_basis: 'EVENT',
		qualifying_service_months: 0,
		vesting: 'UPFRONT',
		event: {
			window_months: 12,
			allocation: 'HOUSEHOLD',
			unit: 'WEEKS',
			weekly_index_cap: 6
		}
	};
	return row;
}

function eventAccountApi(profiles, committed = [], pending = []) {
	const eventType = {
		...type(0, { kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } }),
		id: 'event-type',
		company_id: 'company',
		leave_plan_id: 'event-plan',
		code: 'SHARED_PARENTAL',
		name: 'Shared parental leave',
		statutory_kind: 'SHARED_PARENTAL',
		account_basis: 'EVENT',
		event_unit: 'WEEKS',
		event_window_months: null
	};
	return {
		db: {
			employments: {
				findFirst: () =>
					Effect.succeed({
						id: 'employment',
						company_id: 'company',
						employee_id: 'employee',
						hire_date: '2020-01-01',
						exit_date: null,
						approval_id: null
					})
			},
			leave_types: {
				findFirst: () => Effect.succeed(eventType),
				findMany: ({ where }) =>
					Effect.succeed(
						where.id.in.map((id) => ({
							id,
							statutory_kind: 'SHARED_PARENTAL'
						}))
					)
			},
			leave_plans: {
				findFirst: () =>
					Effect.succeed({
						...plan('event-plan', '2025-01-01'),
						company_id: 'company',
						approval_id: null
					})
			},
			companies: {
				findFirst: () =>
					Effect.succeed({ id: 'company', jurisdiction_id: profiles[0].id, approval_id: null })
			},
			employees: { findFirst: () => Effect.succeed({ id: 'employee', gender: null }) },
			employment_terms: { findMany: () => Effect.succeed([]) },
			employee_children: { findMany: () => Effect.succeed([]) },
			jurisdictions: {
				findFirst: () => Effect.succeed({ code: 'SG' }),
				findMany: () => Effect.succeed(profiles)
			},
			leave_accounts: {
				findMany: () => Effect.succeed(committed),
				findPending: () => Effect.succeed(pending)
			}
		}
	};
}

function reconciliationApi({ asOf, exitDate = null, accounts, entries, requests = [] }) {
	const employmentRow = {
		id: 'employment',
		company_id: 'company',
		employee_id: 'employee',
		hire_date: '2020-01-01',
		exit_date: exitDate,
		approval_id: null
	};
	const planRow = {
		...plan('plan-old', '2026-01-01'),
		company_id: 'company',
		approval_id: null
	};
	const profileRow = { ...profile('law-old', '2026-01-01', 0), approval_id: null };
	let nextEntryId = 1;
	return {
		api: {
			db: {
				employments: { findFirst: () => Effect.succeed(employmentRow) },
				companies: {
					findFirst: () =>
						Effect.succeed({
							id: 'company',
							jurisdiction_id: 'law-old',
							leave_year_start_month: 1,
							approval_id: null
						})
				},
				employees: {
					findFirst: () => Effect.succeed({ id: 'employee', gender: null })
				},
				employment_terms: { findMany: () => Effect.succeed([]) },
				employee_children: { findMany: () => Effect.succeed([]) },
				leave_plans: { findMany: () => Effect.succeed([planRow]) },
				leave_types: {
					findMany: () => Effect.succeed([]),
					findFirst: () => Effect.succeed(null)
				},
				jurisdictions: {
					findFirst: () => Effect.succeed({ code: 'SG' }),
					findMany: () => Effect.succeed([profileRow])
				},
				leave_accounts: {
					findMany: () => Effect.succeed(accounts),
					findFirst: ({ where }) =>
						Effect.succeed(
							accounts.find((row) =>
								where.id != null
									? row.id === where.id.eq
									: row.employment_id === where.employment_id?.eq &&
										row.leave_code === where.leave_code?.eq &&
										row.leave_year === where.leave_year?.eq
							) ?? null
						),
					mutate: (mutations) =>
						Effect.sync(() => {
							for (const mutation of mutations) {
								const current = accounts.find((row) => row.id === mutation.id);
								if (current != null) Object.assign(current, mutation);
								else
									accounts.push({
										id: `account-${accounts.length + 1}`,
										approval_id: null,
										...mutation
									});
							}
						})
				},
				leave_entries: {
					findMany: ({ where }) =>
						Effect.succeed(
							entries.filter((entry) =>
								where.source_request_id != null
									? entry.source_request_id === where.source_request_id.eq
									: entry.leave_account_id === where.leave_account_id.eq
							)
						),
					mutate: (mutations) =>
						Effect.sync(() => {
							entries.push(
								...mutations.map((mutation) => ({
									...mutation,
									id: `posted-${nextEntryId++}`,
									approval_id: null
								}))
							);
						})
				},
				leave_requests: {
					findPending: () => Effect.succeed([]),
					findMany: () => Effect.succeed(requests)
				}
			}
		},
		asOf
	};
}

test('monthly schedules never catch up accrual from before hire', () => {
	const entries = entitlementEntries({
		accountId: 'account',
		type: type(12, { kind: 'MONTHLY', settlement: { settlement: 'FORFEIT' } }),
		plan: plan('plan-old', '2026-01-01'),
		profile: profile('law-old', '2026-01-01', 0),
		target: 12,
		yearStart: '2026-01-01',
		yearEnd: '2026-12-31',
		hireDate: '2026-07-15'
	});
	assert.deepEqual(
		entries.map((entry) => [entry.effective_on, entry.days]),
		[
			['2026-07-31', 1],
			['2026-08-31', 1],
			['2026-09-30', 1],
			['2026-10-31', 1],
			['2026-11-30', 1],
			['2026-12-31', 1]
		]
	);
});

test('statutory monthly vesting uses its own whole-day half-up rule', () => {
	const statutoryOpening = (completed) =>
		entitlementEntries({
			accountId: 'account',
			type: type(0, { kind: 'MONTHLY', settlement: { settlement: 'FORFEIT' } }),
			plan: plan('plan-old', '2026-01-01'),
			profile: profile('law-old', '2026-01-01', 7),
			target: 7,
			yearStart: '2026-01-01',
			yearEnd: '2026-12-31',
			hireDate: '2026-01-01',
			openingDate: '2026-04-15',
			statutoryTarget: 7,
			companyTarget: 0,
			statutoryVesting: 'MONTHLY',
			statutoryRounding: 'WHOLE_DAY_HALF_UP',
			statutoryCatchUpMonths: completed
		})[0].days;
	assert.equal(statutoryOpening(3), 2);
	assert.equal(statutoryOpening(4), 2);
});

test('qualifying-event law is selected from the event cohort, not the request date', async () => {
	const oldLaw = eventProfile('sg-six-weeks', '2025-04-01', '2026-04-01', 6);
	const newLaw = eventProfile('sg-ten-weeks', '2026-04-01', null, 10);
	assert.equal(profileAt([oldLaw, newLaw], 'SG', '2026-03-31').id, oldLaw.id);
	assert.equal(profileAt([oldLaw, newLaw], 'SG', '2026-04-01').id, newLaw.id);

	const handler = leaveAccountHooks.mutate.perRecord.before.handler;
	const march = await Effect.runPromise(
		handler({
			input: {
				employment_id: 'employment',
				leave_type_id: 'event-type',
				account_kind: 'EVENT',
				event_reference: 'child-2026-03',
				qualifying_date: '2026-03-31',
				statutory_cohort_date: '2026-03-31',
				starts_on: '2026-03-31',
				ends_on: '2027-03-30',
				allocation_units: 6,
				weekly_index: 5.5,
				eligibility_evidence: 'Verified birth cohort and household allocation'
			},
			existing: null,
			recordId: 'march-account',
			api: eventAccountApi([oldLaw, newLaw])
		})
	);
	assert.equal(march.opening_statutory_profile_id, oldLaw.id);
	assert.equal(march.calculation.statutory_days, 33);
	assert.equal(march.entitlement_days, 33);
	assert.equal(march.ends_on, '2027-03-30');

	const april = await Effect.runPromise(
		handler({
			input: {
				...march,
				event_reference: 'child-2026-04',
				qualifying_date: '2026-04-01',
				statutory_cohort_date: '2026-04-01',
				starts_on: '2026-04-01',
				ends_on: '2027-03-31',
				allocation_units: 10,
				weekly_index: 6
			},
			existing: null,
			recordId: 'april-account',
			api: eventAccountApi([oldLaw, newLaw])
		})
	);
	assert.equal(april.opening_statutory_profile_id, newLaw.id);
	assert.equal(april.calculation.statutory_days, 60);
	assert.equal(april.entitlement_days, 60);
});

test('an early birth may use the reviewed estimated-delivery cohort while its window starts at birth', async () => {
	const oldLaw = eventProfile('sg-six-weeks', '2025-04-01', '2026-04-01', 6);
	const newLaw = eventProfile('sg-ten-weeks', '2026-04-01', null, 10);
	const account = await Effect.runPromise(
		leaveAccountHooks.mutate.perRecord.before.handler({
			input: {
				employment_id: 'employment',
				leave_type_id: 'event-type',
				account_kind: 'EVENT',
				event_reference: 'child-early-birth',
				qualifying_date: '2026-03-28',
				statutory_cohort_date: '2026-04-02',
				starts_on: '2026-03-28',
				ends_on: '2027-03-27',
				allocation_units: 10,
				weekly_index: 6,
				eligibility_evidence: 'Birth registration and reviewed estimated delivery date'
			},
			existing: null,
			recordId: 'early-birth-account',
			api: eventAccountApi([oldLaw, newLaw])
		})
	);
	assert.equal(account.opening_statutory_profile_id, newLaw.id);
	assert.equal(account.qualifying_date, '2026-03-28');
	assert.equal(account.statutory_cohort_date, '2026-04-02');
	assert.equal(account.ends_on, '2027-03-27');
	assert.equal(account.entitlement_days, 60);
});

test('week allocations use the verified weekly index and floor only the final duration', () => {
	assert.equal(eventAllocationDays(6, 5.5), 33);
	assert.equal(eventAllocationDays(10, 6), 60);
	assert.equal(eventAllocationDays(3.5, 5.3), 18.5);
});

test('a newly sealed statutory kind cannot disappear behind a missing company mapping', () => {
	const currentLaw = eventProfile('new-law', '2026-04-01', null, 10);
	currentLaw.statutory_leave.push({
		kind: 'NEW_PARENTAL_CATEGORY',
		account_basis: 'YEAR',
		ladder: [{ band_from: 0, days: 4 }],
		per_child: null,
		max_days: null,
		transition: 'FULL_AT_EFFECTIVE_DATE',
		settlement: { settlement: 'FORFEIT' },
		authority: 'Enacted test law'
	});
	assert.throws(
		() =>
			requireStatutoryMappings(currentLaw, [
				{
					statutory_kind: 'SHARED_PARENTAL',
					account_basis: 'EVENT',
					event_unit: 'WEEKS'
				}
			]),
		/missing statutory mappings for NEW_PARENTAL_CATEGORY/i
	);
});

test('one event cohort enforces its household maximum across companies and leave codes', async () => {
	const currentLaw = eventProfile('sg-ten-weeks', '2026-04-01', null, 10);
	const existingAllocation = {
		id: 'other-parent-account',
		employment_id: 'other-company-employment',
		leave_type_id: 'other-company-parental-type',
		leave_code: 'PARENT_POOL',
		event_reference: 'CHILD-42',
		account_kind: 'EVENT',
		opening_statutory_profile_id: currentLaw.id,
		allocation_units: 6,
		weekly_index: 5.5,
		entitlement_days: 33,
		approval_id: null
	};
	const handler = leaveAccountHooks.mutate.perRecord.before.handler;
	const input = {
		employment_id: 'employment',
		leave_type_id: 'event-type',
		account_kind: 'EVENT',
		event_reference: 'child-42',
		qualifying_date: '2026-04-01',
		statutory_cohort_date: '2026-04-01',
		starts_on: '2026-04-01',
		ends_on: '2027-03-31',
		allocation_units: 4,
		weekly_index: 6,
		eligibility_evidence: 'Second parent verified against the same household reference'
	};
	const accepted = await Effect.runPromise(
		handler({
			input,
			existing: null,
			recordId: 'second-parent-account',
			api: eventAccountApi([currentLaw], [existingAllocation])
		})
	);
	assert.equal(accepted.entitlement_days, 24);
	await assert.rejects(
		Effect.runPromise(
			handler({
				input: { ...input, allocation_units: 4.5 },
				existing: null,
				recordId: 'overallocated-account',
				api: eventAccountApi([currentLaw], [existingAllocation])
			})
		),
		/household already allocated 6 weeks/i
	);
});

test('a statutory successor appends one idempotent target delta', async () => {
	const posted = [];
	const currentPlan = plan('plan-old', '2026-01-01');
	const currentProfile = profile('law-new', '2026-07-01', 15, 'FULL_AT_EFFECTIVE_DATE');
	const api = {
		db: { leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) } }
	};
	const count = await Effect.runPromise(
		reconcileTarget({
			api,
			account,
			entries: [opening],
			employment,
			type: type(),
			plan: currentPlan,
			profile: currentProfile,
			children: [],
			asOf: '2026-07-01'
		})
	);
	assert.equal(count, 1);
	assert.deepEqual(
		posted.map(({ kind, effective_on, days, source_key }) => ({
			kind,
			effective_on,
			days,
			source_key
		})),
		[
			{
				kind: 'STATUTORY_ADJUSTMENT',
				effective_on: '2026-07-01',
				days: 5,
				source_key: 'statutory:law-new'
			}
		]
	);
	assert.equal(
		await Effect.runPromise(
			reconcileTarget({
				api,
				account,
				entries: [opening, { ...posted[0], id: 'adjustment', approval_id: null }],
				employment,
				type: type(),
				plan: currentPlan,
				profile: currentProfile,
				children: [],
				asOf: '2026-07-01'
			})
		),
		0
	);
});

test('the newest changed source chooses the transition when plan and law ids both differ', async () => {
	const posted = [];
	const api = {
		db: { leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) } }
	};
	await Effect.runPromise(
		reconcileTarget({
			api,
			account,
			entries: [opening],
			employment,
			type: type(),
			plan: plan('plan-new', '2026-04-01', 'NEXT_LEAVE_YEAR'),
			profile: profile('law-new', '2026-07-01', 15, 'FULL_AT_EFFECTIVE_DATE'),
			children: [],
			asOf: '2026-07-01'
		})
	);
	assert.equal(posted[0].kind, 'STATUTORY_ADJUSTMENT');
	assert.equal(posted[0].days, 5);
});

test('personal fact drift does not rewrite an already sealed account', async () => {
	const currentProfile = profile('law-old', '2026-01-01', 10, 'FULL_AT_EFFECTIVE_DATE');
	currentProfile.statutory_leave[0].per_child = {
		age_limit: 7,
		min_children: 1,
		days: 3
	};
	const api = {
		db: { leave_entries: { mutate: () => Effect.die('sealed account must not be rewritten') } }
	};
	assert.equal(
		await Effect.runPromise(
			reconcileTarget({
				api,
				account,
				entries: [opening],
				employment,
				type: type(),
				plan: plan('plan-old', '2026-01-01'),
				profile: currentProfile,
				children: [
					{
						id: 'child',
						child_birthdate: '2026-06-01',
						effective_range: { start: '2026-06-01', end: null },
						supersedes_id: null
					}
				],
				asOf: '2026-07-01'
			})
		),
		0
	);
});

test('a newly eligible mid-year type opens with the plan transition applied once', async () => {
	let storedAccount;
	const posted = [];
	const api = {
		db: {
			leave_accounts: {
				mutate: ([row]) =>
					Effect.sync(() => {
						storedAccount = { ...row, id: 'generated-account', approval_id: null };
					}),
				findFirst: () => Effect.succeed(storedAccount)
			},
			leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) }
		}
	};
	const result = await Effect.runPromise(
		ensureAccount({
			api,
			employment,
			type: type(12),
			plan: plan('plan-new', '2026-07-01', 'PRORATE_REMAINDER'),
			profile: profile('law-old', '2026-01-01', 10),
			children: [],
			year: 2026,
			startMonth: 1,
			existing: [],
			midYearOpening: {
				effectiveOn: '2026-07-01',
				transition: 'PRORATE_REMAINDER'
			}
		})
	);
	assert.equal(result.created, true);
	assert.equal(storedAccount.entitlement_days, 6);
	assert.equal(posted.length, 1);
	assert.equal(posted[0].kind, 'OPENING_ENTITLEMENT');
	assert.equal(posted[0].effective_on, '2026-07-01');
	assert.equal(posted[0].days, 6);
});

test('a mid-year policy calculates child-scaled leave at its effective date', async () => {
	let storedAccount;
	const posted = [];
	const api = {
		db: {
			leave_accounts: {
				mutate: ([row]) =>
					Effect.sync(() => {
						storedAccount = { ...row, id: 'child-account', approval_id: null };
					}),
				findFirst: () => Effect.succeed(storedAccount)
			},
			leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) }
		}
	};
	const childProfile = profile('law-new', '2026-07-01', 0, 'FULL_AT_EFFECTIVE_DATE');
	childProfile.statutory_leave[0].per_child = {
		age_limit: 7,
		min_children: 1,
		days: 3
	};
	await Effect.runPromise(
		ensureAccount({
			api,
			employment,
			type: type(),
			plan: plan('plan-new', '2026-07-01', 'FULL_AT_EFFECTIVE_DATE'),
			profile: childProfile,
			children: [
				{
					id: 'child',
					child_birthdate: '2026-06-01',
					effective_range: { start: '2026-06-01', end: null },
					supersedes_id: null
				}
			],
			year: 2026,
			startMonth: 1,
			existing: [],
			midYearOpening: {
				effectiveOn: '2026-07-01',
				transition: 'FULL_AT_EFFECTIVE_DATE'
			}
		})
	);
	assert.equal(storedAccount.calculation.calculated_on, '2026-07-01');
	assert.equal(storedAccount.entitlement_days, 3);
	assert.equal(posted[0].days, 3);
});

test('monthly leave first becoming eligible accrues only after eligibility', async () => {
	let storedAccount;
	const posted = [];
	const api = {
		db: {
			leave_accounts: {
				mutate: ([row]) =>
					Effect.sync(() => {
						storedAccount = { ...row, id: 'service-account', approval_id: null };
					}),
				findFirst: () => Effect.succeed(storedAccount)
			},
			leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) }
		}
	};
	await Effect.runPromise(
		ensureAccount({
			api,
			employment,
			type: type(12, { kind: 'MONTHLY', settlement: { settlement: 'FORFEIT' } }),
			plan: plan('plan-old', '2026-01-01'),
			profile: profile('law-old', '2026-01-01', 0),
			children: [],
			year: 2026,
			startMonth: 1,
			existing: [],
			eligibilityOpeningOn: '2026-10-15'
		})
	);
	assert.equal(storedAccount.entitlement_days, 3);
	assert.deepEqual(
		posted.map((entry) => [entry.effective_on, entry.days]),
		[
			['2026-10-31', 1],
			['2026-11-30', 1],
			['2026-12-31', 1]
		]
	);
});

test('statutory monthly vesting catches up completed service when company eligibility is stricter', async () => {
	let storedAccount;
	const posted = [];
	const api = {
		db: {
			leave_accounts: {
				mutate: ([row]) =>
					Effect.sync(() => {
						storedAccount = { ...row, id: 'statutory-account', approval_id: null };
					}),
				findFirst: () => Effect.succeed(storedAccount)
			},
			leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) }
		}
	};
	const statutoryProfile = profile('law-old', '2026-01-01', 12);
	statutoryProfile.statutory_leave[0].qualifying_service_months = 3;
	statutoryProfile.statutory_leave[0].vesting = 'MONTHLY';
	await Effect.runPromise(
		ensureAccount({
			api,
			employment: { ...employment, hire_date: '2026-07-15' },
			type: type(24, { kind: 'MONTHLY', settlement: { settlement: 'FORFEIT' } }),
			plan: plan('plan-old', '2026-01-01'),
			profile: statutoryProfile,
			children: [],
			year: 2026,
			startMonth: 1,
			existing: [],
			companyEligible: false,
			eligibilityOpeningOn: '2026-10-15'
		})
	);
	assert.equal(storedAccount.calculation.company_days, 0);
	assert.equal(storedAccount.calculation.statutory_days, 12);
	assert.equal(storedAccount.entitlement_days, 6);
	assert.deepEqual(
		posted.map((entry) => [entry.effective_on, entry.days]),
		[
			['2026-10-15', 3],
			['2026-10-31', 1],
			['2026-11-30', 1],
			['2026-12-31', 1]
		]
	);
});

test('restored leave is not treated as consumed carry at expiry', async () => {
	const posted = [];
	const entries = [
		{
			id: 'carry',
			kind: 'CARRY_FORWARD',
			effective_on: '2026-01-01',
			expires_on: '2026-03-31',
			days: 5,
			source_key: 'carry:old',
			approval_id: null
		},
		{ kind: 'TAKEN', effective_on: '2026-02-01', days: -5, approval_id: null },
		{ kind: 'RESTORED', effective_on: '2026-02-01', days: 5, approval_id: null }
	];
	const api = {
		db: { leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) } }
	};
	assert.equal(await Effect.runPromise(expireCarry(api, account, entries, '2026-04-01')), 1);
	assert.equal(posted[0].days, -5);
});

test('restoring a request after expiry appends the newly required expiry delta', async () => {
	const posted = [];
	const entries = [
		{
			id: 'carry',
			kind: 'CARRY_FORWARD',
			effective_on: '2026-01-01',
			expires_on: '2026-03-31',
			days: 10,
			source_key: 'carry:old',
			approval_id: null
		},
		{ kind: 'TAKEN', effective_on: '2026-02-01', days: -4, approval_id: null },
		{
			kind: 'EXPIRED',
			effective_on: '2026-03-31',
			days: -6,
			source_key: 'expire:carry',
			approval_id: null
		},
		{ kind: 'RESTORED', effective_on: '2026-02-01', days: 4, approval_id: null }
	];
	const api = {
		db: { leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) } }
	};
	assert.equal(await Effect.runPromise(expireCarry(api, account, entries, '2026-04-02')), 1);
	assert.equal(posted[0].days, -4);
	assert.equal(posted[0].source_key, 'expire:carry:v2');
});

test('carry expiry is reread before an employment exit settles the account', async () => {
	const accounts = [
		{
			...account,
			leave_year: 2026,
			leave_code: 'ANNUAL',
			leave_type_id: 'type',
			carry_limit_days: 0,
			carry_expiry_months: 3
		}
	];
	const entries = [
		{
			id: 'carry',
			leave_account_id: account.id,
			kind: 'CARRY_FORWARD',
			effective_on: '2026-01-01',
			expires_on: '2026-03-31',
			days: 5,
			source_key: 'carry:prior',
			approval_id: null
		}
	];
	const { api, asOf } = reconciliationApi({
		asOf: '2026-04-02',
		exitDate: '2026-04-01',
		accounts,
		entries
	});

	await Effect.runPromise(reconcileEmploymentLeave(api, 'employment', asOf));

	assert.deepEqual(
		entries.map((entry) => [entry.kind, entry.days, entry.source_key]),
		[
			['CARRY_FORWARD', 5, 'carry:prior'],
			['EXPIRED', -5, 'expire:carry']
		]
	);
	assert.equal(accounts[0].status, 'CLOSED');
});

test('carry expiry is reread before year close transfers the balance', async () => {
	const previous = {
		...account,
		id: 'old-account',
		leave_year: 2026,
		leave_code: 'ANNUAL',
		leave_type_id: 'type',
		carry_limit_days: 5,
		carry_expiry_months: 12
	};
	const next = {
		...account,
		id: 'new-account',
		opening_plan_id: 'plan-old',
		opening_statutory_profile_id: 'law-old',
		starts_on: '2027-01-01',
		ends_on: '2027-12-31',
		leave_year: 2027,
		leave_code: 'ANNUAL',
		leave_type_id: 'type',
		carry_limit_days: 5,
		carry_expiry_months: 12
	};
	const accounts = [previous, next];
	const entries = [
		{
			id: 'carry',
			leave_account_id: previous.id,
			kind: 'CARRY_FORWARD',
			effective_on: '2026-01-01',
			expires_on: '2026-12-31',
			days: 5,
			source_key: 'carry:prior',
			approval_id: null
		}
	];
	const { api, asOf } = reconciliationApi({ asOf: '2027-01-02', accounts, entries });

	await Effect.runPromise(reconcileEmploymentLeave(api, 'employment', asOf));

	assert.deepEqual(
		entries.map((entry) => [entry.kind, entry.days, entry.source_key]),
		[
			['CARRY_FORWARD', 5, 'carry:prior'],
			['EXPIRED', -5, 'expire:carry']
		]
	);
	assert.equal(previous.status, 'CLOSED');
});

test('a retry closes an account after its carry entries already committed', async () => {
	const closed = [];
	const previous = { ...account, id: 'old-account', ends_on: '2025-12-31' };
	const api = {
		db: {
			leave_accounts: { mutate: (rows) => Effect.sync(() => closed.push(...rows)) },
			leave_entries: { mutate: () => Effect.die('must not duplicate carry') }
		}
	};
	assert.equal(
		await Effect.runPromise(
			transferCarry({
				api,
				previous,
				next: { ...account, id: 'new-account', starts_on: '2026-01-01' },
				entries: [{ source_key: 'close:old-account:out' }],
				pending: [],
				asOf: '2026-01-02'
			})
		),
		0
	);
	assert.deepEqual(closed, [{ id: 'old-account', status: 'CLOSED' }]);
});

test('future plan approval leaves the current plan active until the successor date', async () => {
	const retired = [];
	const successorRows = [
		{
			id: 'successor-due',
			supersedes_id: 'current-due',
			effective_range: { start: '2026-07-01', end: null }
		},
		{
			id: 'successor-future',
			supersedes_id: 'current-future',
			effective_range: { start: '2027-01-01', end: null }
		}
	];
	const api = {
		db: {
			leave_plans: {
				findMany: (options) =>
					Effect.succeed(
						options.where.supersedes_id == null ? [{ id: 'current-due' }] : successorRows
					),
				mutate: (rows) => Effect.sync(() => retired.push(...rows))
			}
		}
	};
	assert.equal(await Effect.runPromise(retireDueLeavePlanPredecessors(api, '2026-07-01')), 1);
	assert.deepEqual(retired, [{ id: 'current-due', lifecycle: 'RETIRED' }]);
});

test('retiring a due plan does not reopen validation of its older predecessor', async () => {
	const existing = {
		...plan('current-due', '2026-01-01'),
		company_id: 'company',
		code: 'DEFAULT',
		name: 'Current',
		supersedes_id: 'already-retired',
		change_note: 'Current version'
	};
	const input = { lifecycle: 'RETIRED' };
	assert.deepEqual(
		await Effect.runPromise(
			leavePlanHooks.mutate.perRecord.before.handler({
				input,
				existing,
				api: {
					db: {
						leave_plans: {
							findFirst: () => Effect.die('retirement must not reread older predecessors')
						}
					}
				}
			})
		),
		input
	);
});

test('manual balance corrections require a reason, reference and open in-year account', async () => {
	const handler = leaveEntryHooks.mutate.perRecord.before.handler;
	const input = {
		leave_account_id: 'account',
		kind: 'MANUAL_ADJUSTMENT',
		effective_on: '2026-06-01',
		days: 1,
		reason: 'Opening balance evidence corrected',
		source_key: 'manual:ticket-42'
	};
	const api = {
		db: {
			leave_accounts: {
				findFirst: () =>
					Effect.succeed({
						id: 'account',
						status: 'OPEN',
						starts_on: '2026-01-01',
						ends_on: '2026-12-31'
					})
			}
		}
	};
	assert.deepEqual(await Effect.runPromise(handler({ input, existing: null, api })), input);
	await assert.rejects(
		Effect.runPromise(handler({ input: { ...input, reason: '' }, existing: null, api })),
		/reason/
	);
	await assert.rejects(
		Effect.runPromise(
			handler({ input: { ...input, effective_on: '2027-01-01' }, existing: null, api })
		),
		/account year/
	);
});

test('a seeded account shell receives its generated entitlement on the first sweep', async () => {
	const shell = {
		...account,
		id: 'shell',
		employment_id: 'employment',
		leave_type_id: 'annual',
		account_kind: 'YEAR',
		leave_code: 'ANNUAL_LEAVE',
		leave_year: 2026,
		entitlement_days: '0',
		accrual_kind: 'UPFRONT',
		carry_limit_days: null,
		carry_expiry_months: null,
		calculation: {
			calculated_on: '2026-01-01',
			service_months: 0,
			statutory_days: 0,
			company_days: 0,
			selected_days: 0,
			formula_version: 'LEAVE_ACCOUNT_V1'
		},
		approval_id: null
	};
	const entries = [];
	const harness = reconciliationApi({ asOf: '2026-03-15', accounts: [shell], entries });
	const annual = { ...type(14), id: 'annual', code: 'ANNUAL_LEAVE', name: 'Annual leave' };
	harness.api.db.leave_types.findMany = () => Effect.succeed([annual]);
	const result = await Effect.runPromise(
		reconcileEmploymentLeave(harness.api, 'employment', harness.asOf)
	);
	assert.equal(
		Number(shell.entitlement_days),
		14,
		'the shell now carries the generated entitlement'
	);
	assert.equal(shell.calculation.selected_days, 14);
	assert.ok(
		entries.some(
			(entry) => entry.leave_account_id === 'shell' && entry.kind === 'OPENING_ENTITLEMENT'
		),
		'an award entry was posted for the shell'
	);
	assert.ok(result.accounts_created >= 1);
	const again = await Effect.runPromise(
		reconcileEmploymentLeave(harness.api, 'employment', harness.asOf)
	);
	assert.equal(again.entries_posted, 0, 'the second sweep posts nothing for the same shell');
});

test('an approved request is charged once, under the id its own write would use, whichever write comes first', async () => {
	const { chargeApprovedRequests } = await import('../src/lib/leave/reconcile.ts');
	const { leaveAccountIdFor, leaveEntryIdFor, requestSourceKey } =
		await import('../src/lib/leave/identity.ts');
	const employment = { id: 'emp-1', company_id: 'co' };
	const accountId = leaveAccountIdFor({
		employment_id: 'emp-1',
		leave_code: 'ANNUAL',
		leave_year: 2026
	});
	const request = {
		id: 'req-1',
		employment_id: 'emp-1',
		leave_type_id: 'type-annual',
		leave_account_id: null,
		approval_id: null,
		event: { range: { start: { date: '2026-04-16' } }, chargeable_days: 1.5 }
	};
	const posted = [];
	let stored = [];
	const api = {
		db: {
			leave_requests: { findMany: () => Effect.succeed([request]) },
			leave_types: { findMany: () => Effect.succeed([{ id: 'type-annual', code: 'ANNUAL' }]) },
			leave_entries: {
				findFirst: ({ where }) =>
					Effect.succeed(
						stored.find(
							(entry) =>
								entry.leave_account_id === where.leave_account_id.eq &&
								entry.source_key === where.source_key.eq
						) ?? null
					),
				mutate: (rows) =>
					Effect.sync(() => {
						posted.push(...rows);
						stored = [...stored, ...rows];
					})
			}
		}
	};
	// The account the request names by formula exists: one TAKEN line, under the shared id.
	assert.equal(
		await Effect.runPromise(chargeApprovedRequests(api, employment, [{ id: accountId }], 1)),
		1
	);
	assert.deepEqual(posted, [
		{
			id: leaveEntryIdFor({ leave_account_id: accountId, source_key: requestSourceKey('req-1') }),
			leave_account_id: accountId,
			kind: 'TAKEN',
			effective_on: '2026-04-16',
			days: -1.5,
			reason: 'Approved leave request',
			source_key: 'request:req-1',
			source_request_id: 'req-1'
		}
	]);
	// Whether that line came from this write or from the request's own, the next pass restates nothing.
	assert.equal(
		await Effect.runPromise(chargeApprovedRequests(api, employment, [{ id: accountId }], 1)),
		0
	);
	// A request whose account is not (yet) generated is left for the write that generates it.
	assert.equal(
		await Effect.runPromise(chargeApprovedRequests(api, employment, [{ id: 'other' }], 1)),
		0
	);
	assert.equal(posted.length, 1);
});

test('a ledger line accepts the no-change restatement a complete-set write carries, and nothing else', async () => {
	const before = leaveEntryHooks.mutate.perRecord.before.handler;
	const existing = { id: 'line', kind: 'ACCRUAL', days: 1, source_key: 'accrual:1' };
	const context = (input) => ({ input, existing, recordId: 'line', api: { db: {} } });
	assert.deepEqual(await Effect.runPromise(before(context({ id: 'line' }) as never) as never), {
		id: 'line'
	});
	await assert.rejects(
		Effect.runPromise(before(context({ id: 'line', days: 2 }) as never) as never),
		/append-only/
	);
});

const settledType = (settlement) => ({
	...type(),
	accrual: { kind: 'UPFRONT', settlement }
});

const settledProfile = (settlement) => ({
	...profile('law', '2026-01-01', 8),
	statutory_leave: [
		{
			kind: 'ANNUAL',
			ladder: [{ band_from: 0, days: 8 }],
			per_child: null,
			max_days: null,
			transition: 'NEXT_LEAVE_YEAR',
			settlement
		}
	]
});

test('settlement merges by worker-protective rank: commute beats carry beats forfeit', () => {
	const forfeit = { settlement: 'FORFEIT' };
	const carry = { settlement: 'CARRY', limit_days: 5, expiry_months: 3, coverage: null };
	const commute = { settlement: 'COMMUTE', pay_basis: 'ORDINARY_DIV26' };
	assert.deepEqual(
		mergedSettlement(
			settledProfile(commute),
			settledType({ settlement: 'CARRY', limit_days: 5, expiry_months: 3, coverage: null }),
			null
		),
		commute
	);
	assert.deepEqual(mergedSettlement(settledProfile(carry), settledType(forfeit), null), carry);
	assert.deepEqual(mergedSettlement(settledProfile(forfeit), settledType(forfeit), null), forfeit);
});

test('two carry floors merge to the wider limit and later expiry, law winning ties', () => {
	const merged = mergedSettlement(
		settledProfile({ settlement: 'CARRY', limit_days: null, expiry_months: 12, coverage: null }),
		settledType({ settlement: 'CARRY', limit_days: 5, expiry_months: 3, coverage: null }),
		null
	);
	assert.equal(merged.settlement, 'CARRY');
	assert.equal(merged.limit_days, null);
	assert.equal(merged.expiry_months, 12);
});

test('a banded statutory floor protects only employments carrying its code', () => {
	const banded = {
		settlement: 'CARRY',
		limit_days: null,
		expiry_months: 12,
		coverage: ['SG_PART_IV']
	};
	const company = { settlement: 'FORFEIT' };
	assert.deepEqual(
		mergedSettlement(settledProfile(banded), settledType(company), 'SG_PART_IV'),
		banded
	);
	assert.deepEqual(mergedSettlement(settledProfile(banded), settledType(company), null), company);
	assert.deepEqual(
		mergedSettlement(settledProfile(banded), settledType(company), 'OTHER'),
		company
	);
});

test('coverage derivation matches the first band and stays silent otherwise', () => {
	const profileWithBands = (bands) => ({ statutory_coverage: bands });
	const bands = [
		{
			code: 'SG_PART_IV_W',
			max_monthly_basic: 4500,
			workman_only: true,
			authority: 'Employment Act Part IV'
		},
		{
			code: 'SG_PART_IV',
			max_monthly_basic: 2600,
			workman_only: false,
			authority: 'Employment Act Part IV'
		}
	];
	assert.equal(
		resolveStatutoryCoverage({
			profile: profileWithBands(bands),
			...coverageInputs({
				pay_frequency: 'MONTHLY',
				base_salary: { value: 2400 },
				statutory_work_category: 'NON_MANUAL'
			})
		}),
		'SG_PART_IV'
	);
	assert.equal(
		resolveStatutoryCoverage({
			profile: profileWithBands(bands),
			...coverageInputs({
				pay_frequency: 'MONTHLY',
				base_salary: { value: 4000 },
				statutory_work_category: 'MANUAL_LABOUR'
			})
		}),
		'SG_PART_IV_W'
	);
	assert.equal(
		resolveStatutoryCoverage({
			profile: profileWithBands(bands),
			...coverageInputs({
				pay_frequency: 'MONTHLY',
				base_salary: { value: 9000 },
				statutory_work_category: 'NON_MANUAL'
			})
		}),
		null
	);
	assert.equal(
		resolveStatutoryCoverage({
			profile: profileWithBands(null),
			...coverageInputs({
				pay_frequency: 'MONTHLY',
				base_salary: { value: 2000 },
				statutory_work_category: 'NON_MANUAL'
			})
		}),
		null
	);
});

test('commutation rates follow the stated divisor and refuse the rest', () => {
	assert.equal(
		commuteDailyRate({ pay_frequency: 'MONTHLY', base_salary: { value: 2600 } }, 'ORDINARY_DIV26'),
		100
	);
	assert.equal(
		commuteDailyRate({ pay_frequency: 'MONTHLY', base_salary: { value: 3000 } }, 'MONTHLY_DIV30'),
		100
	);
	assert.equal(
		commuteDailyRate({ pay_frequency: 'DAILY', base_salary: { value: 150 } }, 'DAILY_WAGE'),
		150
	);
	assert.throws(
		() =>
			commuteDailyRate({ pay_frequency: 'HOURLY', base_salary: { value: 20 } }, 'ORDINARY_DIV26'),
		/not stated/
	);
});

test('a commuted year posts one cash receipt and never repeats it', async () => {
	const posted = [];
	const accountRow = {
		...account,
		leave_year: 2025,
		account_kind: 'YEAR',
		starts_on: '2025-01-01',
		ends_on: '2025-12-31',
		status: 'OPEN',
		settlement: { settlement: 'COMMUTE', pay_basis: 'ORDINARY_DIV26' }
	};
	const entries = [
		{
			id: 'opening',
			kind: 'OPENING_ENTITLEMENT',
			effective_on: '2025-01-01',
			days: 8,
			source_key: 'opening',
			approval_id: null
		}
	];
	const api = {
		db: { leave_entries: { mutate: (rows) => Effect.sync(() => posted.push(...rows)) } }
	};
	assert.equal(
		await Effect.runPromise(expireCarry(api, accountRow, entries, '2026-01-15', 100)),
		1
	);
	assert.equal(posted[0].kind, 'COMMUTED');
	assert.equal(posted[0].days, -8);
	assert.equal(posted[0].source_key, `commute:${accountRow.id}`);
	assert.match(posted[0].reason, /800/);
	entries.push({ ...posted[0], approval_id: null });
	assert.equal(
		await Effect.runPromise(expireCarry(api, accountRow, entries, '2026-01-15', 100)),
		0
	);
	assert.equal(posted.length, 1);
});

test('commutation without a priced rate refuses instead of posting vapor', async () => {
	const api = { db: { leave_entries: { mutate: () => Effect.succeed(undefined) } } };
	const accountRow = {
		...account,
		account_kind: 'YEAR',
		ends_on: '2025-12-31',
		status: 'OPEN',
		settlement: { settlement: 'COMMUTE', pay_basis: 'ORDINARY_DIV26' }
	};
	await assert.rejects(
		Effect.runPromise(expireCarry(api, accountRow, [], '2026-01-15', null)),
		/no daily rate/
	);
});

// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * ============================================================================
 * WHAT THE ROSTER/ATTENDANCE MERGE MUST NOT HAVE WIDENED
 * ============================================================================
 *
 * `roster_entries` and `time_entries` became one collection, `work_days`. Two collection-level
 * grants therefore became one collection with **field-level** grants, and that is the whole risk
 * this file exists for: a grant that used to be bounded by which *table* it named is now bounded
 * only by the `fields` mask somebody remembered to write. Forget the mask and every rank that could
 * record a punch can publish a roster — authority nobody on the ladder ever held, arriving purely
 * because two tables became one.
 *
 * Read alongside `policy_grants.test.ts`: same convention, same known weakness. These are assertions
 * about **authored intent**, made against the policy modules rather than a live workspace, because a
 * policy has no behaviour of its own — it is data that `runtime/access/access-control.ts`
 * interprets. Two of that file's rules are restated as one-line helpers below, and each is quoted so
 * that drift on either side is visible in a diff.
 *
 * ## What "a supervisor cannot edit attendance" means here, precisely
 *
 * A supervisor **can** write attendance — they always could; `time_entries.mutate.new` and
 * `time_entries.mutate.existing` were theirs before the merge. What they cannot do, and must still
 * not be able to do, is:
 *
 *   1. write attendance on their OWN authority — every attendance write they hold is reviewed by
 *      the direct manager, and the review is what makes the write land as a held request rather
 *      than as a fact;
 *   2. touch the SCHEDULE at all — the plan is not theirs at any rank below HR, and the merged row
 *      is the first time those columns have ever been inside a grant they hold;
 *   3. remove a day — no delete, at all, so a rostered day cannot be taken away wholesale.
 *
 * All three used to be consequences of the table split. Only the field mask and the approval
 * resolver hold them now, so all three are asserted.
 *
 * ## And the one that runs the other way
 *
 * Field grants NARROW and never widen. `rowPredicate` collects the field grants of every policy a
 * subject holds and unions them, but a policy declaring no grant for a collection contributes
 * nothing — so holding an unrestricted policy beside a masked one leaves the mask in force. In this
 * workspace each team holds exactly one policy (`+teams.ts`), so the union is a single grant and the
 * mask is simply the rule. The last test states that, because the day somebody gives a team two
 * policies is the day it stops being obvious.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';

import teams from '../src/access/+teams.ts';
import employee from '../src/access/policies/+employee.ts';
import supervisor from '../src/access/policies/+supervisor.ts';
import manager from '../src/access/policies/+manager.ts';
import seniorManagement from '../src/access/policies/+senior_management.ts';
import hrController from '../src/access/policies/+hr_controller.ts';
import hrManager from '../src/access/policies/+hr_manager.ts';
import { WORK_DAY_ATTENDANCE_FIELDS, WORK_DAY_PLANNED_FIELDS } from '../src/lib/policy_grants.ts';

/** Keyed by the filename each one was imported from: the filename is the policy's only name. */
const policiesByFileKey = {
	employee,
	supervisor,
	manager,
	senior_management: seniorManagement,
	hr_controller: hrController,
	hr_manager: hrManager
};

const namesByPolicy = new Map(
	Object.entries(policiesByFileKey).map(([name, policy]) => [policy, name])
);
const nameOf = (policy) => namesByPolicy.get(policy) ?? '<unknown policy>';

/** `matches`: the grant this policy has for one collection and grant coordinate, or undefined. */
const grantFor = (policy, collection, coordinate) => {
	const [operation, phase] = coordinate.split('.');
	return phase === undefined
		? policy.grants[collection]?.[operation]
		: policy.grants[collection]?.[operation]?.[phase];
};

const may = (policy, collection, coordinate) =>
	grantFor(policy, collection, coordinate) !== undefined;

/** The ranks below HR: the ones whose authority the merge could have widened. */
const ORDINARY_RANKS = [employee, supervisor, manager];
/** The ranks that own the roster board, and always did. */
const SCHEDULE_RANKS = [seniorManagement, hrController, hrManager];

test('an employee may mutate only their own existing person-day attendance', async () => {
	const grant = grantFor(employee, 'work_days', 'mutate.existing');
	assert.notEqual(grant, undefined, 'an employee cannot report against a roster-only day');
	assert.deepEqual(grant.fields, WORK_DAY_ATTENDANCE_FIELDS);
	for (const field of [...WORK_DAY_PLANNED_FIELDS, 'employment_id', 'work_date']) {
		assert.equal(
			grant.fields.includes(field),
			false,
			`employee mutate.existing can write ${field}`
		);
	}
	assert.equal(typeof grant.authorize, 'function');
	assert.notEqual(grant.approval, undefined);

	const api = {
		requestor: { email: 'employee@example.com' },
		db: {
			employments: {
				findFirst: ({ where }) =>
					Effect.succeed(
						where.id.eq === 'own-employment'
							? { employee_id: 'own-employee' }
							: where.id.eq === 'foreign-employment'
								? { employee_id: 'foreign-employee' }
								: undefined
					)
			},
			employees: {
				findFirst: ({ where }) =>
					Effect.succeed(
						where.id.eq === 'own-employee'
							? { email: 'EMPLOYEE@example.com' }
							: where.id.eq === 'foreign-employee'
								? { email: 'colleague@example.com' }
								: undefined
					)
			}
		}
	};
	const context = (employment_id) => ({
		previous: { employment_id },
		changes: { break_minutes: 30 },
		record: { employment_id }
	});
	assert.equal(await Effect.runPromise(grant.authorize(context('own-employment'), api)), true);
	assert.equal(await Effect.runPromise(grant.authorize(context('foreign-employment'), api)), false);
	assert.equal(await Effect.runPromise(grant.authorize(context('missing-employment'), api)), false);

	for (const field of WORK_DAY_ATTENDANCE_FIELDS) {
		const flow = grant.approval.flow({
			previous: {},
			changes: { [field]: field === 'break_minutes' ? 30 : [] },
			record: {}
		});
		assert.equal(flow._tag, 'Review', `employee mutate.existing of ${field} is not reviewed`);
		assert.deepEqual(flow.stages[0].approvers, ['L1 Manager', 'HR Manager', 'Senior Management']);
	}
});

test('a supervisor cannot edit attendance on their own authority', () => {
	// Every write a supervisor holds on `work_days` is masked to the clock columns, and every write
	// the resolver sees on a clock column is reviewed. So there is no reachable path by which a
	// supervisor's edit to attendance becomes a stored fact without the direct manager deciding it.
	for (const coordinate of ['mutate.new', 'mutate.existing']) {
		const grant = grantFor(supervisor, 'work_days', coordinate);
		assert.notEqual(grant, undefined, `supervisor must still be able to raise ${coordinate}`);
		assert.ok(Array.isArray(grant.fields), `supervisor ${coordinate} has no field mask`);
		assert.notEqual(grant.approval, undefined, `supervisor ${coordinate} is not reviewed`);
		assert.equal(typeof grant.approval.flow, 'function');
		// The resolver decides per write, so this is the shape check, not the decision check. The
		// decision is checked below, where the record is the input.
		assert.deepEqual(grant.approval.superceded_by, ['HR Manager', 'Senior Management']);
	}

	// A write that carries attendance is reviewed. `worked_intervals` present — even as the empty
	// array, which claims "this day was read and nothing was worked" — is an attendance claim.
	const newGrant = grantFor(supervisor, 'work_days', 'mutate.new');
	for (const worked of [
		[],
		[{ start: '2026-08-03T01:00:00.000Z', end: '2026-08-03T09:00:00.000Z' }]
	]) {
		const flow = newGrant.approval.flow({
			record: { employment_id: 'e', work_date: '2026-08-03', worked_intervals: worked }
		});
		assert.equal(flow._tag, 'Review', 'an attendance mutate.new must be reviewed');
		assert.deepEqual(flow.stages[0].approvers, ['L1 Manager', 'HR Manager', 'Senior Management']);
	}

	const existingGrant = grantFor(supervisor, 'work_days', 'mutate.existing');
	for (const field of WORK_DAY_ATTENDANCE_FIELDS) {
		const flow = existingGrant.approval.flow({
			previous: {},
			changes: { [field]: field === 'break_minutes' ? 45 : [] },
			record: {}
		});
		assert.equal(flow._tag, 'Review', `mutate.existing touching ${field} must be reviewed`);
	}

	// And a supervisor may not take the day away instead. There is no `fields` mask on a delete —
	// a delete takes the whole row — so the only safe answer at this rank is no delete at all.
	assert.equal(may(supervisor, 'work_days', 'delete'), false);
});

test('no rank below HR may write the schedule half of a work day', () => {
	// The merge's one real hazard, stated once per rank. A planned column inside a mask held by
	// employee, supervisor or manager is the roster board handed to somebody who never had it.
	for (const policy of ORDINARY_RANKS) {
		for (const coordinate of ['mutate.new', 'mutate.existing']) {
			const grant = grantFor(policy, 'work_days', coordinate);
			if (grant === undefined) continue;
			assert.ok(Array.isArray(grant.fields), `${nameOf(policy)} ${coordinate} has no field mask`);
			for (const planned of WORK_DAY_PLANNED_FIELDS) {
				assert.equal(
					grant.fields.includes(planned),
					false,
					`${nameOf(policy)} ${coordinate} can write ${planned}`
				);
			}
			// `mutate.new` has to say which person and day. The employee `mutate.existing` grant's
			// intentionally smaller identity-free mask is asserted in its dedicated test above.
			if (coordinate === 'mutate.new') {
				for (const identity of ['employment_id', 'work_date'])
					assert.ok(
						grant.fields.includes(identity),
						`${nameOf(policy)} ${coordinate} cannot say ${identity}`
					);
			}
		}
	}

	// An employee mutates their own attendance and nothing else. There is still no delete
	// anywhere below HR except the manager's, which is checked next.
	assert.equal(may(employee, 'work_days', 'mutate.existing'), true);
	assert.equal(may(employee, 'work_days', 'delete'), false);
});

test("a manager's work-day delete cannot reach a day that carries a plan", () => {
	// `time_entries` delete was the manager's; `roster_entries` delete was not. A delete has no
	// field mask, so the boundary the two tables used to draw has to be drawn by a decision about
	// the row instead — otherwise the merge hands this rank the ability to erase a roster
	// assignment by deleting the day it happens to share with a punch.
	const grant = grantFor(manager, 'work_days', 'delete');
	assert.notEqual(grant, undefined, 'a manager must still be able to withdraw attendance');
	assert.equal(typeof grant.authorize, 'function', 'the delete is unconditional');
	assert.equal(grant.authorize({ record: { shift_definition_id: null } }), true);
	assert.equal(grant.authorize({ record: { shift_definition_id: 'shift-1' } }), false);
});

test('the HR ranks keep both halves, and a roster edit is not reviewed as attendance is', () => {
	for (const policy of SCHEDULE_RANKS) {
		for (const coordinate of ['mutate.new', 'mutate.existing']) {
			const grant = grantFor(policy, 'work_days', coordinate);
			assert.notEqual(grant, undefined, `${nameOf(policy)} ${coordinate}`);
			for (const planned of WORK_DAY_PLANNED_FIELDS)
				assert.ok(
					grant.fields.includes(planned),
					`${nameOf(policy)} ${coordinate} lost ${planned}`
				);
			for (const actual of WORK_DAY_ATTENDANCE_FIELDS)
				assert.ok(grant.fields.includes(actual), `${nameOf(policy)} ${coordinate} lost ${actual}`);
		}
		assert.equal(may(policy, 'work_days', 'delete'), true, nameOf(policy));

		// The half the merge would have lost by accident. `roster_entries` writes were never
		// reviewed and `time_entries` writes always were; one grant per coordinate means one of the
		// two rules had to move off the table name and onto the record. This is that rule.
		const newGrant = grantFor(policy, 'work_days', 'mutate.new');
		assert.equal(
			newGrant.approval.flow({
				record: { employment_id: 'e', work_date: '2026-08-03', shift_definition_id: 's' }
			})._tag,
			'NoApproval',
			`${nameOf(policy)} now needs a signature to publish a roster`
		);
		assert.equal(
			newGrant.approval.flow({
				record: { employment_id: 'e', work_date: '2026-08-03', worked_intervals: [] }
			})._tag,
			'Review',
			`${nameOf(policy)} can record attendance unreviewed`
		);

		const existingGrant = grantFor(policy, 'work_days', 'mutate.existing');
		assert.equal(
			existingGrant.approval.flow({
				previous: {},
				changes: { assignment_code: 'AMRES' },
				record: {}
			})._tag,
			'NoApproval'
		);
		assert.equal(
			existingGrant.approval.flow({ previous: {}, changes: { break_minutes: 30 }, record: {} })
				._tag,
			'Review'
		);
	}
});

test('every rank can read the whole day, because reading a schedule was never the restricted half', () => {
	for (const policy of Object.values(policiesByFileKey)) {
		const read = grantFor(policy, 'work_days', 'read');
		assert.notEqual(read, undefined, `${nameOf(policy)} cannot see a work day at all`);
		// No `fields` on the read. `roster_entries` and `time_entries` were both readable by every
		// rank that held either, so masking the merged read would be a narrowing nobody asked for —
		// and it would blind the board that has to draw the plan and the punch on one row.
		assert.equal(read.fields, undefined, `${nameOf(policy)} reads a partial day`);
	}
});

test('one team, one policy — so a field mask cannot be widened by a second grant', () => {
	// `rowPredicate` unions the field grants of every policy a subject holds, and an unrestricted
	// policy contributes no grant for a collection it does not name — so a mask survives beside one.
	// What it does NOT survive is a second policy naming the same coordinate *without* a mask. That
	// cannot happen while every team holds exactly one policy, and this is the assertion that says
	// so out loud, at the place the masks are.
	for (const [team, held] of Object.entries(teams))
		assert.equal(
			held.length,
			1,
			`team ${team} holds more than one policy; the work_day masks union`
		);
});

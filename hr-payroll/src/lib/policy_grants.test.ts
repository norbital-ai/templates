// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The role ladder, read off the declarations the runtime reads.
 *
 * These assertions are about **authored intent**, and they are deliberately made against the policy
 * modules rather than a live workspace: a policy has no behaviour of its own, it is data that
 * `oss/packages/bolt/src/runtime/access/access-control.ts` interprets. Three of that file's rules
 * are restated below as one-line helpers, quoted where they came from, because a test that could
 * not name what it is checking would be checking a shape rather than a rule:
 *
 *   - `subjectHasPolicy`  — `const roles = policy.roles ?? [policy.name]`, compared case-folded.
 *   - `matches`           — `grants.some((grant) => grant.collection === resource && grant.action === action)`.
 *   - `requiresApproval`  — `definition.approvalLock === true || visibility.approval !== undefined`,
 *                           where `visibility.approval` is the `approval` on the matching grant.
 *
 * The restatement is the known weakness: if the runtime's matcher changes, these keep passing
 * against a stale copy. It is three lines rather than three hundred for exactly that reason, and
 * each one is quoted so the drift is visible in a diff of either side.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import employee from '../policies/+employee.policy.ts';
import supervisor from '../policies/+supervisor.policy.ts';
import manager from '../policies/+manager.policy.ts';
import seniorManagement from '../policies/+senior_management.policy.ts';
import hrController from '../policies/+hr_controller.policy.ts';
import hrManager from '../policies/+hr_manager.policy.ts';

const policies = [employee, supervisor, manager, seniorManagement, hrController, hrManager];

/** `subjectHasPolicy`: the role a subject must carry to match this policy. */
const rolesOf = (policy) => (policy.roles ?? [policy.name]).map((role) => role.toLocaleLowerCase());

/** `matches`: the grants this policy has for one collection and one action. */
const grantsFor = (policy, collection, action) =>
	policy.grants.filter((grant) => grant.collection === collection && grant.action === action);

const may = (policy, collection, action) => grantsFor(policy, collection, action).length > 0;

/** Every `(collection, action)` pair a policy grants at all. */
const surfaceOf = (policy) =>
	new Set(policy.grants.map((grant) => `${grant.collection}:${grant.action}`));

test('the six policies are the six roles, and a role is a policy name', () => {
	assert.deepEqual(
		policies.flatMap(rolesOf).toSorted(),
		[
			'employee',
			'hr_controller',
			'hr_manager',
			'manager',
			'senior_management',
			'supervisor'
		].toSorted()
	);
	// One role per policy. A policy carrying two would be a policy two credentials can reach, and
	// the ladder's whole shape is that each rank is reachable by exactly one token.
	for (const policy of policies) assert.equal(rolesOf(policy).length, 1, policy.name);
});

test('an employee cannot create a payroll run, and neither can a supervisor or a manager', () => {
	// The owner's ladder enumerates payroll authority rather than accumulating it with rank. There is
	// no grant to gate, so there is nothing to review and nothing to hold: `matches` finds no grant,
	// `decide` falls through to "no matching allow policy", and the create is refused outright.
	for (const policy of [employee, supervisor, manager]) {
		assert.equal(may(policy, 'payroll_runs', 'create'), false, policy.name);
		assert.equal(may(policy, 'payroll_runs', 'update'), false, policy.name);
		assert.equal(may(policy, 'payroll_runs', 'delete'), false, policy.name);
		// And they cannot look at one either, which is the half that is easy to leave behind.
		assert.equal(may(policy, 'payroll_runs', 'read'), false, policy.name);
		assert.equal(may(policy, 'payslips', 'read'), false, policy.name);
	}
});

test('a controller may view payroll, and their create is held for hr_manager or senior management', () => {
	assert.equal(may(hrController, 'payroll_runs', 'read'), true);

	const [create, ...extra] = grantsFor(hrController, 'payroll_runs', 'create');
	assert.deepEqual(extra, [], 'one create grant, or the union would pick an arbitrary approval');

	// `requiresApproval` is `visibility.approval !== undefined`. The presence of this object is the
	// whole of "may not create it": Bolt writes the row, stamps `norbital_approval_id`, and waits.
	assert.notEqual(create.approval, undefined);
	assert.equal(create.approval.steps.length, 1);
	// One step with two teams, not two steps. `approvals.process` tests
	// `step.approvers.some((team) => subject.teams.includes(team))`, so either team is sufficient —
	// which is what "approval from hr_manager OR senior management" says. Two steps would demand both.
	assert.deepEqual(create.approval.steps[0].approvers, ['HR Manager', 'Senior Management']);

	// Viewing is not running. A controller holds neither the recalculate nor the delete, so the
	// approved run is theirs to look at and nobody else's to be surprised by.
	assert.equal(may(hrController, 'payroll_runs', 'update'), false);
	assert.equal(may(hrController, 'payroll_runs', 'delete'), false);
});

test('hr_manager and senior management create, run and delete payroll without a gate', () => {
	for (const policy of [hrManager, seniorManagement]) {
		const [create] = grantsFor(policy, 'payroll_runs', 'create');
		assert.notEqual(create, undefined, policy.name);
		assert.equal(create.approval, undefined, `${policy.name} create must not be gated`);
		assert.equal(may(policy, 'payroll_runs', 'update'), true, policy.name);
		assert.equal(may(policy, 'payroll_runs', 'delete'), true, policy.name);

		// Running a draft again clears the previous results first, through `api.db.delete`, which
		// authorizes against the requesting subject rather than running elevated. Without these three
		// a recalculation fails on the clear and the run silently keeps last build's figures.
		for (const collection of ['payslips', 'payslip_lines', 'payroll_settlements'])
			assert.equal(may(policy, collection, 'delete'), true, `${policy.name} ${collection}`);
	}
});

test('an employee cannot read an adjustment, and no ordinary policy erases the predicate', () => {
	const [read, ...extra] = grantsFor(employee, 'component_entries', 'read');
	assert.deepEqual(extra, [], 'a second read grant would be OR-ed in and would widen this one');
	assert.match(read.where.$sql, /MANUAL_ADJUSTMENT/);
	assert.match(read.where.$sql, /IS DISTINCT FROM/);
	// The ownership half has to survive beside the adjustment half, or the predicate would exclude
	// corrections and admit every colleague's entries in the same breath.
	assert.match(read.where.$sql, /requestor\.email/);

	// `rowPredicate` unions the matching grants and short-circuits to `true` the moment one of them
	// is unconditional. So the narrowing cannot be applied at the top by subtraction: it has to be
	// present on every policy that must not see corrections. This is that check.
	for (const policy of [employee, supervisor, manager]) {
		for (const grant of grantsFor(policy, 'component_entries', 'read')) {
			assert.notEqual(grant.where, undefined, `${policy.name} has an unconditional entry read`);
			assert.match(grant.where.$sql, /MANUAL_ADJUSTMENT/, policy.name);
		}
	}

	// And the HR roles do see them, or the adjustment path would have no readers at all.
	for (const policy of [hrController, hrManager, seniorManagement]) {
		const [grant] = grantsFor(policy, 'component_entries', 'read');
		assert.notEqual(grant, undefined, policy.name);
		assert.equal(grant.where, undefined, `${policy.name} must read corrections unconditionally`);
	}
});

test('only the HR roles may create an adjustment; an employee may only claim', () => {
	// Nothing to subtract, because nothing below was ever added: no rank on the ordinary ladder holds
	// a `component_entries` create at all.
	for (const policy of [supervisor, manager])
		assert.equal(may(policy, 'component_entries', 'create'), false, policy.name);

	// The employee's one create is pinned to the CLAIM arm. Without that clause this grant would let
	// an employee post a MANUAL_ADJUSTMENT against their own employment.
	const [claim] = grantsFor(employee, 'component_entries', 'create');
	assert.match(claim.where.$sql, /'CLAIM'/);
	assert.doesNotMatch(claim.where.$sql, /MANUAL_ADJUSTMENT/);

	for (const policy of [hrController, hrManager, seniorManagement])
		assert.equal(may(policy, 'component_entries', 'create'), true, policy.name);
});

test('every policy can read the settlement ledger, or its refusal becomes an access denial', () => {
	// The hook that refuses a settled record reads `payroll_settlements` under the editing person's
	// own subject. A policy without this grant turns "payroll 2026-03 has already taken this record
	// into account" into a bare denial naming a collection they have never heard of.
	for (const policy of policies)
		assert.equal(may(policy, 'payroll_settlements', 'read'), true, policy.name);
});

test('each rank composes the rank beneath it, because nothing inherits at run time', () => {
	// `subjectHasPolicy` matches by role, so a subject carrying only `manager` is granted exactly what
	// `+manager.policy.ts` lists. Inheritance is therefore materialized, and this is the check that it
	// stayed materialized when somebody edited one file and not the other.
	const contains = (wider, narrower) => {
		const surface = surfaceOf(wider);
		for (const pair of surfaceOf(narrower))
			assert.ok(surface.has(pair), `${wider.name} is missing ${pair} from ${narrower.name}`);
	};
	contains(manager, supervisor);
	contains(seniorManagement, manager);
	contains(hrManager, hrController);

	// Self-service is deliberately *not* restated up the ladder. A supervisor is also an employee and
	// carries both roles, so their own payslip comes from the `employee` policy — scoped to them —
	// rather than from a team-wide payslip grant nobody above them was meant to have.
	assert.equal(may(supervisor, 'payslips', 'read'), false);
	assert.equal(may(employee, 'payslips', 'read'), true);
});

// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The policy ladder, read off the declarations the runtime reads.
 *
 * These assertions are about **authored intent**, and they are deliberately made against the policy
 * modules rather than a live workspace: a policy has no behaviour of its own, it is data that
 * `oss/packages/bolt/src/runtime/access/access-control.ts` interprets. Three of that file's rules
 * are restated below as one-line helpers, quoted where they came from, because a test that could
 * not name what it is checking would be checking a shape rather than a rule:
 *
 *   - `policiesHeldByTeam` — `teamsByFoldedName.get(teamName.toLocaleLowerCase())`, then each name
 *                            it yields kept only when `declaredPolicies.has(folded)`. So a policy is
 *                            held when a team in the subject's `teamPath` declares its `name`, with
 *                            both team names and policy names folded.
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

import teams from '../+teams.ts';
import employee from '../access/policies/+employee.ts';
import supervisor from '../access/policies/+supervisor.ts';
import manager from '../access/policies/+manager.ts';
import seniorManagement from '../access/policies/+senior_management.ts';
import hrController from '../access/policies/+hr_controller.ts';
import hrManager from '../access/policies/+hr_manager.ts';

/** Keyed by the filename each one was imported from, which is the other half of the name check. */
const policiesByFileKey = {
	employee,
	supervisor,
	manager,
	senior_management: seniorManagement,
	hr_controller: hrController,
	hr_manager: hrManager
};

const policies = Object.values(policiesByFileKey);

/** `policiesHeldByTeam`: the name a team has to declare for a subject to hold this policy. */
const heldNameOf = (policy) => policy.name.toLocaleLowerCase();

/** `matches`: the grants this policy has for one collection and one action. */
const grantsFor = (policy, collection, action) =>
	policy.grants.filter((grant) => grant.collection === collection && grant.action === action);

const may = (policy, collection, action) => grantsFor(policy, collection, action).length > 0;

/** Every `(collection, action)` pair a policy grants at all. */
const surfaceOf = (policy) =>
	new Set(policy.grants.map((grant) => `${grant.collection}:${grant.action}`));

test('the six policies are the six names a team may declare', () => {
	assert.deepEqual(
		policies.map(heldNameOf).toSorted(),
		[
			'employee',
			'hr_controller',
			'hr_manager',
			'manager',
			'senior_management',
			'supervisor'
		].toSorted()
	);
	// One name per policy, and no two policies sharing one. `policiesHeldByTeam` returns a set of
	// folded names, so two policies folding together would be two policies one name reaches.
	assert.equal(new Set(policies.map(heldNameOf)).size, policies.length);
	// And each of those strings is the policy's own file key — `+hr_controller.ts` declares
	// `hr_controller`. A `name` that drifted from its filename would be a second axis to keep in
	// step, and `+teams.ts` would end up typed against whichever of the two was handier.
	for (const [key, policy] of Object.entries(policiesByFileKey))
		assert.equal(policy.name, key, `+${key}.policy.ts declares name ${policy.name}`);
});

test('every name `+teams.ts` declares is a policy this workspace ships', () => {
	// The other half of the match, and the half nothing else checks. `policiesHeldByTeam` drops a
	// name the release does not declare — inert, warned about once, never fatal — so a typo in
	// `+teams.ts` costs a team its authority and produces no failure anywhere. This is that failure.
	const declared = new Set(policies.map(heldNameOf));
	for (const [team, held] of Object.entries(teams)) {
		assert.ok(held.length > 0, `team ${team} declares no policies`);
		for (const name of held)
			assert.ok(
				declared.has(name.toLocaleLowerCase()),
				`team ${team} names unknown policy ${name}`
			);
	}
	// And every policy is reachable: one that no team declares is a file nobody can hold.
	const namedByTeams = new Set(
		Object.values(teams).flatMap((held) => held.map((name) => name.toLocaleLowerCase()))
	);
	for (const policy of policies)
		assert.ok(namedByTeams.has(heldNameOf(policy)), `no team declares ${policy.name}`);
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
	}
	// A payslip is the exception, and deliberately so: Employee Self-Service exists to show somebody
	// their own pay. The grant is row-scoped to their own employment, so reading one is not reading
	// payroll — the run that produced it stays out of reach above.
	assert.equal(may(employee, 'payslips', 'read'), true);
	for (const policy of [supervisor, manager]) {
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
	// One step with two teams, not two steps. `approvals.decide` tests
	// `step.approvers.some((team) => team folded === subject.team?.toLocaleLowerCase())` — a person
	// has one team — so either team is sufficient, which is what "approval from hr_manager OR senior
	// management" says. Two steps would demand both.
	assert.deepEqual(create.approval.steps[0].approvers, ['HR Manager', 'Senior Management']);
	// The approver names are team names, and a team name is what `+teams.ts` keys on. A step naming
	// a team no key spells is a step nobody is eligible to decide, and nothing else would say so.
	const teamNames = new Set(Object.keys(teams).map((name) => name.toLocaleLowerCase()));
	for (const approver of create.approval.steps[0].approvers)
		assert.ok(teamNames.has(approver.toLocaleLowerCase()), `no team named ${approver}`);

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
		// authorizes against the requesting subject rather than running elevated. Without these two
		// a recalculation fails on the clear and the run silently keeps last build's figures. The
		// source rows go with the payslips by the database's own cascade, so `payslip_sources`
		// needs no delete grant at all.
		for (const collection of ['payslips', 'payslip_lines'])
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

	// And the HR policies do see them, or the adjustment path would have no readers at all.
	for (const policy of [hrController, hrManager, seniorManagement]) {
		const [grant] = grantsFor(policy, 'component_entries', 'read');
		assert.notEqual(grant, undefined, policy.name);
		assert.equal(grant.where, undefined, `${policy.name} must read corrections unconditionally`);
	}
});

test('only the HR policies may create an adjustment; an employee may only claim', () => {
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
	// The hook that refuses a settled record reads `payslip_sources` under the editing person's
	// own subject. A policy without this grant turns "payroll 2026-03 has already taken this record
	// into account" into a bare denial naming a collection they have never heard of.
	for (const policy of policies)
		assert.equal(may(policy, 'payslip_sources', 'read'), true, policy.name);
});

test('each rank composes the rank beneath it, because nothing inherits at run time', () => {
	// `subjectHasPolicy` matches by name, so a subject whose team declares only `manager` is granted
	// exactly what `+manager.ts` lists. Inheritance is therefore materialized, and this is the
	// check that it stayed materialized when somebody edited one file and not the other.
	const contains = (wider, narrower) => {
		const surface = surfaceOf(wider);
		for (const pair of surfaceOf(narrower))
			assert.ok(surface.has(pair), `${wider.name} is missing ${pair} from ${narrower.name}`);
	};
	contains(manager, supervisor);
	contains(seniorManagement, manager);
	contains(hrManager, hrController);

	// Self-service is deliberately *not* restated up the ladder. Every team on the ladder declares
	// `employee` alongside its own rung, so a supervisor's own payslip comes from the `employee`
	// policy — scoped to them — rather than from a team-wide payslip grant nobody above them was
	// meant to have.
	assert.equal(may(supervisor, 'payslips', 'read'), false);
	assert.equal(may(employee, 'payslips', 'read'), true);
});

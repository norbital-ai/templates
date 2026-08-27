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
 *   - `policiesHeld`       — a person's own team contributes the policy filename keys declared for
 *                            it in `access/+teams.ts`.
 *   - `matches`            — the collection/action key is present in the policy grant map.
 *   - approval             — the matching write grant carries a live `flow` function.
 *
 * The restatement is the known weakness: if the runtime's matcher changes, these keep passing
 * against a stale copy. It is three lines rather than three hundred for exactly that reason, and
 * each one is quoted so the drift is visible in a diff of either side.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import teams from '../access/+teams.ts';
import employee from '../access/policies/+employee.ts';
import supervisor from '../access/policies/+supervisor.ts';
import manager from '../access/policies/+manager.ts';
import seniorManagement from '../access/policies/+senior_management.ts';
import hrController from '../access/policies/+hr_controller.ts';
import hrManager from '../access/policies/+hr_manager.ts';

/** Keyed by the filename each one was imported from: the filename is the policy's only name. */
const policiesByFileKey = {
	employee,
	supervisor,
	manager,
	senior_management: seniorManagement,
	hr_controller: hrController,
	hr_manager: hrManager
};

const policies = Object.values(policiesByFileKey);
const namesByPolicy = new Map(
	Object.entries(policiesByFileKey).map(([name, policy]) => [policy, name])
);

const nameOf = (policy) => namesByPolicy.get(policy) ?? '<unknown policy>';

/** The filename key a team has to declare for a subject to hold this policy. */
const heldNameOf = (policy) => nameOf(policy).toLocaleLowerCase();

/** `matches`: the grants this policy has for one collection and one action. */
const grantsFor = (policy, collection, action) =>
	policy.grants[collection]?.[action] === undefined ? [] : [policy.grants[collection][action]];

const may = (policy, collection, action) => grantsFor(policy, collection, action).length > 0;

const sqlReadDependencies = (policy) =>
	Object.fromEntries(
		Object.entries(policy.grants).flatMap(([collection, actions]) => {
			const read = actions.read;
			return read?.where?.$sql === undefined
				? []
				: [[collection, read.dependencies ?? ['<missing>']]];
		})
	);

/** Every `(collection, action)` pair a policy grants at all. */
const surfaceOf = (policy) =>
	new Set(
		Object.entries(policy.grants).flatMap(([collection, actions]) =>
			Object.keys(actions).map((action) => `${collection}:${action}`)
		)
	);

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
	// One filename key per policy, and no two declarations sharing one. `policiesHeld` returns a set of
	// folded names, so two policies folding together would be two policies one name reaches.
	assert.equal(new Set(policies.map(heldNameOf)).size, policies.length);
});

test('SQL-scoped reads declare only their exact linking collections', () => {
	assert.deepEqual(sqlReadDependencies(employee), {
		employments: ['employees'],
		employment_terms: ['employments', 'employees'],
		employment_statutory_facts: ['employments', 'employees'],
		// One entry each where there used to be two. `roster_entries` and `time_entries` are
		// `work_days`; `component_entries` and `repayment_agreements` are `obligations`.
		work_days: ['employments', 'employees'],
		obligations: ['employments', 'employees'],
		leave_requests: ['employments', 'employees'],
		payslips: ['employments', 'employees']
	});
	assert.deepEqual(sqlReadDependencies(supervisor), {
		payslips: ['employments', 'employees'],
		obligations: []
	});
	assert.deepEqual(sqlReadDependencies(manager), {
		payslips: ['employments', 'employees'],
		obligations: []
	});
	for (const policy of [seniorManagement, hrController, hrManager]) {
		assert.deepEqual(sqlReadDependencies(policy), {}, nameOf(policy));
	}
});

test('every name `+teams.ts` declares is a policy this workspace ships', () => {
	// The other half of the match, and the half nothing else checks. `policiesHeldByTeam` drops a
	// name the release does not declare — inert, warned about once, never fatal — so a typo in
	// `+teams.ts` costs a team its authority and produces no failure anywhere. This is that failure.
	const declared = new Set(policies.map(heldNameOf));
	for (const [team, held] of Object.entries(teams)) {
		assert.equal(held.length, 1, `team ${team} must declare exactly one complete policy`);
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
		assert.ok(namedByTeams.has(heldNameOf(policy)), `no team declares ${nameOf(policy)}`);

	assert.deepEqual(teams, {
		Employee: ['employee'],
		Supervisor: ['supervisor'],
		'L1 Manager': ['manager'],
		'Senior Management': ['senior_management'],
		'HQ Payroll HR': ['hr_controller'],
		'HR Manager': ['hr_manager'],
		'Manager (HR Controller)': ['hr_controller']
	});
});

test('an employee cannot create a payroll run, and neither can a supervisor or a manager', () => {
	// The owner's ladder enumerates payroll authority rather than accumulating it with rank. There is
	// no grant to gate, so there is nothing to review and nothing to hold: `matches` finds no grant,
	// `decide` falls through to "no matching allow policy", and the create is refused outright.
	for (const policy of [employee, supervisor, manager]) {
		assert.equal(may(policy, 'payroll_runs', 'create'), false, nameOf(policy));
		assert.equal(may(policy, 'payroll_runs', 'update'), false, nameOf(policy));
		assert.equal(may(policy, 'payroll_runs', 'delete'), false, nameOf(policy));
		// And they cannot look at one either, which is the half that is easy to leave behind.
		assert.equal(may(policy, 'payroll_runs', 'read'), false, nameOf(policy));
	}
	// A payslip is the exception, and deliberately so: Employee Self-Service exists to show somebody
	// their own pay. The grant is row-scoped to their own employment, so reading one is not reading
	// payroll — the run that produced it stays out of reach above.
	for (const policy of [employee, supervisor, manager]) {
		const [ownPayslip, ...extra] = grantsFor(policy, 'payslips', 'read');
		assert.deepEqual(extra, [], `${nameOf(policy)} has more than one payslip read`);
		assert.match(ownPayslip.where.$sql, /requestor\.email/, nameOf(policy));
	}
});

test('a controller may view payroll, and their create is held for hr_manager or senior management', () => {
	assert.equal(may(hrController, 'payroll_runs', 'read'), true);

	const [create, ...extra] = grantsFor(hrController, 'payroll_runs', 'create');
	assert.deepEqual(extra, [], 'one create grant, or the union would pick an arbitrary approval');

	// The live flow returns one concrete route. There are no authored step ids or names.
	assert.notEqual(create.approval, undefined);
	const flow = create.approval.flow();
	assert.equal(flow.stages.length, 1);
	// One step with two teams, not two steps. `approvals.decide` tests
	// each candidate is compared with `subject.teamPath[0]` — a person has one own team — so either
	// team is sufficient, which is what "approval from hr_manager OR senior
	// management" says. Two steps would demand both.
	assert.deepEqual(flow.stages[0].approvers, ['HR Manager', 'Senior Management']);
	// The approver names are team names, and a team name is what `+teams.ts` keys on. A step naming
	// a team no key spells is a step nobody is eligible to decide, and nothing else would say so.
	const teamNames = new Set(Object.keys(teams).map((name) => name.toLocaleLowerCase()));
	for (const approver of flow.stages[0].approvers)
		assert.ok(teamNames.has(approver.toLocaleLowerCase()), `no team named ${approver}`);

	// Viewing is not running. A controller holds neither the recalculate nor the delete, so the
	// approved run is theirs to look at and nobody else's to be surprised by.
	assert.equal(may(hrController, 'payroll_runs', 'update'), false);
	assert.equal(may(hrController, 'payroll_runs', 'delete'), false);
});

test('hr_manager and senior management create, run and delete payroll without a gate', () => {
	for (const policy of [hrManager, seniorManagement]) {
		const [create] = grantsFor(policy, 'payroll_runs', 'create');
		assert.notEqual(create, undefined, nameOf(policy));
		assert.equal(create.approval, undefined, `${nameOf(policy)} create must not be gated`);
		assert.equal(may(policy, 'payroll_runs', 'update'), true, nameOf(policy));
		assert.equal(may(policy, 'payroll_runs', 'delete'), true, nameOf(policy));

		// Running a draft again clears the previous results first, through `api.db.delete`, which
		// authorizes against the requesting subject rather than running elevated. Without these two
		// a recalculation fails on the clear and the run silently keeps last build's figures. There
		// is no third collection to grant now: the settlement claim a run holds over a source record
		// is a column on the adjustment, and it is released with it.
		for (const collection of ['payslips', 'payslip_adjustments'])
			assert.equal(may(policy, collection, 'delete'), true, `${nameOf(policy)} ${collection}`);
	}
});

test('an employee cannot read an adjustment, and no ordinary policy erases the predicate', () => {
	const [read, ...extra] = grantsFor(employee, 'obligations', 'read');
	assert.deepEqual(extra, [], 'a second read grant would be OR-ed in and would widen this one');
	// An adjustment is a ONE_OFF obligation whose `occasion` column is ADJUSTMENT. The merge folded
	// `repayment_agreements` — which had no such filter — into this same collection, so the
	// predicate now has to be the one that survives both readings.
	assert.match(read.where.$sql, /"occasion" IS DISTINCT FROM 'ADJUSTMENT'/);
	// And it reads a COLUMN, not a path into a jsonb blob. That is not a style preference: a field
	// grant can mask a column and cannot mask a jsonb sub-path, and this release grants fields on
	// `work_days`. A `->` or `->>` creeping back in here is the shape regressing.
	assert.doesNotMatch(read.where.$sql, /->/);
	// The ownership half has to survive beside the adjustment half, or the predicate would exclude
	// corrections and admit every colleague's entries in the same breath.
	assert.match(read.where.$sql, /requestor\.email/);

	// `rowPredicate` unions the matching grants and short-circuits to `true` the moment one of them
	// is unconditional. So the narrowing cannot be applied at the top by subtraction: it has to be
	// present on every policy that must not see corrections. This is that check.
	for (const policy of [employee, supervisor, manager]) {
		for (const grant of grantsFor(policy, 'obligations', 'read')) {
			assert.notEqual(grant.where, undefined, `${nameOf(policy)} has an unconditional entry read`);
			assert.match(grant.where.$sql, /"occasion" IS DISTINCT FROM 'ADJUSTMENT'/, nameOf(policy));
			assert.doesNotMatch(grant.where.$sql, /->/, `${nameOf(policy)} reads a jsonb path`);
		}
	}

	// And the HR policies do see them, or the adjustment path would have no readers at all.
	for (const policy of [hrController, hrManager, seniorManagement]) {
		const [grant] = grantsFor(policy, 'obligations', 'read');
		assert.notEqual(grant, undefined, nameOf(policy));
		assert.equal(grant.where, undefined, `${nameOf(policy)} must read corrections unconditionally`);
	}
});

test('ordinary ranks authorize only their own reviewed claim; HR may create adjustments', () => {
	// Writes use pure TypeScript/Effect authorization over the prepared record, not a SQL where.
	for (const policy of [employee, supervisor, manager]) {
		const [claim, ...extra] = grantsFor(policy, 'obligations', 'create');
		assert.deepEqual(extra, [], `${nameOf(policy)} has more than one component entry create`);
		assert.equal(typeof claim.authorize, 'function', nameOf(policy));
		assert.equal(claim.where, undefined, nameOf(policy));
		assert.notEqual(claim.approval, undefined, `${nameOf(policy)} claim must be reviewed`);
	}

	for (const policy of [hrController, hrManager, seniorManagement]) {
		const [create] = grantsFor(policy, 'obligations', 'create');
		assert.notEqual(create, undefined, nameOf(policy));
		assert.equal(create.where, undefined, `${nameOf(policy)} must create entries unconditionally`);
	}
});

test('no team holder receives the same operation from two policies', () => {
	const conflicts = [];
	for (const [team, heldNames] of Object.entries(teams)) {
		const ownersByOperation = new Map();
		for (const heldName of heldNames) {
			const policy = policiesByFileKey[heldName.toLocaleLowerCase()];
			for (const [collection, actions] of Object.entries(policy.grants)) {
				for (const action of Object.keys(actions)) {
					const operation = `${action} on ${collection}`;
					const owners = ownersByOperation.get(operation) ?? [];
					owners.push(heldName);
					ownersByOperation.set(operation, owners);
				}
			}
		}
		for (const [operation, owners] of ownersByOperation) {
			if (owners.length > 1) conflicts.push({ team, operation, owners });
		}
	}
	assert.deepEqual(conflicts, []);
});

test('no human policy may author the system-only statutory predecessor instruction', () => {
	for (const policy of policies) {
		for (const action of ['create', 'update']) {
			for (const grant of grantsFor(policy, 'employment_statutory_facts', action)) {
				assert.ok(Array.isArray(grant.fields), `${nameOf(policy)} ${action} needs a field mask`);
				assert.equal(
					grant.fields.includes('supersedes_fact_id'),
					false,
					`${nameOf(policy)} ${action} exposes the system transition instruction`
				);
			}
		}
	}
});

test('every policy can read the settlement ledger, or its refusal becomes an access denial', () => {
	// The hook that refuses a settled record reads `payslip_adjustments` under the editing person's
	// own subject. A policy without this grant turns "payroll 2026-03 has already taken this record
	// into account" into a bare denial naming a collection they have never heard of.
	for (const policy of policies)
		assert.equal(may(policy, 'payslip_adjustments', 'read'), true, nameOf(policy));

	// `payslip_sources` was a collection of nothing but the claim, so reading all of it was safe.
	// The merged collection carries `amount`, and the ranks with no payroll authority must reach the
	// claim without reaching what it paid. That is the field mask, and this is the check that it is
	// still there — without it the merge quietly hands every employee the whole payroll.
	for (const policy of [employee, supervisor, manager]) {
		const [claim] = grantsFor(policy, 'payslip_adjustments', 'read');
		assert.ok(Array.isArray(claim.fields), `${nameOf(policy)} reads the ledger unmasked`);
		assert.deepEqual(claim.fields.toSorted(), ['id', 'payslip_id', 'period', 'source']);
		assert.equal(claim.fields.includes('amount'), false, nameOf(policy));
	}

	// And the payroll ranks read it whole, or a payslip could not be rendered.
	for (const policy of [hrController, hrManager, seniorManagement]) {
		const [full] = grantsFor(policy, 'payslip_adjustments', 'read');
		assert.equal(full.fields, undefined, `${nameOf(policy)} cannot render a payslip`);
	}
});

test('each rank composes the rank beneath it, because nothing inherits at run time', () => {
	// `subjectHasPolicy` matches by name, so a subject whose team declares only `manager` is granted
	// exactly what `+manager.ts` lists. Inheritance is therefore materialized, and this is the
	// check that it stayed materialized when somebody edited one file and not the other.
	const contains = (wider, narrower) => {
		const surface = surfaceOf(wider);
		for (const pair of surfaceOf(narrower))
			assert.ok(surface.has(pair), `${nameOf(wider)} is missing ${pair} from ${nameOf(narrower)}`);
	};
	contains(manager, supervisor);
	contains(seniorManagement, manager);
	contains(hrManager, hrController);

	// The shared personal delta is deliberately restated in the complete supervisor and manager
	// policies. Each team holds only its one rung, so personal payslip reads and own claim creates
	// remain scoped without composing that policy with `employee` at runtime.
	for (const policy of [employee, supervisor, manager]) {
		assert.equal(may(policy, 'payslips', 'read'), true, nameOf(policy));
		assert.equal(may(policy, 'obligations', 'create'), true, nameOf(policy));
	}
});

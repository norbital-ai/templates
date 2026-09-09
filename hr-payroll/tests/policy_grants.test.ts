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
 *   - `matches`            — the collection/grant coordinate is present in the policy grant map.
 *   - approval             — the matching write grant carries a live `flow` function.
 *
 * The restatement is the known weakness: if the runtime's matcher changes, these keep passing
 * against a stale copy. It is three lines rather than three hundred for exactly that reason, and
 * each one is quoted so the drift is visible in a diff of either side.
 */
import assert from 'node:assert/strict';
import { noApproval } from '@norbital-ai/bolt/authoring';
import test from 'node:test';
import { Effect } from 'effect';

import teams from '../src/access/+teams.ts';
import employee from '../src/access/policies/+employee.ts';
import supervisor from '../src/access/policies/+supervisor.ts';
import manager from '../src/access/policies/+manager.ts';
import seniorManagement from '../src/access/policies/+senior_management.ts';
import hrController from '../src/access/policies/+hr_controller.ts';
import hrManager from '../src/access/policies/+hr_manager.ts';
import kiosk from '../src/access/policies/+kiosk.ts';

/** Keyed by the filename each one was imported from: the filename is the policy's only name. */
const policiesByFileKey = {
	employee,
	supervisor,
	manager,
	senior_management: seniorManagement,
	hr_controller: hrController,
	hr_manager: hrManager,
	kiosk
};

const policies = Object.values(policiesByFileKey);
const namesByPolicy = new Map(
	Object.entries(policiesByFileKey).map(([name, policy]) => [policy, name])
);

const nameOf = (policy) => namesByPolicy.get(policy) ?? '<unknown policy>';

/** The filename key a team has to declare for a subject to hold this policy. */
const heldNameOf = (policy) => nameOf(policy).toLocaleLowerCase();

/** `matches`: the grants this policy has for one collection and one grant coordinate. */
const grantsFor = (policy, collection, coordinate) => {
	const [operation, phase] = coordinate.split('.');
	const grant =
		phase === undefined
			? policy.grants[collection]?.[operation]
			: policy.grants[collection]?.[operation]?.[phase];
	return grant === undefined ? [] : [grant];
};

const may = (policy, collection, coordinate) =>
	grantsFor(policy, collection, coordinate).length > 0;

/** Every `(collection, grant coordinate)` pair a policy grants at all. */
const surfaceOf = (policy) =>
	new Set(
		Object.entries(policy.grants).flatMap(([collection, actions]) =>
			Object.entries(actions).flatMap(([operation, grant]) =>
				operation === 'mutate'
					? Object.keys(grant).map((phase) => `${collection}:mutate.${phase}`)
					: [`${collection}:${operation}`]
			)
		)
	);

test('the seven policies are the seven names a team may declare', () => {
	assert.deepEqual(
		policies.map(heldNameOf).toSorted(),
		[
			'employee',
			'hr_controller',
			'hr_manager',
			'kiosk',
			'manager',
			'senior_management',
			'supervisor'
		].toSorted()
	);
	// One filename key per policy, and no two declarations sharing one. `policiesHeld` returns a set of
	// folded names, so two policies folding together would be two policies one name reaches.
	assert.equal(new Set(policies.map(heldNameOf)).size, policies.length);
});

test('write grants use only mutate.new and mutate.existing authoring coordinates', () => {
	for (const policy of policies) {
		for (const [collection, grants] of Object.entries(policy.grants)) {
			assert.equal(
				Object.hasOwn(grants, 'create'),
				false,
				`${nameOf(policy)} ${collection}.create`
			);
			assert.equal(
				Object.hasOwn(grants, 'update'),
				false,
				`${nameOf(policy)} ${collection}.update`
			);
			if (grants.mutate !== undefined) {
				for (const phase of Object.keys(grants.mutate))
					assert.ok(
						phase === 'new' || phase === 'existing',
						`${nameOf(policy)} ${collection}.mutate.${phase}`
					);
			}
		}
	}

	assert.deepEqual(Object.keys(hrManager.grants.payroll_runs.mutate).toSorted(), [
		'existing',
		'new'
	]);
});

test('read scopes are structured trees with compiler-owned dependencies', () => {
	for (const policy of policies) {
		for (const actions of Object.values(policy.grants)) {
			const read = actions.read;
			if (read === undefined) continue;
			assert.equal(Object.hasOwn(read, 'dependencies'), false, nameOf(policy));
			assert.notEqual(read.where?.kind, 'policy-sql', nameOf(policy));
		}
	}
	assert.deepEqual(employee.grants.employees.read.where, {
		email: { caseFoldEq: { $subject: 'email' } }
	});
	assert.deepEqual(employee.grants.employments.read.where, {
		employment_employee: {
			some: { email: { caseFoldEq: { $subject: 'email' } } }
		}
	});
	assert.deepEqual(employee.grants.payslips.read.where, {
		payslip_employment: {
			some: {
				employment_employee: {
					some: { email: { caseFoldEq: { $subject: 'email' } } }
				}
			}
		}
	});
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
		'Manager (HR Controller)': ['hr_controller'],
		'Attendance Kiosk': ['kiosk']
	});
});

test('an employee cannot mutate a new payroll run, and neither can a supervisor or a manager', () => {
	// The owner's ladder enumerates payroll authority rather than accumulating it with rank. There is
	// no grant to gate, so there is nothing to review and nothing to hold: `matches` finds no grant,
	// `decide` falls through to "no matching allow policy", and `mutate.new` is refused outright.
	for (const policy of [employee, supervisor, manager]) {
		assert.equal(may(policy, 'payroll_runs', 'mutate.new'), false, nameOf(policy));
		assert.equal(may(policy, 'payroll_runs', 'mutate.existing'), false, nameOf(policy));
		assert.equal(may(policy, 'payroll_runs', 'delete'), false, nameOf(policy));
		const [calendar] = grantsFor(policy, 'payroll_runs', 'read');
		assert.deepEqual(
			calendar.fields,
			['company_id', 'period', 'lifecycle', 'attendance_from', 'attendance_to'],
			nameOf(policy)
		);
	}
	// A payslip is the exception, and deliberately so: Employee Self-Service exists to show somebody
	// their own pay. The grant is row-scoped to their own employment, so reading one is not reading
	// payroll — only paid-period calendar metadata is exposed above.
	for (const policy of [employee, supervisor, manager]) {
		const [ownPayslip, ...extra] = grantsFor(policy, 'payslips', 'read');
		assert.deepEqual(extra, [], `${nameOf(policy)} has more than one payslip read`);
		assert.deepEqual(
			ownPayslip.where.payslip_employment.some.employment_employee.some.email,
			{ caseFoldEq: { $subject: 'email' } },
			nameOf(policy)
		);
	}
});

test('a controller may view payroll, and mutate.new is held for hr_manager or senior management', () => {
	assert.equal(may(hrController, 'payroll_runs', 'read'), true);

	const [newGrant, ...extra] = grantsFor(hrController, 'payroll_runs', 'mutate.new');
	assert.deepEqual(
		extra,
		[],
		'one mutate.new grant, or the union would pick an arbitrary approval'
	);

	// The live flow returns one concrete route. There are no authored step ids or names.
	assert.notEqual(newGrant.approval, undefined);
	const flow = newGrant.approval.flow();
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
	assert.equal(may(hrController, 'payroll_runs', 'mutate.existing'), false);
	assert.equal(may(hrController, 'payroll_runs', 'delete'), false);

	// The run's `before` hook returns the payslips, adjustments and capture junctions, and what a
	// hook returns is the workspace's own work: no grant of this policy names them, and a
	// controller submitting a payslip directly is refused on that claim.
	for (const collection of [
		'payslips',
		'payslip_allowance_request_inputs',
		'payslip_leave_inputs',
		'payslip_loan_repayment_inputs'
	]) {
		assert.equal(may(hrController, collection, 'mutate.new'), false, `hr_controller ${collection}`);
		assert.equal(may(hrController, collection, 'delete'), false, `hr_controller ${collection}`);
	}
	// The Scheduling app reads the capture junctions as this subject to mark consumed days.
	for (const collection of [
		'payslip_allowance_request_inputs',
		'payslip_leave_inputs',
		'payslip_loan_repayment_inputs'
	])
		assert.equal(may(hrController, collection, 'read'), true, `hr_controller ${collection}`);
});

test('hr_manager and senior management mutate new and existing payroll runs without a gate', () => {
	for (const policy of [hrManager, seniorManagement]) {
		const [newGrant] = grantsFor(policy, 'payroll_runs', 'mutate.new');
		assert.notEqual(newGrant, undefined, nameOf(policy));
		assert.equal(newGrant.approval, undefined, `${nameOf(policy)} mutate.new must not be gated`);
		assert.equal(may(policy, 'payroll_runs', 'mutate.existing'), true, nameOf(policy));
		assert.equal(may(policy, 'payroll_runs', 'delete'), true, nameOf(policy));

		// Running a draft again states the run's complete set of payslips from the `before` hook
		// and the omitted ones go with it. That graph is the workspace's own work, so the policy
		// holds no write on the result: `payroll_runs.mutate.existing` is the whole of "run again".
		// Deleting a run is different: its cascade descends as the deleting person (RFC 0003 §3.2),
		// so the six collections a run owns carry delete, and only delete.
		for (const collection of [
			'payslips',
			'payslip_allowance_request_inputs',
			'payslip_leave_inputs',
			'payslip_loan_repayment_inputs'
		]) {
			assert.equal(may(policy, collection, 'mutate.new'), false, `${nameOf(policy)} ${collection}`);
			assert.equal(
				may(policy, collection, 'mutate.existing'),
				false,
				`${nameOf(policy)} ${collection}`
			);
			assert.equal(may(policy, collection, 'delete'), true, `${nameOf(policy)} ${collection}`);
		}

		// A completed run stays readable: the creator and HR Manager both see it after it lands.
		assert.equal(may(policy, 'payroll_runs', 'read'), true, nameOf(policy));
		assert.equal(may(policy, 'payslips', 'read'), true, nameOf(policy));
		for (const collection of [
			'payslip_allowance_request_inputs',
			'payslip_leave_inputs',
			'payslip_loan_repayment_inputs'
		]) {
			assert.equal(may(policy, collection, 'read'), true, `${nameOf(policy)} ${collection}`);
		}
	}
});

test('every rank reads its own three request families, and a correction is not a record anybody reads', () => {
	// The rule used to be a row predicate — `event -> 'kind' <> 'MANUAL_ADJUSTMENT'` — explicitly
	// `AND`ed with the ownership path, because `rowPredicate` unions matching grants and a second
	// unconditional read would have widened it to every correction in the workspace. Then it was
	// the absence of a grant on `correction_requests`. It is now neither: a correction is not a
	// record at all. It is an entry against the same component with `as_adjustment_entry` set, so
	// what a rank sees of one is exactly what it sees of the family that entry belongs to.
	for (const family of ['claim', 'allowance', 'payment']) {
		const [read, ...extra] = grantsFor(employee, `${family}_requests`, 'read');
		assert.notEqual(read, undefined, family);
		assert.deepEqual(
			extra,
			[],
			`a second ${family} read grant would be OR-ed in and would widen this one`
		);
		assert.deepEqual(
			read.where[`${family}_request_employment`].some.employment_employee.some.email,
			{ caseFoldEq: { $subject: 'email' } },
			family
		);
	}

	// And no rank holds a grant on a collection that no longer exists, which is the only way the
	// old shape could come back by accident.
	for (const policy of [employee, supervisor, manager, hrController, hrManager, seniorManagement])
		assert.deepEqual(
			Object.keys(policy.grants).filter((name) => name.startsWith('correction')),
			[],
			nameOf(policy)
		);
});

test('an employee may raise only a time-off request', async () => {
	const [grant, ...extra] = grantsFor(employee, 'leave_entries', 'mutate.new');
	assert.deepEqual(extra, [], 'the employee has more than one leave request mutate.new grant');
	assert.equal(typeof grant.authorize, 'function');
	assert.notEqual(grant.approval, undefined, 'an employee leave request must be reviewed');

	const unusedApi = {};
	for (const kind of ['ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL']) {
		const allowed = await Effect.runPromise(
			grant.authorize({ record: { employment_id: 'employment', event: { kind } } }, unusedApi)
		);
		assert.equal(allowed, false, kind);
	}
	assert.equal(
		await Effect.runPromise(
			grant.authorize({ record: { employment_id: 'employment', event: null } }, unusedApi)
		),
		false
	);
});

test('manual Leave categories require HR authority, while time off retains its review route', async () => {
	for (const kind of ['ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL']) {
		const input = { record: { employment_id: 'employment', event: { kind } } };
		for (const policy of [employee, supervisor, manager]) {
			const [grant] = grantsFor(policy, 'leave_entries', 'mutate.new');
			assert.equal(
				await Effect.runPromise(grant.authorize(input, {})),
				false,
				`${nameOf(policy)} ${kind}`
			);
		}
		const [controllerGrant] = grantsFor(hrController, 'leave_entries', 'mutate.new');
		assert.deepEqual(controllerGrant.approval.flow(input).stages[0].approvers, [
			'HR Manager',
			'Senior Management'
		]);
		for (const policy of [hrManager, seniorManagement]) {
			const [grant] = grantsFor(policy, 'leave_entries', 'mutate.new');
			assert.equal(grant.approval.flow(input), noApproval, `${nameOf(policy)} ${kind}`);
		}
	}
	for (const policy of [hrController, hrManager, seniorManagement]) {
		const [grant] = grantsFor(policy, 'leave_entries', 'mutate.new');
		assert.deepEqual(
			grant.approval.flow({ record: { event: { kind: 'TIME_OFF' } } }).stages[0].approvers,
			['L1 Manager', 'HR Manager', 'Senior Management']
		);
		assert.equal(may(policy, 'leave_entries', 'mutate.existing'), false);
		assert.equal(may(policy, 'leave_entries', 'delete'), false);
	}
	for (const policy of policies) {
		const [grant] = grantsFor(policy, 'leave_entries', 'mutate.new');
		if (!grant) continue;
		assert.deepEqual(grant.fields, [
			'employment_id',
			'leave_catalogue_id',
			'event',
			'reference',
			'certificate_file'
		]);
	}
});

test('the settings root: a controller prepares drafts, a manager seals and voids under approval', async () => {
	for (const policy of [employee, supervisor, manager]) {
		assert.equal(may(policy, 'jurisdiction_settings', 'read'), true, nameOf(policy));
		assert.equal(may(policy, 'jurisdiction_settings', 'mutate.existing'), false, nameOf(policy));
		assert.equal(may(policy, 'leave_catalogue', 'mutate.existing'), false, nameOf(policy));
	}
	for (const action of ['mutate.new', 'mutate.existing', 'delete']) {
		const [grant, ...extra] = grantsFor(hrController, 'jurisdiction_settings', action);
		assert.deepEqual(extra, [], action);
		assert.equal(grant.approval, undefined, `${action}: a draft write is not reviewed`);
		assert.equal(
			await Effect.runPromise(grant.authorize({ record: { sealed_at: null, voided_at: null } })),
			true,
			`${action}: the controller edits drafts`
		);
		assert.equal(
			await Effect.runPromise(
				grant.authorize({ record: { sealed_at: '2026-01-01T00:00:00Z', voided_at: null } })
			),
			false,
			`${action}: the controller never seals`
		);
		assert.equal(
			await Effect.runPromise(
				grant.authorize({ record: { sealed_at: null, voided_at: '2026-01-01T00:00:00Z' } })
			),
			false,
			`${action}: the controller never voids`
		);
	}
	for (const policy of [hrManager, seniorManagement]) {
		for (const action of ['mutate.new', 'mutate.existing']) {
			const [grant] = grantsFor(policy, 'jurisdiction_settings', action);
			assert.equal(grant.authorize, undefined, nameOf(policy));
			assert.deepEqual(
				grant.approval.flow({ record: { sealed_at: null }, changes: { name: 'x' } }),
				noApproval,
				`${nameOf(policy)} ${action}: a draft edit is not reviewed`
			);
			assert.deepEqual(
				grant.approval.flow({
					record: { sealed_at: '2026-01-01T00:00:00Z' },
					changes: { sealed_at: '2026-01-01T00:00:00Z' }
				}).stages[0].approvers,
				['HR Manager', 'Senior Management'],
				`${nameOf(policy)} ${action}: sealing is reviewed`
			);
			assert.deepEqual(
				grant.approval.flow({
					record: { sealed_at: '2026-01-01T00:00:00Z', voided_at: '2026-02-01T00:00:00Z' },
					changes: { voided_at: '2026-02-01T00:00:00Z', void_reason: 'wrong table' }
				}).stages[0].approvers,
				['HR Manager', 'Senior Management'],
				`${nameOf(policy)} ${action}: voiding is reviewed`
			);
		}
	}
	// Every row under a version is the draft's to edit, by whoever holds the catalogue; the seal
	// is what reviews them, once, and after it the hooks refuse every write.
	for (const policy of [hrController, hrManager, seniorManagement])
		for (const collection of [
			'statutory_contributions',
			'leave_catalogue',
			'loan_catalogue',
			'claim_catalogue',
			'allowance_catalogue',
			'payment_catalogue',
			'jurisdiction_holidays'
		])
			for (const action of ['mutate.new', 'mutate.existing', 'delete']) {
				const [grant, ...extra] = grantsFor(policy, collection, action);
				assert.deepEqual(extra, [], `${nameOf(policy)} ${collection} ${action}`);
				assert.equal(grant.approval, undefined, `${nameOf(policy)} ${collection} ${action}`);
				assert.equal(grant.authorize, undefined, `${nameOf(policy)} ${collection} ${action}`);
			}
	// Generated rows are the reconciler's: no person may create an entitlement.
	for (const policy of [employee, supervisor, manager, hrController, hrManager, seniorManagement])
		assert.equal(may(policy, 'leave_entitlements', 'mutate.new'), false, nameOf(policy));
});

test('ordinary ranks authorize only their own reviewed claim; HR may raise any family', () => {
	// Writes use pure TypeScript/Effect authorization over the prepared record, not a SQL where.
	const [claim, ...extra] = grantsFor(employee, 'claim_requests', 'mutate.new');
	assert.deepEqual(extra, [], 'the employee has more than one claim mutate.new grant');
	assert.equal(typeof claim.authorize, 'function');
	assert.equal(claim.where, undefined);
	assert.notEqual(claim.approval, undefined, 'an employee claim must be reviewed');
	// A claim is the only family they may raise. Raising an adjustment is raising an entry with
	// the tick set, so "may an employee correct their own pay" is answered by this same grant —
	// and it is answered by the approval on it, not by a separate authority.
	for (const family of ['allowance', 'payment'])
		assert.equal(may(employee, `${family}_requests`, 'mutate.new'), false, family);

	for (const policy of [hrController, hrManager, seniorManagement]) {
		for (const family of ['claim', 'allowance', 'payment']) {
			const [newGrant] = grantsFor(policy, `${family}_requests`, 'mutate.new');
			assert.notEqual(newGrant, undefined, `${nameOf(policy)} ${family}`);
			assert.equal(
				newGrant.where,
				undefined,
				`${nameOf(policy)} ${family} mutate.new must be unconditional`
			);
		}
	}
});

test('no team holder receives the same operation from two policies', () => {
	const conflicts = [];
	for (const [team, heldNames] of Object.entries(teams)) {
		const ownersByOperation = new Map();
		for (const heldName of heldNames) {
			const policy = policiesByFileKey[heldName.toLocaleLowerCase()];
			for (const pair of surfaceOf(policy)) {
				const [collection, coordinate] = pair.split(':');
				const operation = `${coordinate} on ${collection}`;
				const owners = ownersByOperation.get(operation) ?? [];
				owners.push(heldName);
				ownersByOperation.set(operation, owners);
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
		for (const coordinate of ['mutate.new', 'mutate.existing']) {
			for (const grant of grantsFor(policy, 'employment_statutory_facts', coordinate)) {
				assert.ok(
					Array.isArray(grant.fields),
					`${nameOf(policy)} ${coordinate} needs a field mask`
				);
				assert.equal(
					grant.fields.includes('supersedes_fact_id'),
					false,
					`${nameOf(policy)} ${coordinate} exposes the system transition instruction`
				);
			}
		}
	}
});

test('a rank whose app shows captures reads the settlement ledger masked to the claim', () => {
	// The hooks that refuse a settled record read the ledger as the workspace, so no policy holds a
	// grant for their sake. The grants below exist for the apps: My attendance and My leave mark a
	// day or an entry consumed by a payslip, and they read the claim as the person using them.
	//
	// The single-use sources carry their own pin, readable with the row; nothing else is granted.
	for (const policy of [employee, supervisor, manager])
		assert.equal(may(policy, 'payslips', 'mutate.existing'), false, nameOf(policy));
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
		assert.equal(may(policy, 'claim_requests', 'mutate.new'), true, nameOf(policy));
	}
});

test('the kiosk sees one app and may only key time entries and face enrollments', () => {
	assert.deepEqual(kiosk.capabilities, { apps: ['hr_controller/kiosk'] });

	// Masked person reads: identity display plus face state, no statutory or identity PII.
	const [personRead] = grantsFor(kiosk, 'employees', 'read');
	assert.notEqual(personRead, undefined);
	for (const field of ['date_of_birth', 'identity_number', 'address', 'user_id']) {
		assert.equal(personRead.fields.includes(field), false, `kiosk employees.read exposes ${field}`);
	}

	// Interval-only day writes, and no approval flow holds a punch.
	for (const coordinate of ['mutate.new', 'mutate.existing']) {
		const [grant] = grantsFor(kiosk, 'work_days', coordinate);
		assert.notEqual(grant, undefined, `kiosk work_days.${coordinate}`);
		assert.equal(grant.approval, undefined, `kiosk work_days.${coordinate} must not review`);
	}
	const [dayNew] = grantsFor(kiosk, 'work_days', 'mutate.new');
	for (const field of ['shift_definition_id', 'assignment_code', 'planned_origin']) {
		assert.equal(dayNew.fields.includes(field), false, `kiosk may not plan ${field}`);
	}
	assert.equal(may(kiosk, 'work_days', 'delete'), false, 'kiosk may not delete days');

	// Nothing outside people, employments, days, companies, terms and shifts. Every grant answers
	// "what may the device do"; none answers "what does a hook need". The day guards a punch runs
	// and the leave ledger an enrolment generates read as the workspace, so the reads that used to
	// exist for them (leave requests, payroll runs, the work-day capture) are gone, and the
	// collections the ledger is made of were never granted at all.
	for (const collection of [
		'claim_requests',
		'allowance_requests',
		'payment_requests',
		'correction_requests',
		'loans',
		'payslips',
		'leave_entries',
		'payroll_runs',
		'leave_catalogue',
		'leave_entitlements',
		'leave_entries',
		'jurisdiction_settings'
	]) {
		assert.equal(may(kiosk, collection, 'read'), false, `kiosk reads ${collection}`);
		assert.equal(may(kiosk, collection, 'mutate.new'), false, `kiosk writes ${collection}`);
	}
});

test('kiosk-created persons always land pending, and only HR approves', () => {
	const [created] = grantsFor(kiosk, 'employees', 'mutate.new');
	assert.notEqual(created, undefined);
	assert.equal(
		created.authorize({ record: { face_enrollment_status: 'PENDING' } }, undefined),
		true
	);
	assert.equal(
		created.authorize({ record: { face_enrollment_status: 'APPROVED' } }, undefined),
		false,
		'the kiosk may not approve its own enrollment'
	);
	assert.equal(created.authorize({ record: { face_enrollment_status: 'NONE' } }, undefined), false);

	const [edited] = grantsFor(kiosk, 'employees', 'mutate.existing');
	assert.notEqual(edited, undefined);
	const decide = (previous, next) =>
		edited.authorize(
			{
				previous: { face_enrollment_status: previous },
				changes: { face_enrollment_status: next },
				record: { face_enrollment_status: next }
			},
			undefined
		);
	assert.equal(decide('NONE', 'APPROVED'), true, 'known-person enrollment');
	assert.equal(decide('APPROVED', 'APPROVED'), true, 'punch bookkeeping');
	assert.equal(decide('NONE', 'PENDING'), false);
	assert.equal(decide('PENDING', 'APPROVED'), false, 'approving a pending row is HR');
	assert.equal(decide('APPROVED', 'SUSPENDED'), false, 'suspending is HR');
	assert.equal(decide('SUSPENDED', 'APPROVED'), false, 'unsuspending is HR');
});

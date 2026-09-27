// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The person: child facts append-only. A kiosk enrolment approves a known face or creates the person PENDING with their
 * employment (`kiosk.test.ts` holds the matcher).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import employees from '../src/data/collection/employees/+collection.ts';
import { action, caller, transform } from './helpers/bodies.ts';

const probe = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

test('child facts are append-only; a new person starts with none', async () => {
	const child = { name: 'A', effective_range: null };
	const stored = { id: 'p', children: [child] };
	await transform(employees, [{ children: [child, { name: 'B' }] }], { existing: [stored] });
	await assert.rejects(
		transform(employees, [{ children: [] }], { existing: [stored] }),
		/append-only/
	);
	await assert.rejects(
		transform(employees, [{ children: [{ name: 'Z' }] }], { existing: [stored] }),
		/append-only/
	);
	const [created] = await transform(employees, [{ name: 'New' }]);
	assert.equal(created.children, undefined); // the model's `default: []` fills it at the write
});

test('an enrolment approves a known face, or creates the person PENDING with their employment', async () => {
	const consent_at = '2026-06-15T01:00:00.000Z';
	const known = caller({ tables: { employees: [{ id: 'p', face_enrollment_status: 'NONE' }] } });
	await action(
		employees,
		'kiosk_enroll',
		{ employee_id: 'p', face_embedding: probe, consent_at },
		known
	);
	assert.deepEqual(known.acts[0].input.target, 'p');
	assert.equal(known.acts[0].input.set.face_enrollment_status, 'APPROVED');
	const pending = caller({
		tables: { employees: [{ id: 'p', face_enrollment_status: 'PENDING' }] }
	});
	await assert.rejects(
		action(
			employees,
			'kiosk_enroll',
			{ employee_id: 'p', face_embedding: probe, consent_at },
			pending
		),
		/HR must review/
	);
	const fresh = caller();
	const out = await action(
		employees,
		'kiosk_enroll',
		{ new_person: { name: ' Ana ', company_id: 'entity' }, face_embedding: probe, consent_at },
		fresh
	);
	const person = fresh.acts[0].input;
	assert.deepEqual(
		[person.name, person.face_enrollment_status, person.employments.create[0].effective_range],
		['Ana', 'PENDING', { from: '2026-06-15', to: null }]
	);
	assert.equal(out.status, 'PENDING');
	await assert.rejects(
		action(employees, 'kiosk_enroll', { face_embedding: probe.map(() => 0), consent_at }, fresh),
		/face descriptor/
	);
	await assert.rejects(
		action(
			employees,
			'kiosk_enroll',
			{ employee_id: 'p', face_embedding: probe, consent_at: '2027-01-01T00:00:00.000Z' },
			known
		),
		/in the future/
	);
});

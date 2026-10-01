// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Package D (capability plan I4, I5, I7): a leave entry records the event facts its catalogue row
 * declares and may continue an episode; evidence attaches to any subject that records a declared
 * fact, with the document type and expiry its declaration names; a departure ground is a code of
 * the `TERMINATION_GROUND` table in force on the last working day. Fixtures are jurisdiction-free.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import leaveEntries from '../src/data/collection/leave_entries/+collection.ts';
import employments from '../src/data/collection/employments/+collection.ts';
import evidence from '../src/data/collection/fact_evidence/+collection.ts';
import { runTransform } from './helpers/ctx.ts';
import { transform } from './helpers/bodies.ts';
import { approve, id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';

// ── I4: leave event facts and episodes ──

const period = (range) => ({
	from: { $d: range.start },
	to: range.end == null ? null : { $d: range.end }
});

const CHILD = [{ key: 'child_index', type: 'number', integer: true, minimum: 1, required: true }];

function leaveTables(eventFacts = CHILD, entries = []) {
	const context = leaveContext();
	return {
		employments: context.employments.map((row) => ({
			...row,
			effective_range: period(row.effective_range)
		})),
		companies: context.companies,
		employees: context.employees,
		employment_terms: context.terms.map(({ base_salary, ...row }) => ({
			...row,
			effective_range: period(row.effective_range),
			base_salary: { $dec: String(base_salary.value) },
			currency: base_salary.currency
		})),
		jurisdiction_settings: context.versions,
		leave_catalogue: context.catalogues.map((row) => ({ ...row, event_facts: eventFacts })),
		leave_entries: entries,
		shift_patterns: context.patterns.map((row) => ({ ...row, company_id: id(3) })),
		shift_definitions: context.shifts
	};
}

const request = (over = {}) => ({
	...submission(timeOff('2026-04-06', '2026-04-08'), 'EVENT'),
	...over
});

test('a leave entry records only the event facts its catalogue row declares, each valid and owed', async () => {
	const [planned] = await runTransform(leaveEntries, [request({ facts: { child_index: 2 } })], {
		tables: leaveTables()
	});
	assert.deepEqual(planned.facts, { child_index: 2 });
	assert.equal(planned.episode_id, null);
	assert.equal(planned.charges.length, 3, 'the facts change no charge');
	const write = (facts) =>
		runTransform(leaveEntries, [request({ facts })], { tables: leaveTables() });
	await assert.rejects(write({ typo: 1 }), /ANNUAL does not declare the event fact typo/);
	await assert.rejects(write({}), /child_index is required before calculation/);
	await assert.rejects(write({ child_index: 0 }), /child_index must be at least 1/);
	await assert.rejects(write({ child_index: 1.5 }), /child_index must be a whole number/);
	// A catalogue row that declares nothing takes an entry without facts, as before.
	const [plain] = await runTransform(leaveEntries, [request()], { tables: leaveTables([]) });
	assert.deepEqual(plain.facts, {});
});

test('an episode continues its first entry of the same leave and contract', async () => {
	const opener = {
		...approve(leaveContext(), timeOff('2026-03-02'), 50),
		leave_code: 'ANNUAL',
		episode_id: null
	};
	const later = { ...opener, id: id(51), reference: 'TEST-51', episode_id: id(50) };
	const tables = leaveTables([], [opener, later]);
	const [next] = await runTransform(leaveEntries, [request({ episode_id: id(50) })], { tables });
	assert.equal(next.episode_id, id(50));
	await assert.rejects(
		runTransform(leaveEntries, [request({ episode_id: id(51) })], { tables }),
		/named by its first entry/
	);
	await assert.rejects(
		runTransform(leaveEntries, [request({ episode_id: id(99) })], { tables }),
		/same leave on the same contract/
	);
	await assert.rejects(
		runTransform(leaveEntries, [request({ episode_id: id(50) })], {
			tables: { ...tables, leave_entries: [{ ...opener, leave_code: 'SICK' }] }
		}),
		/same leave on the same contract/
	);
});

// ── I5: evidence on any subject ──

const version = (over = {}) => ({
	id: 'v1',
	code: 'TEST',
	sealed_at: '2026-01-01T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	effective_range: { from: '2026-01-01', to: null },
	...over
});
const record = (tables, collection, subjectId, row) =>
	transform(evidence, [{ subject: { collection, id: subjectId }, ...row }], { tables });

test('evidence on a leave entry names the document its declaration demands and counts for valid_days', async () => {
	const tables = {
		leave_catalogue: [
			{
				id: 'cat',
				code: 'EVENT',
				event_facts: [
					{
						key: 'child_index',
						type: 'number',
						evidence: { kind: 'REFERENCE', document: 'BIRTH_RECORD', valid_days: 30 }
					},
					{ key: 'note', type: 'string' }
				]
			}
		],
		leave_entries: [{ id: 'e1', catalogue_id: 'cat', facts: { child_index: 2, note: 'x' } }]
	};
	const [out] = await record(tables, 'leave_entries', 'e1', {
		fact_key: 'child_index',
		reference: 'BR-1',
		received_on: '2026-01-01'
	});
	assert.equal(out.document_type, 'BIRTH_RECORD', 'filled in from the declaration');
	// 30 days counting the day received: 1 January through 30 January.
	assert.equal(out.expires_on, '2026-01-30');
	const [leap] = await record(tables, 'leave_entries', 'e1', {
		fact_key: 'child_index',
		reference: 'BR-2',
		received_on: '2028-02-15'
	});
	assert.equal(leap.expires_on, '2028-03-15', '15 Feb + 29 days crosses a leap day');
	await assert.rejects(
		record(tables, 'leave_entries', 'e1', {
			fact_key: 'child_index',
			reference: 'BR-1',
			received_on: '2026-01-01',
			document_type: 'PAYSLIP'
		}),
		/must be a BIRTH_RECORD document/
	);
	await assert.rejects(
		record(tables, 'leave_entries', 'e1', { fact_key: 'child_index', reference: 'BR-1' }),
		/needs the day it was received/
	);
	await assert.rejects(
		record(tables, 'leave_entries', 'e1', {
			fact_key: 'child_index',
			reference: 'BR-1',
			received_on: '2026-02-01',
			expires_on: '2026-01-31'
		}),
		/cannot expire before it was received/
	);
	await assert.rejects(
		record(tables, 'leave_entries', 'e1', { fact_key: 'note', reference: 'R' }),
		/EVENT declares no evidence for the fact note/
	);
	await assert.rejects(
		record(tables, 'leave_entries', 'e1', { fact_key: 'absent', reference: 'R' }),
		/record no fact absent/
	);
});

test('a departure, a person fact, a registration and a duty each carry evidence their declarer demands', async () => {
	const file = { kind: 'FILE' };
	const tables = {
		companies: [{ id: 'co', settings_code: 'TEST' }],
		employments: [
			{ id: 'k1', employee_id: 'p1', company_id: 'co', exit_facts: { notice_served: true } }
		],
		person_facts: [
			{ id: 'pf1', employee_id: 'p1', employment_id: null, facts: { disabled: true } }
		],
		statutory_contributions: [
			{ id: 's1', code: 'FUND', elections: [{ key: 'voluntary', type: 'boolean', evidence: file }] }
		],
		employment_statutory_facts: [
			{
				id: 'r1',
				employee_id: 'p1',
				statutory_contribution_id: 's1',
				status: { kind: 'REGISTERED', elections: { voluntary: true } }
			}
		],
		obligation_instances: [
			{ id: 'o1', duty_code: 'NOTIFY', settings_id: 'v1', facts: { lodged: true } }
		],
		jurisdiction_settings: [
			version({
				exit_facts: [{ key: 'notice_served', type: 'boolean', evidence: file }],
				person_facts: [{ key: 'disabled', type: 'boolean', evidence: file }],
				duty_types: [
					{ code: 'NOTIFY', evidence: [{ key: 'lodged', type: 'boolean', evidence: file }] },
					{ code: 'OTHER', evidence: [] }
				]
			})
		]
	};
	for (const [collection, subjectId, key] of [
		['employments', 'k1', 'notice_served'],
		['person_facts', 'pf1', 'disabled'],
		['employment_statutory_facts', 'r1', 'voluntary'],
		['obligation_instances', 'o1', 'lodged']
	]) {
		await record(tables, collection, subjectId, { fact_key: key, file: 'proof.pdf' });
		await assert.rejects(
			record(tables, collection, subjectId, { fact_key: key, reference: 'R' }),
			/needs file/,
			collection
		);
	}
	// A person fact without a contract at a declaring lineage has nothing to judge it.
	await assert.rejects(
		record({ ...tables, employments: [] }, 'person_facts', 'pf1', {
			fact_key: 'disabled',
			file: 'proof.pdf'
		}),
		/declares no evidence for the fact disabled/
	);
	await assert.rejects(
		record(tables, 'payslips', 'x', { fact_key: 'k', file: 'f' }),
		/Evidence must name the fact revision, contract terms, work day, payment/
	);
});

// ── I7: departure grounds ──

const contract = (over = {}) => ({
	id: 'a',
	employee_id: 'person',
	company_id: 'entity',
	employee_number: 'E1',
	effective_range: { from: '2020-01-01', to: '2026-03-31' },
	exit_ground: null,
	exit_facts: null,
	comments: null,
	...over
});
const groundWorld = (left) => ({
	companies: [{ id: 'entity', settings_code: 'TEST' }],
	employments: [left],
	jurisdiction_settings: [
		version({ id: 'law', effective_range: { from: '2020-01-01', to: null } })
	],
	reference_rows: [
		{
			settings_id: 'law',
			table: 'TERMINATION_GROUND',
			code: 'MISCONDUCT',
			effective_range: { from: '2020-01-01', to: null }
		},
		// Repealed on 2025-12-31: no longer a ground for a last day after it.
		{
			settings_id: 'law',
			table: 'TERMINATION_GROUND',
			code: 'OLD_GROUND',
			effective_range: { from: '2020-01-01', to: '2025-12-31' }
		},
		{
			settings_id: 'law',
			table: 'DOCUMENT_TYPE',
			code: 'NOTICE',
			effective_range: { from: '2020-01-01', to: null }
		}
	]
});

test('a departure ground is a code of the ground table in force on the last working day', async () => {
	const left = contract();
	const one = (input, row = left) =>
		transform(employments, [input], { existing: [row], tables: groundWorld(row) });
	await one({ exit_ground: 'MISCONDUCT' });
	await assert.rejects(
		one({ exit_ground: 'OLD_GROUND' }),
		/no departure ground OLD_GROUND in force on 2026-03-31/
	);
	await assert.rejects(
		one({ exit_ground: 'NOTICE' }),
		/no departure ground NOTICE/,
		'another table’s code'
	);
	await assert.rejects(one({ exit_ground: 'INVENTED' }), /no departure ground INVENTED/);
	// A last day inside the repealed ground's range still takes it.
	const earlier = contract({ effective_range: { from: '2020-01-01', to: '2025-06-30' } });
	await one({ exit_ground: 'OLD_GROUND' }, earlier);
	// An open contract has no last day to judge a ground by.
	const open = contract({ effective_range: { from: '2020-01-01', to: null } });
	await assert.rejects(one({ exit_ground: 'MISCONDUCT' }, open), /requires a last working day/);
});

// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Declared FactKey schemas beyond the entity: a settings version declares the jurisdiction inputs
 * recorded on contract terms, person-days, payments and settlements; each subject's `facts` holds
 * them, one `fact_evidence` row evidences one of them, and the expression roots read them by name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { factKeysValueSchema } from '../src/lib/datatypes/fact_keys.ts';
import { factValuesFault } from '../src/lib/declared-facts.ts';
import { compileExpression } from '../src/lib/expressions/compile.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { workDayHolds } from '../src/lib/payroll/work-bands.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { withDeclaredFacts } from '../src/lib/payroll/run/configuration.ts';
import settings from '../src/data/collection/jurisdiction_settings/+collection.ts';
import terms from '../src/data/collection/employment_terms/+collection.ts';
import evidence from '../src/data/collection/fact_evidence/+collection.ts';
import { COMPANY_ID, createStatutoryWorld } from './fixtures/statutory-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { transform } from './helpers/bodies.ts';

const decode = Schema.decodeUnknownSync(factKeysValueSchema);

test('a fact is a boolean, number, string, calendar day or UTC instant, and may demand evidence', () => {
	assert.doesNotThrow(() =>
		decode([
			{ key: 'notice_on', type: 'date', default_value: '2026-01-01' },
			{ key: 'agreed_at', type: 'instant' },
			{ key: 'grade', type: 'string', evidence: { kind: 'REFERENCE_AND_FILE' } },
			{
				key: 'permit',
				type: 'boolean',
				evidence: { kind: 'REFERENCE', when: 'terms.facts.permit' }
			}
		])
	);
	for (const declarations of [
		[{ key: 'notice_on', type: 'date', default_value: '2026-02-30' }],
		[{ key: 'agreed_at', type: 'instant', default_value: '2026-01-01' }],
		[{ key: 'grade', type: 'string', evidence: { kind: 'STAMP' } }],
		[{ key: 'grade', type: 'string', evidence: { kind: 'FILE', when: ' ' } }]
	])
		assert.throws(() => decode(declarations));
});

test('an evidenced value counts only once its evidence is recorded', () => {
	const fields = [{ key: 'grade', type: 'string', evidence: { kind: 'REFERENCE' } }];
	assert.equal(factValuesFault(fields, { grade: 'G1' }), null, 'a write may precede its evidence');
	assert.match(
		factValuesFault(fields, { grade: 'G1' }, true),
		/evidence \(reference\) is recorded/
	);
	assert.equal(
		factValuesFault(fields, { grade: 'G1' }, true, undefined, () => true),
		null
	);
	assert.equal(factValuesFault(fields, {}, true), null, 'nothing recorded demands nothing');
	const conditional = [{ ...fields[0], evidence: { kind: 'FILE', when: 'false' } }];
	assert.equal(
		factValuesFault(conditional, { grade: 'G1' }, true, () => false),
		null
	);
});

test('the subject roots are open: fact names are data, typed where the version is in hand', () => {
	const declared = [{ key: 'permit', type: 'boolean' }];
	const at = (expression, site, extra = {}) =>
		compileExpression({ expression, site, type: 'boolean', ...extra });
	assert.equal(at('terms.facts.permit', 'person', { termsFacts: declared }), null);
	assert.equal(at('"permit" in terms.fact_keys', 'person'), null);
	assert.match(at('terms.facts.typo', 'person', { termsFacts: declared }), /terms input typo/);
	assert.equal(at('person.terms.facts.permit && day_facts.consent', 'work_day'), null);
	assert.equal(at('"consent" in day_fact_keys', 'work_day'), null);
	assert.equal(
		at('payment.facts.permit && payment.kind == "CASH"', 'payment', { paymentFacts: declared }),
		null
	);
	assert.match(
		at('settlement.facts.basis', 'payment', { paymentFacts: [], settlementFacts: [] }),
		/settlement input basis/
	);
	assert.notEqual(at('day_facts.consent', 'person'), null, 'a day input is the work day’s');
});

test('a work band reads the day’s declared inputs as day_facts', () => {
	const person = personContext({
		employment: { service_start: '2026-01-01' },
		terms: null,
		asOf: '2026-01-15'
	});
	const day = (facts) => ({
		workDayId: 'd1',
		date: '2026-01-15',
		dayType: 'ORDINARY',
		workedHours: 10,
		normalHours: 8,
		overtimeHours: 2,
		breakMinutes: 60,
		holidayKind: '',
		holidayName: '',
		consecutiveHours: 4,
		continuousAttendance: false,
		restDay: false,
		offDay: false,
		nightHours: 0,
		requestedBy: 'EMPLOYER',
		facts
	});
	const holds = (facts) =>
		workDayHolds({
			work: { limits: [] },
			expression: 'day_facts.consent',
			person,
			day: day(facts),
			rates: { ordinaryHour: 10, dayWage: 80 }
		});
	assert.equal(holds({ consent: true }), true);
	assert.equal(holds({ consent: false }), false);
	assert.equal(person.terms.fact_keys.length, 0);
});

const draft = {
	code: 'TEST',
	jurisdiction_code: 'SG',
	name: 'TEST',
	payroll: { currency: 'SGD' },
	effective_range: { from: '2026-01-01', to: null },
	facts: [],
	sealed_at: null
};

test('a version’s subject schemas compile at their sites; evidence stays off a departure', async () => {
	const write = (row) => transform(settings, [{ ...draft, ...row }], { tables: {} });
	await write({
		terms_facts: [{ key: 'permit', type: 'boolean', required_when: 'terms.facts.permit' }],
		work_day_facts: [
			{
				key: 'consent_ref',
				type: 'string',
				evidence: { kind: 'REFERENCE', when: 'terms.facts.permit' }
			}
		],
		payment_facts: [
			{
				key: 'requested',
				type: 'boolean',
				valid_when: 'payment.kind == "CASH"',
				validation_message: 'Cash only.'
			}
		]
	});
	await assert.rejects(
		write({ terms_facts: [{ key: 'permit', type: 'boolean', required_when: 'terms.facts.typo' }] }),
		/permit terms requirement: .*terms input typo/
	);
	await assert.rejects(
		write({
			payment_facts: [{ key: 'requested', type: 'boolean', required_when: 'employee.age > 1' }]
		}),
		/requested payment requirement/
	);
	// An entity fact's evidence is recorded on its dated revision; a departure has no subject row.
	await write({ facts: [{ key: 'registered', type: 'boolean', evidence: { kind: 'FILE' } }] });
	await assert.rejects(
		write({ exit_facts: [{ key: 'registered', type: 'boolean', evidence: { kind: 'FILE' } }] }),
		/evidence is declared on entity, terms, work-day, payment and settlement inputs/
	);
});

const sealedTest = (terms_facts) => ({
	id: 'v1',
	code: 'TEST',
	sealed_at: '2026-01-01T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	terms_facts,
	work_day_facts: [],
	payment_facts: []
});

test('contract terms take only inputs their lineage declares, each value valid', async () => {
	const tables = {
		employments: [
			{ id: 'contract', company_id: 'co', effective_range: { from: '2025-01-01', to: null } }
		],
		companies: [{ id: 'co', settings_code: 'TEST' }],
		jurisdiction_settings: [sealedTest([{ key: 'grade', type: 'string', options: ['G1', 'G2'] }])]
	};
	const write = (facts) =>
		transform(
			terms,
			[
				{
					employment_id: 'contract',
					job_title: 'Cook',
					employment_type: 'PERMANENT',
					allowances: [],
					effective_range: { from: '2025-01-01', to: null },
					facts
				}
			],
			{ tables }
		);
	await write({});
	await write({ grade: 'G1' });
	await assert.rejects(write({ typo: 'G1' }), /TEST does not declare the entity fact typo/);
	await assert.rejects(write({ grade: 'G9' }), /must be one of: G1, G2/);
});

test('evidence is one row per evidenced fact, of the kind the declaration demands', async () => {
	const tables = {
		employment_terms: [{ id: 't1', employment_id: 'contract', facts: { grade: 'G1', site: 'X' } }],
		employments: [{ id: 'contract', company_id: 'co' }],
		companies: [{ id: 'co', settings_code: 'TEST' }],
		jurisdiction_settings: [
			sealedTest([
				{ key: 'grade', type: 'string', evidence: { kind: 'REFERENCE_AND_FILE' } },
				{ key: 'site', type: 'string' }
			])
		]
	};
	const record = (row) =>
		transform(evidence, [{ subject: { collection: 'employment_terms', id: 't1' }, ...row }], {
			tables
		});
	await record({ fact_key: 'grade', reference: 'SK-1', file: 'scale.pdf' });
	await assert.rejects(
		record({ fact_key: 'grade', reference: 'SK-1' }),
		/needs reference and file/
	);
	await assert.rejects(
		record({ fact_key: 'site', reference: 'R' }),
		/declares no evidence for the fact site/
	);
	await assert.rejects(record({ fact_key: 'absent', reference: 'R' }), /record no fact absent/);
	await assert.rejects(
		transform(
			evidence,
			[{ subject: { collection: 'employment_terms', id: 'nope' }, fact_key: 'grade' }],
			{
				tables
			}
		),
		/must name the fact revision, contract terms, work day, payment/
	);
	// Nested under its payment, the row has no parent key yet: the payment judges it.
	const [nested] = await transform(evidence, [{ fact_key: 'requested', reference: 'R' }], {
		tables
	});
	assert.equal(nested.fact_key, 'requested');
});

test('a run judges recorded terms inputs against the governing version and changes no figure', () => {
	const options = { code: 'SG', period: '2026-01', people: [{ key: 'INPUT', wage: 3000 }] };
	const run = (declare, evidenceRows = []) => {
		const world = createStatutoryWorld(options);
		declare(world);
		const prepared = gatherPayrollRun({
			world: { ...payrollWorld(world), fact_evidence: evidenceRows },
			companyId: COMPANY_ID,
			period: options.period
		});
		return { prepared, world, built: buildPayrollRun(prepared) };
	};
	const figures = (built) =>
		built.payslip_payroll_run.map((slip) => [slip.gross, slip.total_deductions, slip.net]);
	const baseline = figures(run(() => {}).built);
	const declare = (fields, facts) => (world) => {
		for (const version of world.jurisdiction_settings) version.terms_facts = fields;
		world.employment_terms[0].facts = facts;
	};
	assert.throws(
		() => run(declare([{ key: 'grade', type: 'string', required: true }], {})),
		/INPUT: terms on 2026-01-01: grade is required before calculation/
	);
	const graded = run(declare([{ key: 'grade', type: 'string', required: true }], { grade: 'G1' }));
	assert.deepEqual(figures(graded.built), baseline);
	const evidenced = [{ key: 'grade', type: 'string', evidence: { kind: 'REFERENCE' } }];
	assert.throws(
		() => run(declare(evidenced, { grade: 'G1' })),
		/grade counts only once its evidence \(reference\) is recorded/
	);
	const withEvidence = run(declare(evidenced, { grade: 'G1' }), [
		{
			id: 'ev1',
			subject: { collection: 'employment_terms', id: 'b0000000-0000-4000-8000-000000000000' },
			fact_key: 'grade',
			reference: 'SK-1',
			approval_id: null
		}
	]);
	assert.deepEqual(figures(withEvidence.built), baseline);
	// Declared defaults fill what the terms leave unrecorded; the recorded keys ride along.
	const defaulted = run(declare([{ key: 'site_class', type: 'string', default_value: 'A' }], {}));
	const resolved = withDeclaredFacts(
		defaulted.prepared.configuration,
		payrollWorld(defaulted.world),
		defaulted.prepared.window
	).employment_terms[0];
	assert.deepEqual([resolved.facts, resolved.fact_keys], [{ site_class: 'A' }, []]);
});

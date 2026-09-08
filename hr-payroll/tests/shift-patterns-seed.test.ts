// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Public fixture references and manifest dependency ordering. Only directories with an authored
 * model are collections; leftover directories for retired collections do not define the schema.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import { workPatternSchema } from '../src/datatypes/work_pattern/+definition.ts';

const fixture = (name) =>
	JSON.parse(readFileSync(new URL(`./fixtures/seed/${name}.json`, import.meta.url), 'utf8'));
const manifest = JSON.parse(
	readFileSync(new URL('../norbital.template.json', import.meta.url), 'utf8')
);

test('every public term points at a pattern row of its own company, and no term embeds one', () => {
	const patterns = fixture('shift_patterns');
	const terms = fixture('employment_terms');
	const employments = new Map(fixture('employments').map((row) => [row.id, row]));
	const patternById = new Map(patterns.map((row) => [row.id, row]));
	assert.ok(patterns.length >= 1);
	for (const term of terms) {
		assert.equal('work_pattern' in term, false, `${term.id} still embeds a work pattern`);
		const pattern = patternById.get(term.shift_pattern_id);
		assert.ok(pattern, `${term.id} points at ${term.shift_pattern_id}, which is not seeded`);
		assert.equal(pattern.company_id, employments.get(term.employment_id)?.company_id);
	}
});

test('pattern rows are unique per company and code, and decode as the work_pattern type', () => {
	const patterns = fixture('shift_patterns');
	const codes = fixture('shift_definitions');
	const codeIds = new Set(codes.map((row) => row.id));
	const seen = new Set();
	for (const row of patterns) {
		const key = `${row.company_id}:${row.code}`;
		assert.equal(seen.has(key), false, `duplicate pattern ${key}`);
		seen.add(key);
		assert.ok(row.name.length > 0);
		const decoded = Schema.decodeUnknownSync(workPatternSchema)(row.pattern);
		if (decoded.type === 'PATTERNED') {
			for (const phase of decoded.phases)
				for (const day of phase.day_cycle)
					assert.ok(codeIds.has(day.roster_code_id), `${row.code} names a missing roster code`);
		}
	}
});

test('the manifest covers current source collections and stages consumers after their dependencies', () => {
	const stages = manifest.seed.stages;
	const seeded = stages.flat();
	const collections = readdirSync(new URL('../src/collections/', import.meta.url), {
		withFileTypes: true
	})
		.filter(
			(entry) =>
				entry.isDirectory() &&
				existsSync(new URL(`../src/collections/${entry.name}/+model.ts`, import.meta.url))
		)
		.map((entry) => entry.name);
	const unseededPayrollCollections = [
		'payroll_runs',
		'payslips',
		'payslip_adjustments',
		'payslip_work_day_inputs',
		'payslip_leave_inputs',
		'payslip_claim_request_inputs',
		'payslip_allowance_request_inputs',
		'payslip_payment_request_inputs',
		'payslip_loan_repayment_inputs'
	];
	assert.equal(manifest.counts.collections, collections.length);
	for (const name of unseededPayrollCollections) assert.ok(collections.includes(name), name);
	assert.equal(new Set(seeded).size, seeded.length, 'a collection must be seeded only once');
	assert.deepEqual(
		seeded.toSorted(),
		[
			'team',
			'user',
			...collections.filter((name) => !unseededPayrollCollections.includes(name))
		].toSorted()
	);
	const before = (dependency, consumer) => {
		const dependencyStage = stages.findIndex((stage) => stage.includes(dependency));
		const consumerStage = stages.findIndex((stage) => stage.includes(consumer));
		assert.ok(dependencyStage >= 0, `${dependency} needs a seed stage`);
		assert.ok(consumerStage > dependencyStage, `${dependency} must precede ${consumer}`);
	};
	for (const [dependency, consumer] of [
		['companies', 'shift_definitions'],
		['shift_definitions', 'shift_patterns'],
		['shift_patterns', 'employment_terms'],
		['companies', 'employments'],
		['employees', 'employments'],
		['employment_terms', 'work_days'],
		['jurisdiction_holiday_calendars', 'work_days'],
		['work_days', 'leave_entries'],
		['loans', 'loan_repayments'],
		['work_days', 'holiday_calendar_inputs'],
		['leave_entries', 'holiday_calendar_inputs']
	])
		before(dependency, consumer);
	for (const [catalogue, consumer] of [
		['work_catalogue', 'work_days'],
		['leave_catalogue', 'leave_entries'],
		['claim_catalogue', 'claim_requests'],
		['allowance_catalogue', 'allowance_requests'],
		['payment_catalogue', 'payment_requests'],
		['loan_catalogue', 'loans'],
		['statutory_contributions', 'contribution_rates']
	]) {
		before('jurisdiction_settings', catalogue);
		before(catalogue, consumer);
	}
	for (const consumer of [
		'employment_terms',
		'employment_departures',
		'employment_statutory_facts',
		'employee_children',
		'work_days',
		'leave_entries',
		'claim_requests',
		'allowance_requests',
		'payment_requests',
		'loans',
		'loan_repayments'
	]) {
		before('employments', consumer);
		before(consumer, 'employment_contract_inputs');
	}
});

/**
 * Line trace (package MAP), hand-computed: inside `traceLine` every evaluation is recorded — the expression, its
 * value, the inputs read with the caller's revision date and evidence, the table rows looked up and each rounding —
 * and returns exactly what an untraced evaluation returns. A false result is counted, not kept; outside a scope
 * nothing is recorded, and a line priced outside a collection is a plain call. Needs the one-hook request in `.tmp/r10-requests/K-MAP.md` (evaluate.ts `run`).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	evaluateBoolean,
	evaluateNumber,
	runtimeExpressionEngine
} from '../src/lib/expressions/evaluate.ts';
import type { TableLookup } from '../src/lib/expressions/functions/tables.ts';
import {
	collectLineTraces,
	traceLine,
	tracesForEmployment,
	tracesOf
} from '../src/lib/trace/record.ts';
import { evaluationObserver } from '../src/lib/trace/observer.ts';

const tables: TableLookup = {
	table: (name, keys) =>
		name === 'FLOORS' && String(keys[0]) === 'R1' ? { code: 'R1', rate: 12.5 } : null,
	band: () => null,
	bands: () => []
};
const engine = runtimeExpressionEngine({ tables });
const context = { terms: { facts: { grade: 'G2' } }, worksite: { region: 'R1' } };
const PRICE = "round(table('FLOORS', worksite.region).rate * 3.0, 1, 'UP')";

test('line trace: records the evaluation behind a line and changes nothing', () => {
	const untraced = evaluateNumber(engine, PRICE, context);
	assert.equal(untraced, 38, '12.5 × 3 = 37.5, rounded up to a whole unit');
	assert.equal(
		traceLine({ kind: 'ADJUSTMENT', code: 'MEAL' }, { settingsId: 'v1' }, () =>
			evaluateNumber(engine, PRICE, context)
		),
		untraced,
		'outside a collection a line is simply priced'
	);
	const { result, traces } = collectLineTraces(() =>
		traceLine(
			{ kind: 'ADJUSTMENT', code: 'MEAL', source_id: 's1' },
			{
				settingsId: 'v1',
				provenance: (path) =>
					path === 'terms.facts.grade' ? { effective_from: '2026-01-01', evidence: 'doc-1' } : null
			},
			() => {
				evaluateBoolean(engine, "terms.facts.grade == 'G9'", context);
				evaluateBoolean(engine, "terms.facts.grade == 'G2'", context);
				return evaluateNumber(engine, PRICE, context);
			}
		)
	);
	assert.equal(result, untraced);
	assert.equal(traces.length, 1);
	const trace = traces[0]!;
	assert.equal(trace.settings_id, 'v1');
	assert.equal(trace.skipped, 1, 'the false rung is counted');
	assert.equal(trace.omitted, 0);
	assert.equal(trace.steps.length, 2);
	const [when, price] = trace.steps;
	assert.equal(when!.value, 'true');
	assert.deepEqual(when!.reads, [
		{ path: 'terms.facts.grade', value: 'G2', effective_from: '2026-01-01', evidence: 'doc-1' }
	]);
	assert.equal(price!.expression, PRICE);
	assert.equal(price!.value, '38');
	assert.deepEqual(price!.reads, [{ path: 'worksite.region', value: 'R1' }]);
	assert.deepEqual(price!.tables, [
		{ fn: 'table', name: 'FLOORS', keys: '["R1"]', row: '{"code":"R1","rate":12.5}' }
	]);
	assert.deepEqual(price!.rounding, [{ value: 37.5, step: 1, mode: 'UP', result: 38 }]);
	assert.equal(evaluationObserver(), null, 'the scope closes');
	assert.deepEqual(tracesOf(traces, { kind: 'ADJUSTMENT', code: 'MEAL', source_id: 's1' }), [
		trace
	]);
	assert.deepEqual(tracesOf(traces, { kind: 'ADJUSTMENT', code: 'MEAL', source_id: 's2' }), []);
});

test('line trace: one trace per employment and line part; a line priced again keeps its last pricing', () => {
	const { traces } = collectLineTraces(() => {
		for (const [part, factor] of [
			['A', '1.0'],
			['B', '2.0'],
			['A', '3.0']
		] as const)
			traceLine(
				{ employment_id: 'e1', kind: 'ADJUSTMENT', code: 'OT', source_id: 'd1', part },
				{ settingsId: 'v1' },
				() => evaluateNumber(engine, `worksite.region == 'R1' ? ${factor} : 0.0`, context)
			);
		traceLine({ employment_id: 'e2', kind: 'STATUTORY', code: 'FUND' }, { settingsId: 'v1' }, () =>
			evaluateNumber(engine, '1.0', context)
		);
	});
	assert.equal(traces.length, 3);
	const mine = tracesForEmployment(traces, 'e1');
	assert.deepEqual(
		tracesForEmployment(traces, 'e2').map((trace) => trace.line.code),
		['FUND']
	);
	assert.deepEqual(
		tracesOf(mine, { kind: 'ADJUSTMENT', code: 'OT', source_id: 'd1' }).map((trace) => [
			trace.line.part,
			trace.steps[0]!.value
		]),
		[
			['A', '3'],
			['B', '2']
		]
	);
});

test('line trace: a throwing evaluation is recorded with its error and still throws', () => {
	const { traces } = collectLineTraces(() =>
		traceLine({ kind: 'STATUTORY', code: 'FUND' }, { settingsId: 'v1' }, () => {
			assert.throws(() => evaluateNumber(engine, "table('MISSING').rate * 1.0", context));
			return 0;
		})
	);
	const trace = traces[0]!;
	assert.equal(trace.steps.length, 1);
	assert.ok((trace.steps[0]!.error ?? '') !== '');
	assert.deepEqual(trace.steps[0]!.tables, [{ fn: 'table', name: 'MISSING', keys: '[]', row: '' }]);
});

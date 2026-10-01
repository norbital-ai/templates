import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileExpression } from '../src/lib/expressions/compile.ts';
import { EXPRESSION_CONTEXTS } from '../src/lib/expressions/contexts.ts';
import { renderExpressionContexts } from '../src/lib/expressions/document.ts';

test('docs/expression-context.md is the context catalogue, rendered', () => {
	// One statement of what the engine evaluates: `contexts.ts`. The document is its render, so a
	// member added or cut there is a documentation change the suite refuses until the file is
	// regenerated (`scripts/render-expression-context.ts`).
	const doc = readFileSync(new URL('../docs/expression-context.md', import.meta.url), 'utf8');
	assert.equal(doc, renderExpressionContexts());
});

test('limit blanks carry no statutory figure: a mentioned limit compiles as 0', () => {
	// The version's own limit keys are data (`work_rules.limits`); the compile-time blank holds
	// none, and a key an expression names is zero-filled by the open-prefix blank.
	assert.deepEqual(EXPRESSION_CONTEXTS.entry.blank.limits, {});
	assert.deepEqual(EXPRESSION_CONTEXTS.work_day.blank.limits, {});
	assert.equal(
		compileExpression({
			site: 'work_day',
			type: 'hours',
			expression: 'worked_hours > limits.normal_day ? worked_hours - limits.normal_day : 0'
		}),
		null
	);
});

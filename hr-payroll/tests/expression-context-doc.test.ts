import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderExpressionContexts } from '../src/lib/expressions/document.ts';

test('docs/expression-context.md is the context catalogue, rendered', () => {
	// One statement of what the engine evaluates: `contexts.ts`. The document is its render, so a
	// member added or cut there is a documentation change the suite refuses until the file is
	// regenerated (`scripts/render-expression-context.ts`).
	const doc = readFileSync(new URL('../docs/expression-context.md', import.meta.url), 'utf8');
	assert.equal(doc, renderExpressionContexts());
});

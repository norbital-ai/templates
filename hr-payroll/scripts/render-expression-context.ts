import { writeFileSync } from 'node:fs';
import { renderExpressionContexts } from '../src/lib/expressions/document.ts';

writeFileSync(
	new URL('../docs/expression-context.md', import.meta.url),
	renderExpressionContexts()
);

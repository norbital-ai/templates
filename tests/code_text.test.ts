import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { foldDiff, formatCel, lineDiff, valueLines } from '../src/lib/ui/format/code_text.ts';

describe('code text', () => {
	it('formats CEL without changing anything but whitespace, idempotently', () => {
		const source =
			'has(terms.facts) && has(terms.facts.weekly_scheduled_days) && double(terms.facts.weekly_scheduled_days) <= 4.0 ? [[0.0, 1.0], [2.0, 3.0]][0][1] : size(bands.filter(b, service_months >= b.service_months)) > 0 ? "a, b ? c" : 0.0';
		const formatted = formatCel(source);
		assert.ok(formatted.includes('\n'));
		assert.ok(formatted.includes('"a, b ? c"'));
		assert.equal(formatCel(formatted), formatted);
		const squash = (text: string) => text.replace(/\s+/g, '');
		assert.equal(squash(formatted), squash(source));
		assert.equal(formatCel('base.assessed <= 50.0'), 'base.assessed <= 50.0');
	});

	it('diffs lines and folds unchanged runs', () => {
		const left = valueLines({ code: 'AL', bands: [{ days: 14 }], name: 'Annual' });
		const right = valueLines({ code: 'AL', bands: [{ days: 16 }], name: 'Annual' });
		const diff = lineDiff(left, right);
		assert.deepEqual(
			diff.filter((line) => line.kind !== 'same').map((line) => `${line.kind} ${line.text}`),
			['removed     days: 14', 'added     days: 16']
		);
		const long = Array.from({ length: 20 }, (_, at) => `line ${at}`);
		const folded = foldDiff(lineDiff(long, [...long.slice(0, 19), 'changed']), 2);
		assert.deepEqual(folded[0], { kind: 'fold', count: 17 });
	});
});

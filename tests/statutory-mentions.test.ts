// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Scheme dependency edges: the mentions are read from the compiled CEL AST, an
 * unknown producer refuses by name, and a loop refuses with the path that closes it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { orderSchemes, producedMentions } from '../src/collections/payroll_runs/lib/mentions.ts';

test('a mention is read from the expression AST, not the raw text', () => {
	const rules = [
		{ when: 'base > 0.0', employee: 'produced.EPF.employee * 0.0', employer: '0.0' },
		{
			when: 'base > 0.0',
			employee: '"produced.GHOST.employee" == "x" ? 0.0 : 1.0',
			employer: '0.0'
		},
		{
			when: 'produced.SOCSO.employer >= 0.0',
			employee: 'produced.SOCSO.employee',
			employer: '0.0'
		}
	];
	assert.deepEqual(producedMentions(rules), ['EPF', 'SOCSO']);
});

test('a loop refuses with its path, and an unknown producer by name', () => {
	assert.throws(
		() =>
			orderSchemes([
				{
					row: {
						code: 'A',
						rules: [{ when: 'true', employee: 'produced.B.employee', employer: '0.0' }]
					}
				},
				{
					row: {
						code: 'B',
						rules: [{ when: 'true', employee: 'produced.A.employee', employer: '0.0' }]
					}
				}
			]),
		/loop/
	);
	assert.throws(
		() =>
			orderSchemes([
				{
					row: {
						code: 'A',
						rules: [{ when: 'true', employee: 'produced.MISSING.employee', employer: '0.0' }]
					}
				}
			]),
		/MISSING/
	);
});

test('a producer orders before its consumer; ties by code', () => {
	const ordered = orderSchemes([
		{
			row: {
				code: 'TAX',
				rules: [{ when: 'true', employee: 'produced.CPF.employee', employer: '0.0' }]
			}
		},
		{ row: { code: 'CPF', rules: [] } },
		{ row: { code: 'EPF', rules: [] } }
	]).map((entry) => entry.row.code);
	assert.deepEqual(ordered, ['CPF', 'EPF', 'TAX']);
});

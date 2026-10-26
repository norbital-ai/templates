import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { labelled } from '../src/lib/ui/settings/labelled.ts';

it('labels JSON shapes without losing native periods or expression kinds', () => {
	const messages = new Map([
		['models.jurisdiction_settings.fields.payroll.period', 'Effective period'],
		['models.jurisdiction_settings.fields.payroll.rules.when', 'Condition']
	]);
	const kind = labelled(
		{ t: (key) => messages.get(key) ?? key },
		'jurisdiction_settings',
		'payroll',
		{
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					period: { kind: 'period', of: 'date' },
					rules: {
						kind: 'list',
						of: { kind: 'object', fields: { when: { kind: 'text', format: 'cel' } } }
					}
				}
			}
		}
	);
	assert(kind.kind === 'json' && kind.shape?.kind === 'object');
	assert.deepEqual(kind.shape.fields.period, {
		kind: 'period',
		of: 'date',
		label: 'Effective period'
	});
	const rules = kind.shape.fields.rules;
	assert(rules?.kind === 'list' && rules.of.kind === 'object');
	assert.deepEqual(rules.of.fields.when, {
		kind: 'text',
		format: 'cel',
		label: 'Condition'
	});
});

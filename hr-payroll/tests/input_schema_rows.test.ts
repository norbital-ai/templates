import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from '@effect/vitest';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { rowsOf, schemaFrom } from '../src/lib/ui/settings/input_schema_rows.ts';

const SEED = resolve(process.cwd(), 'seed/jurisdiction');
const versions = readdirSync(SEED).flatMap((code) =>
	readdirSync(join(SEED, code)).map((version) =>
		join(SEED, code, version, 'jurisdiction_settings.json')
	)
);

describe('input schema rows', () => {
	it('every seeded input schema reads as rows and writes back unchanged', () => {
		for (const file of versions) {
			const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
			const settings: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
			assert.ok(isJsonObject(settings), file);
			for (const key of ['entity_input_schema', 'employee_input_schema']) {
				const schema: unknown = settings[key];
				if (schema == null) continue;
				assert.deepStrictEqual(schemaFrom(rowsOf(schema), schema), schema, `${file} ${key}`);
			}
		}
	});

	it('a renamed row keeps its keywords and children, added rows nest by path, blanks are named', () => {
		const held = {
			type: 'object',
			additionalProperties: false,
			properties: {
				pay: {
					type: 'array',
					items: {
						type: 'object',
						allOf: [{ if: {}, then: { required: ['code'] } }],
						properties: { code: { type: 'string', minLength: 1 } }
					}
				}
			}
		};
		const rows = rowsOf(held);
		assert.deepStrictEqual(
			rows.map((row) => row.path),
			['pay', 'pay[].code']
		);
		const renamed = schemaFrom(
			rows.map((row) =>
				row.path === 'pay[].code' ? { ...row, path: 'pay[].ref', required: true } : row
			),
			held
		);
		assert.deepStrictEqual(renamed.properties, {
			pay: {
				type: 'array',
				items: {
					type: 'object',
					allOf: [{ if: {}, then: { required: ['code'] } }],
					properties: { ref: { type: 'string', minLength: 1 } },
					required: ['ref']
				}
			}
		});
		const added = schemaFrom(
			[...rows, { path: 'meta.started', type: 'date', label: 'Started' }, {}],
			held
		);
		assert.deepStrictEqual(added.properties, {
			...held.properties,
			meta: {
				type: 'object',
				properties: { started: { type: 'string', format: 'date', title: 'Started' } }
			},
			field_4: { type: 'string' }
		});
	});
});

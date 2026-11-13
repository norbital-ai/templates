// A country extension field exists because a formula reads it or the salary listing shows it. The schema is flat.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { LAW_ROWS } from '../../src/lib/law.ts';
import SCHEMA_SOURCE_JSON from '../../src/lib/payroll_engine/extension_schema.json';
import { SEEDED } from './seeded.ts';

const SCHEMA_SOURCE: Readonly<
	Record<string, { readonly employee: unknown; readonly entity: unknown }>
> = SCHEMA_SOURCE_JSON;
const LABELS = ['employee_extension_schema', 'entity_extension_schema'] as const;
const BUCKETS = new Set(['facts', 'term_facts', 'exit_facts', 'elections']);
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const sources = (dir: string): readonly string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sources(path) : /\.(ts|svelte)$/.test(name) ? [path] : [];
	});
const SOURCE = sources('src')
	.map((path) => readFileSync(path, 'utf8'))
	.join('\n');

const leaves = (schema: unknown, prefix = ''): readonly string[] => {
	if (!isObject(schema)) return [];
	const properties = isObject(schema.properties) ? schema.properties : {};
	return Object.entries(properties).flatMap(([key, spec]) => {
		const here = prefix === '' ? key : `${prefix}.${key}`;
		if (!isObject(spec)) return [];
		if (spec.type === 'object' && isObject(spec.properties)) return leaves(spec, here);
		if (spec.type === 'array' && isObject(spec.items) && isObject(spec.items.properties))
			return leaves(spec.items, `${here}[]`);
		return [here];
	});
};

describe('country extension fields', () => {
	for (const { code, standing } of SEEDED) {
		/** The one catalogue is the schema source; names are derived, never a second file. */
		const sourceFields = [
			...new Set(standing.flatMap((law) => LABELS.flatMap((label) => leaves(law.settings[label]))))
		];
		// what reads a field: the rows of the law on any of its dates, and the source
		const text = `${JSON.stringify(standing.map((law) => law.rows))}\n${SOURCE}`;

		it(`${code}: every schema is flat and every field is read`, () => {
			const unread: string[] = [];
			const held = new Set<string>();
			for (const law of standing)
				for (const label of LABELS) {
					const schema = law.settings[label];
					if (!isObject(schema)) continue;
					const properties = isObject(schema.properties) ? schema.properties : {};
					for (const bucket of BUCKETS)
						assert.equal(
							Object.hasOwn(properties, bucket),
							false,
							`${code}/${law.on}: ${label}.${bucket} is not flat`
						);
					for (const path of leaves(schema)) {
						held.add(path);
						assert.ok(
							sourceFields.includes(path),
							`${code}/${law.on}: ${label}.${path} is not in the field catalogue`
						);
						if (
							!path.endsWith('registration_number') &&
							!new RegExp(
								`(?<![A-Za-z0-9_])${path.split('.').at(-1)?.replace('[]', '')}(?![A-Za-z0-9_])`
							).test(text)
						)
							unread.push(`${code}/${law.on}: ${label}.${path}`);
					}
				}
			assert.deepEqual(
				sourceFields.filter((path) => !held.has(path)),
				[],
				`${code}: the catalogue names a field no schema declares`
			);
			assert.deepEqual(unread, [], 'a country field nothing reads: read it, or remove it');
		});

		it(`${code}: the schema in force is generated from its source declaration`, () => {
			const latest = standing.at(-1);
			assert.ok(latest !== undefined);
			assert.deepEqual(latest.settings.employee_extension_schema, SCHEMA_SOURCE[code]?.employee);
			assert.deepEqual(latest.settings.entity_extension_schema, SCHEMA_SOURCE[code]?.entity);
		});

		it(`${code}: every direct extension path is declared`, () => {
			const missing: string[] = [];
			for (const law of standing) {
				const fields = (label: (typeof LABELS)[number]): ReadonlySet<string> => {
					const schema = law.settings[label];
					return new Set(
						isObject(schema) && isObject(schema.properties) ? Object.keys(schema.properties) : []
					);
				};
				const employee = fields('employee_extension_schema');
				const entity = fields('entity_extension_schema');
				for (const row of LAW_ROWS.flatMap((family) => law.rows[family]))
					for (const field of [
						'calculation',
						'eligibility',
						'conversion',
						'paid_share',
						'payout',
						'incurred_on',
						'employee_amount',
						'employer_amount',
						'condition',
						'validate',
						'effects',
						'entitlement'
					]) {
						const source = row[field];
						if (typeof source !== 'string') continue;
						for (const match of source.matchAll(
							/employee_extension_data\.([a-z0-9_]+)|entity_extension_data\.([a-z0-9_]+)/g
						)) {
							const whole = match[0];
							const employeeField = match[1];
							const entityField = match[2];
							if (employeeField !== undefined && !employee.has(employeeField))
								missing.push(`${code}/${law.on}: ${whole}`);
							if (entityField !== undefined && !entity.has(entityField))
								missing.push(`${code}/${law.on}: ${whole}`);
						}
					}
			}
			assert.deepEqual(
				[...new Set(missing)],
				[],
				'a formula reads a path no extension schema declares'
			);
		});
	}
});

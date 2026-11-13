// A country extension field exists because a formula reads it or the salary listing shows it. The schema is flat.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import SCHEMA_SOURCE_JSON from '../../src/lib/payroll_engine/extension_schema.json';

const SCHEMA_SOURCE: Readonly<
	Record<string, { readonly employee: unknown; readonly entity: unknown }>
> = SCHEMA_SOURCE_JSON;

/** The one catalogue is the schema source; names are derived, never a second file. */
const sourceFields = (code: string): readonly string[] => {
	const held = new Set<string>();
	for (const version of readdirSync(join(ROOT, code)))
		for (const settings of settingsOf(code, version))
			for (const label of ['employee_extension_schema', 'entity_extension_schema'])
				for (const path of leaves(settings[label])) held.add(path);
	return [...held];
};

const ROOT = 'seed/public/jurisdiction';
const JURISDICTIONS = readdirSync(ROOT);
const BUCKETS = new Set(['facts', 'term_facts', 'exit_facts', 'elections']);
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const sources = (dir: string): readonly string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sources(path) : /\.(ts|svelte)$/.test(name) ? [path] : [];
	});

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

const readerText = (code: string): string => {
	const seed = readdirSync(join(ROOT, code)).flatMap((version) =>
		readdirSync(join(ROOT, code, version))
			.filter((file) => file !== 'jurisdiction_settings.json')
			.map((file) => readFileSync(join(ROOT, code, version, file), 'utf8'))
	);
	const source = sources('src').map((path) => readFileSync(path, 'utf8'));
	return [...seed, ...source].join('\n');
};

const settingsOf = (code: string, version: string): readonly Record<string, unknown>[] => {
	const value: unknown = JSON.parse(
		readFileSync(join(ROOT, code, version, 'jurisdiction_settings.json'), 'utf8')
	);
	return (Array.isArray(value) ? value : [value]).filter(isObject);
};

describe('country extension fields', () => {
	for (const code of JURISDICTIONS) {
		const text = readerText(code);
		it(`${code}: every schema is flat and every field is read`, () => {
			const versions = readdirSync(join(ROOT, code));
			const unread: string[] = [];
			const held = new Set<string>();
			for (const version of versions)
				for (const settings of settingsOf(code, version))
					for (const label of ['employee_extension_schema', 'entity_extension_schema']) {
						const schema = settings[label];
						if (!isObject(schema)) continue;
						const properties = isObject(schema.properties) ? schema.properties : {};
						for (const bucket of BUCKETS)
							assert.equal(
								Object.hasOwn(properties, bucket),
								false,
								`${code}/${version}: ${label}.${bucket} is not flat`
							);
						for (const path of leaves(schema)) {
							held.add(path);
							assert.ok(
								sourceFields(code).includes(path),
								`${code}/${version}: ${label}.${path} is not in the field catalogue`
							);
							if (
								!path.endsWith('registration_number') &&
								!new RegExp(
									`(?<![A-Za-z0-9_])${path.split('.').at(-1)?.replace('[]', '')}(?![A-Za-z0-9_])`
								).test(text)
							)
								unread.push(`${code}/${version}: ${label}.${path}`);
						}
					}
			assert.deepEqual(
				sourceFields(code).filter((path) => !held.has(path)),
				[],
				`${code}: the catalogue names a field no schema declares`
			);
			assert.deepEqual(unread, [], 'a country field nothing reads: read it, or remove it');
		});
	}

	for (const code of JURISDICTIONS)
		it(`${code}: the latest schema is generated from its source declaration`, () => {
			const latest = readdirSync(join(ROOT, code))
				.filter((name) => /^version_\d+$/.test(name))
				.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)))
				.at(-1);
			assert.ok(latest !== undefined);
			const [settings] = settingsOf(code, latest);
			assert.deepEqual(settings?.employee_extension_schema, SCHEMA_SOURCE[code]?.employee);
			assert.deepEqual(settings?.entity_extension_schema, SCHEMA_SOURCE[code]?.entity);
		});

	for (const code of JURISDICTIONS)
		it(`${code}: every direct extension path is declared`, () => {
			const missing: string[] = [];
			for (const version of readdirSync(join(ROOT, code))) {
				const [settings] = settingsOf(code, version);
				const fields = (label: string): ReadonlySet<string> => {
					const schema = settings?.[label];
					return new Set(
						isObject(schema) && isObject(schema.properties) ? Object.keys(schema.properties) : []
					);
				};
				const employee = fields('employee_extension_schema');
				const entity = fields('entity_extension_schema');
				const paths = readdirSync(join(ROOT, code, version))
					.filter((file) => file !== 'jurisdiction_settings.json')
					.map((file) => join(ROOT, code, version, file));
				for (const path of paths) {
					const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
					for (const row of (Array.isArray(value) ? value : [value]).filter(isObject))
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
							if (typeof row[field] !== 'string') continue;
							for (const match of row[field].matchAll(
								/employee_extension_data\.([a-z0-9_]+)|entity_extension_data\.([a-z0-9_]+)/g
							)) {
								const whole = match[0];
								const employeeField = match[1];
								const entityField = match[2];
								if (employeeField !== undefined && !employee.has(employeeField))
									missing.push(`${code}/${version}: ${whole}`);
								if (entityField !== undefined && !entity.has(entityField))
									missing.push(`${code}/${version}: ${whole}`);
							}
						}
				}
			}
			assert.deepEqual(
				[...new Set(missing)],
				[],
				'a formula reads a path no extension schema declares'
			);
		});
});

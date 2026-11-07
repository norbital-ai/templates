// Generate tables.ts and params.ts from the seed rows. Run after a seed/model vocabulary change:
//   node scripts/generate-registries.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'seed/public/jurisdiction';
const versions = (code) =>
	readdirSync(join(root, code))
		.filter((name) => /^version_\d+$/.test(name))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const jurisdictions = readdirSync(root);
const rows = (path) => {
	const value = JSON.parse(readFileSync(path, 'utf8'));
	return (Array.isArray(value) ? value : [value]).filter(
		(row) => row !== null && typeof row === 'object' && !Array.isArray(row)
	);
};

const kind = (value) => {
	if (typeof value === 'boolean') return 'bool';
	if (typeof value === 'number') return 'number';
	if (typeof value === 'string') return 'text';
	if (Array.isArray(value)) return 'array';
	if (value !== null && typeof value === 'object') return 'object';
	return 'null';
};

const record = (entries, total) =>
	`Schema.Struct({ ${Object.entries(entries)
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([key, items]) => {
			const body = schema(items);
			return `${JSON.stringify(key)}: ${items.length < total ? `Schema.optional(${body})` : body}`;
		})
		.join(', ')} })`;

const schema = (values) => {
	const held = new Set(values.map(kind));
	if (held.size <= 1) {
		const one = [...held][0];
		if (one === 'number') return 'Schema.Number';
		if (one === 'bool') return 'Schema.Boolean';
		if (one === 'text') return 'Schema.String';
		if (one === 'null') return 'Schema.Null';
		if (one === 'array') {
			const items = values.flat();
			return `Schema.Array(${schema(items)})`;
		}
		if (one === 'object') {
			const entries = {};
			for (const value of values)
				for (const [key, item] of Object.entries(value)) (entries[key] ??= []).push(item);
			return record(entries, values.length);
		}
	}
	const shapes = [];
	for (const one of [...held].toSorted()) {
		const subset = values.filter((value) => kind(value) === one);
		if (one === 'null') shapes.push('Schema.Null');
		if (one === 'number') shapes.push('Schema.Number');
		if (one === 'bool') shapes.push('Schema.Boolean');
		if (one === 'text') shapes.push('Schema.String');
		if (one === 'array') shapes.push(`Schema.Array(${schema(subset.flat())})`);
		if (one === 'object') {
			const entries = {};
			for (const value of subset)
				for (const [key, item] of Object.entries(value)) (entries[key] ??= []).push(item);
			shapes.push(record(entries, subset.length));
		}
	}
	return [...new Set(shapes)].length === 1
		? shapes[0]
		: `Schema.Union([${[...new Set(shapes)].join(', ')}])`;
};

// tables.ts
const tables = {};
for (const code of jurisdictions)
	for (const version of versions(code))
		for (const row of rows(join(root, code, version, 'jurisdiction_settings.json')))
			for (const [key, value] of Object.entries(row.lookup ?? {})) (tables[key] ??= []).push(value);
writeFileSync(
	'src/lib/payroll_engine/tables.ts',
	[
		"import { Schema } from 'effect';",
		'',
		'/** Every settings lookup key, with the row shape its values declare. Shared tables only. */',
		'export const TABLES = {',
		...Object.entries(tables)
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([key, values]) => `\t${JSON.stringify(key)}: ${schema(values)},`),
		'} as const;',
		'',
		'export type TableKey = keyof typeof TABLES;',
		'export const tableOf = (key: string): (typeof TABLES)[TableKey] | undefined =>',
		'\tTABLES[key as TableKey];',
		''
	].join('\n')
);

// params.ts
const families = {
	allowance_catalog: 'allowance_catalog.json',
	overtime_catalog: 'overtime_catalog.json',
	statutory_contribution_catalog: 'statutory_contribution_catalog.json',
	leave_catalog: 'leave_catalog.json',
	claim_catalog: 'claim_catalog.json',
	adhoc_catalog: 'adhoc_catalog.json',
	loan_catalog: 'loan_catalog.json'
};
const perCode = {};
for (const [family, file] of Object.entries(families)) {
	perCode[family] = {};
	for (const code of jurisdictions)
		for (const version of versions(code)) {
			const path = join(root, code, version, file);
			try {
				readFileSync(path);
			} catch {
				continue;
			}
			for (const row of rows(path)) {
				const lookup = row.lookup ?? {};
				const name = String(row.code ?? '');
				const held = (perCode[family][name] ??= { sets: [], values: {} });
				held.sets.push(new Set(Object.keys(lookup)));
				for (const [key, value] of Object.entries(lookup))
					(held.values[key] ??= []).push(value);
			}
		}
}
const paramLines = [
	"import { Schema } from 'effect';",
	'',
	'/** One typed param schema per family and code: required keys are required, not hidden in a side map. */',
	'export const ROW_PARAMS = {'
];
for (const [family, codes] of Object.entries(perCode)) {
	paramLines.push(`\t${family}: {`);
	for (const [code, held] of Object.entries(codes).toSorted(([left], [right]) => left.localeCompare(right))) {
		const required = [...held.sets[0]].filter((key) => held.sets.every((set) => set.has(key)));
		const optional = [...new Set(held.sets.flatMap((set) => [...set]))].filter(
			(key) => !required.includes(key)
		);
		paramLines.push(`\t\t${JSON.stringify(code)}: Schema.Struct({`);
		for (const key of required.toSorted())
			paramLines.push(`\t\t\t${JSON.stringify(key)}: ${schema(held.values[key])},`);
		for (const key of optional.toSorted())
			paramLines.push(`\t\t\t${JSON.stringify(key)}: Schema.optional(${schema(held.values[key])}),`);
		paramLines.push('\t\t}),');
	}
	paramLines.push('\t},');
}
paramLines.push(
	'} as const;',
	'',
	'export const paramsFor = (family: string, code: string) =>',
	'\t(ROW_PARAMS as Record<string, Record<string, Schema.ConstraintDecoder<unknown>>>)[family]?.[code];',
	'',
	'/** Every param key a family can declare, for the ownership test. */',
	'export const PARAM_KEYS = {'
);
for (const [family, codes] of Object.entries(perCode))
	paramLines.push(
		`\t${family}: [${[...new Set(Object.values(codes).flatMap((held) => Object.keys(held.values)))]
			.toSorted()
			.map((key) => JSON.stringify(key))
			.join(', ')}] as const,`
	);
paramLines.push('} as const;', '');
writeFileSync('src/lib/payroll_engine/params.ts', paramLines.join('\n'));
console.log('generated tables.ts and params.ts');

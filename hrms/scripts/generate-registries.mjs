// Generate per-family param schemas under src/data/model/jurisdiction/service/params/ from the seed rows.
// Run after a seed/model vocabulary change:
//   node scripts/generate-registries.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'seed/public/jurisdiction';
const applied = (state, patch, depth) => {
	const next = { ...state };
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) delete next[key];
		else if (depth > 1 && typeof value === 'object' && !Array.isArray(value))
			next[key] = applied(next[key] ?? {}, value, depth - 1);
		else next[key] = value;
	}
	return next;
};
// every law a jurisdiction ever held: its first change, then that with each later patch applied, oldest first
// (the fold of src/lib/dated.ts, three keys deep)
const laws = readdirSync(root).flatMap((code) => {
	let law = {};
	return JSON.parse(readFileSync(join(root, code, 'jurisdiction_change.json'), 'utf8'))
		.toSorted((left, right) => left.effective_from.localeCompare(right.effective_from))
		.map((row) => (law = applied(law, row.law, 3)));
});

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

// params.ts
const families = [
	'allowance_catalog',
	'overtime_catalog',
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog'
];
const perCode = {};
for (const family of families) {
	perCode[family] = {};
	for (const law of laws)
		for (const [name, row] of Object.entries(law[family] ?? {})) {
			const lookup = row.lookup ?? {};
			const held = (perCode[family][name] ??= { sets: [], values: {} });
			held.sets.push(new Set(Object.keys(lookup)));
			for (const [key, value] of Object.entries(lookup)) (held.values[key] ??= []).push(value);
		}
}
const outDir = 'src/data/model/jurisdiction/service/params';
mkdirSync(outDir, { recursive: true });
for (const [family, codes] of Object.entries(perCode)) {
	const familyLines = [
		"import { Schema } from 'effect';",
		'',
		`/** Typed param schemas for ${family}: required keys are required, not hidden in a side map. */`,
		`export const ${family} = {`
	];
	for (const [code, held] of Object.entries(codes).toSorted(([left], [right]) =>
		left.localeCompare(right)
	)) {
		const required = [...held.sets[0]].filter((key) => held.sets.every((set) => set.has(key)));
		const optional = [...new Set(held.sets.flatMap((set) => [...set]))].filter(
			(key) => !required.includes(key)
		);
		familyLines.push(`\t${JSON.stringify(code)}: Schema.Struct({`);
		for (const key of required.toSorted())
			familyLines.push(`\t\t${JSON.stringify(key)}: ${schema(held.values[key])},`);
		for (const key of optional.toSorted())
			familyLines.push(`\t\t${JSON.stringify(key)}: Schema.optional(${schema(held.values[key])}),`);
		familyLines.push('\t}),');
	}
	familyLines.push('} as const;', '');
	writeFileSync(join(outDir, `${family}.ts`), familyLines.join('\n'));
}
const indexLines = [
	"import type { Schema } from 'effect';",
	...families.map((family) => `import { ${family} } from './${family}.js';`),
	'',
	'/** One typed param schema per family and code: required keys are required, not hidden in a side map. */',
	'export const ROW_PARAMS = {',
	...families.map((family) => `\t${family},`),
	'} as const;',
	'',
	'const BY_ROW: Readonly<',
	'\tRecord<string, Readonly<Record<string, Schema.ConstraintDecoder<unknown>>>>',
	'> = ROW_PARAMS;',
	'export const paramsFor = (family: string, code: string) => BY_ROW[family]?.[code];',
	''
];
writeFileSync(join(outDir, 'index.ts'), indexLines.join('\n'));
console.log(`generated ${families.length} family param modules under ${outDir}/`);

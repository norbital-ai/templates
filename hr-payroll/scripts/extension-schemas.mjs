// The current (latest) country schemas are authored in extension_schema.json and copied into each seed version.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'seed/public/jurisdiction';
const source = JSON.parse(readFileSync('src/lib/payroll_engine/extension_schema.json', 'utf8'));
for (const [code, schemas] of Object.entries(source)) {
	const versions = readdirSync(join(root, code))
		.filter((name) => /^version_\d+$/.test(name))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
	const path = join(root, code, versions.at(-1), 'jurisdiction_settings.json');
	const rows = JSON.parse(readFileSync(path, 'utf8'));
	for (const row of rows) {
		row.employee_extension_schema = schemas.employee;
		row.entity_extension_schema = schemas.entity;
	}
	writeFileSync(path, `${JSON.stringify(rows, null, '\t')}\n`);
}

// The country schemas are authored in extension_schema.json and copied into each law's first change.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'seed/public/jurisdiction';
const source = JSON.parse(readFileSync('src/lib/payroll_engine/extension_schema.json', 'utf8'));
for (const [code, schemas] of Object.entries(source)) {
	const path = join(root, code, 'jurisdiction_change.json');
	const rows = JSON.parse(readFileSync(path, 'utf8'));
	const first = rows.toSorted((left, right) =>
		left.effective_from.localeCompare(right.effective_from)
	)[0];
	first.law.employee_extension_schema = schemas.employee;
	first.law.entity_extension_schema = schemas.entity;
	writeFileSync(path, `${JSON.stringify(rows, null, '\t')}\n`);
}

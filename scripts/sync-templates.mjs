import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { discoverTemplates } from './lib/templates.mjs';

/**
 * Derive Bolt assembly and migrations for every template.
 *
 * The Bolt CLI comes from the template's own installed dependencies, at the exact version its
 * manifest pins — the same binary a tenant sandbox runs. There is no repository-wide Bolt build to
 * fall out of date against, which is the point of a template owning its own lockfile.
 */

const filter = process.argv[2];

for (const template of discoverTemplates(filter)) {
	if (!existsSync(path.join(template.directory, 'node_modules', '.bin', 'bolt'))) {
		throw new Error(
			`${template.key} is not installed. Run \`pnpm --dir ${template.key} install\`.`
		);
	}
	console.log(`Synchronizing ${template.key}...`);
	execFileSync('pnpm', ['sync'], { cwd: template.directory, stdio: 'inherit' });
}

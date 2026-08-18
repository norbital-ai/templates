import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	actualCounts,
	discoverTemplates,
	templateMetadataFile,
	templateRefNamespace
} from '../lib/templates.mjs';

describe('template discovery', () => {
	it('discovers every template from its own tree, with no separate catalogue', () => {
		const templates = discoverTemplates();
		assert.ok(templates.length > 0);
		for (const template of templates) {
			assert.ok(
				existsSync(path.join(template.directory, templateMetadataFile)),
				`${template.key} must carry ${templateMetadataFile} in its own tree so the metadata projects with it`
			);
			assert.equal(template.ref, `${templateRefNamespace}/${template.key}`);
		}
	});

	it('keeps declared picker counts equal to what the tree actually contains', () => {
		for (const template of discoverTemplates()) {
			assert.deepEqual(template.counts, actualCounts(template.directory), template.key);
		}
	});

	it('pins its own Bolt version, exactly', () => {
		// A template's Bolt version lives in its own manifest and its own lockfile. Nothing
		// outside the tree declares which Bolt versions it works with, and nothing propagates
		// a bump into it.
		for (const template of discoverTemplates()) {
			const manifest = JSON.parse(
				readFileSync(path.join(template.directory, 'package.json'), 'utf8')
			);
			// Read through the yalc overlay, the way `project-templates.mjs` does.
			//
			// A working tree that is linked against a local Bolt carries `file:.yalc/@norbital-ai/bolt`
			// in the manifest, and yalc records the version it replaced in `yalc.lock`. Asserting the
			// manifest alone therefore failed on every developer machine with a link installed —
			// which is every machine running the local loop — so the check that exists to catch an
			// unpinned template was instead permanently red and told nobody anything.
			const pinned = manifest.dependencies['@norbital-ai/bolt'];
			if (pinned.startsWith('file:.yalc/')) {
				// The linked build's own version. `yalc.lock`'s `replaced` is empty for a template that
				// was linked before it ever installed Bolt from the registry, which is every private
				// template — so the build itself is the only thing that knows what is installed.
				const linked = path.join(template.directory, '.yalc', '@norbital-ai', 'bolt', 'package.json');
				assert.ok(existsSync(linked), `${template.key} is yalc-linked but has no linked build`);
				assert.match(JSON.parse(readFileSync(linked, 'utf8')).version, /^\d+\.\d+\.\d+/);
				continue;
			}
			assert.match(pinned, /^\d+\.\d+\.\d+/);
		}
	});

	it('commits a lockfile per template, so nothing outside the tree pins its dependencies', () => {
		for (const template of discoverTemplates()) {
			assert.ok(
				existsSync(path.join(template.directory, 'pnpm-lock.yaml')),
				`${template.key} must commit pnpm-lock.yaml`
			);
		}
	});

	/**
	 * Every first-party version a template actually depends on must be named in its release-age
	 * exemption, and named exactly.
	 *
	 * Derived from the template's own dependencies rather than a hardcoded version list. A literal
	 * list turns this into a version pin that fails on every release and says nothing about the
	 * property being protected — which is that publishing a package means admitting it here
	 * deliberately, one line per reviewed release.
	 *
	 * The wildcard check is the other half. A scope-wide exemption would defeat the gate in exactly
	 * the case it exists for: a stolen publish credential, whose release would then install the
	 * moment it appeared.
	 */
	it('exempts each first-party version a template depends on, and only by exact version', () => {
		for (const template of discoverTemplates()) {
			const manifest = JSON.parse(
				readFileSync(path.join(template.directory, 'package.json'), 'utf8')
			);
			const dependencies = {
				...(manifest.dependencies ?? {}),
				...(manifest.devDependencies ?? {})
			};
			const firstParty = Object.entries(dependencies).filter(([name]) =>
				name.startsWith('@norbital-ai/')
			);
			assert.ok(firstParty.length > 0, `${template.key} declares no first-party dependencies`);

			const policy = readFileSync(path.join(template.directory, 'pnpm-workspace.yaml'), 'utf8');
			/**
			 * A yalc-linked dependency is exempted at the version it replaced, not at its link.
			 *
			 * The exemption exists so a reviewed first-party release bypasses the minimum-release-age
			 * gate, and that gate is about *released* versions — `file:.yalc/@norbital-ai/bolt` is a
			 * path on one developer's disk and names no release at all. Asserting the manifest's literal
			 * specifier therefore failed on every machine with a local link installed, which is every
			 * machine running the local loop.
			 */
			const yalcLockPath = path.join(template.directory, 'yalc.lock');
			const overlay = existsSync(yalcLockPath)
				? JSON.parse(readFileSync(yalcLockPath, 'utf8'))
				: undefined;
			const released = (name, specifier) => {
				if (!String(specifier).startsWith('file:.yalc/')) return specifier;
				// The linked build's own version, in preference to yalc's `replaced`.
				//
				// `replaced` records what the link displaced, which is the version this checkout used to
				// install — `std` still says 0.0.45 here. That is the right answer for the committed pin
				// and the wrong one for this check, which asks what the template depends on *now*. A
				// package linked before it was ever installed from the registry, as `bolt-protocol` was,
				// records no `replaced` at all.
				const linked = path.join(template.directory, '.yalc', ...name.split('/'), 'package.json');
				if (existsSync(linked)) return JSON.parse(readFileSync(linked, 'utf8')).version;
				const replaced = overlay?.packages?.[name]?.replaced;
				return typeof replaced === 'string' ? replaced : specifier;
			};
			for (const [name, declared] of firstParty) {
				const version = released(name, declared);
				assert.match(
					policy,
					new RegExp(`'${name}@${String(version).replace(/[.+*?^$()[\]{}|\\]/g, '\\$&')}'`),
					`${template.key} depends on ${name}@${version} but does not exempt it`
				);
			}
			assert.doesNotMatch(policy, /@norbital-ai\/\*/);
		}
	});

	it('materializes host and Linux/musl guest native dependencies on every developer OS', () => {
		for (const template of discoverTemplates()) {
			const policy = readFileSync(path.join(template.directory, 'pnpm-workspace.yaml'), 'utf8');
			assert.match(policy, /supportedArchitectures:/);
			for (const architecture of ['darwin', 'linux', 'win32', 'x64', 'arm64', 'glibc', 'musl']) {
				assert.match(policy, new RegExp(`- ${architecture}`), `${template.key}: ${architecture}`);
			}
			assert.doesNotMatch(policy, /- current/);
		}
	});

	it('keeps fresh and upgrade migration lineages internally coherent', () => {
		for (const template of discoverTemplates()) {
			const migrationsDir = path.join(template.directory, '.norbital', 'migrations');
			const migrationSql = readdirSync(migrationsDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort()
				.map((tag) => ({
					tag,
					sql: readFileSync(path.join(migrationsDir, tag, 'migration.sql'), 'utf8')
				}));
			const declared = new Map();
			const declaredIndexes = new Set();

			for (const migration of migrationSql) {
				for (const match of migration.sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)) {
					const columns = new Set(
						[...match[2].matchAll(/^\s*"([^"]+)"\s/gm)].map((column) => column[1])
					);
					declared.set(match[1], columns);
				}
				for (const match of migration.sql.matchAll(
					/_norbital_create_history_table\('([^']+)'::regclass, '([^']+)'\)/g
				)) {
					const [, liveTable, historyTable] = match;
					const liveColumns = declared.get(liveTable);
					if (liveColumns) declared.set(historyTable, new Set(liveColumns));
				}
				for (const match of migration.sql.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/g)) {
					const [statement, table, column] = match;
					const columns = declared.get(table);
					if (!columns) continue;
					const precedingSql = migration.sql.slice(0, match.index);
					const replacesColumn = precedingSql.includes(
						`ALTER TABLE "${table}" DROP COLUMN "${column}";`
					);
					assert.ok(
						!columns.has(column) || replacesColumn,
						`${template.key}/${migration.tag}: ${statement} duplicates the fresh schema`
					);
					columns.add(column);
				}
				for (const match of migration.sql.matchAll(
					/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)"/g
				)) {
					declaredIndexes.add(match[1]);
				}
				for (const match of migration.sql.matchAll(
					/ALTER TABLE "([^"]+)" DROP COLUMN (IF EXISTS )?"([^"]+)"/g
				)) {
					const [, table, guarded, column] = match;
					const columns = declared.get(table);
					assert.ok(
						guarded || columns?.has(column),
						`${template.key}/${migration.tag}: a column absent from the fresh lineage must be dropped with IF EXISTS (${table}.${column})`
					);
					const followingSql = migration.sql.slice((match.index ?? 0) + match[0].length);
					const replacedInMigration = followingSql.includes(
						`ALTER TABLE "${table}" ADD COLUMN "${column}"`
					);
					if (!replacedInMigration) columns?.delete(column);
				}
				for (const match of migration.sql.matchAll(/DROP INDEX (IF EXISTS )?"([^"]+)"/g)) {
					const [, guarded, index] = match;
					assert.ok(
						guarded || declaredIndexes.has(index),
						`${template.key}/${migration.tag}: an index absent from the fresh lineage must be dropped with IF EXISTS (${index})`
					);
					declaredIndexes.delete(index);
				}
				for (const match of migration.sql.matchAll(/DROP TABLE (IF EXISTS )?"([^"]+)"/g)) {
					const [, guarded, table] = match;
					assert.ok(
						guarded || declared.has(table),
						`${template.key}/${migration.tag}: a table absent from the fresh lineage must be dropped with IF EXISTS (${table})`
					);
					declared.delete(table);
				}
				for (const match of migration.sql.matchAll(
					/ALTER TABLE "([^"]+)" ((?:ADD|DROP|ALTER|RENAME) COLUMN[^;]+);/g
				)) {
					const [, table, columnChange] = match;
					if (table.endsWith('_history') || !declared.has(`${table}_history`)) continue;
					assert.ok(
						migration.sql.includes(`ALTER TABLE "${table}_history" ${columnChange};`),
						`${template.key}/${migration.tag}: ${table}.${columnChange} is not mirrored to typed history`
					);
				}
			}
		}
	});

	it('rejects a filter that matches no template', () => {
		assert.throws(() => discoverTemplates('no-such-template'), /No template matched/);
	});
});

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	actualCounts,
	discoverTemplates,
	resolveLockfile,
	repositoryRoot,
	templateMetadataFile,
	templateRefNamespace
} from './ci.ts';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte'];
const SKIP = new Set(['.git', '.norbital', '.svelte-kit', 'build', 'node_modules']);
const FORBIDDEN_PACKAGE = ['file:../../oss', 'file:../oss', 'file:.yalc', 'node ../../oss'];

const listFiles = (root: string): string[] =>
	readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const filePath = path.join(root, entry.name);
		if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : listFiles(filePath);
		return SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension)) ? [filePath] : [];
	});

const specifiers = (file: string, source: string): string[] => {
	const body = file.endsWith('.svelte')
		? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
				.map((match) => match[1] ?? '')
				.join('\n')
		: source;
	const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
	return [
		...stripped.matchAll(
			/(?:^|[\n;])\s*(?:import|export)(?:\s+type)?[\s\w{},*]*\s+from\s*['"]([^'"]+)['"]/g
		),
		...stripped.matchAll(/(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g),
		...stripped.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
	].map((match) => match[1] ?? '');
};

describe('template CI', () => {
	it('discovers every template from its own tree', () => {
		const templates = discoverTemplates();
		assert.ok(templates.length > 0);
		for (const template of templates) {
			assert.ok(existsSync(path.join(template.directory, templateMetadataFile)));
			assert.equal(template.ref, `${templateRefNamespace}/${template.slug}`);
			assert.match(template.handle, /^norbital_[a-z0-9_]+$/);
			assert.doesNotMatch(template.slug, /_/);
			assert.deepEqual(discoverTemplates(template.slug), [template]);
			assert.deepEqual(discoverTemplates(template.handle), [template]);
		}
	});

	it('keeps declared picker counts equal to the tree', async () => {
		for (const template of discoverTemplates()) {
			assert.deepEqual(template.counts, await actualCounts(template.directory), template.slug);
		}
	});

	it('pins published first-party versions and commits a lockfile', () => {
		for (const template of discoverTemplates()) {
			const manifest = JSON.parse(
				readFileSync(path.join(template.directory, 'package.json'), 'utf8')
			) as {
				readonly dependencies?: Record<string, string>;
				readonly devDependencies?: Record<string, string>;
			};
			const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
			const firstParty = Object.entries(dependencies).filter(([name]) =>
				name.startsWith('@norbital-ai/')
			);
			assert.ok(firstParty.length > 0, `${template.slug} declares no first-party dependencies`);
			assert.ok(existsSync(path.join(template.directory, 'pnpm-lock.yaml')));
			const policy = readFileSync(path.join(template.directory, 'pnpm-workspace.yaml'), 'utf8');
			const exempted = new Map(
				[...policy.matchAll(/'(@[^']+?)@([^']*)'/g)].map(([, name, versions]) => [
					name,
					versions.split('||').map((entry) => entry.trim())
				])
			);
			for (const [name, version] of firstParty) {
				assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${template.slug} ${name}`);
				assert.ok(
					exempted.get(name)?.includes(version),
					`${template.slug} depends on ${name}@${version} but does not exempt it`
				);
			}
			assert.doesNotMatch(policy, /@norbital-ai\/\*/);
			assert.match(policy, /supportedArchitectures:/);
			for (const architecture of ['darwin', 'linux', 'win32', 'x64', 'arm64', 'glibc', 'musl']) {
				assert.match(policy, new RegExp(`- ${architecture}`), `${template.slug}: ${architecture}`);
			}
		}
	});

	it('does not import Colony, the private bank, or another product template', () => {
		const templates = discoverTemplates();
		const slugs = templates.map((template) => template.slug);
		const offenders: string[] = [];
		for (const template of templates) {
			const fragments = [
				'apps/colony',
				'seed_bank',
				...slugs
					.filter((slug) => slug !== template.slug)
					.flatMap((slug) => [`templates/${slug}`, `../${slug}`, `../../${slug}`])
			];
			for (const root of ['src', 'tests'].map((leaf) => path.join(template.directory, leaf))) {
				if (!existsSync(root)) continue;
				for (const file of listFiles(root)) {
					for (const specifier of specifiers(file, readFileSync(file, 'utf8'))) {
						const spec = specifier.replaceAll('\\', '/');
						if (
							fragments.some(
								(fragment) =>
									spec === fragment ||
									spec.startsWith(`${fragment}/`) ||
									spec.includes(`/${fragment}/`) ||
									spec.endsWith(`/${fragment}`)
							)
						) {
							offenders.push(
								`${template.slug} ${path.relative(template.directory, file)} -> ${specifier}`
							);
						}
					}
				}
			}
			const manifest = JSON.parse(
				readFileSync(path.join(template.directory, 'package.json'), 'utf8')
			) as {
				readonly dependencies?: Record<string, string>;
				readonly devDependencies?: Record<string, string>;
				readonly scripts?: Record<string, string>;
			};
			for (const value of [
				...Object.values(manifest.dependencies ?? {}),
				...Object.values(manifest.devDependencies ?? {}),
				...Object.values(manifest.scripts ?? {})
			]) {
				for (const fragment of FORBIDDEN_PACKAGE) {
					if (value.includes(fragment)) {
						offenders.push(`${template.slug} package.json contains ${fragment}: ${value}`);
					}
				}
			}
		}
		assert.deepEqual(offenders, []);
	});

	it('keeps fresh and upgrade migration lineages coherent', () => {
		for (const template of discoverTemplates()) {
			const migrationsDir = path.join(template.directory, '.norbital', 'migrations');
			if (!existsSync(migrationsDir)) continue;
			const declared = new Map<string, Set<string>>();
			const declaredIndexes = new Set<string>();
			for (const tag of readdirSync(migrationsDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort()) {
				const sql = readFileSync(path.join(migrationsDir, tag, 'migration.sql'), 'utf8');
				for (const match of sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)) {
					declared.set(
						match[1] ?? '',
						new Set([...match[2].matchAll(/^\s*"([^"]+)"\s/gm)].map((column) => column[1] ?? ''))
					);
				}
				for (const match of sql.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/g)) {
					const table = match[1] ?? '';
					const column = match[2] ?? '';
					const columns = declared.get(table);
					if (columns === undefined) continue;
					const replaces = sql
						.slice(0, match.index)
						.includes(`ALTER TABLE "${table}" DROP COLUMN "${column}";`);
					assert.ok(
						!columns.has(column) || replaces,
						`${template.slug}/${tag}: duplicate ${table}.${column}`
					);
					columns.add(column);
				}
				for (const match of sql.matchAll(
					/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)"/g
				)) {
					declaredIndexes.add(match[1] ?? '');
				}
				for (const match of sql.matchAll(
					/ALTER TABLE "([^"]+)" DROP COLUMN (IF EXISTS )?"([^"]+)"/g
				)) {
					const table = match[1] ?? '';
					const guarded = match[2];
					const column = match[3] ?? '';
					assert.ok(
						guarded || declared.get(table)?.has(column),
						`${template.slug}/${tag}: drop ${table}.${column} needs IF EXISTS`
					);
					if (
						!sql
							.slice((match.index ?? 0) + match[0].length)
							.includes(`ALTER TABLE "${table}" ADD COLUMN "${column}"`)
					) {
						declared.get(table)?.delete(column);
					}
				}
				for (const match of sql.matchAll(/DROP INDEX (IF EXISTS )?"([^"]+)"/g)) {
					assert.ok(
						match[1] || declaredIndexes.has(match[2] ?? ''),
						`${template.slug}/${tag}: drop index ${match[2]}`
					);
					declaredIndexes.delete(match[2] ?? '');
				}
				for (const match of sql.matchAll(/DROP TABLE (IF EXISTS )?"([^"]+)"/g)) {
					assert.ok(
						match[1] || declared.has(match[2] ?? ''),
						`${template.slug}/${tag}: drop table ${match[2]}`
					);
					declared.delete(match[2] ?? '');
				}
				for (const match of sql.matchAll(
					/ALTER TABLE "([^"]+)" ((?:ADD|DROP|ALTER|RENAME) COLUMN[^;]+);/g
				)) {
					const table = match[1] ?? '';
					const columnChange = match[2] ?? '';
					if (table.endsWith('_history') || !declared.has(`${table}_history`)) continue;
					assert.ok(
						sql.includes(`ALTER TABLE "${table}_history" ${columnChange};`),
						`${template.slug}/${tag}: ${table}.${columnChange} is not mirrored to typed history`
					);
				}
			}
		}
	});

	it('preserves the committed dependency resolution when validating a lockfile', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'norbital-lock-test-'));
		try {
			writeFileSync(path.join(directory, 'package.json'), '{"dependencies":{"example":"^1.0.0"}}');
			writeFileSync(path.join(directory, 'pnpm-workspace.yaml'), 'packages: []\n');
			const committed = 'lockfileVersion: 9.0\n# example remains at 1.0.0 even when 1.1.0 exists\n';
			writeFileSync(path.join(directory, 'pnpm-lock.yaml'), committed);
			const template = { ...discoverTemplates()[0]!, directory };
			const resolved = resolveLockfile(template, (command, args, options = {}) => {
				assert.equal(command, 'pnpm');
				assert.ok(options.cwd);
				assert.equal(readFileSync(path.join(options.cwd, 'pnpm-lock.yaml'), 'utf8'), committed);
				assert.ok(args.includes('--no-frozen-lockfile'));
				assert.ok(!args.includes('--force'));
				assert.ok(!args.includes('--ignore-workspace'));
				return '';
			});
			assert.equal(resolved, committed);
			assert.equal(readFileSync(path.join(directory, 'pnpm-lock.yaml'), 'utf8'), committed);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('rejects a filter that matches no template', () => {
		assert.throws(() => discoverTemplates('no-such-template'), /No template matched/);
	});

	it('lives next to the repository root that owns the templates', () => {
		assert.ok(existsSync(path.join(repositoryRoot, 'package.json')));
	});
});

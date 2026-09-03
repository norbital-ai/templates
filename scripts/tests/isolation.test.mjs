import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importsMatching, listFiles, walkImportSpecifiers } from '../lib/import-specifiers.mjs';
import { discoverTemplates } from '../lib/templates.mjs';

const scanRoots = (directory) =>
	['src', 'tests'].map((leaf) => path.join(directory, leaf)).filter((root) => existsSync(root));

const FORBIDDEN_PACKAGE_FRAGMENTS = [
	'file:../../oss',
	'file:../oss',
	'file:.yalc',
	'node ../../oss'
];

describe('template isolation', () => {
	it('does not import Colony, the private bank, or another product template', () => {
		const templates = discoverTemplates();
		assert.ok(templates.length > 0, 'template discovery walked an empty tree');
		const slugs = templates.map((template) => template.slug);
		const offenders = [];
		let fileCount = 0;
		for (const template of templates) {
			const fragments = [
				'apps/colony',
				'seed_bank',
				...slugs
					.filter((slug) => slug !== template.slug)
					.flatMap((slug) => [`templates/${slug}`, `../${slug}`, `../../${slug}`])
			];
			for (const root of scanRoots(template.directory)) {
				const files = listFiles(root);
				fileCount += files.length;
				for (const hit of importsMatching(walkImportSpecifiers(root), fragments)) {
					offenders.push(
						`${template.slug} ${path.relative(template.directory, hit.file)} -> ${hit.specifier}`
					);
				}
			}
		}
		assert.ok(fileCount >= 20, `expected source files under template trees, found ${fileCount}`);
		assert.deepEqual(offenders, []);
	});

	it('does not pin oss checkout paths or yalc overlays in package.json', () => {
		const templates = discoverTemplates();
		const offenders = [];
		for (const template of templates) {
			const manifest = JSON.parse(
				readFileSync(path.join(template.directory, 'package.json'), 'utf8')
			);
			const values = [
				...Object.values(manifest.dependencies ?? {}),
				...Object.values(manifest.devDependencies ?? {}),
				...Object.values(manifest.scripts ?? {})
			];
			for (const value of values) {
				const text = String(value);
				for (const fragment of FORBIDDEN_PACKAGE_FRAGMENTS) {
					if (text.includes(fragment)) {
						offenders.push(`${template.slug} package.json contains ${fragment}: ${text}`);
					}
				}
			}
			const lockfile = path.join(template.directory, 'pnpm-lock.yaml');
			if (existsSync(lockfile)) {
				const lockText = readFileSync(lockfile, 'utf8');
				for (const fragment of FORBIDDEN_PACKAGE_FRAGMENTS) {
					if (lockText.includes(fragment)) {
						offenders.push(`${template.slug} pnpm-lock.yaml contains ${fragment}`);
					}
				}
			}
		}
		assert.deepEqual(offenders, []);
	});
});

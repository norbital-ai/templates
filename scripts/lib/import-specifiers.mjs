import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs', '.svelte'];

const SKIP_DIRECTORIES = new Set([
	'.git',
	'.norbital',
	'.svelte-kit',
	'.turbo',
	'build',
	'coverage',
	'dist',
	'node_modules'
]);

export function listFiles(root, extensions = SOURCE_EXTENSIONS) {
	return readdirSync(root).flatMap((entry) => {
		const filePath = path.join(root, entry);
		if (statSync(filePath).isDirectory()) {
			return SKIP_DIRECTORIES.has(entry) ? [] : listFiles(filePath, extensions);
		}
		return extensions.some((extension) => filePath.endsWith(extension)) ? [filePath] : [];
	});
}

function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function scriptBodies(source) {
	return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
		.map((match) => match[1] ?? '')
		.join('\n');
}

const FROM_SPECIFIER =
	/(?:^|[\n;])\s*(?:import|export)(?:\s+type)?[\s\w{},*]*\s+from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_CALL = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function collect(source, pattern) {
	return [...source.matchAll(pattern)].map((match) => match[1]).filter((value) => value != null);
}

export function specifiersInSource(file, source) {
	const body = withoutComments(file.endsWith('.svelte') ? scriptBodies(source) : source);
	return [
		...collect(body, FROM_SPECIFIER),
		...collect(body, BARE_IMPORT),
		...collect(body, DYNAMIC_IMPORT),
		...collect(body, REQUIRE_CALL)
	];
}

export function specifierContainsPath(specifier, fragment) {
	const spec = specifier.replaceAll('\\', '/');
	const frag = fragment.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
	if (frag === '') return false;
	if (spec === frag) return true;
	if (spec.startsWith(`${frag}/`)) return true;
	if (spec.includes(`/${frag}/`)) return true;
	return spec.endsWith(`/${frag}`);
}

export function walkImportSpecifiers(root, extensions = SOURCE_EXTENSIONS) {
	return listFiles(root, extensions).flatMap((file) =>
		specifiersInSource(file, readFileSync(file, 'utf8')).map((specifier) => ({ file, specifier }))
	);
}

export function importsMatching(records, fragments) {
	return records.filter((record) =>
		fragments.some((fragment) => specifierContainsPath(record.specifier, fragment))
	);
}

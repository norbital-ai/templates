import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Authored workspace source may not hand a framework system column to a framework component.
 *
 * Every row carries `norbital_*` columns the platform owns. A workspace author reads them freely as
 * *data* — `where: { norbital_id: { eq: … } }` is how a foreign key is resolved, and `{#each rows as
 * row (row.norbital_id)}` is how a list is keyed. What authored source must never do is dig a system
 * column out of a record and pass it back to the framework surface that supplied the record: the
 * framework already has it. That was the shape of `recordId={record?.norbital_id}` on every
 * `CollectionForm`, and of `view={`employees:employments:${record.norbital_id}`}` on every nested
 * `CollectionTable`. Both are now framework-derived, so both shapes are dead — and this rule keeps
 * them dead, because a deleted prop is only one `svelte-check` regression away from coming back.
 *
 * The line is *identity* versus *data*, and the walk draws it structurally so no author ever has to
 * suppress the rule — a rule people suppress is a rule nobody enforces:
 *   - Flagged: the attribute's value is the system-column read, or a string spelled out of one.
 *     `recordId={record?.norbital_id}` and `view={`a:b:${record.norbital_id}`}` hand the framework
 *     back its own key as the value of the prop.
 *   - Not flagged: a read inside an object or array literal. `query={{ where: { employee_id: { eq:
 *     record.norbital_id } } }}` is a filter — the author is telling the framework *which rows*,
 *     which is knowledge the framework does not have, and the key is a value in a predicate.
 *   - Not flagged: a read inside a function body, including every `on*` handler and every
 *     `exportPipelines` callback. That expression runs authored code later; the framework is handed
 *     a function, not a key.
 *   - Not flagged: plain elements. An `href` or a `data-` attribute is the author's own markup.
 *
 * Read off the Svelte compiler's syntax tree rather than the source text: a text scan cannot tell an
 * attribute from a comment, a query key, or a string, and every one of those distinctions is load
 * bearing here.
 *
 * A value laundered through a variable — `const id = record.norbital_id` and then `prop={id}` — is
 * deliberately not chased. It is indistinguishable from the legitimate `const siteId =
 * record.norbital_id` that a query filter needs, so following bindings would flag correct code. The
 * type system covers that case where it matters: `CollectionForm` no longer declares `recordId`, so
 * threading one back is a `svelte-check` error whatever route the value took.
 */

export const systemColumnPrefix = 'norbital_';

/** Every authored source extension, so a walk cannot go green by quietly skipping components. */
export const authoredSourceExtensions = ['.svelte', '.ts'];

/** Authored source files under a workspace's `src/`, newest-first order irrelevant. */
export function authoredSourceFiles(workspaceDirectory) {
	const root = path.join(workspaceDirectory, 'src');
	const walk = (directory) =>
		readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return walk(entryPath);
			return authoredSourceExtensions.some((extension) => entry.name.endsWith(extension))
				? [entryPath]
				: [];
		});
	return statSync(root, { throwIfNoEntry: false }) ? walk(root) : [];
}

/**
 * The workspace's own Svelte, so the parser matches the compiler that actually builds the template.
 *
 * Resolved per workspace rather than declared here: this repository root installs no framework, and
 * a second Svelte pinned for the checker could disagree with the one the template compiles with.
 */
function svelteParser(workspaceDirectory) {
	return createRequire(path.join(workspaceDirectory, 'package.json'))('svelte/compiler').parse;
}

const isSystemColumnName = (name) =>
	typeof name === 'string' && name.startsWith(systemColumnPrefix);

/** A property access that pulls a system column's *value* out of an object. */
function isSystemColumnRead(node) {
	if (node.type !== 'MemberExpression') return false;
	return node.computed
		? node.property?.type === 'Literal' && isSystemColumnName(node.property.value)
		: isSystemColumnName(node.property?.name);
}

/**
 * Nodes that turn a system-column read from an identity into ordinary data.
 *
 * An object or array literal is a descriptor the author composes — a `where` clause, a pipeline
 * list — and a key inside one is a predicate operand. A function body is authored code the
 * framework merely invokes. Descending past either is what produced findings on correct source.
 */
const dataBoundaryTypes = new Set([
	'ObjectExpression',
	'ArrayExpression',
	'ArrowFunctionExpression',
	'FunctionExpression',
	'FunctionDeclaration'
]);

/** Whether the expression hands a system column's value straight to the component. */
function passesSystemColumnValue(node) {
	if (node === null || typeof node !== 'object') return false;
	if (Array.isArray(node)) return node.some(passesSystemColumnValue);
	if (isSystemColumnRead(node)) return true;
	if (dataBoundaryTypes.has(node.type)) return false;
	return Object.entries(node).some(([key, child]) =>
		key === 'loc' || key === 'parent' ? false : passesSystemColumnValue(child)
	);
}

/** A capitalised tag is a component; a lowercase one is the author's own markup. */
function isComponentAttributeOwner(node) {
	return node.type === 'Component' || node.type === 'SvelteComponent';
}

function attributeFindings(file, owner) {
	return (owner.attributes ?? [])
		.filter((attribute) => attribute.type === 'Attribute' || attribute.type === 'SpreadAttribute')
		.filter((attribute) => !String(attribute.name ?? '').startsWith('on'))
		.filter((attribute) => passesSystemColumnValue(attribute.value ?? attribute.expression))
		.map((attribute) => ({
			file,
			component: owner.name,
			property: attribute.name ?? '{...spread}'
		}));
}

function fragmentFindings(file, node, findings) {
	if (node === null || typeof node !== 'object') return findings;
	if (Array.isArray(node)) {
		for (const child of node) fragmentFindings(file, child, findings);
		return findings;
	}
	if (isComponentAttributeOwner(node)) findings.push(...attributeFindings(file, node));
	for (const [key, child] of Object.entries(node)) {
		// `attributes` is already classified above, and the instance/module scripts are authored
		// TypeScript where reading a system column is the legitimate data-access case.
		if (key === 'attributes' || key === 'parent' || key === 'loc') continue;
		fragmentFindings(file, child, findings);
	}
	return findings;
}

/**
 * Reports every authored component attribute that carries a framework system column.
 *
 * `files` maps a path to its source so the rule is a pure function over text — the same shape the
 * boundary audit uses, and the reason a synthetic violation can prove the rule still fires.
 */
export function auditAuthoredSystemColumns(workspaceDirectory, files) {
	const parse = svelteParser(workspaceDirectory);
	const findings = [];
	for (const [file, source] of Object.entries(files)) {
		if (!file.endsWith('.svelte')) continue;
		const { fragment } = parse(source, { modern: true, filename: file });
		fragmentFindings(file, fragment, findings);
	}
	return findings;
}

/** Convenience for a gate: read a workspace's authored tree and audit it in one call. */
export function auditWorkspace(workspaceDirectory) {
	const files = Object.fromEntries(
		authoredSourceFiles(workspaceDirectory).map((file) => [file, readFileSync(file, 'utf8')])
	);
	return { files, findings: auditAuthoredSystemColumns(workspaceDirectory, files) };
}

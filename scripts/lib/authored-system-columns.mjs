import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Effect } from 'effect';

/**
 * Authored workspace source may not hand a framework system column to a framework component.
 *
 * Every row carries fixed columns the platform owns. A workspace author reads them freely as
 * *data* — `where: { id: { eq: … } }` is how a foreign key is resolved, and `{#each rows as
 * row (row.id)}` is how a list is keyed. What authored source must never do is dig a system
 * column out of a record and pass it back to the framework surface that supplied the record: the
 * framework already has it. That was the shape of `recordId={record?.id}` on every
 * `CollectionForm`, and of `view={`employees:employments:${record.id}`}` on every nested
 * `CollectionTable`. Both are now framework-derived, so both shapes are dead — and this rule keeps
 * them dead, because a deleted prop is only one `svelte-check` regression away from coming back.
 *
 * The line is *identity* versus *data*, and the walk draws it structurally so no author ever has to
 * suppress the rule — a rule people suppress is a rule nobody enforces:
 *   - Flagged: the attribute's value is the system-column read, or a string spelled out of one.
 *     `recordId={record?.id}` and `view={`a:b:${record.id}`}` hand the framework
 *     back its own key as the value of the prop.
 *   - Not flagged: a read inside an object or array literal. `query={{ where: { employee_id: { eq:
 *     record.id } } }}` is a filter — the author is telling the framework *which rows*,
 *     which is knowledge the framework does not have, and the key is a value in a predicate.
 *   - Not flagged: a read inside a function body, including every `on*` handler and every
 *     `exportPipelines` callback. That expression runs authored code later; the framework is handed
 *     a function, not a key.
 *   - Not flagged: plain elements or locally imported components. An `href`, a `data-` attribute,
 *     or a sibling component's prop is the author's own presentation surface.
 *   - Not flagged: an identically named property on some other value. `item.id` and `layer.id` are
 *     commonly presentation-catalogue keys; only the `record` binding supplied by `$props()` is a
 *     framework row.
 *
 * Read off the Svelte compiler's syntax tree rather than the source text: a text scan cannot tell an
 * attribute from a comment, a query key, or a string, and every one of those distinctions is load
 * bearing here.
 *
 * A value laundered through a variable — `const id = record.id` and then `prop={id}` — is
 * deliberately not chased. It is indistinguishable from the legitimate `const siteId =
 * record.id` that a query filter needs, so following bindings would flag correct code. The
 * type system covers that case where it matters: `CollectionForm` no longer declares `recordId`, so
 * threading one back is a `svelte-check` error whatever route the value took.
 */

/** The framework-owned columns present on every row. */
export const systemColumnNames = Object.freeze([
	'id',
	'created_at',
	'updated_at',
	'sys_period',
	'row_version',
	'approval_id'
]);

const systemColumns = new Set(systemColumnNames);

/** Every authored source extension, so a walk cannot go green by quietly skipping components. */
export const authoredSourceExtensions = ['.svelte', '.ts'];

/** Authored source files under a workspace's `src/`, newest-first order irrelevant. */
function authoredSourceFiles(workspaceDirectory) {
	const root = path.join(workspaceDirectory, 'src');
	return Effect.tryPromise({
		try: () => readdir(root, { recursive: true, withFileTypes: true }),
		catch: (cause) => cause
	}).pipe(
		Effect.catch((error) => (error?.code === 'ENOENT' ? Effect.succeed([]) : Effect.fail(error))),
		Effect.map((entries) =>
			entries
				.filter(
					(entry) =>
						entry.isFile() &&
						authoredSourceExtensions.some((extension) => entry.name.endsWith(extension))
				)
				.map((entry) => path.join(entry.parentPath, entry.name))
		)
	);
}

/**
 * The workspace's own Svelte, so the parser matches the compiler that actually builds the template.
 *
 * Resolved per workspace rather than declared here: this repository root installs no framework, and
 * a second Svelte pinned for the checker could disagree with the one the template compiles with.
 */
function svelteParser(workspaceDirectory) {
	const templateRequire = createRequire(path.join(workspaceDirectory, 'package.json'));
	return Effect.try(() => templateRequire('svelte/compiler').parse).pipe(
		// A template's own install is the primary source, but the repository-level audit
		// (scripts/tests) also runs in CI where templates are never installed — the workflow's
		// declaration step explicitly requires none of it. Fall back to the repository root's
		// Svelte, which this repository now declares for exactly that job.
		Effect.catch(() => Effect.sync(() => createRequire(import.meta.url)('svelte/compiler').parse)),
		Effect.runSync
	);
}

const isSystemColumnName = (name) => typeof name === 'string' && systemColumns.has(name);

/** Expressions whose wrapper does not change which binding a member access reads. */
function unwrapExpression(node) {
	let expression = node;
	while (
		expression?.type === 'ChainExpression' ||
		expression?.type === 'TSAsExpression' ||
		expression?.type === 'TSSatisfiesExpression' ||
		expression?.type === 'TSNonNullExpression' ||
		expression?.type === 'TypeCastExpression' ||
		expression?.type === 'ParenthesizedExpression'
	) {
		expression = expression.expression;
	}
	return expression;
}

/** A property access that pulls a system column's *value* directly out of the framework record. */
function isSystemColumnRead(node, recordBindings) {
	if (node.type !== 'MemberExpression') return false;
	const object = unwrapExpression(node.object);
	if (object?.type !== 'Identifier' || !recordBindings.has(object.name)) return false;
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
function passesSystemColumnValue(node, recordBindings) {
	if (node === null || typeof node !== 'object') return false;
	if (Array.isArray(node))
		return node.some((child) => passesSystemColumnValue(child, recordBindings));
	if (isSystemColumnRead(node, recordBindings)) return true;
	if (dataBoundaryTypes.has(node.type)) return false;
	return Object.entries(node).some(([key, child]) =>
		key === 'loc' || key === 'parent' ? false : passesSystemColumnValue(child, recordBindings)
	);
}

/** Relative paths and project aliases name authored code, not an imported framework surface. */
function isLocalModuleSpecifier(specifier) {
	return (
		typeof specifier !== 'string' ||
		specifier.startsWith('.') ||
		specifier.startsWith('/') ||
		specifier.startsWith('$') ||
		specifier.startsWith('#')
	);
}

/** Component bindings imported from package boundaries. */
function frameworkComponentBindings(instance) {
	return new Set(
		(instance?.content?.body ?? []).flatMap((statement) =>
			statement.type !== 'ImportDeclaration' || isLocalModuleSpecifier(statement.source?.value)
				? []
				: (statement.specifiers ?? []).flatMap((specifier) =>
						specifier.local?.name ? [specifier.local.name] : []
					)
		)
	);
}

/** Names a `const { record: name } = $props()` declaration binds to its `record` destructure. */
function propsRecordBinding(declaration) {
	if (declaration.id?.type !== 'ObjectPattern') return [];
	const init = unwrapExpression(declaration.init);
	if (init?.type !== 'CallExpression') return [];
	if (init.callee?.type !== 'Identifier' || init.callee.name !== '$props') return [];
	return declaration.id.properties
		.filter(
			(property) =>
				property.type === 'Property' &&
				!property.computed &&
				property.key?.name === 'record' &&
				property.value?.type === 'Identifier'
		)
		.map((property) => property.value.name);
}

/** Local names bound to the framework's `record` prop, including a destructuring alias. */
function frameworkRecordBindings(instance) {
	const bindings = new Set();
	for (const statement of instance?.content?.body ?? []) {
		if (statement.type !== 'VariableDeclaration') continue;
		for (const declaration of statement.declarations ?? []) {
			for (const name of propsRecordBinding(declaration)) bindings.add(name);
		}
	}
	return bindings;
}

function componentBinding(owner) {
	if (owner.type === 'Component') return owner.name?.split('.')[0];
	if (owner.type === 'SvelteComponent') return unwrapExpression(owner.expression)?.name;
	return undefined;
}

function attributeFindings(file, owner, recordBindings) {
	const findings = [];
	for (const attribute of owner.attributes ?? []) {
		if (attribute.type !== 'Attribute' && attribute.type !== 'SpreadAttribute') continue;
		if (String(attribute.name ?? '').startsWith('on')) continue;
		if (!passesSystemColumnValue(attribute.value ?? attribute.expression, recordBindings)) continue;
		findings.push({
			file,
			component: owner.name,
			property: attribute.name ?? '{...spread}'
		});
	}
	return findings;
}

function fragmentFindings(file, node, frameworkBindings, recordBindings, findings) {
	if (node === null || typeof node !== 'object') return findings;
	if (Array.isArray(node)) {
		for (const child of node) {
			fragmentFindings(file, child, frameworkBindings, recordBindings, findings);
		}
		return findings;
	}
	if (frameworkBindings.has(componentBinding(node))) {
		findings.push(...attributeFindings(file, node, recordBindings));
	}
	for (const [key, child] of Object.entries(node)) {
		// `attributes` is already classified above, and the instance/module scripts are authored
		// TypeScript where reading a system column is the legitimate data-access case.
		if (key === 'attributes' || key === 'parent' || key === 'loc') continue;
		fragmentFindings(file, child, frameworkBindings, recordBindings, findings);
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
		const { fragment, instance } = parse(source, { modern: true, filename: file });
		fragmentFindings(
			file,
			fragment,
			frameworkComponentBindings(instance),
			frameworkRecordBindings(instance),
			findings
		);
	}
	return findings;
}

/** Convenience for a gate: read a workspace's authored tree and audit it in one call. */
export function auditWorkspace(workspaceDirectory) {
	return Effect.gen(function* () {
		const sourceFiles = yield* authoredSourceFiles(workspaceDirectory);
		const entries = yield* Effect.forEach(
			sourceFiles,
			(file) =>
				Effect.tryPromise(() => readFile(file, 'utf8')).pipe(
					Effect.map((source) => [file, source])
				),
			{ concurrency: 'unbounded' }
		);
		const files = Object.fromEntries(entries);
		return { files, findings: auditAuthoredSystemColumns(workspaceDirectory, files) };
	});
}

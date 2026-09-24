/**
 * The authoring agent's hover and check (`workspace_hover`, `workspace_check`), run by the pinned
 * `@norbital-ai/bolt/type-service` over this workspace as synced.
 *
 * The agent writes against these answers, so they must be the compiler's exact shapes: a
 * collection's `create` input with its required and optional fields, and a representation's props
 * inside its `.svelte` source. Positions are found by searching the source, not by fixed lines.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	collectionDocs,
	createWorkspaceTypeService,
	readFromDisk
} from '@norbital-ai/bolt/type-service';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const service = createWorkspaceTypeService();
const workspace = { key: 'field-operations', root };
after(() => service.dispose());

/** 1-based line and column of the first `needle` in a workspace file, offset into it. */
const at = (path: string, needle: string, offset = 0) => {
	const lines = readFileSync(join(root, path), 'utf8').split('\n');
	const line = lines.findIndex((text) => text.includes(needle));
	assert.notEqual(line, -1, `${needle} is in ${path}`);
	return { path, line: line + 1, column: lines[line]!.indexOf(needle) + offset + 1 };
};

describe('the agent type service over this workspace', () => {
	it("hovers a collection's create with its exact input", () => {
		const hover = service.hover(
			workspace,
			at('src/automations/suspicion-review.ts', 'suspicious_activity_logs.create(', 25)
		);
		assert.ok(hover?.text.startsWith('(property) create: (input: {'), hover?.text);
		assert.match(hover.text, /readonly job_assignment_id: string;/);
		assert.match(hover.text, /readonly reason: string;/);
		assert.match(hover.text, /readonly basis\?: string \| null \| undefined;/);
		assert.doesNotMatch(hover.text, /\bany\b/);
	});

	it("hovers a representation's props inside its .svelte source", () => {
		const path = 'src/collections/job_assignments/+representation.svelte';
		const hover = service.hover(workspace, at(path, 'let { record', 6));
		assert.equal(hover?.text, 'let record: Row | null');
		assert.equal(
			hover?.definition?.path,
			'.norbital/types/collections/job_assignments/$types.d.ts'
		);
	});

	it('checks the synced workspace clean, and a broken draft at its line', () => {
		const path = 'src/collections/job_assignments/+representation.svelte';
		assert.deepEqual(service.check(workspace, [path, 'src/automations/suspicion-review.ts']), []);
		const source = readFileSync(join(root, path), 'utf8');
		const broken = source.replace('let { record', 'let { recrod');
		const { line } = at(path, 'let { record');
		const problems = service.check({ ...workspace, overlay: { [path]: broken } }, [path]);
		assert.ok(
			problems.some((problem) => problem.line === line && /recrod/.test(problem.message)),
			JSON.stringify(problems)
		);
	});
	it("carries the workspace's own statements of what a write does, with where each is written", () => {
		// What `bolt sync` ships on the type index, and `workspace_type collections.job_assignments.create`
		// answers with: the transform's stamps and a column's meaning, each with its line.
		const docs = collectionDocs(readFromDisk(root), 'job_assignments');
		assert.match(
			docs?.transform?.text ?? '',
			/^Refuses a job that names a site that does not exist, files it unassigned until a contractor holds it, stamps the dispatch/
		);
		assert.equal(
			docs?.transform?.source,
			`src/collections/job_assignments/+collection.ts:${at('src/collections/job_assignments/+collection.ts', 'transform: (inputs').line}`
		);
		assert.equal(docs?.fields['status']?.text, 'Where the work has got to, and nothing else.');
		assert.equal(
			docs?.fields['status']?.source,
			`src/collections/job_assignments/+model.ts:${at('src/collections/job_assignments/+model.ts', 'status: enums(').line}`
		);
		const photos = collectionDocs(readFromDisk(root), 'photo_evidence');
		assert.ok(photos !== undefined && Object.keys(photos.fields).includes('sha256'));
	});
});

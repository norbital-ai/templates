import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	auditAuthoredSystemColumns,
	auditWorkspace,
	authoredSourceExtensions,
	systemColumnPrefix
} from '../lib/authored-system-columns.mjs';
import { discoverTemplates } from '../lib/templates.mjs';

const templates = discoverTemplates();

describe('authored system columns', () => {
	it('walks components as well as modules, so a green result cannot mean a skipped extension', () => {
		// The precedent this rule follows filtered its file walk with `path.endsWith('.ts')`, which
		// meant every `.svelte` file bypassed it and the check was green for the wrong reason.
		//
		// The expectation is spelled out here rather than read from `authoredSourceExtensions`. A
		// first draft of this test iterated that export, which made narrowing the walk to `['.ts']`
		// narrow the assertion with it — the same silent pass, reproduced inside the test written to
		// prevent it. A literal cannot be shrunk from the other side.
		const required = ['.svelte', '.ts'];
		assert.deepEqual([...authoredSourceExtensions].sort(), [...required].sort());
		for (const template of templates) {
			const { files } = auditWorkspace(template.directory);
			const counted = Object.fromEntries(
				required.map((extension) => [
					extension,
					Object.keys(files).filter((file) => path.extname(file) === extension).length
				])
			);
			for (const extension of required) {
				assert.ok(
					counted[extension] > 0,
					`${template.key} contributed no ${extension} files: ${JSON.stringify(counted)}`
				);
			}
		}
	});

	it('hands no framework system column to a framework component', () => {
		// Every template is audited before anything is asserted. A per-template assertion inside the
		// loop stops at the first offender and reports the rest as clean, which reads exactly like a
		// clean scan.
		const offences = templates.flatMap((template) =>
			auditWorkspace(template.directory).findings.map(
				(finding) =>
					`${template.key}/${path.relative(template.directory, finding.file)} <${finding.component} ${finding.property}>`
			)
		);
		assert.deepEqual(offences, [], 'the framework supplies what a surface already knows');
	});

	it('reports a record key threaded back into a framework prop', () => {
		// The positive control. A rule asserted only against clean source is satisfied just as well by
		// a rule that never matches, so each shape this check is claimed to catch is proved here.
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'a.svelte': '<CollectionForm collection="x" recordId={record?.norbital_id} />'
			}),
			[{ file: 'a.svelte', component: 'CollectionForm', property: 'recordId' }]
		);
	});

	it('reports a view-persistence key interpolating a system column', () => {
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'a.svelte': '<CollectionTable view={`employees:employments:${record.norbital_id}`} />'
			}),
			[{ file: 'a.svelte', component: 'CollectionTable', property: 'view' }]
		);
	});

	it('sees through the optional chain and the string the key is spelled into', () => {
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'chain.svelte': "<CollectionTable view={record?.norbital_id ?? 'none'} />",
				'computed.svelte': "<CollectionForm recordId={record['norbital_id']} />"
			}),
			[
				{ file: 'chain.svelte', component: 'CollectionTable', property: 'view' },
				{ file: 'computed.svelte', component: 'CollectionForm', property: 'recordId' }
			]
		);
	});

	it('leaves the legitimate data-access reads alone', () => {
		// `norbital_id` is a real column and the value every foreign key points at. Naming it as a
		// query key, filtering on it, keying a list by it, linking to it, or reading it inside a
		// callback the framework merely invokes is not the offence — handing it to a surface that
		// already has the record is. Every shape below appears in the templates today, so a rule that
		// widened to catch them would be suppressed everywhere instead of enforced.
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'a.svelte': `<CollectionTable
						query={{
							where: { employee_id: { eq: record.norbital_id }, ${systemColumnPrefix}id: { in: ids } },
							orderBy: { norbital_created_at: 'desc' }
						}}
						exportPipelines={[{ id: 'x', run: async ({ selectedRows }) => selectedRows.map((row) => row.norbital_id) }]}
					/>
					{#each rows as row (row.norbital_id)}
						<a href="/jobs/{row.norbital_id}">{row.title}</a>
						<Button onclick={() => publish(row.norbital_id)}>Publish</Button>
					{/each}`
			}),
			[]
		);
	});
});

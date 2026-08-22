import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	auditAuthoredSystemColumns,
	auditWorkspace,
	authoredSourceExtensions
} from '../lib/authored-system-columns.mjs';
import { discoverTemplates } from '../lib/templates.mjs';

const templates = discoverTemplates();

const frameworkFixture = (markup) => `<script>
	import { CollectionForm, CollectionTable } from '@example/framework';
	let { record } = $props();
</script>
${markup}`;

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
					`${template.slug} contributed no ${extension} files: ${JSON.stringify(counted)}`
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
					`${template.slug}/${path.relative(template.directory, finding.file)} <${finding.component} ${finding.property}>`
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
				'a.svelte': frameworkFixture('<CollectionForm collection="x" recordId={record?.id} />')
			}),
			[{ file: 'a.svelte', component: 'CollectionForm', property: 'recordId' }]
		);
	});

	it('reports a view-persistence key interpolating a system column', () => {
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'a.svelte': frameworkFixture(
					'<CollectionTable view={`employees:employments:${record.id}`} />'
				)
			}),
			[{ file: 'a.svelte', component: 'CollectionTable', property: 'view' }]
		);
	});

	it('sees through the optional chain and the string the key is spelled into', () => {
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'chain.svelte': frameworkFixture("<CollectionTable view={record?.id ?? 'none'} />"),
				'computed.svelte': frameworkFixture("<CollectionForm recordId={record['id']} />")
			}),
			[
				{ file: 'chain.svelte', component: 'CollectionTable', property: 'view' },
				{ file: 'computed.svelte', component: 'CollectionForm', property: 'recordId' }
			]
		);
	});

	it('recognises every framework-owned column and no similarly named authored column', () => {
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'a.svelte': frameworkFixture(`<CollectionForm
					rowId={record.id}
					created={record.created_at}
					updated={record.updated_at}
					period={record.sys_period}
					version={record.row_version}
					approval={record.approval_id}
					customer={record.customer_id}
				/>`)
			}),
			[
				{ file: 'a.svelte', component: 'CollectionForm', property: 'rowId' },
				{ file: 'a.svelte', component: 'CollectionForm', property: 'created' },
				{ file: 'a.svelte', component: 'CollectionForm', property: 'updated' },
				{ file: 'a.svelte', component: 'CollectionForm', property: 'period' },
				{ file: 'a.svelte', component: 'CollectionForm', property: 'version' },
				{ file: 'a.svelte', component: 'CollectionForm', property: 'approval' }
			]
		);
	});

	it('leaves the legitimate data-access reads alone', () => {
		// `id` is a real column and the value every foreign key points at. Naming it as a
		// query key, filtering on it, keying a list by it, linking to it, or reading it inside a
		// callback the framework merely invokes is not the offence — handing it to a surface that
		// already has the record is. Every shape below appears in the templates today, so a rule that
		// widened to catch them would be suppressed everywhere instead of enforced.
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'a.svelte': frameworkFixture(`<CollectionTable
						query={{
							where: { employee_id: { eq: record.id }, id: { in: ids } },
							orderBy: { created_at: 'desc' }
						}}
						exportPipelines={[{ id: 'x', run: async ({ selectedRows }) => selectedRows.map((row) => row.id) }]}
					/>
					{#each rows as row (row.id)}
						<a href="/jobs/{row.id}">{row.title}</a>
						<Button onclick={() => publish(row.id)}>Publish</Button>
					{/each}`)
			}),
			[]
		);
	});

	it('leaves reclamation presentation-catalogue ids on local sibling components alone', () => {
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'model-panel.svelte': `<script>
					import InfoHint from './info-hint.svelte';
				</script>
				<InfoHint
					label={t('component.about_label', { label: surfaceLabel(i18n, layer.id, layer.label) })}
					text={surfaceNote(i18n, layer.id, SURFACE_NOTE[layer.id])}
				/>`,
				'cost-panel.svelte': `<script>
					import InfoHint from './info-hint.svelte';
				</script>
				<InfoHint
					label={t('component.why_label', { label: manualTakeOffLabel(i18n, item.id, item.label) })}
					text={manualTakeOffWhy(i18n, item.id, item.why)}
				/>`
			}),
			[]
		);
	});

	it('requires both a package component and the framework record binding', () => {
		const workspace = templates[0].directory;
		assert.deepEqual(
			auditAuthoredSystemColumns(workspace, {
				'local-record.svelte': `<script>
					import InfoHint from './info-hint.svelte';
					let { record } = $props();
				</script>
				<InfoHint text={record.id} />`,
				'external-catalogue.svelte': `<script>
					import { InfoHint } from '@example/framework';
					let { item } = $props();
				</script>
				<InfoHint text={item.id} />`
			}),
			[]
		);
	});
});

<script lang="ts">
	/** Workplace case files of one legal entity: requests, incidents and changes its version lists. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Row } from '@norbital-ai/bolt';
	import { Table } from '@norbital-ai/ui';
	import EventPage from '../../../lib/ui/events/event_page.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { parseCaseSheet } from '../../../data/model/entry/service/entry_workbook.js';
	import { employmentQuery, entryImport } from '../../../lib/ui/workbook/entry_import.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();

	const scope = companyScope(ctx);
	const laws = pageLaws(ctx, () => scope.entities.map((row) => row.settings_code));
	const t = ctx.t;
	const caseName = listedKindNames(ctx, 'case_kinds', () =>
		scope.entities.map((row) => row.settings_code)
	);
	let creating = $state(false);

	const entities = $derived(
		scope.entities.map((row) => ({
			id: row.id,
			code: row.code ?? null,
			name: row.name,
			settings_code: row.settings_code
		}))
	);

	const importCases = entryImport(ctx, scope, laws, {
		action: 'workplace_case_catalog_entry.create',
		label: () => t('app.cases.title'),
		load: (companyId) =>
			ctx.query({
				workplace_case_catalog_entry: {
					where: { entity_id: { eq: companyId } },
					fields: ['entity_id', 'employment_id', 'kind', 'opened_on'],
					limit: 10000
				},
				employment: employmentQuery(companyId)
			}),
		build: (grids, current, party) => {
			const parsed = parseCaseSheet(grids, {
				...party,
				entities,
				existing: current.workplace_case_catalog_entry.rows.map((row) => ({
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					kind: row.kind,
					opened_on: row.opened_on
				}))
			});
			return {
				warnings: parsed.warnings,
				rows: parsed.rows.map((row) => ({
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					kind: row.kind,
					...(row.severity == null ? {} : { severity: row.severity }),
					opened_on: row.opened_on,
					...(row.scheduled_on == null ? {} : { scheduled_on: row.scheduled_on }),
					...(row.closed_on == null ? {} : { closed_on: row.closed_on }),
					inputs: row.inputs
				}))
			};
		}
	});
</script>

{#snippet caseCell({
	value
}: {
	value: Row<'workplace_case_catalog_entry'>['kind'] | undefined;
})}{caseName(value ?? '')}{/snippet}

<EventPage
	{ctx}
	{scope}
	icon="lucide:folder-open"
	title={t('app.cases.title')}
	description={t('app.cases.description')}
	createOf="workplace_case_catalog_entry"
	bind:creating
>
	{#snippet children(companyId)}
		<Table
			{ctx}
			of="workplace_case_catalog_entry"
			key={`workplace_case_catalog_entry-${companyId}`}
			where={{ entity_id: { eq: companyId } }}
			order_by={{ opened_on: 'desc' }}
			toolbar={{
				title: t('app.cases.title'),
				new: () => (creating = true),
				actions: [importCases(t('import.cases'))]
			}}
			columns={[{ field: 'kind', cell: caseCell }, 'opened_on', 'closed_on', 'payroll_run_id']}
		/>
	{/snippet}
</EventPage>

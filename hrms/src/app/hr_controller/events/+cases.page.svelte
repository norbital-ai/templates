<script lang="ts">
	/** Workplace case files of one legal entity: requests, incidents and changes its version lists. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Row } from '@norbital-ai/bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, RecordShell, Sheet, Table } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { parseCaseSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import { entryImport } from '../../../lib/ui/workbook/entry_import.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();

	const scope = companyScope(ctx);
	const laws = pageLaws(ctx, () => scope.entities.map((row) => row.settings_code));
	const t = ctx.t;
	const caseName = listedKindNames(ctx, 'case_kinds', () =>
		scope.entities.map((row) => row.settings_code)
	);
	let creating = $state<'workplace_case_catalog_entry' | null>(null);

	const held = $derived.by(() =>
		scope.id == null
			? null
			: ctx.query({
					workplace_case_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['entity_id', 'employment_id', 'kind', 'opened_on'],
						limit: 10000
					},
					employment: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employee_number', 'entity_id', 'effective_range'],
						limit: 10000
					}
				})
	);

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
		held: () => held?.current,
		loading: 'Workplace case data is still loading.',
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

<AppShell
	icon="lucide:folder-open"
	title={t('app.cases.title')}
	description={t('app.cases.description')}
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id == null}
		<EmptyState title={t('app.events.empty_scope')} />
	{:else}
		<Table
			{ctx}
			of="workplace_case_catalog_entry"
			key={`workplace_case_catalog_entry-${scope.id}`}
			where={{ entity_id: { eq: scope.id } }}
			order_by={{ opened_on: 'desc' }}
			toolbar={{
				title: t('app.cases.title'),
				new: () => (creating = 'workplace_case_catalog_entry'),
				actions: [importCases(t('holiday_calendar.import_spreadsheet'))]
			}}
			columns={[{ field: 'kind', cell: caseCell }, 'opened_on', 'closed_on', 'payroll_run_id']}
		/>
	{/if}
</AppShell>

{#if creating != null && scope.id != null}
	<Sheet open on_open_change={(open) => !open && (creating = null)} title={t('app.cases.title')}>
		<RecordShell
			{ctx}
			of={creating}
			mode="create"
			values={{ entity_id: scope.id }}
			on_done={() => (creating = null)}
		/>
	</Sheet>
{/if}

<script lang="ts">
	/** Workplace case files of one legal entity: requests, incidents and changes its version lists. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput, Row } from '@norbital-ai/bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, RecordShell, Sheet, Table } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';
	import { parseCaseSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import {
		runWorkbookImport,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';
	let { ctx }: { ctx: PageContext } = $props();

	const scope = companyScope(ctx);
	const t = ctx.t;
	const caseName = listedKindNames(ctx, 'case_kinds');
	let creating = $state<'workplace_case_catalog_entry' | null>(null);
	let importing = $state(false);
	let warnings: readonly string[] = [];

	const held = $derived.by(() =>
		scope.id == null
			? null
			: ctx.query({
					jurisdiction_settings: {
						where: { status: { eq: 'SEALED' } },
						fields: ['code', 'effective_range'],
						limit: 10000
					},
					workplace_case_catalog: { fields: ['code', 'settings_id'], limit: 10000 },
					workplace_case_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['entity_id', 'employment_id', 'kind', 'opened_on'],
						limit: 10000
					},
					employee_contract: {
						where: { entity_id: { eq: scope.id }, status: { eq: 'SEALED' } },
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

	function caseRows(grids: WorkbookGrids): ActInput<'workplace_case_catalog_entry.create'> {
		const current = held?.current;
		const company = scope.company;
		const entityId = scope.id;
		if (current == null || company == null || entityId == null)
			throw new Error('Workplace case data is still loading.');
		const parsed = parseCaseSheet(grids, {
			entity: {
				id: entityId,
				code: company.code ?? null,
				name: company.name,
				settings_code: company.settings_code
			},
			employees: current.employee_contract.rows.map((row) => ({
				id: row.id,
				number: row.employee_number,
				entity_id: row.entity_id,
				from: row.effective_range.from,
				to: row.effective_range.to
			})),
			versions: current.jurisdiction_settings.rows.map((row) => ({
				id: row.id,
				code: row.code,
				from: row.effective_range.from,
				to: row.effective_range.to
			})),
			catalogs: current.workplace_case_catalog.rows.map((row) => ({
				id: row.id,
				code: row.code,
				settings_id: row.settings_id
			})),
			entities,
			existing: current.workplace_case_catalog_entry.rows.map((row) => ({
				entity_id: row.entity_id,
				employment_id: row.employment_id,
				kind: row.kind,
				opened_on: row.opened_on
			}))
		});
		warnings = parsed.warnings;
		return parsed.rows.map((row) => ({
			entity_id: row.entity_id,
			employment_id: row.employment_id,
			catalog_id: row.catalog_id,
			kind: row.kind,
			...(row.severity == null ? {} : { severity: row.severity }),
			opened_on: row.opened_on,
			...(row.scheduled_on == null ? {} : { scheduled_on: row.scheduled_on }),
			...(row.closed_on == null ? {} : { closed_on: row.closed_on }),
			inputs: row.inputs
		}));
	}

	function importCases() {
		importing = true;
		fork(
			runWorkbookImport(ctx, {
				action: 'workplace_case_catalog_entry.create',
				recordLabel: t('app.cases.title').toLowerCase(),
				buildPayload: caseRows,
				importedCount: (payload) => payload.length,
				warnings: () => warnings
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						importing = false;
					})
				)
			)
		);
	}
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
				actions: [
					{
						run: importCases,
						icon: 'lucide:file-spreadsheet',
						name: t('holiday_calendar.import_spreadsheet'),
						disabled: () => (importing || held?.current == null ? t('component.loading') : null)
					}
				]
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

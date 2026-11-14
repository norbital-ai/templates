<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, RecordShell, Sheet } from '@norbital-ai/ui';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { numberOf } from '../../../lib/payroll_engine/foundation.js';
	import { parseAdhocSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import { entryImport, plain } from '../../../lib/ui/workbook/entry_import.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const laws = pageLaws(ctx, () => (scope.company == null ? [] : [scope.company.settings_code]));
	let creating = $state(false);

	const held = $derived.by(() =>
		scope.id == null
			? null
			: ctx.query({
					employment: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employee_number', 'entity_id', 'effective_range'],
						limit: 10000
					},
					adhoc_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'catalog_code', 'quantity', 'description', 'incurred_on'],
						limit: 10000
					}
				})
	);

	const importAdhoc = entryImport(ctx, scope, laws, {
		action: 'adhoc_catalog_entry.create',
		label: () => ctx.t('app.adhoc.title'),
		held: () => held?.current,
		loading: 'Employee and ad hoc data is still loading.',
		build: (grids, current, party) => {
			const parsed = parseAdhocSheet(grids, {
				...party,
				existing: current.adhoc_catalog_entry.rows.map((row) => ({
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					quantity: numberOf(row.quantity) ?? 0,
					incurred_on: row.incurred_on,
					description: row.description
				}))
			});
			return {
				warnings: parsed.warnings,
				rows: parsed.rows.map((row) => ({
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					description: row.description ?? '',
					quantity: plain(row.quantity),
					unit: 'MONEY' as const,
					incurred_on: row.incurred_on
				}))
			};
		}
	});
</script>

{#snippet sealCell({ value }: { value: unknown })}<SealedBadge sealed={value != null} />{/snippet}

<AppShell
	title={ctx.t('app.adhoc.title')}
	description={ctx.t('app.adhoc.description')}
	icon="lucide:hand-coins"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={ctx.t('app.events.empty_scope')} />
	{:else}<Table
			{ctx}
			of="adhoc_catalog_entry"
			key="adhoc_catalog_entry"
			where={{ entity_id: { eq: scope.id } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('app.adhoc.title'),
				actions: [importAdhoc(ctx.t('holiday_calendar.import_spreadsheet'))]
			}}
			columns={[
				'employment_id',
				'catalog_code',
				'description',
				'quantity',

				'incurred_on',
				{ field: 'payroll_run_id', cell: sealCell }
			]}
		/>{/if}
</AppShell>
{#if creating && scope.id !== null}<Sheet
		open
		on_open_change={(open) => !open && (creating = false)}
		title={ctx.t('app.adhoc.title')}
		><RecordShell
			{ctx}
			of="adhoc_catalog_entry"
			mode="create"
			values={{ entity_id: scope.id }}
			on_done={() => (creating = false)}
		/></Sheet
	>{/if}

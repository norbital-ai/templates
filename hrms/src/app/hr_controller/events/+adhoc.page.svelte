<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { stintNames } from '../../../lib/ui/person/stint_names.svelte.js';
	import { Table } from '@norbital-ai/ui';
	import EventPage from '../../../lib/ui/events/event_page.svelte';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { numberOf } from '../../../lib/foundation.js';
	import { parseAdhocSheet } from '../../../data/model/entry/service/entry_workbook.js';
	import {
		employmentQuery,
		entryImport,
		plain
	} from '../../../lib/ui/workbook/entry_import.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const stints = stintNames(ctx, () => scope.id);
	const laws = pageLaws(ctx, () => (scope.company == null ? [] : [scope.company.settings_code]));
	let creating = $state(false);

	const importAdhoc = entryImport(ctx, scope, laws, {
		action: 'adhoc_catalog_entry.create',
		label: () => ctx.t('app.adhoc.title'),
		load: (companyId) =>
			ctx.query({
				employment: employmentQuery(companyId),
				adhoc_catalog_entry: {
					where: { entity_id: { eq: companyId } },
					fields: ['employment_id', 'catalog_code', 'quantity', 'description', 'incurred_on'],
					limit: 10000
				}
			}),
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

{#snippet who({ value }: { value: unknown })}{stints.of(value)}{/snippet}

{#snippet sealCell({ value }: { value: unknown })}<SealedBadge
		sealed={value != null}
		{ctx}
	/>{/snippet}

<EventPage
	{ctx}
	{scope}
	title={ctx.t('app.adhoc.title')}
	description={ctx.t('app.adhoc.description')}
	icon="lucide:hand-coins"
	createOf="adhoc_catalog_entry"
	bind:creating
>
	{#snippet children(companyId)}<Table
			{ctx}
			of="adhoc_catalog_entry"
			key="adhoc_catalog_entry"
			where={{ entity_id: { eq: companyId } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('app.adhoc.title'),
				actions: [importAdhoc(ctx.t('import.adhoc'))]
			}}
			columns={[
				{ field: 'employment_id', cell: who },
				'catalog_code',
				'description',
				'quantity',
				'incurred_on',
				{ field: 'payroll_run_id', cell: sealCell }
			]}
		/>{/snippet}
</EventPage>

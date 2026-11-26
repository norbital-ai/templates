<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { stintNames } from '../../../lib/ui/person/stint_names.svelte.js';
	import { Table } from '@norbital-ai/ui';
	import EventPage from '../../../lib/ui/events/event_page.svelte';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import ClaimRequest from '../../../lib/ui/person/claim_request.svelte';
	import { numberOf } from '../../../lib/foundation.js';
	import { parseClaimSheet } from '../../../data/model/entry/service/entry_workbook.js';
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

	const importClaims = entryImport(ctx, scope, laws, {
		action: 'claim_catalog_entry.create',
		label: () => ctx.t('app.claims.title'),
		load: (companyId) =>
			ctx.query({
				employment: employmentQuery(companyId),
				claim_catalog_entry: {
					where: { entity_id: { eq: companyId } },
					fields: ['employment_id', 'catalog_code', 'quantity', 'incurred_on'],
					limit: 10000
				}
			}),
		build: (grids, current, party) => {
			const parsed = parseClaimSheet(grids, {
				...party,
				existing: current.claim_catalog_entry.rows.map((row) => ({
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					quantity: numberOf(row.quantity) ?? 0,
					incurred_on: row.incurred_on,
					description: null
				}))
			});
			return {
				warnings: parsed.warnings,
				rows: parsed.rows.map((row) => ({
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					quantity: plain(row.quantity),
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
	title={ctx.t('app.claims.title')}
	description={ctx.t('app.claims.description')}
	icon="lucide:receipt-text"
	bind:creating
>
	{#snippet children(companyId)}<Table
			{ctx}
			of="claim_catalog_entry"
			key="claim_catalog_entry"
			where={{ entity_id: { eq: companyId } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('app.claims.title'),
				actions: [importClaims(ctx.t('import.claims'))]
			}}
			columns={[
				{ field: 'employment_id', cell: who },
				'catalog_code',
				'quantity',
				'incurred_on',
				{ field: 'payroll_run_id', cell: sealCell }
			]}
		/>{/snippet}
	{#snippet create(companyId)}<ClaimRequest
			{ctx}
			{companyId}
			onsaved={() => (creating = false)}
			onclose={() => (creating = false)}
		/>{/snippet}
</EventPage>

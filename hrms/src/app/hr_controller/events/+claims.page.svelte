<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState } from '@norbital-ai/ui';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import ClaimRequest from '../../../lib/ui/person/claim_request.svelte';
	import { numberOf } from '../../../lib/payroll_engine/foundation.js';
	import { parseClaimSheet } from '../../../lib/payroll_engine/entry_workbook.js';
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
					claim_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'catalog_code', 'quantity', 'incurred_on'],
						limit: 10000
					}
				})
	);

	const importClaims = entryImport(ctx, scope, laws, {
		action: 'claim_catalog_entry.create',
		label: () => ctx.t('app.claims.title'),
		held: () => held?.current,
		loading: 'Employee and claim data is still loading.',
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

{#snippet sealCell({ value }: { value: unknown })}<SealedBadge sealed={value != null} />{/snippet}

<AppShell
	title={ctx.t('app.claims.title')}
	description={ctx.t('app.claims.description')}
	icon="lucide:receipt-text"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={ctx.t('app.events.empty_scope')} />
	{:else}<Table
			{ctx}
			of="claim_catalog_entry"
			key="claim_catalog_entry"
			where={{ entity_id: { eq: scope.id } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('app.claims.title'),
				actions: [importClaims(ctx.t('holiday_calendar.import_spreadsheet'))]
			}}
			columns={[
				'employment_id',
				'catalog_code',
				'quantity',
				'incurred_on',
				{ field: 'payroll_run_id', cell: sealCell }
			]}
		/>{/if}
</AppShell>
{#if creating && scope.id !== null}<ClaimRequest
		{ctx}
		companyId={scope.id}
		onsaved={() => (creating = false)}
		onclose={() => (creating = false)}
	/>{/if}

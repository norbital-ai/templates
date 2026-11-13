<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput } from '@norbital-ai/bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState } from '@norbital-ai/ui';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import ClaimRequest from '../../../lib/ui/person/claim_request.svelte';
	import { numberOf } from '../../../lib/payroll_engine/foundation.js';
	import { parseClaimSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import {
		runWorkbookImport,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const laws = pageLaws(ctx, () => (scope.company == null ? [] : [scope.company.settings_code]));
	let creating = $state(false);
	let importing = $state(false);
	let warnings: readonly string[] = [];

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

	function claimRows(grids: WorkbookGrids): ActInput<'claim_catalog_entry.create'> {
		const current = held?.current;
		const company = scope.company;
		const entityId = scope.id;
		if (current == null || company == null || entityId == null)
			throw new Error('Employee and claim data is still loading.');
		const parsed = parseClaimSheet(grids, {
			entity: {
				id: entityId,
				code: company.code ?? null,
				name: company.name,
				settings_code: company.settings_code
			},
			employees: current.employment.rows.map((row) => ({
				id: row.id,
				number: row.employee_number,
				entity_id: row.entity_id,
				from: row.effective_range.from,
				to: row.effective_range.to
			})),
			laws: laws.on,
			existing: current.claim_catalog_entry.rows.map((row) => ({
				employment_id: row.employment_id,
				catalog_code: row.catalog_code,
				quantity: numberOf(row.quantity) ?? 0,
				incurred_on: row.incurred_on,
				description: null
			}))
		});
		warnings = parsed.warnings;
		return parsed.rows.map((row) => ({
			entity_id: row.entity_id,
			employment_id: row.employment_id,
			catalog_code: row.catalog_code,
			quantity: new Intl.NumberFormat('en', {
				useGrouping: false,
				maximumFractionDigits: 20
			}).format(row.quantity),
			incurred_on: row.incurred_on
		}));
	}

	function importClaims() {
		importing = true;
		fork(
			runWorkbookImport(ctx, {
				action: 'claim_catalog_entry.create',
				recordLabel: ctx.t('app.claims.title').toLowerCase(),
				buildPayload: claimRows,
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
				actions: [
					{
						run: importClaims,
						icon: 'lucide:file-spreadsheet',
						name: ctx.t('holiday_calendar.import_spreadsheet'),
						disabled: () =>
							importing || held?.current == null || laws.loading ? ctx.t('component.loading') : null
					}
				]
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

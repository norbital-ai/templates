<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput } from '@norbital-ai/bolt';
	import { plain_date } from '../../../lib/date.js';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState } from '@norbital-ai/ui';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import ClaimRequest from '../../../lib/ui/person/claim_request.svelte';
	import { numberOf } from '../../../lib/payroll_engine/foundation.js';
	import { decimalText } from '../../../lib/payroll_engine/money.js';
	import { parseClaimSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import {
		runWorkbookImport,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	let creating = $state(false);
	let importing = $state(false);
	let warnings: readonly string[] = [];

	const held = $derived.by(() =>
		scope.id == null
			? null
			: ctx.query({
					employee_contract: {
						where: { entity_id: { eq: scope.id }, status: { eq: 'SEALED' } },
						fields: ['employee_number', 'entity_id', 'effective_range'],
						limit: 10000
					},
					jurisdiction_settings: {
						where: { status: { eq: 'SEALED' } },
						fields: ['code', 'effective_range'],
						limit: 10000
					},
					claim_catalog: { fields: ['code', 'settings_id'], limit: 10000 },
					claim_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'catalog_id', 'quantity', 'incurred_on'],
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
			catalogs: current.claim_catalog.rows.map((row) => ({
				id: row.id,
				code: row.code,
				settings_id: row.settings_id
			})),
			existing: current.claim_catalog_entry.rows.map((row) => ({
				employment_id: row.employment_id,
				catalog_id: row.catalog_id,
				quantity: numberOf(row.quantity) ?? 0,
				incurred_on: row.incurred_on,
				description: null
			}))
		});
		warnings = parsed.warnings;
		return parsed.rows.map((row) => ({
			entity_id: row.entity_id,
			employment_id: row.employment_id,
			catalog_id: row.catalog_id,
			quantity: decimalText(row.quantity),
			incurred_on: plain_date(row.incurred_on)
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
						disabled: () => (importing || held?.current == null ? ctx.t('component.loading') : null)
					}
				]
			}}
			columns={[
				'employment_id',
				'catalog_id',
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

<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, RecordShell, Sheet } from '@norbital-ai/ui';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { numberOf } from '../../../lib/payroll_engine/foundation.js';
	import {
		parseLoanSheet,
		parseRepaymentSheet
	} from '../../../lib/payroll_engine/entry_workbook.js';
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
					loan_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'catalog_code', 'quantity', 'repayment_period'],
						limit: 10000
					},
					loan_catalog_entry_repayment: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'loan_id', 'amount', 'paid_on'],
						limit: 10000
					}
				})
	);

	const importLoans = entryImport(ctx, scope, laws, {
		action: 'loan_catalog_entry.create',
		label: () => ctx.t('app.loans.title'),
		held: () => held?.current,
		loading: 'Employee and loan data is still loading.',
		build: (grids, current, party) => {
			const parsed = parseLoanSheet(grids, {
				...party,
				existing: current.loan_catalog_entry.rows.map((row) => ({
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					quantity: numberOf(row.quantity) ?? 0,
					from: row.repayment_period.from,
					to: row.repayment_period.to
				}))
			});
			return {
				warnings: parsed.warnings,
				rows: parsed.rows.map((row) => ({
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					quantity: plain(row.quantity),
					repayment_period: { from: row.repayment_from, to: row.repayment_to }
				}))
			};
		}
	});

	const importRepayments = entryImport(ctx, scope, laws, {
		action: 'loan_catalog_entry_repayment.create',
		label: () => ctx.t('v2.repayments'),
		held: () => held?.current,
		loading: 'Employee and loan data is still loading.',
		build: (grids, current, party) => {
			const parsed = parseRepaymentSheet(grids, {
				...party,
				loans: current.loan_catalog_entry.rows.map((row) => ({
					id: row.id,
					employment_id: row.employment_id,
					catalog_code: row.catalog_code
				})),
				existing: current.loan_catalog_entry_repayment.rows.map((row) => ({
					employment_id: row.employment_id,
					loan_id: row.loan_id,
					amount: numberOf(row.amount) ?? 0,
					paid_on: row.paid_on == null ? null : String(row.paid_on)
				}))
			});
			return {
				warnings: parsed.warnings,
				rows: parsed.rows.map((row) => ({
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					loan_id: row.loan_id,
					amount: plain(row.amount),
					paid_on: row.paid_on
				}))
			};
		}
	});
</script>

{#snippet sealCell({ value }: { value: unknown })}<SealedBadge sealed={value != null} />{/snippet}

<AppShell
	title={ctx.t('app.loans.title')}
	description={ctx.t('v2.loans_help')}
	icon="lucide:landmark"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={ctx.t('app.events.empty_scope')} />{:else}<Table
			{ctx}
			of="loan_catalog_entry"
			key="loans"
			where={{ entity_id: { eq: scope.id } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('app.loans.title'),
				actions: [
					importLoans(ctx.t('holiday_calendar.import_spreadsheet')),
					importRepayments(ctx.t('v2.import_repayments'))
				]
			}}
			columns={[
				'employment_id',
				'catalog_code',
				'quantity',
				'repayment_period',
				{ field: 'payroll_run_id', cell: sealCell }
			]}
		/>{/if}
</AppShell>
{#if creating && scope.id !== null}<Sheet
		open
		on_open_change={(open) => !open && (creating = false)}
		title={ctx.t('app.loans.title')}
		><RecordShell
			{ctx}
			of="loan_catalog_entry"
			mode="create"
			values={{ entity_id: scope.id }}
			on_done={() => (creating = false)}
		/></Sheet
	>{/if}

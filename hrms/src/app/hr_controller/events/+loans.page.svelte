<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { stintNames } from '../../../lib/ui/person/stint_names.svelte.js';
	import { Table } from '@norbital-ai/ui';
	import EventPage from '../../../lib/ui/events/event_page.svelte';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { numberOf } from '../../../lib/foundation.js';
	import {
		parseLoanSheet,
		parseRepaymentSheet
	} from '../../../data/model/entry/service/entry_workbook.js';
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

	const loadHeld = (companyId: NonNullable<typeof scope.id>) =>
		ctx.query({
			employment: employmentQuery(companyId),
			loan_catalog_entry: {
				where: { entity_id: { eq: companyId } },
				fields: ['employment_id', 'catalog_code', 'quantity', 'repayment_period'],
				limit: 10000
			},
			loan_catalog_entry_repayment: {
				where: { entity_id: { eq: companyId } },
				fields: ['employment_id', 'loan_id', 'amount', 'paid_on'],
				limit: 10000
			}
		});

	const importLoans = entryImport(ctx, scope, laws, {
		action: 'loan_catalog_entry.create',
		label: () => ctx.t('app.loans.title'),
		load: loadHeld,
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
		load: loadHeld,
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

{#snippet who({ value }: { value: unknown })}{stints.of(value)}{/snippet}

{#snippet sealCell({ value }: { value: unknown })}<SealedBadge
		sealed={value != null}
		{ctx}
	/>{/snippet}

<EventPage
	{ctx}
	{scope}
	title={ctx.t('app.loans.title')}
	description={ctx.t('v2.loans_help')}
	icon="lucide:landmark"
	createOf="loan_catalog_entry"
	bind:creating
>
	{#snippet children(companyId)}<Table
			{ctx}
			of="loan_catalog_entry"
			key="loans"
			where={{ entity_id: { eq: companyId } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('app.loans.title'),
				actions: [
					importLoans(ctx.t('import.loans')),
					importRepayments(ctx.t('v2.import_repayments'))
				]
			}}
			columns={[
				{ field: 'employment_id', cell: who },
				'catalog_code',
				'quantity',
				'repayment_period',
				{ field: 'payroll_run_id', cell: sealCell }
			]}
		/>{/snippet}
</EventPage>

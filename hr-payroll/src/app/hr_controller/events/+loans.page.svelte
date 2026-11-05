<script lang="ts">
	import { bolt } from '$bolt';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, RecordShell, Sheet } from '@norbital-ai/ui';
	import SealedBadge from '../../../lib/ui/payroll/sealed_badge.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { numberOf } from '../../../lib/payroll_engine/foundation.js';
	import {
		parseLoanSheet,
		parseRepaymentSheet
	} from '../../../lib/payroll_engine/entry_workbook.js';
	import {
		runWorkbookImport,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';
	const scope = companyScope();
	let creating = $state(false);
	let importingLoans = $state(false);
	let importingRepayments = $state(false);
	let loanWarnings: readonly string[] = [];
	let repaymentWarnings: readonly string[] = [];

	const held = $derived.by(() =>
		scope.id == null
			? null
			: bolt.query({
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
					loan_catalog: { fields: ['code', 'name', 'settings_id'], limit: 10000 },
					loan_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'catalog_id', 'quantity', 'repayment_period'],
						limit: 10000
					},
					loan_repayment_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'loan_id', 'amount', 'paid_on'],
						limit: 10000
					}
				})
	);

	const party = () => {
		const current = held?.current;
		const company = scope.company;
		const entityId = scope.id;
		if (current == null || company == null || entityId == null)
			throw new Error('Employee and loan data is still loading.');
		return {
			current,
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
			}))
		};
	};

	function loanRows(grids: WorkbookGrids): ActInput<'loan_catalog_entry.create'> {
		const { current, ...base } = party();
		const parsed = parseLoanSheet(grids, {
			...base,
			catalogs: current.loan_catalog.rows.map((row) => ({
				id: row.id,
				code: row.code,
				settings_id: row.settings_id
			})),
			existing: current.loan_catalog_entry.rows.map((row) => ({
				employment_id: row.employment_id,
				catalog_id: row.catalog_id,
				quantity: numberOf(row.quantity) ?? 0,
				from: row.repayment_period.from,
				to: row.repayment_period.to
			}))
		});
		loanWarnings = parsed.warnings;
		return parsed.rows.map((row) => ({
			entity_id: row.entity_id,
			employment_id: row.employment_id,
			catalog_id: row.catalog_id,
			quantity: row.quantity,
			repayment_period: {
				from: PlainDate(row.repayment_from),
				to: PlainDate(row.repayment_to)
			}
		}));
	}

	function repaymentRows(grids: WorkbookGrids): ActInput<'loan_repayment_entry.create'> {
		const { current, ...base } = party();
		const parsed = parseRepaymentSheet(grids, {
			...base,
			catalogs: current.loan_catalog.rows.map((row) => ({
				id: row.id,
				code: row.code,
				settings_id: row.settings_id
			})),
			loans: current.loan_catalog_entry.rows.map((row) => ({
				id: row.id,
				employment_id: row.employment_id,
				catalog_id: row.catalog_id
			})),
			existing: current.loan_repayment_entry.rows.map((row) => ({
				employment_id: row.employment_id,
				loan_id: row.loan_id,
				amount: numberOf(row.amount) ?? 0,
				paid_on: row.paid_on == null ? null : String(row.paid_on)
			}))
		});
		repaymentWarnings = parsed.warnings;
		return parsed.rows.map((row) => ({
			entity_id: row.entity_id,
			employment_id: row.employment_id,
			loan_id: row.loan_id,
			amount: row.amount,
			paid_on: PlainDate(row.paid_on)
		}));
	}

	function importLoans() {
		importingLoans = true;
		fork(
			runWorkbookImport({
				action: 'loan_catalog_entry.create',
				recordLabel: bolt.t('app.loans.title').toLowerCase(),
				buildPayload: loanRows,
				importedCount: (payload) => payload.length,
				warnings: () => loanWarnings
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						importingLoans = false;
					})
				)
			)
		);
	}

	function importRepayments() {
		importingRepayments = true;
		fork(
			runWorkbookImport({
				action: 'loan_repayment_entry.create',
				recordLabel: bolt.t('v2.repayments').toLowerCase(),
				buildPayload: repaymentRows,
				importedCount: (payload) => payload.length,
				warnings: () => repaymentWarnings
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						importingRepayments = false;
					})
				)
			)
		);
	}
</script>

{#snippet sealCell({ value }: { value: unknown })}<SealedBadge sealed={value != null} />{/snippet}

<AppShell
	title={bolt.t('app.loans.title')}
	description={bolt.t('v2.loans_help')}
	icon="lucide:landmark"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={bolt.t('app.events.empty_scope')} />{:else}<Stack
			gap="lg"
		>
			<Table
				of="loan_catalog_entry"
				key="loans"
				where={{ entity_id: { eq: scope.id } }}
				toolbar={{
					new: () => (creating = true),
					title: bolt.t('app.loans.title'),
					actions: [
						{
							run: importLoans,
							icon: 'lucide:file-spreadsheet',
							name: bolt.t('holiday_calendar.import_spreadsheet'),
							disabled: () =>
								importingLoans || held?.current == null ? bolt.t('component.loading') : null
						},
						{
							run: importRepayments,
							icon: 'lucide:file-spreadsheet',
							name: bolt.t('v2.import_repayments'),
							disabled: () =>
								importingRepayments || held?.current == null ? bolt.t('component.loading') : null
						}
					]
				}}
				columns={[
					'employment_id',
					'catalog_id',
					'quantity',
					'repayment_period',
					{ field: 'payroll_run_id', cell: sealCell }
				]}
			/>
		</Stack>{/if}
</AppShell>
{#if creating && scope.id !== null}<Sheet
		open
		onOpenChange={(open) => !open && (creating = false)}
		title={bolt.t('app.loans.title')}
		><RecordShell
			of="loan_catalog_entry"
			mode="create"
			values={{ entity_id: scope.id }}
			onDone={() => (creating = false)}
		/></Sheet
	>{/if}

<script lang="ts">
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	/**
	 * The payroll runs of one legal entity; a run opens on its own payslips. Creating a run is the whole tap: the
	 * transform assembles its payslips from the records in force and the `behaviour_taps` automation pins every
	 * consumed catalogue entry to its slip. Selected runs have separate bank-file and salary-listing export actions.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { downloadTextFiles, EmptyState, Table, toast } from '@norbital-ai/ui';
	import { downloadSalaryReport } from '../../../lib/ui/payroll/salary_report.js';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import RunCreate from '../../../lib/ui/payroll/run_create.svelte';
	const scope = companyScope();
	let creating = $state(false);
	let exporting = $state(false);
	function exportPayroll(ids: Id<'payroll_run'>[], kind: 'BANK' | 'SALARY'): void {
		if (ids.length === 0 || exporting) return;
		exporting = true;
		fork(
			bolt.query('payroll_run.export_payroll', { ids, kind }).pipe(
				Effect.flatMap(({ documents, salary_reports }) => {
					if (kind === 'SALARY') return downloadSalaryReport(salary_reports);
					return Effect.sync(() => {
						if (documents.length === 0) toast.info(bolt.t('app.payroll.no_bank_payments'));
						else downloadTextFiles(documents, 'bank-files.zip');
					});
				}),
				Effect.catch((failure) =>
					Effect.sync(() =>
						toast.error(failure instanceof Error ? failure.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(
					Effect.sync(() => {
						exporting = false;
					})
				)
			)
		);
	}
</script>

<AppShell
	icon="lucide:receipt"
	title={bolt.t('app.payroll.runs_title')}
	description={bolt.t('app.payroll.configured_description')}
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id == null}
		<EmptyState title={bolt.t('app.payroll.empty_runs')} />
	{:else}
		<Stack gap="md">
			<Table
				of="payroll_run"
				key="payroll_run"
				where={{ company_id: { eq: scope.id } }}
				orderBy={{ period: 'desc' }}
				toolbar={{
					export: false,
					title: bolt.t('app.payroll.runs_title'),
					new: () => (creating = true),
					delete: true,
					actions: [
						{
							run: (ids: Id<'payroll_run'>[]) => exportPayroll(ids, 'BANK'),
							requiresSelection: true,
							icon: 'lucide:landmark',
							name: bolt.t('app.payroll.export_bank_file'),
							description: bolt.t('app.payroll.export_bank_file_help'),
							disabled: () => (exporting ? bolt.t('component.loading') : null)
						},
						{
							run: (ids: Id<'payroll_run'>[]) => exportPayroll(ids, 'SALARY'),
							requiresSelection: true,
							icon: 'lucide:file-spreadsheet',
							name: bolt.t('app.payroll.export_salary_listing'),
							description: bolt.t('app.payroll.export_salary_listing_help'),
							disabled: () => (exporting ? bolt.t('component.loading') : null)
						}
					]
				}}
				columns={[
					'period',
					'kind',
					'pay_date',
					'pay_due_date',
					'attendance_from',
					'attendance_to',
					'warnings'
				]}
			/>
		</Stack>
		<RunCreate companyId={scope.id} bind:open={creating} />
	{/if}
</AppShell>

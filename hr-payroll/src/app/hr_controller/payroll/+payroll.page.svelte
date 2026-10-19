<script lang="ts">
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	/**
	 * The payroll runs of one legal entity; a run opens on its own payslips. Creating a run is the whole tap: the
	 * transform assembles its payslips from the records in force and the `behaviour_taps` automation pins every
	 * consumed catalogue entry to its slip. Export bundles the bank file and per-employee payslip CSVs in one ZIP.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { downloadTextFiles, EmptyState, Table, toast } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import RunCreate from '../../../lib/ui/payroll/run_create.svelte';
	const scope = companyScope();
	let creating = $state(false);
	function exportPayroll(ids: Id<'payroll_run'>[]): void {
		if (ids.length === 0) return;
		fork(
			bolt.query('payroll_run.export_payroll', { ids }).pipe(
				Effect.tap(({ documents }) =>
					Effect.sync(() => downloadTextFiles(documents, 'payroll-exports.zip'))
				),
				Effect.catch((failure) =>
					Effect.sync(() =>
						toast.error(failure instanceof Error ? failure.message : bolt.t('component.error'))
					)
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
					title: bolt.t('app.payroll.runs_title'),
					new: () => (creating = true),
					delete: true,
					actions: [
						{
							run: exportPayroll,
							requiresSelection: true,
							icon: 'lucide:download',
							name: bolt.t('app.payroll.export'),
							description: bolt.t('app.payroll.export_description')
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

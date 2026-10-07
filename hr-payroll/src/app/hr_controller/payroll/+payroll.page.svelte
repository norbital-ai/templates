<script lang="ts">
	/**
	 * The payroll runs of one legal entity; a run opens on its own payslips. Creating a run is the whole tap: the
	 * transform assembles its payslips from the records in force and the `behaviour_taps` automation pins every
	 * consumed catalogue entry to its slip. Export downloads the bank file and one payslip CSV per employee.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { EmptyState, Table } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import RunCreate from '../../../lib/ui/payroll/run_create.svelte';

	const scope = companyScope();
	let creating = $state(false);

	async function exportPayroll(ids: Id<'payroll_run'>[]) {
		if (ids.length === 0) return;
		const { documents } = await bolt.query('payroll_run.export_payroll', {
			ids
		});
		for (const file of documents) {
			const href = URL.createObjectURL(
				new Blob([file.content], { type: 'text/plain;charset=utf-8' })
			);
			const a = Object.assign(document.createElement('a'), { download: file.name, href });
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(href), 1000);
		}
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
							label: bolt.t('app.payroll.export'),
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

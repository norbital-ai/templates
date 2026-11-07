<script lang="ts">
	import { bolt } from '$bolt';
	import { Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import {
		Button,
		Form,
		notifyOutcome,
		RecordShell,
		Table,
		Tabs,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { exportSalaryListing } from '../../../lib/export_format_configuration/salary_listing_download.js';
	let { view }: { view: RecordView<'payroll_run'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	let downloading = $state(false);
	let paying = $state(false);
	const markPaid = () => {
		if (record === null) return;
		paying = true;
		fork(
			bolt.act('payroll_run.update', [{ target: record.id, set: { state: 'PAID' } }]).pipe(
				Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (paying = false)))
			)
		);
	};
	const download = () => {
		if (record === null) return;
		downloading = true;
		fork(
			exportSalaryListing([record.id]).pipe(
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (downloading = false)))
			)
		);
	};
</script>

{#snippet summary()}{#if record !== null}<div class="mb-2 flex justify-end gap-2">
			{#if record.state === 'UNPAID'}<Button disabled={paying} onclick={markPaid}
					>{bolt.t('app.payroll.mark_paid')}</Button
				>{/if}
			<Button variant="secondary" disabled={downloading} onclick={download}
				>{bolt.t('app.payroll.export_listing')}</Button
			>
		</div>{/if}<Form
		of="payroll_run"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	/>{/snippet}
{#snippet payslips()}{#if record}<Table
			of="payslip"
			key="run-payslips"
			where={{ payroll_run_id: { eq: record.id } }}
			toolbar={{ new: false, delete: false, title: bolt.t('v2.payslips') }}
			columns={[
				'employee_id',
				'employment_id',
				'basic_earnings',
				'gross_earnings',
				'net_pay',
				'total_deductions',
				'employer_cost'
			]}
		/>{/if}{/snippet}
<RecordShell
	of="payroll_run"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}{@render summary()}{:else}<Tabs
			tabs={[
				{ name: 'payslips', title: bolt.t('v2.payslips'), body: payslips },
				{ name: 'summary', title: bolt.t('v2.run_details'), body: summary }
			]}
		/>{/if}
</RecordShell>

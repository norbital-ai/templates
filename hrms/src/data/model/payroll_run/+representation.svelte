<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		Form,
		notify_outcome,
		RecordShell,
		Table,
		Tabs,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { exportSalaryListing } from '../../../lib/export_format_configuration/salary_listing_download.js';
	let { view, ctx }: { view: RecordView<'payroll_run'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	let downloading = $state(false);
	let paying = $state(false);
	const markPaid = () => {
		if (record === null) return;
		paying = true;
		fork(
			ctx
				.act({
					'payroll_run.update': [
						{ target: { id: record.id, revision: record.revision }, set: { state: 'PAID' } }
					]
				})
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notify_outcome(ctx, outcome))),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
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
			exportSalaryListing(ctx, [record.id]).pipe(
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (downloading = false)))
			)
		);
	};
</script>

{#snippet summary()}<Stack size="fill" gap="sm"
		>{#if record !== null}<Cluster gap="sm" justify="end">
				{#if record.state === 'UNPAID'}<Button disabled={paying} onclick={markPaid}
						>{ctx.t('app.payroll.mark_paid')}</Button
					>{/if}
				<Button variant="secondary" disabled={downloading} onclick={download}
					>{ctx.t('app.payroll.export_listing')}</Button
				>
			</Cluster>{/if}<Form
			{ctx}
			of="payroll_run"
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record === null
				? { values: view.mode === 'create' ? view.values : {} }
				: { id: record.id, record }}
		/></Stack
	>{/snippet}
{#snippet payslips()}{#if record}<Table
			{ctx}
			of="payslip"
			key="run-payslips"
			where={{ payroll_run_id: { eq: record.id } }}
			toolbar={{ new: false, delete: false, title: ctx.t('v2.payslips') }}
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
{#snippet amended()}{#if record}<Stack size="fill" gap="lg">
			<Table
				{ctx}
				of="pay_amendment"
				key="run-amendments"
				where={{ payroll_run_id: { eq: record.id } }}
				toolbar={{ new: false, delete: false, title: ctx.t('app.payroll.amended_carried') }}
				columns={['employee_id', 'pay_group_id', 'period']}
			/>
			<Table
				{ctx}
				of="pay_amendment"
				key="run-amendments-waiting"
				where={{ payroll_run_id: { is_null: true } }}
				toolbar={{ new: false, delete: false, title: ctx.t('app.payroll.amended_waiting') }}
				columns={['employee_id', 'pay_group_id', 'period']}
			/>
		</Stack>{/if}{/snippet}
<RecordShell
	{ctx}
	of="payroll_run"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}{@render summary()}{:else}<Tabs
			tabs={[
				{ name: 'payslips', title: ctx.t('v2.payslips'), body: payslips },
				{ name: 'amended', title: ctx.t('app.payroll.amended'), body: amended },
				{ name: 'summary', title: ctx.t('v2.run_details'), body: summary }
			]}
		/>{/if}
</RecordShell>

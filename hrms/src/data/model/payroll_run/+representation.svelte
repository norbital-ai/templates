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
	import { moneyKind } from '../../../lib/ui/format/money_kind.js';
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
	// the run's company pays in its law's currency
	const paidIn = $derived(
		record === null
			? null
			: ctx.query({
					entity: {
						where: { id: { eq: record.entity_id } },
						fields: ['settings_code'],
						limit: 1
					},
					jurisdiction: { fields: ['code', 'currency'], limit: 1000 }
				})
	);
	const MONEY = $derived(
		moneyKind(
			paidIn?.current?.jurisdiction.rows.find(
				(law) => law.code === paidIn.current?.entity.rows[0]?.settings_code
			)?.currency
		)
	);
</script>

{#snippet actions()}{#if record?.state === 'UNPAID'}<Button disabled={paying} onclick={markPaid}
			>{ctx.t('app.payroll.mark_paid')}</Button
		>{/if}{/snippet}
{#snippet summary()}<Stack size="fill" gap="sm"
		>{#if record !== null}<Cluster gap="sm" justify="end">
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
				{ field: 'basic_earnings', kind: MONEY },
				{ field: 'gross_earnings', kind: MONEY },
				{ field: 'net_pay', kind: MONEY },
				{ field: 'total_deductions', kind: MONEY },
				{ field: 'employer_cost', kind: MONEY }
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
				where={{ pay_group_id: { eq: record.pay_group_id }, payroll_run_id: { is_null: true } }}
				toolbar={{ new: false, delete: false, title: ctx.t('app.payroll.amended_waiting') }}
				columns={['employee_id', 'pay_group_id', 'period']}
			/>
		</Stack>{/if}{/snippet}
<RecordShell
	{ctx}
	of="payroll_run"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	footer_actions={actions}
>
	{#if record === null}{@render summary()}{:else}<Tabs
			tabs={[
				{ name: 'payslips', title: ctx.t('v2.payslips'), body: payslips },
				{ name: 'amended', title: ctx.t('app.payroll.amended'), body: amended },
				{ name: 'summary', title: ctx.t('v2.run_details'), body: summary }
			]}
		/>{/if}
</RecordShell>

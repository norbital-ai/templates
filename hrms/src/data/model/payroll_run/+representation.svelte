<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import { Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		Form,
		notify_outcome,
		RecordShell,
		Table,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { moneyKind } from '../../../lib/ui/format/money_kind.js';
	let { view, ctx }: { view: RecordView<'payroll_run'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
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
<RecordShell
	{ctx}
	of="payroll_run"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	footer_actions={actions}
>
	{#if record === null}
		<Form {ctx} of="payroll_run" mode="create" values={view.mode === 'create' ? view.values : {}} />
	{:else}
		<Stack size="fill" gap="lg">
			<Form {ctx} of="payroll_run" mode="update" id={record.id} {record} size="content" />
			<Table
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
			/>
		</Stack>
	{/if}
</RecordShell>

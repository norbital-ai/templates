<script lang="ts">
	/**
	 * Every ledger row that moved a person's balance, newest first; each opens its own record. New is HR's manual
	 * adjustment, the one write HR makes here.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	import { Table } from '@norbital-ai/ui';

	let {
		ctx,
		balanceId,
		onadjust
	}: { ctx: PageContext; balanceId: Id<'employee_balance'>; onadjust: () => void } = $props();
	const SOURCES = [
		'manual',
		'entitlement',
		'retention',
		'payroll_run',
		'leave_catalog_entry',
		'claim_catalog_entry',
		'adhoc_catalog_entry'
	] as const;
	/** `manual:<id>`, `leave_catalog_entry:<id>`, `payroll_run:<id>`, `entitlement:…`, `retention:…` in plain words. */
	const sourceName = (source: unknown) => {
		const kind = String(source ?? '').split(':')[0] ?? '';
		const known = SOURCES.find((name) => name === kind);
		return known === undefined ? kind : ctx.t(`balance.source.${known}`);
	};
</script>

{#snippet sourceCell({ value }: { value: unknown })}{sourceName(value)}{/snippet}
<Table
	{ctx}
	of="ledger_entry"
	key="person-ledger"
	where={{ balance_id: { eq: balanceId } }}
	order_by={{ effective_on: 'desc' }}
	toolbar={{
		title: ctx.t('balance.ledger'),
		description: ctx.t('balance.ledger_help'),
		new: onadjust
	}}
	columns={[
		'effective_on',
		'code',
		{ field: 'source', cell: sourceCell },
		'operation',
		'amount',
		'unit',
		'measure',
		'note'
	]}
/>

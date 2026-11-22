<script lang="ts">
	import { Field, type FormState } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { watch } from 'runed';
	import { onDestroy } from 'svelte';
	import { numberOf } from '../../foundation.js';
	import {
		loanScheduleProblems,
		loanScheduleState,
		newLoanRepayments
	} from '../../../data/model/entry/loan_catalog_entry/service/loan_schedule.js';
	import CatalogField from '../settings/catalog_field.svelte';

	let { ctx, form }: { ctx: PageContext; form: FormState } = $props();
	const terms = $derived.by(() => {
		const period = form.get('repayment_period');
		const end = (side: 'from' | 'to') => {
			const day = period !== null && typeof period === 'object' ? Reflect.get(period, side) : null;
			return typeof day === 'string' ? day : '';
		};
		return {
			principal: numberOf(form.get('quantity')) ?? 0,
			from: end('from'),
			to: end('to'),
			repayments: []
		};
	});
	const repayments = $derived(
		loanScheduleState(terms) === 'NO_TERMS'
			? []
			: newLoanRepayments(
					{ entity_id: form.get('entity_id'), employment_id: form.get('employment_id') },
					terms
				)
	);
	// a loan arrives with its schedule: the instalments are nested in its create, one write
	watch(
		() => repayments,
		(rows) =>
			form.queue_children(
				'repayments',
				rows.map((values) => ({ action: 'create' as const, values }))
			)
	);
	// terms no schedule can follow are not saved: what is wrong shows on the field once it holds a value
	onDestroy(
		form.add_validation(() =>
			loanScheduleProblems(terms).flatMap((problem) =>
				problem === 'principal' && form.get('quantity') !== null
					? [{ field: 'quantity', message: ctx.t('loan.principal_required') }]
					: problem === 'period' && form.get('repayment_period') !== null
						? [{ field: 'repayment_period', message: ctx.t('loan.period_required') }]
						: []
			)
		)
	);
</script>

<Stack gap="md">
	<div class="grid gap-3 sm:grid-cols-2">
		<Field {ctx} name="employment_id" />
		<CatalogField {ctx} of="loan_catalog" />
		<Field {ctx} name="quantity" />
		<Field {ctx} name="repayment_period" />
		<Field {ctx} name="evidence_file" />
	</div>
	{#if repayments.length > 0}<div class="rounded-lg border">
			<div class="flex items-center justify-between border-b px-3 py-2">
				<span class="text-sm font-medium">{ctx.t('loan.repayments')}</span>
				<span class="text-xs text-muted-foreground">{repayments.length} ×</span>
			</div>
			<div class="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-sm sm:grid-cols-3">
				{#each repayments as row (row.paid_on)}<span class="text-muted-foreground"
						>{row.paid_on}</span
					><span class="tabular-nums">{row.amount}</span>{/each}
			</div>
		</div>{/if}
</Stack>

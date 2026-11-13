<script lang="ts">
	import { Field, type FormState } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { numberOf } from '../../payroll_engine/foundation.js';
	import { buildLoanSchedule } from '../../payroll_engine/loan_schedule.js';

	let { ctx, form }: { ctx: PageContext; form: FormState } = $props();
	const principal = $derived(numberOf(form.get('quantity')) ?? 0);
	const period = $derived.by(() => {
		const value = form.get('repayment_period');
		if (value === null || typeof value !== 'object') return null;
		const from = Reflect.get(value, 'from');
		const to = Reflect.get(value, 'to');
		return typeof from === 'string' && typeof to === 'string' ? { from, to } : null;
	});
	const plan = $derived.by(() => {
		if (principal <= 0 || period === null) return null;
		try {
			return buildLoanSchedule({
				principal,
				from: period.from,
				to: period.to,
				repayments: []
			});
		} catch {
			return null;
		}
	});
</script>

<Stack gap="md">
	<div class="grid gap-3 sm:grid-cols-2">
		<Field {ctx} name="employment_id" />
		<Field {ctx} name="catalog_id" />
		<Field {ctx} name="quantity" />
		<Field {ctx} name="repayment_period" />
		<Field {ctx} name="evidence_file" />
	</div>
	{#if plan !== null && plan.create.length > 0}<div class="rounded-lg border">
			<div class="flex items-center justify-between border-b px-3 py-2">
				<span class="text-sm font-medium">{ctx.t('loan.repayments')}</span>
				<span class="text-xs text-muted-foreground">{plan.create.length} ×</span>
			</div>
			<div class="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-sm sm:grid-cols-3">
				{#each plan.create as row (row.paid_on)}<span class="text-muted-foreground"
						>{row.paid_on}</span
					><span class="tabular-nums">{row.amount}</span>{/each}
			</div>
		</div>{/if}
</Stack>

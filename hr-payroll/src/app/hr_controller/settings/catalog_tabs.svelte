<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { highlighted_line, Table, Tabs } from '@norbital-ai/ui';

	let {
		ctx,
		versionId,
		draft
	}: {
		ctx: PageContext;
		versionId: Id<'jurisdiction_settings'>;
		draft: boolean;
	} = $props();

	const families = [
		'allowance_catalog',
		'overtime_catalog',
		'statutory_contribution_catalog',
		'leave_catalog',
		'claim_catalog',
		'adhoc_catalog',
		'loan_catalog',
		'workplace_case_catalog',
		'work_event_catalog'
	] as const;
	const labels: Record<(typeof families)[number], string> = {
		allowance_catalog: 'Allowances',
		overtime_catalog: 'Overtime and work',
		statutory_contribution_catalog: 'Statutory contributions',
		leave_catalog: 'Leave',
		claim_catalog: 'Claims',
		adhoc_catalog: 'Ad hoc',
		loan_catalog: 'Loans',
		workplace_case_catalog: 'Workplace cases',
		work_event_catalog: 'Work events'
	};
	/** What each family configures, so the table is readable without opening a row. */
	const descriptions: Record<(typeof families)[number], string> = {
		allowance_catalog:
			'Recurring contractual additions. Each row states who is eligible, how the amount is calculated (a prorated amount reads the share of the period paid) and whether it counts toward the ordinary rate.',
		overtime_catalog:
			'Work-pattern pricing. Each row states eligibility, the paid multiplier or amount and whether the line adds or deducts.',
		statutory_contribution_catalog:
			'Statutory schemes and their employee and employer amounts, dependencies and balance windows. The engine posts each scheme once per period.',
		leave_catalog:
			'Leave and absence rules. Each row states eligibility, what the leave is worth (empty: a normal paid day; 0: no pay) and the subtotal that receives the difference.',
		claim_catalog:
			'Employee claims and reimbursements. Each row states eligibility and what the claim reimburses.',
		adhoc_catalog:
			'One-off payments and deductions. Each row states eligibility, the amount, whether an off-cycle run may pay it and whether the line adds or deducts.',
		loan_catalog:
			'Loan and salary-advance types. Each row states who may be given the loan (checked when the loan is recorded) and the subtotal its repayments are deducted at.',
		workplace_case_catalog:
			'Workplace cases such as accidents, harassment or data breaches. Each row declares the events and the lookup that drives the case workflow.',
		work_event_catalog:
			'Event types such as a heat period, hurricane or epidemic. A work event references this row directly; the row itself is the type, with no separate category enum.'
	};
	let selected = $state<(typeof families)[number]>('allowance_catalog');
	const firstLine = (value: unknown): string =>
		String(value ?? '')
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line !== '' && line !== '// js' && !line.startsWith('//')) ?? '';
</script>

{#snippet codeCell({ value }: { value: unknown })}
	<code
		class="bg-muted block max-w-[18rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-xs"
		data-cel
		>{#each highlighted_line(firstLine(value)) as token, i (i)}<span
				class={token.class || undefined}>{token.text}</span
			>{/each}</code
	>
{/snippet}

{#snippet jsonCell({ value }: { value: unknown })}
	<span class="block max-w-[18rem] truncate font-mono text-xs text-muted-foreground"
		>{firstLine(JSON.stringify(value ?? {}))}</span
	>
{/snippet}

{#snippet catalog()}
	<section class="min-w-0 space-y-3">
		<p class="max-w-4xl text-sm text-muted-foreground">{descriptions[selected]}</p>
		{#if selected === 'allowance_catalog'}<Table
				{ctx}
				of="allowance_catalog"
				key="allowance_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.allowance_catalog }}
				columns={[
					'code',
					'description',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id'
				]}
			/>
		{:else if selected === 'overtime_catalog'}<Table
				{ctx}
				of="overtime_catalog"
				key="overtime_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.overtime_catalog }}
				columns={[
					'code',
					'description',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id',
					'direction'
				]}
			/>
		{:else if selected === 'statutory_contribution_catalog'}<Table
				{ctx}
				of="statutory_contribution_catalog"
				key="statutory_contribution_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.statutory_contribution_catalog }}
				columns={[
					'code',
					'description',
					'kind',
					'depends_on',
					{ field: 'employee_amount', cell: codeCell },
					{ field: 'employer_amount', cell: codeCell },
					'subtotal_id',
					'employer_cost_subtotal_id'
				]}
			/>
		{:else if selected === 'leave_catalog'}<Table
				{ctx}
				of="leave_catalog"
				key="leave_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.leave_catalog }}
				columns={[
					'code',
					'description',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'paid_share', cell: codeCell },
					{ field: 'payout', cell: codeCell },
					'subtotal_id'
				]}
			/>
		{:else if selected === 'claim_catalog'}<Table
				{ctx}
				of="claim_catalog"
				key="claim_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.claim_catalog }}
				columns={[
					'code',
					'description',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id'
				]}
			/>
		{:else if selected === 'adhoc_catalog'}<Table
				{ctx}
				of="adhoc_catalog"
				key="adhoc_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.adhoc_catalog }}
				columns={[
					'code',
					'description',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id',
					'direction',
					'party'
				]}
			/>
		{:else if selected === 'loan_catalog'}<Table
				{ctx}
				of="loan_catalog"
				key="loan_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.loan_catalog }}
				columns={['code', 'description', { field: 'eligibility', cell: codeCell }, 'subtotal_id']}
			/>
		{:else if selected === 'workplace_case_catalog'}<Table
				{ctx}
				of="workplace_case_catalog"
				key="workplace_case_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.workplace_case_catalog }}
				columns={['code', 'description', 'events', { field: 'lookup', cell: jsonCell }]}
			/>
		{:else}<Table
				{ctx}
				of="work_event_catalog"
				key="work_event_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.work_event_catalog }}
				columns={['code', 'description', { field: 'lookup', cell: jsonCell }]}
			/>{/if}
	</section>
{/snippet}

<Tabs
	orientation="vertical"
	class="min-h-[34rem]"
	tabs={families.map((name) => ({ name, title: labels[name], body: catalog }))}
	value={selected}
	on_value_change={(next) => {
		selected = families.find((family) => family === next) ?? selected;
	}}
/>

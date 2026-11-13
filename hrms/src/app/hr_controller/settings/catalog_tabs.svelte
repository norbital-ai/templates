<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Tabs } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { Law } from '../../../lib/law.js';
	import { LAW_FAMILY_LABEL, type LawRowTarget } from '../../../lib/ui/settings/law_row.svelte';
	import LawTable from '../../../lib/ui/settings/law_table.svelte';

	let {
		ctx,
		law,
		on_open
	}: {
		ctx: PageContext;
		law: Law;
		on_open: (target: LawRowTarget) => void;
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
	type Family = (typeof families)[number];
	/** What each family configures, so the table is readable without opening a row. */
	const descriptions: Record<Family, string> = {
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
			'Event types such as a heat period, hurricane or epidemic. A work event names this row by its code; the row itself is the type, with no separate category enum.'
	};
	const code = (field: string) => ({ field, as: 'code' }) as const;
	const json = (field: string) => ({ field, as: 'json' }) as const;
	const columns: Record<Family, readonly (string | ReturnType<typeof code | typeof json>)[]> = {
		allowance_catalog: ['code', 'description', code('eligibility'), code('conversion'), 'subtotal'],
		overtime_catalog: [
			'code',
			'description',
			code('eligibility'),
			code('conversion'),
			'subtotal',
			'direction'
		],
		statutory_contribution_catalog: [
			'code',
			'description',
			'kind',
			'depends_on',
			code('employee_amount'),
			code('employer_amount'),
			'subtotal',
			'employer_cost_subtotal'
		],
		leave_catalog: [
			'code',
			'description',
			code('eligibility'),
			code('paid_share'),
			code('payout'),
			'subtotal'
		],
		claim_catalog: ['code', 'description', code('eligibility'), code('conversion'), 'subtotal'],
		adhoc_catalog: [
			'code',
			'description',
			code('eligibility'),
			code('conversion'),
			'subtotal',
			'direction',
			'party'
		],
		loan_catalog: ['code', 'description', code('eligibility'), 'subtotal'],
		workplace_case_catalog: ['code', 'description', json('events'), json('lookup')],
		work_event_catalog: ['code', 'description', json('lookup')]
	};
	let selected = $state<Family>('allowance_catalog');
</script>

{#snippet catalog()}
	<Stack size="fill" gap="sm">
		<p class="max-w-4xl text-sm text-muted-foreground">{descriptions[selected]}</p>
		{#key selected}
			<LawTable
				{ctx}
				name={selected}
				title={LAW_FAMILY_LABEL[selected]}
				rows={law.rows[selected]}
				columns={columns[selected]}
				on_open={(row) => on_open({ family: selected, code: row })}
				on_new={() => on_open({ family: selected, code: null })}
			/>
		{/key}
	</Stack>
{/snippet}

<Tabs
	orientation="vertical"
	tabs={families.map((name) => ({ name, title: LAW_FAMILY_LABEL[name], body: catalog }))}
	value={selected}
	on_value_change={(next) => {
		selected = families.find((family) => family === next) ?? selected;
	}}
/>

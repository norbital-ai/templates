<script lang="ts">
	/** A person's dependants, as a table. A row opens its own record. */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Form, RecordShell, Sheet, Table } from '@norbital-ai/ui';
	import { paidPeriods } from '../payroll/paid_period.svelte.js';

	let { ctx, person }: { ctx: PageContext; person: Id<'employee_profile'> } = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const paid = paidPeriods(ctx);
	let adding = $state(false);
</script>

<Table
	{ctx}
	of="dependant"
	key="person-family"
	where={{ employee_id: { eq: person } }}
	toolbar={{ title: false, new: () => (adding = true) }}
	columns={['name', 'relation', 'born_on', 'expected_on', 'has_income', 'disabled', 'studying']}
/>

<Sheet bind:open={adding} title={t('person.add_dependant')}>
	<RecordShell
		{ctx}
		of="dependant"
		mode="create"
		on_done={(outcome) => {
			if (outcome.kind === 'committed') adding = false;
		}}
	>
		<Form
			{ctx}
			of="dependant"
			mode="create"
			values={{ employee_id: person }}
			confirm={paid.confirm(() => false, ['born_on', 'expected_on'])}
		/>
	</RecordShell>
</Sheet>

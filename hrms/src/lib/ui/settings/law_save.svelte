<script lang="ts">
	/**
	 * How an edit of the law is written. A law is its changes, so an edit is either a new change with its date of effect,
	 * or a correction of the changes that set the edited values. Without `always` bound, it is the date alone.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, Editor, Label } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';

	let {
		ctx,
		id,
		always = $bindable(false),
		choose = false,
		date = $bindable()
	}: {
		ctx: PageContext;
		/** The date input's id: one for each place it is asked. */
		id: string;
		always?: boolean;
		/** Offers the correction as well as the new change. */
		choose?: boolean;
		/** The new change's date of effect. */
		date: string;
	} = $props();
</script>

<Stack gap="xs">
	{#if choose}
		<Combobox
			aria-label={ctx.t('law_save.title')}
			options={[
				{ value: 'from', label: ctx.t('law_save.from_date') },
				{ value: 'always', label: ctx.t('law_save.always') }
			]}
			value={always ? 'always' : 'from'}
			on_change={(next) => (always = next === 'always')}
		/>
	{/if}
	{#if !always}
		<Label for={id}>{ctx.t('law_save.date')}</Label>
		<Editor
			{ctx}
			{id}
			name="effective_from"
			kind={{ kind: 'date' }}
			value={date}
			on_change={(next) => next != null && (date = String(next))}
		/>
	{/if}
</Stack>

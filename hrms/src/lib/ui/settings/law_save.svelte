<script lang="ts">
	/** Every save of the law asks one question: was it always so, or does it change from a date? */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, Editor, Label } from '@norbital-ai/ui';

	let {
		ctx,
		id,
		always = $bindable(),
		date = $bindable()
	}: {
		ctx: PageContext;
		/** The date input's id: one for each place the question is asked. */
		id: string;
		always: boolean;
		/** The day it changes from. */
		date: string;
	} = $props();
</script>

<Combobox
	aria-label={ctx.t('law_save.title')}
	options={[
		{ value: 'from', label: ctx.t('law_save.from_date') },
		{ value: 'always', label: ctx.t('law_save.always') }
	]}
	value={always ? 'always' : 'from'}
	on_change={(next) => (always = next === 'always')}
/>{#if !always}<Label for={id}>{ctx.t('law_save.date')}</Label><Editor
		{ctx}
		{id}
		name="effective_from"
		kind={{ kind: 'date' }}
		value={date}
		on_change={(next) => next != null && (date = String(next))}
	/>{/if}

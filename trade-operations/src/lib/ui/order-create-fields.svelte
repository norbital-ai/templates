<script lang="ts">
	import { Field, Picker, TimeRangeInput, type FormState, type FieldEditor } from '@norbital-ai/ui';
	import { Schema } from 'effect';
	import { Grid } from '@norbital-ai/ui/layout';
	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	let {
		form,
		scoped = false
	}: {
		form: FormState;
		scoped?: boolean;
	} = $props();
</script>

{#snippet party(field: FieldEditor)}
	<Picker
		of="parties"
		id={field.id}
		value={form.id<'parties'>('party')}
		where={{ active: { eq: true }, kind: { in: ['customer', 'both'] } }}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
		onChange={field.onChange}
	/>
{/snippet}
<Grid gap="md" minimum="compact">
	{#each ['title', ...(!scoped ? ['party'] : []), 'owner', 'warehouse', 'ordered_on', 'currency', 'tax_inclusive', 'payment_terms', 'delivery_terms', 'notes'] as name}<Field
			{name}
			{...name === 'party' ? { editor: party } : {}}
		/>{/each}
	<Field name="valid_from"
		>{#snippet editor(field)}
			<TimeRangeInput
				id={field.id}
				of="date"
				precision="day"
				value={{ from: form.get('valid_from'), to: form.get('valid_until') }}
				onChange={(r) => {
					if (Schema.is(DateBounds)(r)) {
						form.set('valid_from', r.from ?? null);
						form.set('valid_until', r.to ?? null);
					}
				}}
			/>
		{/snippet}</Field
	>
</Grid>

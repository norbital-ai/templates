<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Picker, type FieldEditor } from '@norbital-ai/ui';

	/** An entry's catalogue field: its picker lists only the catalogue rows of the law version in force. */
	let {
		ctx,
		of
	}: {
		ctx: PageContext;
		of:
			| 'adhoc_catalog'
			| 'claim_catalog'
			| 'leave_catalog'
			| 'loan_catalog'
			| 'work_event_catalog'
			| 'workplace_case_catalog';
	} = $props();
	const clock = ctx.clock('day');
	const versions = ctx.query({
		jurisdiction_settings: {
			where: { status: { eq: 'SEALED' } },
			fields: ['id', 'effective_range'],
			limit: 1000
		}
	});
	// the version covering today, else the newest; none sealed leaves the choices unscoped
	const versionId = $derived.by(() => {
		const rows = versions.current?.jurisdiction_settings.rows ?? [];
		const covering = rows.find(
			(row) =>
				row.effective_range.from <= clock.today &&
				(row.effective_range.to === null || clock.today <= row.effective_range.to)
		);
		const newest = rows.toSorted((left, right) =>
			right.effective_range.from.localeCompare(left.effective_range.from)
		)[0];
		return (covering ?? newest)?.id ?? null;
	});
</script>

{#snippet picker(field: FieldEditor)}<Picker
		{ctx}
		{of}
		id={field.id}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		{...versionId === null ? {} : { where: { settings_id: { eq: versionId } } }}
		on_change={(next) => field.on_change(next)}
	/>{/snippet}

<Field {ctx} name="catalog_id" editor={picker} />

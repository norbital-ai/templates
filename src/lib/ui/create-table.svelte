<script lang="ts" generics="C extends ModelName">
	import type { Snippet } from 'svelte';
	import type { ModelName } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import {
		Table as NativeTable,
		Button,
		Dialog,
		Form as NativeForm,
		singular,
		useKinds,
		type TableProps,
		type RowIn,
		type ColumnsIn,
		type FormProps,
		type FormState
	} from '@norbital-ai/ui';
	import { Stack, Scroll } from '@norbital-ai/ui/layout';
	const Table = NativeTable<C>;
	const Form = NativeForm<C>;
	let {
		createFields,
		createForm,
		createValues,
		allowCreate = true,
		...props
	}: TableProps<C, RowIn<C>, ColumnsIn<C>> & {
		createFields?: FormProps<C>['fields'];
		createForm?: Snippet<[FormState]>;
		createValues?: FormProps<C>['values'];
		allowCreate?: boolean;
	} = $props();
	const kinds = useKinds();
	let open = $state(false);
	const canCreate = $derived(
		allowCreate &&
			props.toolbar !== false &&
			props.toolbar?.new !== false &&
			kinds.catalog?.[props.of]?.create !== undefined
	);
	const config = $derived(props.toolbar === false ? {} : (props.toolbar ?? {}));
</script>

{#snippet controls()}
	{#if config.controls}{@render config.controls()}{/if}
	{#if canCreate}<Button data-view-new="true" onclick={() => (open = true)}
			>+ {singular(bolt, props.of)}</Button
		>{/if}
{/snippet}
<Stack class="create-table min-h-0 flex-1" data-model={props.of}>
	<Table {...props} toolbar={{ ...config, new: false, controls }} />
</Stack>
<Dialog.Root bind:open
	><Dialog.Content class="sm:max-w-2xl"
		><Dialog.Title>{singular(bolt, props.of)}</Dialog.Title><Scroll
			name={'create-' + props.of}
			max="tall"
			><Form
				of={props.of}
				mode="create"
				{...createForm ? { children: createForm } : {}}
				{...createFields ? { fields: createFields } : {}}
				{...createValues ? { values: createValues } : {}}
				onOutcome={(outcome) => {
					if (outcome.kind === 'committed') open = false;
				}}
			/></Scroll
		></Dialog.Content
	></Dialog.Root
>

<style>
	:global(.create-table [data-view-controls]) {
		order: 10;
		margin-left: auto;
	}
</style>

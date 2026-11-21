<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, type UiContext } from '@norbital-ai/ui';
	import { Inline } from '@norbital-ai/ui/layout';
	import RecordEditor, {
		number,
		optionalText,
		text,
		type Value
	} from '../../../lib/record-editor.svelte';

	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'bim_pin'>;
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
	} = $props();

	const t = (key: Parameters<PageContext['t']>[0], vars?: Record<string, string | number>) =>
		ctx.t?.(key, vars) ?? key;

	function change(next: Value | null): void {
		if (view.mode !== 'edit') return;
		if (!next) {
			view.on_change(null);
			return;
		}
		const expressId = number(next['express_id']);
		if (expressId === null) return;
		view.on_change({
			express_id: Math.trunc(expressId),
			element_name: text(next['element_name']),
			global_id: optionalText(next['global_id']),
			x: number(next['x']),
			y: number(next['y']),
			z: number(next['z']),
			camera_x: number(next['camera_x']),
			camera_y: number(next['camera_y']),
			camera_z: number(next['camera_z'])
		});
	}
</script>

{#if view.mode === 'show'}
	{#if view.value}
		<Inline gap="xs" class="flex-wrap text-sm">
			<Badge variant="outline">{`#${view.value.express_id}`}</Badge>
			<span class="font-medium">{view.value.element_name}</span>
			{#if view.value.x != null && view.value.y != null && view.value.z != null}
				<span class="text-micro tabular-nums text-muted-foreground">
					{t('bim.pin_coords', { x: view.value.x, y: view.value.y, z: view.value.z })}
				</span>
			{/if}
		</Inline>
	{:else}
		<span class="text-sm text-muted-foreground">{t('bim.unpinned_issue')}</span>
	{/if}
{:else}
	<RecordEditor
		value={view.value
			? {
					express_id: view.value.express_id,
					element_name: view.value.element_name,
					global_id: view.value.global_id ?? null,
					x: view.value.x ?? null,
					y: view.value.y ?? null,
					z: view.value.z ?? null,
					camera_x: view.value.camera_x ?? null,
					camera_y: view.value.camera_y ?? null,
					camera_z: view.value.camera_z ?? null
				}
			: null}
		disabled={view.disabled}
		on_change={change}
		parts={[
			{ key: 'express_id', label: t('bim.express_id'), type: 'number' },
			{ key: 'element_name', label: t('bim.element_name') },
			{ key: 'global_id', label: t('bim.global_id'), optional: true },
			{ key: 'x', label: 'X', type: 'number', optional: true },
			{ key: 'y', label: 'Y', type: 'number', optional: true },
			{ key: 'z', label: 'Z', type: 'number', optional: true },
			{ key: 'camera_x', label: t('bim.camera_x'), type: 'number', optional: true },
			{ key: 'camera_y', label: t('bim.camera_y'), type: 'number', optional: true },
			{ key: 'camera_z', label: t('bim.camera_z'), type: 'number', optional: true }
		]}
	/>
{/if}

<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Icon } from '@norbital-ai/ui';
	import { Inline, Stack, Surface } from '@norbital-ai/ui/layout';
	import {
		kingdeeIntegrationRead,
		workspaceKingdeeSummary,
		type KingdeeInstance
	} from '../../integration/kingdee/connection-status.js';

	let {
		ctx,
		instances
	}: {
		ctx: PageContext;
		/** Optional pre-queried Kingdee instances; when omitted, queries `sys_integration` if permitted. */
		instances?: readonly KingdeeInstance[] | null;
	} = $props();

	const ownQuery = $derived(
		instances === undefined && ctx.catalog?.sys_integration
			? ctx.query(kingdeeIntegrationRead)
			: null
	);
	const rows = $derived(
		instances !== undefined ? instances : (ownQuery?.current?.sys_integration.rows ?? null)
	);
	const summary = $derived(rows === null ? null : workspaceKingdeeSummary(rows));
	const isAdmin = $derived(ctx.actor?.kind === 'member' && ctx.actor.admin);
	const visible = $derived(
		summary !== null && (summary.state !== 'connected' || summary.attention)
	);
	const danger = $derived(
		summary !== null && (summary.state === 'connection_error' || summary.attention)
	);
	const icon = $derived(
		danger
			? 'lucide:triangle-alert'
			: summary?.state === 'not_configured'
				? 'lucide:plug-zap'
				: 'lucide:unplug'
	);
	const title = $derived(
		!summary
			? ''
			: summary.state === 'not_configured'
				? ctx.t('component.kingdee_not_configured')
				: summary.state === 'off'
					? ctx.t('component.kingdee_off')
					: ctx.t('component.kingdee_connection_error')
	);
	const detail = $derived(
		!summary
			? ''
			: summary.state === 'not_configured'
				? ctx.t(
						isAdmin
							? 'component.kingdee_not_configured_admin_hint'
							: 'component.kingdee_not_configured_hint'
					)
				: summary.state === 'off'
					? ctx.t('component.kingdee_off_hint')
					: (summary.detail ?? ctx.t('component.kingdee_attention_hint'))
	);
</script>

{#if visible}
	<Surface tone="subtle" padding="sm" radius="control" role={danger ? 'alert' : 'status'}>
		<Inline align="start" gap="sm">
			<span class={danger ? 'mt-0.5 text-destructive' : 'mt-0.5 text-muted-foreground'}>
				<Icon name={icon} class="size-4" />
			</span>
			<Stack gap="none">
				<span class={danger ? 'text-sm font-medium text-destructive' : 'text-sm font-medium'}>
					{title}
				</span>
				<span class="text-xs text-muted-foreground">{detail}</span>
			</Stack>
		</Inline>
	</Surface>
{/if}

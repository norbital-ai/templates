<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Form, RecordShell } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const me = ctx.actor?.kind === 'member' ? ctx.actor.id : null;
	const profiles = me
		? ctx.query({
				user_profiles: { where: { user_id: { eq: me } }, fields: ['id'], limit: 1 },
				sys_user: { where: { id: { eq: me } }, fields: ['name'], limit: 1 }
			})
		: null;
	const profile = $derived(
		profiles?.current === undefined ? undefined : (profiles.current.user_profiles.rows[0] ?? null)
	);
	const memberName = $derived(profiles?.current?.sys_user.rows[0]?.name ?? '');
	const fields = [
		'name',
		'kingdee_employee_id',
		'kingdee_department_id',
		'kingdee_biller_id',
		'kingdee_customer_id',
		'phone',
		'notes'
	] as const;
</script>

<AppShell
	icon="lucide:id-card"
	title={t('app.profile.title')}
	description={t('app.profile.description')}
	variant="full"
>
	{#if !me}
		<EmptyState size="fill" icon="lock" title={t('component.profile_members_only')} />
	{:else if profile !== undefined}
		{#key profile?.id}
			{#if profile}
				<RecordShell {ctx} of="user_profiles" id={profile.id}>
					<Form {ctx} of="user_profiles" mode="update" id={profile.id} {fields} />
				</RecordShell>
			{:else}
				<RecordShell {ctx} of="user_profiles" mode="create" on_done={() => {}}>
					<Form
						{ctx}
						of="user_profiles"
						mode="create"
						values={{ user_id: me, ...(memberName ? { name: memberName } : {}) }}
						{fields}
						submit={t('component.profile_save')}
					/>
				</RecordShell>
			{/if}
		{/key}
	{/if}
</AppShell>

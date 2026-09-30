<script lang="ts">
	/**
	 * The public booking page: no account needed. The visitor picks a service and a time and leaves their details; the
	 * workspace books it when a helper is free then and emails the confirmation, or the desk replies with a time.
	 */
	import { bolt } from '$bolt';
	import { AppShell, Center, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Button, Field, Form, Label } from '@norbital-ai/ui';

	const t = bolt.t;
	let sent = $state(false);
	/** A fresh form after each request, so a second one starts empty. */
	let round = $state(0);
</script>

<AppShell
	icon="lucide:calendar-heart"
	title={t('app.portal.title')}
	description={t('app.portal.description')}
>
	<Center measure="narrow">
		<Stack gap="lg">
			<!-- a signed-out visit to the customer's app shows the sign-in card, and returns there -->
			<a class="text-sm underline underline-offset-4" href="../my_visits/visits"
				>{t('app.portal.have_account')}</a
			>
			{#if sent}
				<Stack gap="md" align="center">
					<p class="text-title">{t('app.portal.thanks_title')}</p>
					<p class="text-center text-sm text-muted-foreground">{t('app.portal.thanks_body')}</p>
					<Button variant="outline" onclick={() => ((sent = false), (round += 1))}
						>{t('app.portal.another')}</Button
					>
				</Stack>
			{:else}
				{#key round}
					<Form
						of="booking_requests"
						mode="create"
						submit={t('app.portal.submit')}
						onOutcome={(o) => {
							if (o.kind === 'committed') sent = true;
						}}
					>
						<Stack gap="lg">
							<Stack gap="sm">
								<Label>{t('app.portal.section_service')}</Label>
								<Grid minimum="card">
									<Field name="service" />
									<Field name="start" />
									<Field name="repeat" />
								</Grid>
							</Stack>
							<Stack gap="sm">
								<Label>{t('app.portal.section_where')}</Label>
								<Field name="address" />
								<Field name="area" />
							</Stack>
							<Stack gap="sm">
								<Label>{t('app.portal.section_you')}</Label>
								<Grid minimum="card">
									<Field name="name" />
									<Field name="email" />
									<Field name="phone" />
								</Grid>
								<Field name="notes" />
							</Stack>
						</Stack>
					</Form>
				{/key}
			{/if}
		</Stack>
	</Center>
</AppShell>

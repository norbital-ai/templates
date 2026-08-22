import type { Policy } from './$types.js';

/**
 * A sales representative: their own pipeline, and the shared reference data behind it.
 *
 * Declared here rather than seeded so the permission set ships with the workspace — a fresh database
 * has it, and changing it shows up in a diff.
 *
 * Quote reads and edits are scoped to the requestor. `${requestor.id}` is bound at
 * evaluation time against the request scope, so a rep reads *their* quotes rather than every quote
 * that has an owner. The column is typed against the collection's row, so renaming `owner_id` breaks
 * this file rather than silently matching nothing.
 */
export default {
	description:
		'Owns their own quotes and activities; reads shared accounts, contacts, and the product catalogue.',
	capabilities: { apps: ['crm'] },
	grants: [
		{ collection: 'accounts', action: 'read' },
		{ collection: 'contacts', action: 'read' },
		{ collection: 'products', action: 'read' },

		{
			collection: 'quotes',
			action: 'read',
			where: { owner_id: { eq: '${requestor.id}' } }
		},
		{ collection: 'quotes', action: 'create' },
		{
			collection: 'quotes',
			action: 'update',
			where: { owner_id: { eq: '${requestor.id}' } }
		},

		// Lines carry no owner of their own, so they are granted unscoped, matching how the
		// document — the thing the requestor is narrowed to — is the unit of ownership.
		{ collection: 'quote_lines', action: 'read' },
		{ collection: 'quote_lines', action: 'create' },
		{ collection: 'quote_lines', action: 'update' },
		{ collection: 'quote_lines', action: 'delete' },

		{ collection: 'activities', action: 'read' },
		{ collection: 'activities', action: 'create' },

		{
			collection: 'sales_invoices',
			action: 'read',
			where: { owner_id: { eq: '${requestor.id}' } }
		},
		{ collection: 'sales_invoices', action: 'create' },
		{
			collection: 'sales_invoices',
			action: 'update',
			where: { owner_id: { eq: '${requestor.id}' } }
		},

		// Invoice lines carry no owner of their own, so they are granted unscoped, matching how
		// the document — the thing the requestor is narrowed to — is the unit of ownership.
		{ collection: 'sales_invoice_lines', action: 'read' },
		{ collection: 'sales_invoice_lines', action: 'create' },
		{ collection: 'sales_invoice_lines', action: 'update' },
		{ collection: 'sales_invoice_lines', action: 'delete' },

		{
			collection: 'contract_signings',
			action: 'read',
			where: { owner_id: { eq: '${requestor.id}' } }
		},
		{ collection: 'contract_signings', action: 'create' },
		{
			collection: 'contract_signings',
			action: 'update',
			where: { owner_id: { eq: '${requestor.id}' } }
		},

		{ collection: 'settlements', action: 'read' },
		{ collection: 'settlements', action: 'create' }
	],
	/**
	 * What a holder of this policy may spend.
	 *
	 * Declared here rather than in a workspace-wide file, because a rate limit is only meaningful in
	 * terms of who is spending it: `collections.*` is authenticated and cheap, `agents.turn` is
	 * authenticated and costs money at a model provider. Two classes of person holding two policies
	 * can now be given two budgets for the same command, which one file for everybody could not say.
	 */
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 100, key: 'subject' },
		/**
		 * The two caps `+sales_desk` used to carry, said once each in the vocabulary every other limit
		 * is written in.
		 *
		 * `sender` gives each outside sender their own bucket — that was `perSenderPerMinute`. `subject`
		 * bounds the desk as a whole, because an envoy is one subject and every sender therefore counts
		 * against the same key — that was `totalPerMinute`. Neither rule matches a human holding this
		 * policy in the web app: a person has no `sender`, and their `agents.turn` budget above is the
		 * one that applies to them.
		 *
		 * A public envoy is reachable by anyone who can message the transport, so these are the only
		 * thing between that and an unbounded number of agent turns billed to this workspace.
		 */
		'envoys.receive': [
			{ window: '1 min', limit: 8, key: 'sender' },
			{ window: '1 min', limit: 300, key: 'subject' }
		]
	}
} satisfies Policy;

import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Keeps approved research identity and evidence immutable; changing a source requires a new approval, while revocation retains its history.',
				handler: ({ input, existing }) => {
					const raw = input.url ?? existing?.url;
					if (raw == null || !URL.canParse(raw))
						refuse('Research source requires a valid HTTPS URL.');
					const url = new URL(raw);
					if (url.protocol !== 'https:' || url.username || url.password || url.port)
						refuse('Research source requires HTTPS without credentials or a custom port.');
					url.hash = '';
					const code = (input.jurisdiction_code ?? existing?.jurisdiction_code ?? '')
						.trim()
						.toUpperCase();
					if (!/^[A-Z][A-Z0-9_-]{1,11}$/.test(code))
						refuse('Research source requires a jurisdiction code.');
					if (existing != null) {
						for (const key of [
							'jurisdiction_code',
							'title',
							'url',
							'rationale',
							'discovered_from',
							'excerpt',
							'source_sha256',
							'retrieved_at'
						] as const) {
							if (key in input && JSON.stringify(input[key]) !== JSON.stringify(existing[key]))
								refuse(
									'Approved source identity and evidence cannot change. Revoke it and propose a new source.'
								);
						}
					}
					if (existing != null) return input;
					if (!input.title?.trim() || !input.rationale?.trim())
						refuse('State the source title and why it should be trusted.');
					return { ...input, jurisdiction_code: code, url: url.href };
				}
			}
		}
	}
} satisfies Hooks;

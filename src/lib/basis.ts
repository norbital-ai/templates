const point = {
	kind: 'object',
	fields: { lat: { kind: 'number' }, lng: { kind: 'number' } },
	optional: true
} as const;
const identity = { kind: 'text' } as const;
const nullableText = { kind: 'text', optional: true } as const;
const texts = { kind: 'list', of: { kind: 'text' } } as const;
/** The stored evidence language, shared by inference reviews and findings. */
const REVIEW_BASIS_FIELDS = {
	assignment: {
		kind: 'object',
		fields: {
			id: identity,
			site_id: identity,
			title: identity,
			nature: nullableText,
			scheduled_for: identity,
			description: identity,
			status: identity,
			summary: nullableText,
			location: point
		}
	},
	job: {
		kind: 'object',
		fields: {
			id: identity,
			title: identity,
			nature: nullableText,
			scheduled_for: identity,
			description: identity
		}
	},
	site: {
		kind: 'object',
		optional: true,
		fields: { id: identity, name: identity, location: point, house_type: nullableText }
	},
	photos: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				id: identity,
				file_id: identity,
				sha256: identity,
				flags: texts,
				matched_evidence_ids: texts,
				created_at: nullableText
			}
		}
	},
	candidates: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				id: identity,
				file_id: identity,
				sha256: identity,
				flags: texts,
				distance: { kind: 'number' },
				matched_photo_ids: texts
			}
		}
	},
	communications: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				source_message_id: identity,
				sender: identity,
				sent_at: identity,
				message: identity
			}
		}
	}
} as const;
export const REVIEW_BASIS = {
	kind: 'union',
	by: 'kind',
	arms: { review: REVIEW_BASIS_FIELDS }
} as const;
export const SUSPICION_BASIS = {
	kind: 'union',
	by: 'kind',
	arms: {
		review: REVIEW_BASIS_FIELDS,
		human_judgement: { reason: identity, evidence_id: nullableText }
	}
} as const;

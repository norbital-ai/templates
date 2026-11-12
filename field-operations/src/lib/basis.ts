import photos from '../data/model/sites/job_assignments/photo_evidence/+model.js';
import sites from '../data/model/sites/+model.js';
const point = {
	kind: 'object',
	fields: { lat: { kind: 'number' }, lng: { kind: 'number' } },
	optional: true
} as const;
const identity = { kind: 'text' } as const;
const nullableText = { kind: 'text', optional: true } as const;
const texts = { kind: 'text', many: true } as const;
const photo = { kind: 'ref', to: 'photo_evidence' } as const;
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
		fields: {
			id: identity,
			name: identity,
			location: point,
			house_type: sites.spec.fields.house_type
		}
	},
	photos: {
		kind: 'object',
		many: true,
		fields: {
			id: identity,
			file_id: identity,
			sha256: identity,
			flags: photos.spec.fields.flags,
			matched_evidence_ids: texts,
			created_at: nullableText
		}
	},
	candidates: {
		kind: 'object',
		many: true,
		fields: {
			id: photo,
			file_id: identity,
			sha256: identity,
			flags: photos.spec.fields.flags,
			distance: { kind: 'number' },
			matched_photo_ids: { ...photo, many: true }
		}
	},
	communications: {
		kind: 'object',
		many: true,
		fields: {
			source_message_id: identity,
			sender: identity,
			sent_at: identity,
			message: identity
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

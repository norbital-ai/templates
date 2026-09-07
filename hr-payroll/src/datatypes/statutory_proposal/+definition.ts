import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * What the statutory drift automation found, recorded on the draft version it proposed.
 *
 * One entry per changed row: which child collection, which code, which field, the sealed value
 * and the value the official page states, and the provenance HR reviews it by (the page, the
 * quote the model gave, when the page was read and the digest of what was read). The draft's own
 * rows already carry the proposed values; this is the review sheet beside them. Beside the
 * changes it lists every official source the automation could not read, with the reason, so HR
 * reviews the proposal knowing which pages it does not stand on. Nothing reads it back into the
 * engine.
 */
export const unreachableSourceSchema = Schema.Struct({
	/** The research URL as the version names it. */
	url: Schema.NonEmptyString,
	/** One sentence from the page reader: DNS, connect, HTTP status, byte limit, timeout. */
	reason: Schema.NonEmptyString,
	/** When the read was attempted. */
	retrieved_at: Schema.String
});

export const statutoryProposalChangeSchema = Schema.Struct({
	collection: Schema.Literals(['contribution_rates', 'leave_catalogue', 'component_catalogue']),
	/** The scheme, leave or component code the change belongs to. */
	code: Schema.NonEmptyString,
	field: Schema.Literals(['bands', 'entitlement', 'contribution_treatments']),
	previous: Schema.Unknown,
	proposed: Schema.Unknown,
	source_url: Schema.NonEmptyString,
	quote: Schema.NonEmptyString,
	retrieved_at: Schema.String,
	sha256: Schema.String
});

export const statutoryProposalValueSchema = Schema.Struct({
	proposed_by: Schema.Literal('statutory_drift'),
	run_id: Schema.String,
	proposed_at: Schema.String,
	/** The sealed version the draft was cloned from and diffed against. */
	source_version_id: Schema.String,
	changes: Schema.Array(statutoryProposalChangeSchema),
	/** Findings that did not become a change: an unknown code, an unverifiable quote. */
	notes: Schema.Array(Schema.String),
	/** The research URLs that could not be read in this run; the proposal stands on the others. */
	unreachable: Schema.Array(unreachableSourceSchema)
});

export type StatutoryProposal = Schema.Schema.Type<typeof statutoryProposalValueSchema>;
export type StatutoryProposalChange = Schema.Schema.Type<typeof statutoryProposalChangeSchema>;
export type UnreachableSource = Schema.Schema.Type<typeof unreachableSourceSchema>;

/** Whether a root's `research_notes` is a drift proposal; the Settings timeline badges it. */
export const isStatutoryProposal = Schema.is(statutoryProposalValueSchema);

/** Strict standard view: a key no member declares is refused rather than stripped. */
export const statutoryProposalSchema = Schema.toStandardSchemaV1(statutoryProposalValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'statutory_proposal',
	description:
		'The review sheet the statutory drift automation leaves on a draft settings version: each statutory row it changed, the sealed and the official value, the page, quote, time and digest the change stands on, and every official source it could not read.',
	schema: statutoryProposalSchema
});

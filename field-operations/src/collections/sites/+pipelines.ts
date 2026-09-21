import { Effect } from 'effect';
import type { Pipelines } from './$types.js';

export default {
	export: {
		description:
			'Bundles each site with its dispatched jobs, variation requests and photo evidence into one JSON file plus a CSV per table, for handover to another system.',
		handler: ({ records }, api) =>
			Effect.gen(function* () {
				const siteIds = records.map((site) => site.id);
				if (siteIds.length === 0) return [];

				const assignments = yield* api.db.job_assignments.findMany({
					where: { site_id: { in: siteIds } },
					limit: 5_000
				});
				const assignmentIds = assignments.map((assignment) => assignment.id);
				const variations =
					assignmentIds.length > 0
						? yield* api.db.variation_requests.findMany({
								where: { job_assignment_id: { in: assignmentIds } },
								limit: 5_000
							})
						: [];
				const variationIds = variations.map((variation) => variation.id);
				const evidence =
					assignmentIds.length > 0 || variationIds.length > 0
						? yield* api.db.photo_evidence.findMany({
								where: {
									OR: [
										...(assignmentIds.length > 0
											? [{ job_assignment_id: { in: assignmentIds } }]
											: []),
										...(variationIds.length > 0
											? [{ variation_request_id: { in: variationIds } }]
											: [])
									]
								},
								limit: 10_000
							})
						: [];

				return records.map((site) => {
					const siteAssignments = assignments.filter(
						(assignment) => assignment.site_id === site.id
					);
					const siteAssignmentIds = new Set(siteAssignments.map((assignment) => assignment.id));
					const siteVariations = variations.filter((variation) =>
						siteAssignmentIds.has(variation.job_assignment_id)
					);
					const siteVariationIds = new Set(siteVariations.map((variation) => variation.id));
					const siteEvidence = evidence.filter(
						(photo) =>
							(photo.job_assignment_id != null && siteAssignmentIds.has(photo.job_assignment_id)) ||
							(photo.variation_request_id != null &&
								siteVariationIds.has(photo.variation_request_id))
					);
					const code = (site.name || site.id).replace(/[^a-z0-9_-]/gi, '_');

					const assignmentRows = siteAssignments.map((assignment) => ({
						record_id: assignment.id,
						site_id: assignment.site_id,
						external_ref: assignment.external_ref,
						title: assignment.title,
						nature: assignment.nature,
						scheduled_for: assignment.scheduled_for,
						description: assignment.description,
						assignee_user_id: assignment.assignee_user_id,
						dispatched_at: assignment.dispatched_at,
						status: assignment.status,
						completed_at: assignment.completed_at,
						amount_charged: assignment.amount_charged,
						summary: assignment.summary,
						location: assignment.location
					}));
					const variationRows = siteVariations.map((variation) => ({
						record_id: variation.id,
						job_assignment_id: variation.job_assignment_id,
						requested_at: variation.requested_at,
						title: variation.title,
						description: variation.description,
						amount: variation.amount,
						approval_request_id: variation.approval_id
					}));
					const evidenceRows = siteEvidence.map((photo) => ({
						record_id: photo.id,
						job_assignment_id: photo.job_assignment_id,
						variation_request_id: photo.variation_request_id,
						photo: photo.photo,
						sha256: photo.sha256,
						flags: photo.flags,
						matched_evidence_ids: photo.matched_evidence_ids
					}));

					return {
						label: `Field operations interoperability bundle · ${site.name}`,
						attachments: [
							{
								name: `field_ops_${code}.json`,
								contentType: 'JSON' as const,
								content: {
									schema: 'norbital.field_operations.interoperability.v2',
									site,
									job_assignments: assignmentRows,
									variation_requests: variationRows,
									photo_evidence: evidenceRows
								}
							},
							{
								name: `field_ops_${code}_job_assignments.csv`,
								contentType: 'CSV' as const,
								content: assignmentRows.map((assignment) => ({
									...assignment,
									location: JSON.stringify(assignment.location)
								}))
							},
							{
								name: `field_ops_${code}_variations.csv`,
								contentType: 'CSV' as const,
								content: variationRows
							},
							{
								name: `field_ops_${code}_photo_evidence.csv`,
								contentType: 'CSV' as const,
								content: evidenceRows.map((photo) => ({
									...photo,
									flags: (photo.flags ?? []).join('|'),
									matched_evidence_ids: (photo.matched_evidence_ids ?? []).join('|')
								}))
							}
						],
						metadata: {
							schema: 'norbital.field_operations.interoperability.v2',
							site_id: site.id
						}
					};
				});
			})
	}
} satisfies Pipelines;

import {
	contractorSatisfiesCertificationRequirements,
	missingCertificationIds,
	type CertificationLink
} from '../../../lib/certification-eligibility.js';
import { coordinatesOf, exceedsSiteTolerance, type LocationLike } from '../../../lib/haversine.js';

type AssignmentStatus = 'dispatched' | 'in_progress' | 'completed' | 'suspect';

export interface AssignmentCreateInput {
	readonly job_id?: string | null;
	readonly contractor_profile_id?: string | null;
	readonly source_message_id?: string | null;
	readonly dispatched_at?: Date | string | null;
	readonly status?: string | null;
	readonly location?: LocationLike;
	readonly [key: string]: unknown;
}

export interface AssignmentCreateBatchLookup {
	readonly jobs: ReadonlyMap<string, { readonly site_id: string | null }>;
	readonly contractorIds: ReadonlySet<string>;
	readonly occupiedJobIds: ReadonlySet<string>;
	readonly occupiedSourceMessageIds: ReadonlySet<string>;
	readonly requirementsByJob: ReadonlyMap<string, readonly CertificationLink[]>;
	readonly holdingsByContractor: ReadonlyMap<string, readonly CertificationLink[]>;
	readonly sites: ReadonlyMap<string, LocationLike>;
	readonly certificationNames: ReadonlyMap<string, string>;
}

function requireId(value: string | null | undefined, message: string): string {
	if (!value) throw new Error(message);
	return value;
}

function assignmentStatus(value: string | null | undefined): AssignmentStatus {
	switch (value) {
		case 'dispatched':
		case 'in_progress':
		case 'completed':
		case 'suspect':
			return value;
		case undefined:
		case null:
			return 'dispatched';
		default:
			throw new Error(`Unsupported assignment status: ${value}.`);
	}
}

function statusForLocation(
	status: AssignmentStatus,
	assignmentLocation: LocationLike,
	siteLocation: LocationLike
): AssignmentStatus {
	return exceedsSiteTolerance(coordinatesOf(assignmentLocation), coordinatesOf(siteLocation))
		? 'suspect'
		: status;
}

export function prepareAssignmentCreateBatch<T extends AssignmentCreateInput>(
	inputs: readonly T[],
	lookup: AssignmentCreateBatchLookup,
	now: () => Date = () => new Date()
): Array<
	T & {
		readonly dispatched_at: Date | string;
		readonly status: AssignmentStatus;
	}
> {
	const batchJobIds = new Set<string>();
	const batchSourceMessageIds = new Set<string>();
	return inputs.map((input) => {
		const jobId = requireId(input.job_id, 'Job assignment must reference a job.');
		const contractorId = requireId(
			input.contractor_profile_id,
			'Job assignment must reference a contractor profile.'
		);
		const job = lookup.jobs.get(jobId);
		if (!job) throw new Error('Referenced job does not exist.');
		if (!lookup.contractorIds.has(contractorId)) {
			throw new Error('Referenced contractor profile does not exist.');
		}
		if (lookup.occupiedJobIds.has(jobId) || batchJobIds.has(jobId)) {
			throw new Error('This job already has an assignment.');
		}
		batchJobIds.add(jobId);
		const sourceMessageId = input.source_message_id;
		if (sourceMessageId) {
			if (
				lookup.occupiedSourceMessageIds.has(sourceMessageId) ||
				batchSourceMessageIds.has(sourceMessageId)
			) {
				throw new Error('A job assignment with this source_message_id already exists.');
			}
			batchSourceMessageIds.add(sourceMessageId);
		}

		const requirements = lookup.requirementsByJob.get(jobId) ?? [];
		const holdings = lookup.holdingsByContractor.get(contractorId) ?? [];
		if (!contractorSatisfiesCertificationRequirements(holdings, requirements)) {
			const missing = missingCertificationIds(holdings, requirements);
			throw new Error(
				`Contractor is missing required certifications: ${missing
					.map((certificationId) => lookup.certificationNames.get(certificationId) ?? '—')
					.join(', ')}.`
			);
		}
		const siteLocation = job.site_id ? lookup.sites.get(job.site_id) : null;
		return {
			...input,
			dispatched_at: input.dispatched_at ?? now(),
			status: statusForLocation(assignmentStatus(input.status), input.location, siteLocation)
		};
	});
}

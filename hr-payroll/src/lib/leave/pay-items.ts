import type { ContributionTreatments } from '../../datatypes/contribution_treatments/+definition.js';
import type { LeaveTreatments } from '../../datatypes/leave_treatments/+definition.js';

/**
 * The two pay lines a leave row can produce, and where they sit in the settlement order. Neither is
 * captured: the unpaid deduction settles under the leave's own code, the encashment under
 * `${code}_ENCASHMENT`, and both orders are the ones every seeded row carried.
 */
export const LEAVE_ABSENCE_SEQUENCE = 1000;
export const LEAVE_ENCASHMENT_SEQUENCE = 110;

export const encashmentCode = (leaveCode: string): string => `${leaveCode}_ENCASHMENT`;

const column = (
	treatments: LeaveTreatments,
	key: 'absence' | 'encashment'
): ContributionTreatments =>
	Object.fromEntries(Object.entries(treatments).map(([code, cell]) => [code, cell[key]]));

/** The `absence` column of the matrix, as the deduction pay line's treatments. */
export const absenceTreatments = (treatments: LeaveTreatments): ContributionTreatments =>
	column(treatments, 'absence');

/** The `encashment` column of the matrix, as the encashment pay line's treatments. */
export const encashmentTreatments = (treatments: LeaveTreatments): ContributionTreatments =>
	column(treatments, 'encashment');

/** Two column maps back into one matrix; a scheme one column lacks is `UNSET` there. */
export const leaveTreatmentsOf = (
	absence: ContributionTreatments,
	encashment: ContributionTreatments
): LeaveTreatments =>
	Object.fromEntries(
		[...new Set([...Object.keys(absence), ...Object.keys(encashment)])].map((code) => [
			code,
			{
				absence: absence[code] ?? { kind: 'UNSET' },
				encashment: encashment[code] ?? { kind: 'UNSET' }
			}
		])
	);

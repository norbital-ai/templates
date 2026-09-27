import { team } from '@norbital-ai/bolt';

/**
 * Which policies each team holds; who is on a team is a team row, bound here by name (case-insensitive). A team row
 * absent here holds nothing (the bank's `WhatsApp Channel Agent` team is one: the envoy carries its own policy).
 */
export default team({
	/** Dispatch, and the team a variation-request approval routes to. */
	'Field Operations Controllers': ['field_ops_controller'],
	/** The field side: their assigned jobs and sites, their own evidence. */
	Contractor: ['field_ops_contractor'],
	/**
	 * A contractor who also dispatches. `field_ops_controller` already grants everything the contractor policy narrows,
	 * so it names that alone; approval eligibility follows the team name, so members of this team decide nothing.
	 */
	'Contractor (Controller)': ['field_ops_controller']
});

import { team } from '@norbital-ai/bolt';

/**
 * Which policies each team holds. `construction_read` owns every data grant; each other policy opens one app, so a
 * team combines the read policy with the surfaces it needs. Everyone seeded today is in Construction Administrators;
 * the three single-surface teams are declared because the surfaces are separable.
 */
export default team({
	/** Delivery: projects, jobs, RFIs, defects, permits and payment claims, through one app. */
	'Project Delivery': ['construction_read', 'construction_project_workspace'],
	/** The BIM reference matrix settings surface. */
	'Reference Matrix Administrators': [
		'construction_read',
		'construction_settings_reference_matrix'
	],
	/** The workforce settings surface: the worker library and certification compliance. */
	'Workforce Administrators': ['construction_read', 'construction_settings_workforce'],
	/** All three surfaces at once. */
	'Construction Administrators': [
		'construction_read',
		'construction_project_workspace',
		'construction_settings_reference_matrix',
		'construction_settings_workforce'
	]
});

import { messages } from '@norbital-ai/bolt';

export default messages({
	// Apps & Pages
	'app.operations.title': 'Operations',
	'app.operations.description':
		'Manage construction projects, 3D BIM issues, programme milestones, commercial cashflow, and WhatsApp coordination.',
	'app.operations.page_projects': 'Projects',
	'app.operations.projects_description':
		'Main-contractor projects, 3D BIM models, 4D timelines, quotes, claims, and cashflow.',
	'app.operations.page_messages': 'Messages',
	'app.operations.messages_description':
		'Synced WhatsApp, Telegram, email, Slack, and Discord site coordination feed.',

	'app.configuration.title': 'Configuration',
	'app.configuration.description':
		'Connect messaging channels and manage subcontractor, consultant, and client contacts.',

	// Connections
	'connections.title': 'Connections',
	'connections.description':
		'Connect WhatsApp, Telegram, email, Slack, or Discord to sync site updates into projects.',
	'connections.tab_channels': 'Channels',
	'connections.help':
		'Connect your personal WhatsApp or email account so messages automatically funnel into the matching project.',
	'connections.shared': 'Workspace channels',
	'connections.shared_help':
		'Shared company WhatsApp, Telegram, Slack, Discord, and email channels managed by administrators.',
	'connections.add': 'Connect',
	'connections.kind.whatsapp': 'WhatsApp',
	'connections.kind.telegram': 'Telegram',
	'connections.kind.email': 'Email',
	'connections.kind.slack': 'Slack',
	'connections.kind.discord': 'Discord',
	'connections.intake_rules_title': 'Intake & auto-extraction',

	// Contacts page
	'contacts.title': 'Contacts',
	'contacts.description':
		'Subcontractors, site engineers, QS, consultants, and client contacts for routing, quotes, and billing.',

	// Project Hub tabs
	'project.tab_overview': 'Overview',
	'project.tab_bim': 'BIM & Issues',
	'project.tab_programme': 'Schedule & Tasks',
	'project.tab_commercial': 'Commercial',
	'project.tab_comms': 'Site Comms',

	// Co-located spatial zones
	'zones.code': 'Zone code (e.g. L01)',
	'zones.name': 'Zone name',
	'zones.grid_axis': 'Grid axis (e.g. A–D / 1–4)',
	'zones.elevation_m': 'Elevation (m)',
	'zones.add': 'Add zone',
	'zones.remove': 'Remove zone',
	'zones.count_summary': '{count} zone(s)',

	// BIM & IFC viewer
	'bim.legend_critical': 'Critical issues',
	'bim.legend_high': 'High severity issues',
	'bim.legend_medium_low': 'Medium / low issues',
	'bim.legend_4d_active': 'Active on {date}',
	'bim.showing_4d_slice': 'Highlighting BIM elements scheduled on {date}.',
	'bim.unpinned_issue': 'Not pinned to a 3D element',
	'bim.focus_in_3d': 'Focus in 3D',
	'bim.pin_coords': '3D Pin: X {x}, Y {y}, Z {z}',
	'bim.express_id': 'IFC expressID',
	'bim.element_name': 'BIM element',
	'bim.global_id': 'IFC GlobalId',
	'bim.camera_x': 'Camera X',
	'bim.camera_y': 'Camera Y',
	'bim.camera_z': 'Camera Z',

	// Project files & revisions
	'project_files.register_title': 'BIM & Drawings',
	'project_files.revision_history': 'Revision history',
	'project_files.revision_count': '{count} revision(s)',
	'project_files.col_version': 'Version',
	'project_files.col_issued_on': 'Date',
	'project_files.col_reference': 'File / total',
	'project_files.col_notes': 'Summary',

	// Programme, Milestones & 4D Timeline scrubber
	'programme.view_timeline': 'Timeline',
	'programme.view_progress': 'Site Progress',
	'programme.tasks_title': 'Work packages & milestones',
	'programme.new_task': 'New task',
	'tasks.bim_linked_count': '{count} BIM element(s) linked',
	'timeline.scrubber_label': 'Programme time axis',
	'timeline.today': 'Today',
	'timeline.eot_days': '+{days}d EOT',
	'timeline.eot_short': '+{days}d',
	'timeline.jump_today': 'Jump to today',
	'timeline.highlight_bim_active': 'Highlight {count} in BIM',
	'timeline.scrub_hint': 'Drag scrubber to inspect programme, milestones & 4D BIM progress by date',
	'timeline.active_on_date': 'Active on date',
	'timeline.planned_complete': 'Planned complete',
	'timeline.milestones_hit': 'Milestones hit',
	'timeline.milestone_badge': 'Milestone',
	'timeline.ratio_pair': '{done} / {total}',
	'timeline.updates_logged': 'Progress updates',
	'timeline.approved_eot': 'Approved EOT',
	'timeline.empty_title': 'No scheduled tasks yet',
	'timeline.empty_hint':
		'Add structured tasks or milestones with schedule dates to scrub the timeline.',
	'timeline.programme_axis': 'Programme timeline',
	'timeline.work_package': 'Work package / milestone',
	'timeline.change_markers': 'Variations / VOs',
	'timeline.vo_fallback': 'VO',
	'timeline.behind_plan': 'plan {planned}%',
	'timeline.unscheduled': 'No schedule dates',

	// Messages
	'messages.action_sync': 'Sync messages',
	'messages.action_sync_desc':
		'Pull latest WhatsApp, Telegram, email, Slack, and Discord messages now.',
	'messages.action_classify': 'Route pending',
	'messages.action_classify_desc': 'Classify and assign pending messages to matching projects.',
	'messages.action_extract': 'Extract project updates',
	'messages.action_extract_desc':
		'Parse routed messages into progress updates, issues, draft VOs, and tasks.',
	'messages.reextract_now': 'Re-extract updates',

	// Commercial, BOQ, Quotes, VOs & Claims
	'commercial.retention_rule_summary':
		'Retention {retention}% (capped at {cap}% of revised contract) · Tax {tax}%',
	'commercial.draft_claim': 'Draft progress claim',
	'commercial.draft_claim_desc':
		'Calculate current claimable amount from BOQ progress and approved VOs.',
	'commercial.approved_variations': 'Approved VOs',
	'commercial.revised_contract_sum': 'Revised contract sum',
	'commercial.committed_subcon': 'Committed subcon',
	'commercial.projected_margin': 'Projected margin',
	'commercial.margin_pct_value': '{pct}%',
	'commercial.gross_work_done': 'Gross work done',
	'commercial.retention_held': 'Less retention',
	'commercial.previous_certified': 'Previously certified',
	'commercial.net_claimable_now': 'Net claimable now',
	'commercial.tab_boq': 'BOQ & Costings',
	'commercial.tab_quotes': 'Quotes & Revisions',
	'commercial.tab_changes': 'Changes / VOs',
	'commercial.tab_claims': 'Claims & Cashflow',
	'commercial.col_code': 'Code',
	'commercial.col_item': 'Description',
	'commercial.col_contract': 'Contract',
	'commercial.col_progress': 'Progress',
	'commercial.col_gross': 'Gross claimable',

	// Quotes & priced lines
	'quotes.priced_lines': 'Priced line items',
	'quotes.col_unit': 'Unit',
	'quotes.col_qty': 'Qty',
	'quotes.col_rate': 'Unit rate',
	'quotes.col_amount': 'Amount',
	'quotes.add_line': 'Add line',
	'quotes.remove_line': 'Remove line',
	'quotes.revision_history': 'Revision history',
	'quotes.revision_count': '{count} archived revision(s)',

	// Step-based polymorphic claims
	'claims.step_choose_kind': 'Step 1 · Choose cashflow entry type',
	'claims.step_choose_hint':
		'Select whether this entry is a client claim (inflow) or a subcontractor/supplier bill (outflow).',
	'claims.variant_inflow': 'Client Progress / Variation Claim (Inflow)',
	'claims.variant_inflow_desc':
		'Progress valuation, approved VO claim, milestone billing, or retention release receivable from client.',
	'claims.variant_outflow': 'Subcontractor / Supplier Bill (Outflow)',
	'claims.variant_outflow_desc':
		'Subcontractor progress claim or supplier invoice linked to an awarded quote or BOQ cost item.',
	'claims.change_variant': 'Change entry type',

	// Cashflow
	'cashflow.title': 'Commercial & cashflow pulse',
	'cashflow.received_inflow': 'Received (inflow)',
	'cashflow.paid_outflow': 'Paid out (outflow)',
	'cashflow.net_realized': 'Net realized',
	'cashflow.net_projected': 'Net projected',
	'cashflow.overdue_in': 'Overdue receivables: {amount}',
	'cashflow.overdue_out': 'Overdue payables: {amount}',
	'cashflow.monthly_chart': 'Monthly inflow vs outflow',

	// Sections
	'section.project': 'Project details',
	'section.schedule_and_value': 'Programme, commercial & cashflow terms',
	'section.zones': 'Spatial zones & grid axes',
	'section.capture_rules': 'WhatsApp / Telegram routing rules',
	'section.configured': 'Configured',
	'section.address': 'Site address',
	'section.issue': 'Issue details',
	'section.photos_and_evidence': 'Photos & evidence',
	'section.bim_tag': 'BIM IFC tag & 3D pin',
	'section.follow_up': 'Assignment & closeout',
	'section.task': 'Work package / milestone',
	'section.programme_and_links': 'WBS, cost & 4D BIM links',
	'section.change_order': 'Change order / variation',
	'section.commercial_and_time_impact': 'Cost, line pricing & EOT impact',
	'section.progress_update': 'Site progress update',
	'section.site_context_and_photos': 'Site context & photos',
	'section.cost_item': 'BOQ item',
	'section.costing_and_claimable': 'Rates & claimable calculation',
	'section.quote': 'Quote details',
	'section.quote_totals': 'Pricing & totals',
	'section.claim': 'Claim / bill details',
	'section.valuation_breakdown': 'Client valuation & BOQ snapshot',
	'section.submission': 'Submission & payment',
	'section.not_submitted': 'Not submitted',
	'section.message': 'Message',
	'section.attachments_and_voice': 'Site photos & voice note',
	'section.routing_and_extraction': 'Project routing & AI extraction',
	'section.project_file': 'BIM model / project file',
	'section.contact': 'Contact details',
	'section.messaging_handles': 'WhatsApp, Telegram & email handles',

	// Shared component strings
	'component.programme': 'Programme',
	'component.not_set': 'Not set',
	'component.no_value': '—',
	'component.open_tasks_issues': 'Open tasks · issues',
	'component.tasks_issues_pair': '{tasks} tasks · {issues} issues',
	'component.coordination_model': 'BIM IFC model',
	'component.loading_viewer': 'Loading 3D BIM viewer…',
	'component.loading_ifc_model': 'Converting and loading IFC model…',
	'component.no_ifc_model': 'No IFC model attached',
	'component.link_ifc_document':
		'Upload an .ifc file under BIM & Drawings to open the interactive 3D workspace.',
	'component.ifc_model_preview': '3D BIM IFC model viewport',
	'component.ifc_element': 'BIM Element',
	'component.ifc_download_timed_out': 'Downloading the IFC model timed out.',
	'component.ifc_html_instead_of_bytes': 'Expected IFC bytes, received HTML instead.',
	'component.ifc_download_failed': 'Failed to download IFC model (HTTP {status}).',
	'component.ifc_conversion': 'IFC conversion',
	'component.ifc_fragment_load': 'Fragment load',
	'component.ifc_load_failed': 'Unable to load the IFC model.',
	'component.ifc_unable_to_convert': 'Unable to convert the IFC file into 3D geometry.',
	'component.ifc_worker_crashed': 'IFC converter worker stopped unexpectedly.',
	'component.ifc_unknown_worker_error': 'Unknown IFC converter worker error.',
	'component.ifc_worker_communication_failed': 'Communication with IFC converter worker failed.',
	'component.clear_selected_element': 'Clear selection',
	'component.selected_element_properties': 'IFC properties',
	'component.element_tagged_issues_count': '{count} tagged issue(s)',
	'component.click_to_tag_issue': 'Tag this element with a site issue & photos',
	'component.tag_issue_and_photos': 'Tag issue',
	'component.axis_section_scrubbers': '3D axis section scrubbers',
	'component.reset_axes': 'Reset',
	'component.axis_y_elevation': 'Y axis (Elevation)',
	'component.axis_x_section': 'X axis (East–West)',
	'component.axis_z_section': 'Z axis (North–South)',
	'component.reset_camera_view': 'Fit model to view',
	'component.unlock_model_navigation': 'Unlock 3D orbit',
	'component.lock_model_navigation': 'Lock 3D orbit',
	'component.marker_legend': 'BIM highlight legend',
	'component.highlights': 'Highlights',
	'component.clear_filter': 'Clear',
	'component.issues_register': 'Issues & RFIs',
	'component.view_table': 'Table',
	'component.view_board': 'Board',
	'component.address_line_1': 'Address line 1',
	'component.address_line_2': 'Address line 2',
	'component.city': 'City',
	'component.state': 'State / Region',
	'component.postal_code': 'Postal code',
	'component.country': 'Country',

	// Error keys
	'errors.invalid_import_start': 'Invalid message import start configuration.',
	'errors.source_outside_import':
		'Source message falls outside the connection import start window.',
	'errors.intake_failed': 'Unable to file incoming coordination message ({kind}).',
	'errors.personal_accounts_only':
		'Members may only manage their own personal WhatsApp or email accounts.',
	'errors.intake_needs_member': 'Only signed-in members can save personal intake settings.',
	'errors.intake_not_own': 'You can only update your own message intake settings.',
	'errors.classification_too_long':
		'Classification instructions must be 8,000 characters or fewer.',
	'errors.project_not_found': 'Project not found.',
	'errors.claim_create_failed': 'Unable to create draft payment claim.',
	'errors.invalid_zone': 'Zone "{zone}" is not defined in this project’s spatial zones.',
	'errors.vo_cost_managed_by_lines':
		'Cost impact is computed automatically from priced line items; update the lines instead.'
});

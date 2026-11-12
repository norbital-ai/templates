import { messages } from '@norbital-ai/bolt';
export default messages({
	'models.holding.label': 'Holdings',
	'models.holding.singular': 'Holding',
	'models.report.label': 'Reports',
	'models.report.singular': 'Report',
	'models.holding.fields.symbol': 'Ticker',
	'models.holding.fields.symbol.help':
		'Exchange-suffixed ("AAPL", "0700.HK") or Bloomberg-style ("AAPL UW", "700 HK").',
	'models.holding.fields.cost_value': 'Cost (local)',
	'models.holding.fields.market_value': 'Statement value (local)',
	'models.holding.fields.value_base': 'Statement value (base)',
	'models.holding.fields.unrealised_pl': 'Statement unrealised P&L',
	'models.holding.fields.price_date': 'Statement date',
	'models.holding.fields.detail': 'Terms',
	'models.holding.fields.documents': 'Financial files',
	'models.holding.fields.documents.help':
		'The files behind this line: the statement page, the contract note, a confirmation.',
	'models.holding.fields.sources': 'Sources to read',
	'models.holding.fields.sources.help':
		'Pages the agent reads on this line every run: a filing page, an investor-relations page.',
	'models.holding.fields.research_direction': 'Research direction',
	'models.holding.fields.research_direction.help':
		'What the agent should look for on this line: catalysts, risks, peers, a thesis to test.',
	'models.holding.fields.live_price': 'Price now (calculated)',
	'models.holding.fields.live_value_base': 'Value now (calculated)',
	'models.holding.fields.live_change_pct': 'Change today % (calculated)',
	'models.holding.fields.price_updated_at': 'Calculated at',
	'models.holding.fields.volume_ratio': 'Volume vs 20-session average',
	'models.holding.fields.movement': 'Movement (calculated)',
	'models.holding.fields.pnl_history': 'P&L by date (calculated)',
	'models.holding.fields.pnl_history.help':
		'One entry per day: what the line was worth less what it cost, in base currency.',
	'models.holding.fields.research_summary': 'Research summary',
	'models.holding.fields.research_at': 'Researched at',
	'models.holding.fields.insights': 'What the agent read',
	'models.report.fields.for_date': 'Report date',
	'models.report.fields.market_view': 'Market view',
	'models.report.fields.research_log': 'Research log',
	'models.report.fields.research_log.help':
		'What the agent read on this run: each source and what came back.',
	'models.report.fields.day_change': 'Change since the last report',
	'models.report.fields.fx_used': 'Rates used',
	'models.report.fields.positions': 'One call per holding',
	'models.portfolio_settings.label': 'Settings',
	'models.portfolio_settings.singular': 'Settings',
	'models.portfolio_settings.fields.base_currency': 'Base currency',
	'models.portfolio_settings.fields.base_currency.help':
		'The currency the book is valued and reported in. Without a settings row it is USD.',
	'models.portfolio_settings.fields.report_via': 'Send through',
	'models.portfolio_settings.fields.report_via.help':
		'The paired workspace account the daily report is sent from: WhatsApp, Telegram, Slack or Discord.',
	'models.portfolio_settings.fields.recipients': 'Recipients',
	'models.portfolio_settings.fields.recipients.help':
		'Who receives the daily report: a WhatsApp number, a Telegram chat, a Slack or Discord channel.',
	'models.report.fields.deliveries': 'Sent as',
	'automations.portfolio_agent.input.fields.send': 'Send to the recipients',
	'errors.settings_ambiguous':
		'Keep one portfolio settings row: the agent cannot choose between several.',
	'errors.no_report_account':
		'The settings name recipients but no active account to send through: set Send through to a paired chat account.',
	'errors.loan_is_owed': 'A loan line is owed: its base value must be zero or negative.',
	'errors.report_exists': 'There is already a report for this date.'
});

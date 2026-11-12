import { messages } from '@norbital-ai/bolt';
export default messages({
	'models.holding.label': '持仓',
	'models.holding.singular': '持仓',
	'models.report.label': '报告',
	'models.report.singular': '报告',
	'models.portfolio_settings.label': '设置',
	'models.portfolio_settings.singular': '设置',
	'errors.settings_ambiguous': '请只保留一条投资组合设置：智能体无法在多条之间选择。',
	'errors.no_report_account':
		'设置中有收件人，但没有可用的发送账号：请将“发送账号”设为已配对的聊天账号。',
	'errors.loan_is_owed': '贷款行为负债：其基础货币价值必须为零或负数。',
	'errors.report_exists': '该日期已有报告。'
});

import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { Effect } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import {
	buildProjectReport,
	projectReportRead,
	reportConvertSource,
	type ReportKind,
	type ReportLocale
} from './report-document.js';

/** Renders a project's Sustainability or Compliance report as an A4 PDF preview using the active published template. */
export const projectReportPdf = (
	ctx: PageContext,
	projectId: Id<'projects'>,
	kind: ReportKind,
	locale: ReportLocale,
	generatedOn: string,
	includeStamp: boolean
) =>
	Effect.gen(function* () {
		const answer = yield* ctx.query(projectReportRead(projectId));
		const document = yield* buildProjectReport(answer, kind, locale, generatedOn);
		const source = yield* reportConvertSource(document, includeStamp, (asset) =>
			HttpClient.get(ctx.file_url(asset)).pipe(
				Effect.flatMap((response) => response.arrayBuffer),
				Effect.map((bytes) => new Uint8Array(bytes)),
				Effect.provide(FetchHttpClient.layer)
			)
		);
		const bytes = yield* ctx.preview_pdf(source, { page: 'A4' });
		return { document, bytes: new Uint8Array(bytes) };
	});

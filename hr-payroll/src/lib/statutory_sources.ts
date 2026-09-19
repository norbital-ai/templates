/**
 * The official sites statutory research may read, per payroll jurisdiction: the statute database
 * or gazette that carries the declarations themselves, and the regulators that publish the tables.
 *
 * The drift automation prefilters a version's `sources.urls` through this list before the
 * research agent runs, so the agent opens declarations and never a news site or a commercial
 * mirror; how to move around each site is the version's own `sources.instructions`, written by
 * the operator beside the URLs.
 */

const CANONICAL_ORIGINS: Readonly<Record<string, readonly string[]>> = {
	MY: [
		'https://lom.agc.gov.my',
		'https://www.kwsp.gov.my',
		'https://www.perkeso.gov.my',
		'https://www.hasil.gov.my',
		'https://jtksm.mohr.gov.my',
		'https://gajiminimum.mohr.gov.my',
		'https://hrdcorp.gov.my',
		'https://www.johor.gov.my'
	],
	SG: [
		'https://sso.agc.gov.sg',
		'https://www.cpf.gov.sg',
		'https://www.mom.gov.sg',
		'https://www.profamilyleave.msf.gov.sg',
		'https://www.msf.gov.sg',
		'https://ask.gov.sg',
		'https://www.muis.gov.sg'
	],
	TW: [
		'https://law.moj.gov.tw',
		'https://law-out.mof.gov.tw',
		'https://www.bli.gov.tw',
		'https://www.nhi.gov.tw',
		'https://info.nhi.gov.tw',
		'https://www.mol.gov.tw',
		'https://www.dot.gov.tw',
		'https://www.dgpa.gov.tw',
		'https://data.gov.tw'
	],
	PH: [
		'https://www.officialgazette.gov.ph',
		'https://www.sss.gov.ph',
		'https://www.philhealth.gov.ph',
		'https://www.pagibigfund.gov.ph',
		'https://bir-cdn.bir.gov.ph',
		'https://www.bir.gov.ph',
		'https://nwpc.dole.gov.ph',
		'https://bwc.dole.gov.ph'
	],
	ID: [
		'https://peraturan.bpk.go.id',
		'https://jdih.kemnaker.go.id',
		'https://jdih.kemenkeu.go.id',
		'https://www.setneg.go.id',
		'https://setneg.go.id',
		'https://pajak.go.id',
		'https://www.pajak.go.id',
		'https://www.bpjsketenagakerjaan.go.id',
		'https://bpjs-kesehatan.go.id',
		'https://jdih.jakarta.go.id',
		'https://jdih.jabarprov.go.id'
	],
	VN: [
		'https://vanban.chinhphu.vn',
		'https://datafiles.chinhphu.vn',
		'https://congbao.chinhphu.vn',
		'https://xaydungchinhsach.chinhphu.vn',
		'https://baochinhphu.vn',
		'https://baohiemxahoi.gov.vn',
		'https://www.baohiemxahoi.gov.vn',
		'https://mof.gov.vn',
		'https://nief.mof.gov.vn'
	]
};

/**
 * The Wayback Machine's dated copy of a page — `web.archive.org/web/<timestamp>[id_]/<url>` —
 * is that page as the authority published it on the day, kept for a host that refuses the
 * reader (kwsp.gov.my, peraturan.bpk.go.id). It vouches as the page it wraps.
 */
const ARCHIVE = /^https?:\/\/web\.archive\.org\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/;
const unwrapArchive = (url: string): string => ARCHIVE.exec(url)?.[1] ?? url;
const originOf = (url: string): string | null => {
	const inner = unwrapArchive(url);
	return URL.canParse(inner) ? new URL(inner).origin : null;
};

/**
 * A version's research URLs, ranked and screened against the jurisdiction's canonical sites.
 *
 * `kept` are the listed URLs on a canonical origin, in canonical-site order; `dropped` are the
 * rest, each with its reason, for the run's notes. A jurisdiction this file does not know keeps
 * every URL: the operator's list is then the only vouching there is.
 */
export function prefilterStatutorySources(
	jurisdictionCode: string,
	urls: readonly string[]
): {
	readonly kept: readonly string[];
	readonly dropped: readonly { url: string; reason: string }[];
} {
	const canonical = CANONICAL_ORIGINS[jurisdictionCode];
	const unique = [...new Set(urls)];
	if (canonical == null) return { kept: unique, dropped: [] };
	const rank = new Map(canonical.map((origin, index) => [origin, index]));
	const kept: string[] = [];
	const dropped: { url: string; reason: string }[] = [];
	for (const url of unique) {
		const origin = originOf(url);
		if (origin != null && rank.has(origin)) kept.push(url);
		else
			dropped.push({
				url,
				reason:
					origin == null
						? 'not a URL'
						: `${new URL(url).host} is not a canonical ${jurisdictionCode} source; corroboration at most`
			});
	}
	kept.sort((a, b) => rank.get(originOf(a)!)! - rank.get(originOf(b)!)!);
	return { kept, dropped };
}

/** The origins research may open for a jurisdiction: its canonical sites, and the kept URLs' own. */
export const researchOrigins = (jurisdictionCode: string, urls: readonly string[]): string[] => [
	...new Set([
		...(CANONICAL_ORIGINS[jurisdictionCode] ?? []),
		...prefilterStatutorySources(jurisdictionCode, urls).kept,
		// An archived page is read on the archive's own host.
		...(urls.some((url) => ARCHIVE.test(url)) ? ['https://web.archive.org'] : [])
	])
];

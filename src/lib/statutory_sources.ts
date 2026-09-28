/**
 * The official sites statutory research reads, per payroll jurisdiction: the statute database or
 * gazette that carries the declarations themselves, and the regulators that publish the tables.
 * The drift automation hands a lineage's list to its research call as-is.
 */
export const STATUTORY_SOURCES: Readonly<Record<string, readonly string[]>> = {
	MY: [
		'https://lom.agc.gov.my',
		'https://www.kwsp.gov.my',
		'https://www.perkeso.gov.my',
		'https://www.hasil.gov.my',
		'https://jtksm.mohr.gov.my',
		'https://gajiminimum.mohr.gov.my',
		'https://hrdcorp.gov.my',
		'https://www.johor.gov.my',
		'https://www.kabinet.gov.my',
		'https://belanjawan.mof.gov.my',
		'https://www.mof.gov.my'
	],
	SG: [
		'https://sso.agc.gov.sg',
		'https://www.cpf.gov.sg',
		'https://www.mom.gov.sg',
		'https://www.profamilyleave.msf.gov.sg',
		'https://www.msf.gov.sg',
		'https://ask.gov.sg',
		'https://www.muis.gov.sg',
		'https://www.iras.gov.sg'
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
		'https://data.gov.tw',
		'https://gazette.nat.gov.tw',
		'https://www.mohw.gov.tw'
	],
	PH: [
		'https://www.officialgazette.gov.ph',
		'https://www.sss.gov.ph',
		'https://www.philhealth.gov.ph',
		'https://www.pagibigfund.gov.ph',
		'https://bir-cdn.bir.gov.ph',
		'https://www.bir.gov.ph',
		'https://nwpc.dole.gov.ph',
		'https://bwc.dole.gov.ph',
		'https://elibrary.judiciary.gov.ph'
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
		'https://jdih.jabarprov.go.id',
		'https://www.kemenkopmk.go.id'
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
	],
	TH: [
		'https://ratchakitcha.soc.go.th',
		'https://www.ocs.go.th',
		'https://www.mol.go.th',
		'https://www.sso.go.th',
		'https://www.rd.go.th',
		'https://infocenter.oic.go.th'
	],
	// One jurisdiction code for both cities: national issuers, then Shanghai, then Yunnan and Kunming.
	CN: [
		'https://flk.npc.gov.cn',
		'https://www.npc.gov.cn',
		'https://www.gov.cn',
		'https://xzfg.moj.gov.cn',
		'https://www.mohrss.gov.cn',
		'https://www.chinatax.gov.cn',
		'https://fgk.chinatax.gov.cn',
		'https://www.nhsa.gov.cn',
		'https://rsj.sh.gov.cn',
		'https://ybj.sh.gov.cn',
		'https://www.shzfgjj.cn',
		'https://shanghai.chinatax.gov.cn',
		'https://www.shanghai.gov.cn',
		'https://service.shanghai.gov.cn',
		'https://czj.sh.gov.cn',
		'https://hrss.yn.gov.cn',
		'https://www.yn.gov.cn',
		'https://ylbz.yn.gov.cn',
		'https://www.kmrd.gov.cn',
		'https://ybj.km.gov.cn',
		'https://zfgjj.km.gov.cn'
	]
};

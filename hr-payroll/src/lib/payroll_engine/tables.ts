import { Schema } from 'effect';

/** Every settings lookup key, with the row shape its values declare. Shared tables only. */
export const TABLES = {
	annual_ladder: Schema.Array(
		Schema.Struct({
			quick: Schema.optional(Schema.Number),
			rate: Schema.Number,
			up_to: Schema.Union([Schema.Null, Schema.Number])
		})
	),
	annual_tax: Schema.Array(
		Schema.Struct({
			offset: Schema.Number,
			rate: Schema.Number,
			up_to: Schema.Union([Schema.Null, Schema.Number])
		})
	),
	average_wage_cap: Schema.Array(Schema.Struct({ code: Schema.String, monthly: Schema.Number })),
	by_region: Schema.Struct({
		AMNAT_CHAROEN: Schema.optional(Schema.Number),
		ANG_THONG: Schema.optional(Schema.Number),
		BANGKOK: Schema.optional(Schema.Number),
		BUENG_KAN: Schema.optional(Schema.Number),
		BURI_RAM: Schema.optional(Schema.Number),
		CHACHOENGSAO: Schema.optional(Schema.Number),
		CHAI_NAT: Schema.optional(Schema.Number),
		CHAIYAPHUM: Schema.optional(Schema.Number),
		CHANTHABURI: Schema.optional(Schema.Number),
		CHIANG_MAI: Schema.optional(Schema.Number),
		CHIANG_MAI_MUEANG: Schema.optional(Schema.Number),
		CHIANG_RAI: Schema.optional(Schema.Number),
		CHON_BURI: Schema.optional(Schema.Number),
		CHUMPHON: Schema.optional(Schema.Number),
		KALASIN: Schema.optional(Schema.Number),
		KAMPHAENG_PHET: Schema.optional(Schema.Number),
		KANCHANABURI: Schema.optional(Schema.Number),
		KHON_KAEN: Schema.optional(Schema.Number),
		KRABI: Schema.optional(Schema.Number),
		LAMPANG: Schema.optional(Schema.Number),
		LAMPHUN: Schema.optional(Schema.Number),
		LOEI: Schema.optional(Schema.Number),
		LOP_BURI: Schema.optional(Schema.Number),
		MAE_HONG_SON: Schema.optional(Schema.Number),
		MAHA_SARAKHAM: Schema.optional(Schema.Number),
		MUKDAHAN: Schema.optional(Schema.Number),
		NAKHON_NAYOK: Schema.optional(Schema.Number),
		NAKHON_PATHOM: Schema.optional(Schema.Number),
		NAKHON_PHANOM: Schema.optional(Schema.Number),
		NAKHON_RATCHASIMA: Schema.optional(Schema.Number),
		NAKHON_SAWAN: Schema.optional(Schema.Number),
		NAKHON_SI_THAMMARAT: Schema.optional(Schema.Number),
		NAN: Schema.optional(Schema.Number),
		NARATHIWAT: Schema.optional(Schema.Number),
		NONG_BUA_LAM_PHU: Schema.optional(Schema.Number),
		NONG_KHAI: Schema.optional(Schema.Number),
		NONTHABURI: Schema.optional(Schema.Number),
		PATHUM_THANI: Schema.optional(Schema.Number),
		PATTANI: Schema.optional(Schema.Number),
		PHANGNGA: Schema.optional(Schema.Number),
		PHATTHALUNG: Schema.optional(Schema.Number),
		PHAYAO: Schema.optional(Schema.Number),
		PHETCHABUN: Schema.optional(Schema.Number),
		PHETCHABURI: Schema.optional(Schema.Number),
		PHICHIT: Schema.optional(Schema.Number),
		PHITSANULOK: Schema.optional(Schema.Number),
		PHRA_NAKHON_SI_AYUTTHAYA: Schema.optional(Schema.Number),
		PHRAE: Schema.optional(Schema.Number),
		PHUKET: Schema.optional(Schema.Number),
		PRACHIN_BURI: Schema.optional(Schema.Number),
		PRACHUAP_KHIRI_KHAN: Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Barat': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Barat Daya': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Besar': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Jaya': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Selatan': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Singkil': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Tamiang': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Tengah': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Tenggara': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Timur': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Aceh Utara': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Bener Meriah': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Bireuen': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Gayo Lues': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Nagan Raya': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Pidie': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Pidie Jaya': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kabupaten Simeulue': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kota Banda Aceh': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kota Langsa': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kota Lhokseumawe': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kota Sabang': Schema.optional(Schema.Number),
		'Provinsi Aceh/Kota Subulussalam': Schema.optional(Schema.Number),
		'Provinsi Bali/Kabupaten Badung': Schema.optional(Schema.Number),
		'Provinsi Bali/Kabupaten Bangli': Schema.optional(Schema.Number),
		'Provinsi Bali/Kabupaten Buleleng': Schema.optional(Schema.Number),
		'Provinsi Bali/Kabupaten Gianyar': Schema.optional(Schema.Number),
		'Provinsi Bali/Kabupaten Jembrana': Schema.optional(Schema.Number),
		'Provinsi Bali/Kabupaten Karangasem': Schema.optional(Schema.Number),
		'Provinsi Bali/Kabupaten Klungkung': Schema.optional(Schema.Number),
		'Provinsi Bali/Kabupaten Tabanan': Schema.optional(Schema.Number),
		'Provinsi Bali/Kota Denpasar': Schema.optional(Schema.Number),
		'Provinsi Banten/Kabupaten Lebak': Schema.optional(Schema.Number),
		'Provinsi Banten/Kabupaten Pandeglang': Schema.optional(Schema.Number),
		'Provinsi Banten/Kabupaten Serang': Schema.optional(Schema.Number),
		'Provinsi Banten/Kabupaten Tangerang': Schema.optional(Schema.Number),
		'Provinsi Banten/Kota Cilegon': Schema.optional(Schema.Number),
		'Provinsi Banten/Kota Serang': Schema.optional(Schema.Number),
		'Provinsi Banten/Kota Tangerang': Schema.optional(Schema.Number),
		'Provinsi Banten/Kota Tangerang Selatan': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Bengkulu Selatan': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Bengkulu Tengah': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Bengkulu Utara': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Kaur': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Kepahiang': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Lebong': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Mukomuko': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Rejang Lebong': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kabupaten Seluma': Schema.optional(Schema.Number),
		'Provinsi Bengkulu/Kota Bengkulu': Schema.optional(Schema.Number),
		'Provinsi DI Yogyakarta/Kabupaten Bantul': Schema.optional(Schema.Number),
		'Provinsi DI Yogyakarta/Kabupaten Gunungkidul': Schema.optional(Schema.Number),
		'Provinsi DI Yogyakarta/Kabupaten Kulon Progo': Schema.optional(Schema.Number),
		'Provinsi DI Yogyakarta/Kabupaten Sleman': Schema.optional(Schema.Number),
		'Provinsi DI Yogyakarta/Kota Yogyakarta': Schema.optional(Schema.Number),
		'Provinsi DKI Jakarta': Schema.optional(Schema.Number),
		'Provinsi Gorontalo/Kabupaten Boalemo': Schema.optional(Schema.Number),
		'Provinsi Gorontalo/Kabupaten Bone Bolango': Schema.optional(Schema.Number),
		'Provinsi Gorontalo/Kabupaten Gorontalo': Schema.optional(Schema.Number),
		'Provinsi Gorontalo/Kabupaten Gorontalo Utara': Schema.optional(Schema.Number),
		'Provinsi Gorontalo/Kabupaten Pohuwato': Schema.optional(Schema.Number),
		'Provinsi Gorontalo/Kota Gorontalo': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Batanghari': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Bungo': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Kerinci': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Merangin': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Muaro Jambi': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Sarolangun': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Tanjung Jabung Barat': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Tanjung Jabung Timur': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kabupaten Tebo': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kota Jambi': Schema.optional(Schema.Number),
		'Provinsi Jambi/Kota Sungai Penuh': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Bandung': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Bandung Barat': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Bekasi': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Bogor': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Ciamis': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Cianjur': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Cirebon': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Garut': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Indramayu': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Karawang': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Kuningan': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Majalengka': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Pangandaran': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Purwakarta': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Subang': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Sukabumi': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Sumedang': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kabupaten Tasikmalaya': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Bandung': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Banjar': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Bekasi': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Bogor': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Cimahi': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Cirebon': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Depok': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Sukabumi': Schema.optional(Schema.Number),
		'Provinsi Jawa Barat/Kota Tasikmalaya': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Banjarnegara': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Banyumas': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Batang': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Blora': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Boyolali': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Brebes': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Cilacap': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Demak': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Grobogan': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Jepara': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Karanganyar': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Kebumen': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Kendal': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Klaten': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Kudus': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Magelang': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Pati': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Pekalongan': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Pemalang': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Purbalingga': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Purworejo': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Rembang': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Semarang': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Sragen': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Sukoharjo': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Tegal': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Temanggung': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Wonogiri': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kabupaten Wonosobo': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kota Magelang': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kota Pekalongan': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kota Salatiga': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kota Semarang': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kota Surakarta': Schema.optional(Schema.Number),
		'Provinsi Jawa Tengah/Kota Tegal': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Bangkalan': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Banyuwangi': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Blitar': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Bojonegoro': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Bondowoso': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Gresik': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Jember': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Jombang': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Kediri': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Lamongan': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Lumajang': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Madiun': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Magetan': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Malang': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Mojokerto': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Nganjuk': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Ngawi': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Pacitan': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Pamekasan': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Pasuruan': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Ponorogo': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Probolinggo': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Sampang': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Sidoarjo': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Situbondo': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Sumenep': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Trenggalek': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Tuban': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kabupaten Tulungagung': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Batu': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Blitar': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Kediri': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Madiun': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Malang': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Mojokerto': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Pasuruan': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Probolinggo': Schema.optional(Schema.Number),
		'Provinsi Jawa Timur/Kota Surabaya': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Bengkayang': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Kapuas Hulu': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Kayong Utara': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Ketapang': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Kubu Raya': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Landak': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Melawi': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Mempawah': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Sambas': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Sanggau': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Sekadau': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kabupaten Sintang': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kota Pontianak': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Barat/Kota Singkawang': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Balangan': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Banjar': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Barito Kuala': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Hulu Sungai Selatan': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Hulu Sungai Tengah': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Hulu Sungai Utara': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Kotabaru': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Tabalong': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Tanah Bumbu': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Tanah Laut': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kabupaten Tapin': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kota Banjarbaru': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Selatan/Kota Banjarmasin': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Barito Selatan': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Barito Timur': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Barito Utara': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Gunung Mas': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Kapuas': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Katingan': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Kotawaringin Barat': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Kotawaringin Timur': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Lamandau': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Murung Raya': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Pulang Pisau': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Seruyan': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kabupaten Sukamara': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Tengah/Kota Palangka Raya': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kabupaten Berau': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kabupaten Kutai Barat': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kabupaten Kutai Kartanegara': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kabupaten Kutai Timur': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kabupaten Mahakam Ulu': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kabupaten Paser': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kabupaten Penajam Paser Utara': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kota Balikpapan': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kota Bontang': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Timur/Kota Samarinda': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Utara/Kabupaten Bulungan': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Utara/Kabupaten Malinau': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Utara/Kabupaten Nunukan': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Utara/Kabupaten Tana Tidung': Schema.optional(Schema.Number),
		'Provinsi Kalimantan Utara/Kota Tarakan': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Bangka Belitung/Kabupaten Bangka': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Bangka Belitung/Kabupaten Bangka Barat': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Bangka Belitung/Kabupaten Bangka Selatan': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Bangka Belitung/Kabupaten Bangka Tengah': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Bangka Belitung/Kabupaten Belitung': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Bangka Belitung/Kabupaten Belitung Timur': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Bangka Belitung/Kota Pangkalpinang': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Riau/Kabupaten Bintan': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Riau/Kabupaten Karimun': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Riau/Kabupaten Kepulauan Anambas': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Riau/Kabupaten Lingga': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Riau/Kabupaten Natuna': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Riau/Kota Batam': Schema.optional(Schema.Number),
		'Provinsi Kepulauan Riau/Kota Tanjungpinang': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Lampung Barat': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Lampung Selatan': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Lampung Tengah': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Lampung Timur': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Lampung Utara': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Mesuji': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Pesawaran': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Pesisir Barat': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Pringsewu': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Tanggamus': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Tulang Bawang': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Tulang Bawang Barat': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kabupaten Way Kanan': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kota Bandar Lampung': Schema.optional(Schema.Number),
		'Provinsi Lampung/Kota Metro': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kabupaten Halmahera Barat': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kabupaten Halmahera Selatan': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kabupaten Halmahera Tengah': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kabupaten Halmahera Timur': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kabupaten Halmahera Utara': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kabupaten Kepulauan Sula': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kabupaten Pulau Morotai': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kabupaten Pulau Taliabu': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kota Ternate': Schema.optional(Schema.Number),
		'Provinsi Maluku Utara/Kota Tidore Kepulauan': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Buru': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Buru Selatan': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Kepulauan Aru': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Kepulauan Tanimbar': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Maluku Barat Daya': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Maluku Tengah': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Maluku Tenggara': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Seram Bagian Barat': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kabupaten Seram Bagian Timur': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kota Ambon': Schema.optional(Schema.Number),
		'Provinsi Maluku/Kota Tual': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kabupaten Bima': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kabupaten Dompu': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kabupaten Lombok Barat': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kabupaten Lombok Tengah': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kabupaten Lombok Timur': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kabupaten Lombok Utara': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kabupaten Sumbawa': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kabupaten Sumbawa Barat': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kota Bima': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Barat/Kota Mataram': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Alor': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Belu': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Ende': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Flores Timur': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Kupang': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Lembata': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Malaka': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Manggarai': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Manggarai Barat': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Manggarai Timur': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Nagekeo': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Ngada': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Rote Ndao': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Sabu Raijua': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Sikka': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Sumba Barat': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Sumba Barat Daya': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Sumba Tengah': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Sumba Timur': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Timor Tengah Selatan': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kabupaten Timor Tengah Utara': Schema.optional(Schema.Number),
		'Provinsi Nusa Tenggara Timur/Kota Kupang': Schema.optional(Schema.Number),
		'Provinsi Papua Barat Daya/Kabupaten Maybrat': Schema.optional(Schema.Number),
		'Provinsi Papua Barat Daya/Kabupaten Raja Ampat': Schema.optional(Schema.Number),
		'Provinsi Papua Barat Daya/Kabupaten Sorong': Schema.optional(Schema.Number),
		'Provinsi Papua Barat Daya/Kabupaten Sorong Selatan': Schema.optional(Schema.Number),
		'Provinsi Papua Barat Daya/Kabupaten Tambrauw': Schema.optional(Schema.Number),
		'Provinsi Papua Barat Daya/Kota Sorong': Schema.optional(Schema.Number),
		'Provinsi Papua Barat/Kabupaten Fakfak': Schema.optional(Schema.Number),
		'Provinsi Papua Barat/Kabupaten Kaimana': Schema.optional(Schema.Number),
		'Provinsi Papua Barat/Kabupaten Manokwari': Schema.optional(Schema.Number),
		'Provinsi Papua Barat/Kabupaten Manokwari Selatan': Schema.optional(Schema.Number),
		'Provinsi Papua Barat/Kabupaten Pegunungan Arfak': Schema.optional(Schema.Number),
		'Provinsi Papua Barat/Kabupaten Teluk Bintuni': Schema.optional(Schema.Number),
		'Provinsi Papua Barat/Kabupaten Teluk Wondama': Schema.optional(Schema.Number),
		'Provinsi Papua Pegunungan/Kabupaten Jayawijaya': Schema.optional(Schema.Number),
		'Provinsi Papua Pegunungan/Kabupaten Lanny Jaya': Schema.optional(Schema.Number),
		'Provinsi Papua Pegunungan/Kabupaten Mamberamo Tengah': Schema.optional(Schema.Number),
		'Provinsi Papua Pegunungan/Kabupaten Nduga': Schema.optional(Schema.Number),
		'Provinsi Papua Pegunungan/Kabupaten Pegunungan Bintang': Schema.optional(Schema.Number),
		'Provinsi Papua Pegunungan/Kabupaten Tolikara': Schema.optional(Schema.Number),
		'Provinsi Papua Pegunungan/Kabupaten Yahukimo': Schema.optional(Schema.Number),
		'Provinsi Papua Pegunungan/Kabupaten Yalimo': Schema.optional(Schema.Number),
		'Provinsi Papua Selatan/Kabupaten Asmat': Schema.optional(Schema.Number),
		'Provinsi Papua Selatan/Kabupaten Boven Digoel': Schema.optional(Schema.Number),
		'Provinsi Papua Selatan/Kabupaten Mappi': Schema.optional(Schema.Number),
		'Provinsi Papua Selatan/Kabupaten Merauke': Schema.optional(Schema.Number),
		'Provinsi Papua Tengah/Kabupaten Deiyai': Schema.optional(Schema.Number),
		'Provinsi Papua Tengah/Kabupaten Dogiyai': Schema.optional(Schema.Number),
		'Provinsi Papua Tengah/Kabupaten Intan Jaya': Schema.optional(Schema.Number),
		'Provinsi Papua Tengah/Kabupaten Mimika': Schema.optional(Schema.Number),
		'Provinsi Papua Tengah/Kabupaten Nabire': Schema.optional(Schema.Number),
		'Provinsi Papua Tengah/Kabupaten Paniai': Schema.optional(Schema.Number),
		'Provinsi Papua Tengah/Kabupaten Puncak': Schema.optional(Schema.Number),
		'Provinsi Papua Tengah/Kabupaten Puncak Jaya': Schema.optional(Schema.Number),
		'Provinsi Papua/Kabupaten Biak Numfor': Schema.optional(Schema.Number),
		'Provinsi Papua/Kabupaten Jayapura': Schema.optional(Schema.Number),
		'Provinsi Papua/Kabupaten Keerom': Schema.optional(Schema.Number),
		'Provinsi Papua/Kabupaten Kepulauan Yapen': Schema.optional(Schema.Number),
		'Provinsi Papua/Kabupaten Mamberamo Raya': Schema.optional(Schema.Number),
		'Provinsi Papua/Kabupaten Sarmi': Schema.optional(Schema.Number),
		'Provinsi Papua/Kabupaten Supiori': Schema.optional(Schema.Number),
		'Provinsi Papua/Kabupaten Waropen': Schema.optional(Schema.Number),
		'Provinsi Papua/Kota Jayapura': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Bengkalis': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Indragiri Hilir': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Indragiri Hulu': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Kampar': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Kepulauan Meranti': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Kuantan Singingi': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Pelalawan': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Rokan Hilir': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Rokan Hulu': Schema.optional(Schema.Number),
		'Provinsi Riau/Kabupaten Siak': Schema.optional(Schema.Number),
		'Provinsi Riau/Kota Dumai': Schema.optional(Schema.Number),
		'Provinsi Riau/Kota Pekanbaru': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Barat/Kabupaten Majene': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Barat/Kabupaten Mamasa': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Barat/Kabupaten Mamuju': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Barat/Kabupaten Mamuju Tengah': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Barat/Kabupaten Pasangkayu': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Barat/Kabupaten Polewali Mandar': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Bantaeng': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Barru': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Bone': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Bulukumba': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Enrekang': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Gowa': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Jeneponto': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Kepulauan Selayar': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Luwu': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Luwu Timur': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Luwu Utara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Maros': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Pangkajene dan Kepulauan': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Pinrang': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Sidenreng Rappang': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Sinjai': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Soppeng': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Takalar': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Tana Toraja': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Toraja Utara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kabupaten Wajo': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kota Makassar': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kota Palopo': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Selatan/Kota Parepare': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Banggai': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Banggai Kepulauan': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Banggai Laut': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Buol': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Donggala': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Morowali': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Morowali Utara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Parigi Moutong': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Poso': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Sigi': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Tojo Una-Una': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kabupaten Tolitoli': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tengah/Kota Palu': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Bombana': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Buton': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Buton Selatan': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Buton Tengah': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Buton Utara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Kolaka': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Kolaka Timur': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Kolaka Utara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Konawe': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Konawe Kepulauan': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Konawe Selatan': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Konawe Utara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Muna': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Muna Barat': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kabupaten Wakatobi': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kota Baubau': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Tenggara/Kota Kendari': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Bolaang Mongondow': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Bolaang Mongondow Selatan': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Bolaang Mongondow Timur': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Bolaang Mongondow Utara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Kepulauan Sangihe': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Kepulauan Siau Tagulandang Biaro': Schema.optional(
			Schema.Number
		),
		'Provinsi Sulawesi Utara/Kabupaten Kepulauan Talaud': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Minahasa': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Minahasa Selatan': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Minahasa Tenggara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kabupaten Minahasa Utara': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kota Bitung': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kota Kotamobagu': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kota Manado': Schema.optional(Schema.Number),
		'Provinsi Sulawesi Utara/Kota Tomohon': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Agam': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Dharmasraya': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Kepulauan Mentawai': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Lima Puluh Kota': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Padang Pariaman': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Pasaman': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Pasaman Barat': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Pesisir Selatan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Sijunjung': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Solok': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Solok Selatan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kabupaten Tanah Datar': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kota Bukittinggi': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kota Padang': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kota Padang Panjang': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kota Pariaman': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kota Payakumbuh': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kota Sawahlunto': Schema.optional(Schema.Number),
		'Provinsi Sumatera Barat/Kota Solok': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Banyuasin': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Empat Lawang': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Lahat': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Muara Enim': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Musi Banyuasin': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Musi Rawas': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Musi Rawas Utara': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Ogan Ilir': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Ogan Komering Ilir': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Ogan Komering Ulu': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Ogan Komering Ulu Selatan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Ogan Komering Ulu Timur': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kabupaten Penukal Abab Lematang Ilir': Schema.optional(
			Schema.Number
		),
		'Provinsi Sumatera Selatan/Kota Lubuklinggau': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kota Pagar Alam': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kota Palembang': Schema.optional(Schema.Number),
		'Provinsi Sumatera Selatan/Kota Prabumulih': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Asahan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Batu Bara': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Dairi': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Deli Serdang': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Humbang Hasundutan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Karo': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Labuhanbatu': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Labuhanbatu Selatan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Labuhanbatu Utara': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Langkat': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Mandailing Natal': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Nias': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Nias Barat': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Nias Selatan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Nias Utara': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Padang Lawas': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Padang Lawas Utara': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Pakpak Bharat': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Samosir': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Serdang Bedagai': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Simalungun': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Tapanuli Selatan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Tapanuli Tengah': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Tapanuli Utara': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kabupaten Toba': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kota Binjai': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kota Gunungsitoli': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kota Medan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kota Padangsidimpuan': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kota Pematangsiantar': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kota Sibolga': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kota Tanjungbalai': Schema.optional(Schema.Number),
		'Provinsi Sumatera Utara/Kota Tebing Tinggi': Schema.optional(Schema.Number),
		RANONG: Schema.optional(Schema.Number),
		RATCHABURI: Schema.optional(Schema.Number),
		RAYONG: Schema.optional(Schema.Number),
		ROI_ET: Schema.optional(Schema.Number),
		SA_KAEO: Schema.optional(Schema.Number),
		SAKON_NAKHON: Schema.optional(Schema.Number),
		SAMUT_PRAKAN: Schema.optional(Schema.Number),
		SAMUT_SAKHON: Schema.optional(Schema.Number),
		SAMUT_SONGKHRAM: Schema.optional(Schema.Number),
		SARABURI: Schema.optional(Schema.Number),
		SATUN: Schema.optional(Schema.Number),
		SI_SA_KET: Schema.optional(Schema.Number),
		SING_BURI: Schema.optional(Schema.Number),
		SONGKHLA: Schema.optional(Schema.Number),
		SONGKHLA_HAT_YAI: Schema.optional(Schema.Number),
		SUKHOTHAI: Schema.optional(Schema.Number),
		SUPHAN_BURI: Schema.optional(Schema.Number),
		SURAT_THANI: Schema.optional(Schema.Number),
		SURAT_THANI_KO_SAMUI: Schema.optional(Schema.Number),
		SURIN: Schema.optional(Schema.Number),
		TAK: Schema.optional(Schema.Number),
		TRANG: Schema.optional(Schema.Number),
		TRAT: Schema.optional(Schema.Number),
		UBON_RATCHATHANI: Schema.optional(Schema.Number),
		UDON_THANI: Schema.optional(Schema.Number),
		UTHAI_THANI: Schema.optional(Schema.Number),
		UTTARADIT: Schema.optional(Schema.Number),
		YALA: Schema.optional(Schema.Number),
		YASOTHON: Schema.optional(Schema.Number)
	}),
	car_distance_bands: Schema.Array(
		Schema.Struct({ amount: Schema.Number, below: Schema.Union([Schema.Null, Schema.Number]) })
	),
	constants: Schema.Struct({
		annual_bonus_salary_ceiling: Schema.optional(Schema.Number),
		annual_ceiling: Schema.optional(Schema.Number),
		annual_service_deduction: Schema.optional(Schema.Number),
		bonus_salary_ceiling: Schema.optional(Schema.Number),
		bonus_withholding_threshold: Schema.optional(Schema.Number),
		bpjs_daily_wage_days: Schema.optional(Schema.Number),
		breakpoint_deduction: Schema.optional(Schema.Number),
		commuting_monthly_limit: Schema.optional(Schema.Number),
		daily_paid_days_five_day: Schema.optional(Schema.Number),
		daily_paid_days_six_day: Schema.optional(Schema.Number),
		days_two_or_more: Schema.optional(Schema.Number),
		domestic_salary_credit_floor: Schema.optional(Schema.Number),
		domestic_threshold: Schema.optional(Schema.Number),
		employee_share: Schema.optional(Schema.Number),
		epf_maximum_age: Schema.optional(Schema.Number),
		extended_annual_service_deduction: Schema.optional(Schema.Number),
		extended_coverage_age_years: Schema.optional(Schema.Number),
		first_band_days: Schema.optional(Schema.Number),
		first_band_months: Schema.optional(Schema.Number),
		first_tier_days: Schema.optional(Schema.Number),
		foreign_employee_minimum_months: Schema.optional(Schema.Number),
		foreign_minimum_contract_months: Schema.optional(Schema.Number),
		foreign_professional_covered: Schema.optional(Schema.Boolean),
		half_month_share: Schema.optional(Schema.Number),
		half_pay_share: Schema.optional(Schema.Number),
		half_step: Schema.optional(Schema.Number),
		half_year_remainder_months: Schema.optional(Schema.Number),
		half_year_share: Schema.optional(Schema.Number),
		health_maximum_age_years: Schema.optional(Schema.Number),
		hi_employer_rate: Schema.optional(Schema.Number),
		highest_midpoint: Schema.optional(Schema.Number),
		hpf_regions: Schema.optional(
			Schema.Array(
				Schema.Struct({
					code: Schema.String,
					floor: Schema.Union([Schema.Null, Schema.Number]),
					rate_max: Schema.Number,
					rate_min: Schema.Number,
					supp_max: Schema.Union([Schema.Null, Schema.Number]),
					supp_min: Schema.Union([Schema.Null, Schema.Number])
				})
			)
		),
		hundred_units: Schema.optional(Schema.Number),
		insurance_ceiling: Schema.optional(Schema.Number),
		insurance_employee_share: Schema.optional(Schema.Number),
		insurance_employer_share: Schema.optional(Schema.Number),
		insurance_floor: Schema.optional(Schema.Number),
		local_residencies: Schema.optional(Schema.Array(Schema.String)),
		long_tail_years: Schema.optional(Schema.Number),
		lower_rate_ceiling: Schema.optional(Schema.Number),
		lower_salary_step: Schema.optional(Schema.Number),
		manual_categories: Schema.optional(Schema.Array(Schema.String)),
		max_months: Schema.optional(Schema.Number),
		maximum_coverage_age_years: Schema.optional(Schema.Number),
		maximum_salary_credit: Schema.optional(Schema.Number),
		meal_exempt_monthly: Schema.optional(Schema.Number),
		midpoint_offset: Schema.optional(Schema.Number),
		minimum_chargeable: Schema.optional(Schema.Number),
		minimum_contract_months: Schema.optional(Schema.Number),
		minimum_salary_credit: Schema.optional(Schema.Number),
		minimum_service_days: Schema.optional(Schema.Number),
		minimum_service_deduction: Schema.optional(Schema.Number),
		minor_unit: Schema.optional(Schema.Number),
		missing_tax_id_multiplier: Schema.optional(Schema.Number),
		monthly_threshold_hours: Schema.optional(Schema.Number),
		monthly_wage: Schema.optional(Schema.Number),
		monthly_wage_threshold: Schema.optional(Schema.Number),
		nhi_supplement_payment_ceiling: Schema.optional(Schema.Number),
		nhi_supplement_rate: Schema.optional(Schema.Number),
		non_resident_rate: Schema.optional(Schema.Number),
		nonresident_rate: Schema.optional(Schema.Number),
		nursing_maximum_age_years: Schema.optional(Schema.Number),
		nursing_minimum_age_years: Schema.optional(Schema.Number),
		nursing_percent: Schema.optional(Schema.Number),
		old_system_cutoff: Schema.optional(Schema.String),
		ordinary_ceiling: Schema.optional(Schema.Number),
		ordinary_coverage_age_years: Schema.optional(Schema.Number),
		overtime_first_hours: Schema.optional(Schema.Number),
		overtime_first_multiplier: Schema.optional(Schema.Number),
		overtime_further_multiplier: Schema.optional(Schema.Number),
		overtime_multiples: Schema.optional(
			Schema.Struct({
				double_holiday: Schema.Number,
				double_holiday_rest: Schema.Number,
				double_special: Schema.Number,
				double_special_rest: Schema.Number,
				holiday: Schema.Number,
				holiday_rest: Schema.Number,
				ordinary: Schema.Number,
				rest: Schema.Number,
				special: Schema.Number,
				special_rest: Schema.Number
			})
		),
		paid_multiple: Schema.optional(Schema.Number),
		paid_share: Schema.optional(Schema.Number),
		parking_monthly_cap: Schema.optional(Schema.Number),
		part_time_hours_factor: Schema.optional(Schema.Number),
		pension_cap: Schema.optional(Schema.Number),
		pension_maximum_age_years: Schema.optional(Schema.Number),
		pension_maximum_grade: Schema.optional(Schema.Number),
		pension_minimum_grade: Schema.optional(Schema.Number),
		pension_rate: Schema.optional(Schema.Number),
		premium_excluded_categories: Schema.optional(Schema.Array(Schema.String)),
		reconstruction_multiplier: Schema.optional(Schema.Number),
		regular_fund_salary_credit_ceiling: Schema.optional(Schema.Number),
		retirement_exemption_per_service_year: Schema.optional(Schema.Number),
		rounding_step: Schema.optional(Schema.Number),
		salary_ceiling: Schema.optional(Schema.Number),
		salary_class_step: Schema.optional(Schema.Number),
		salary_credit_step: Schema.optional(Schema.Number),
		second_band_days: Schema.optional(Schema.Number),
		second_band_months: Schema.optional(Schema.Number),
		senior_age: Schema.optional(Schema.Number),
		service_months_cap: Schema.optional(Schema.Number),
		severance_daily_wages_limit: Schema.optional(Schema.Number),
		severance_exemption_limit: Schema.optional(Schema.Number),
		severance_taxed_grounds: Schema.optional(Schema.Array(Schema.String)),
		short_tail_years: Schema.optional(Schema.Number),
		si_employer_rate: Schema.optional(Schema.Number),
		special_establishment_weekly_hours: Schema.optional(Schema.Number),
		sss_employee_rate: Schema.optional(Schema.Number),
		sss_employer_rate: Schema.optional(Schema.Number),
		standard_daily_hours: Schema.optional(Schema.Number),
		standard_weekly_hours: Schema.optional(Schema.Number),
		support_rate: Schema.optional(Schema.Number),
		table_ceiling: Schema.optional(Schema.Number),
		tail_threshold_months: Schema.optional(Schema.Number),
		taxable_share: Schema.optional(Schema.Number),
		third_band_days: Schema.optional(Schema.Number),
		ui_cap_multiple: Schema.optional(Schema.Number),
		ui_employer_rate: Schema.optional(Schema.Number),
		unpaid_multiple: Schema.optional(Schema.Number),
		vietnamese_nationality: Schema.optional(Schema.Array(Schema.String)),
		weekly_limit: Schema.optional(Schema.Number),
		whole_unit: Schema.optional(Schema.Number),
		withholding_rate: Schema.optional(Schema.Number),
		year_days: Schema.optional(Schema.Number)
	}),
	cpf_bands: Schema.Array(
		Schema.Struct({ age: Schema.Number, key: Schema.String, phase: Schema.String })
	),
	cpf_rates: Schema.Struct({
		r1_high: Schema.Number,
		r1_low: Schema.Number,
		r1_mid: Schema.Number,
		r1_total: Schema.Number,
		r10_high: Schema.Number,
		r10_low: Schema.Number,
		r10_mid: Schema.Number,
		r10_total: Schema.Number,
		r11_high: Schema.Number,
		r11_low: Schema.Number,
		r11_mid: Schema.Number,
		r11_total: Schema.Number,
		r12_high: Schema.Number,
		r12_low: Schema.Number,
		r12_mid: Schema.Number,
		r12_total: Schema.Number,
		r13_high: Schema.Number,
		r13_low: Schema.Number,
		r13_mid: Schema.Number,
		r13_total: Schema.Number,
		r14_high: Schema.Number,
		r14_low: Schema.Number,
		r14_mid: Schema.Number,
		r14_total: Schema.Number,
		r15_high: Schema.Number,
		r15_low: Schema.Number,
		r15_mid: Schema.Number,
		r15_total: Schema.Number,
		r16_high: Schema.Number,
		r16_low: Schema.Number,
		r16_mid: Schema.Number,
		r16_total: Schema.Number,
		r17_high: Schema.Number,
		r17_low: Schema.Number,
		r17_mid: Schema.Number,
		r17_total: Schema.Number,
		r2_high: Schema.Number,
		r2_low: Schema.Number,
		r2_mid: Schema.Number,
		r2_total: Schema.Number,
		r3_high: Schema.Number,
		r3_low: Schema.Number,
		r3_mid: Schema.Number,
		r3_total: Schema.Number,
		r4_high: Schema.Number,
		r4_low: Schema.Number,
		r4_mid: Schema.Number,
		r4_total: Schema.Number,
		r5_high: Schema.Number,
		r5_low: Schema.Number,
		r5_mid: Schema.Number,
		r5_total: Schema.Number,
		r6_high: Schema.Number,
		r6_low: Schema.Number,
		r6_mid: Schema.Number,
		r6_total: Schema.Number,
		r7_high: Schema.Number,
		r7_low: Schema.Number,
		r7_mid: Schema.Number,
		r7_total: Schema.Number,
		r8_high: Schema.Number,
		r8_low: Schema.Number,
		r8_mid: Schema.Number,
		r8_total: Schema.Number,
		r9_high: Schema.Number,
		r9_low: Schema.Number,
		r9_mid: Schema.Number,
		r9_total: Schema.Number
	}),
	day_multiples: Schema.Struct({
		double_holiday: Schema.Number,
		double_holiday_rest: Schema.Number,
		double_special: Schema.Number,
		double_special_rest: Schema.Number,
		holiday: Schema.Number,
		holiday_rest: Schema.Number,
		ordinary: Schema.Number,
		rest: Schema.Number,
		special: Schema.Number,
		special_rest: Schema.Number
	}),
	ei_employer_rate: Schema.Struct({
		AGRICULTURE_SAKE: Schema.Number,
		CONSTRUCTION: Schema.Number,
		GENERAL: Schema.Number
	}),
	employee_rate: Schema.Struct({
		AGRICULTURE_SAKE: Schema.Number,
		CONSTRUCTION: Schema.Number,
		GENERAL: Schema.Number
	}),
	ladder: Schema.Array(
		Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
	),
	li_grades: Schema.Array(Schema.Number),
	li_part_time_grades: Schema.Array(Schema.Number),
	minimum_wage: Schema.Struct({
		by_region: Schema.Struct({
			I: Schema.Number,
			II: Schema.Number,
			III: Schema.Number,
			IV: Schema.Number
		}),
		prior_by_region: Schema.optional(
			Schema.Struct({ I: Schema.Number, II: Schema.Number, III: Schema.Number, IV: Schema.Number })
		)
	}),
	minimum_wage_by_region: Schema.Array(
		Schema.Struct({ from: Schema.String, monthly: Schema.Number, region: Schema.String })
	),
	minimum_wage_by_zone: Schema.Array(
		Schema.Struct({
			default_zone: Schema.String,
			excludes_employee_contributions: Schema.Boolean,
			hourly: Schema.Number,
			monthly: Schema.Number,
			region: Schema.String,
			zone: Schema.String
		})
	),
	minimum_wage_domestic: Schema.Array(
		Schema.Struct({ from: Schema.String, monthly: Schema.Number, region: Schema.String })
	),
	monthly_ladder: Schema.Array(
		Schema.Struct({
			quick: Schema.Number,
			rate: Schema.Number,
			up_to: Schema.Union([Schema.Null, Schema.Number])
		})
	),
	nhi_grades: Schema.Array(Schema.Number),
	prefecture_rate_percent: Schema.Struct({
		AICHI: Schema.Number,
		AKITA: Schema.Number,
		AOMORI: Schema.Number,
		CHIBA: Schema.Number,
		EHIME: Schema.Number,
		FUKUI: Schema.Number,
		FUKUOKA: Schema.Number,
		FUKUSHIMA: Schema.Number,
		GIFU: Schema.Number,
		GUNMA: Schema.Number,
		HIROSHIMA: Schema.Number,
		HOKKAIDO: Schema.Number,
		HYOGO: Schema.Number,
		IBARAKI: Schema.Number,
		ISHIKAWA: Schema.Number,
		IWATE: Schema.Number,
		KAGAWA: Schema.Number,
		KAGOSHIMA: Schema.Number,
		KANAGAWA: Schema.Number,
		KOCHI: Schema.Number,
		KUMAMOTO: Schema.Number,
		KYOTO: Schema.Number,
		MIE: Schema.Number,
		MIYAGI: Schema.Number,
		MIYAZAKI: Schema.Number,
		NAGANO: Schema.Number,
		NAGASAKI: Schema.Number,
		NARA: Schema.Number,
		NIIGATA: Schema.Number,
		OITA: Schema.Number,
		OKAYAMA: Schema.Number,
		OKINAWA: Schema.Number,
		OSAKA: Schema.Number,
		SAGA: Schema.Number,
		SAITAMA: Schema.Number,
		SHIGA: Schema.Number,
		SHIMANE: Schema.Number,
		SHIZUOKA: Schema.Number,
		TOCHIGI: Schema.Number,
		TOKUSHIMA: Schema.Number,
		TOKYO: Schema.Number,
		TOTTORI: Schema.Number,
		TOYAMA: Schema.Number,
		WAKAYAMA: Schema.Number,
		YAMAGATA: Schema.Number,
		YAMAGUCHI: Schema.Number,
		YAMANASHI: Schema.Number
	}),
	pwm_roles: Schema.Struct({
		ADMIN_ASSISTANT: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		ADMIN_EXECUTIVE: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		ADMIN_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_CONSERVANCY_GENERAL: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_CONSERVANCY_MULTI_SKILLED: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_CONSERVANCY_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_CONSERVANCY_TRUCK_DRIVER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_FNB_DISHWASHER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_FNB_GENERAL: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_FNB_MULTI_SKILLED: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_FNB_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_FNB_TABLE_TOP: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_OFFICE_GENERAL: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_OFFICE_MULTI_SKILLED: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_OFFICE_OUTDOOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		CLEAN_OFFICE_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		DRIVER_GENERAL: Schema.optional(
			Schema.Struct({ base: Schema.String, monthly_floor: Schema.Number, sector: Schema.String })
		),
		DRIVER_GROUP_A_LEVEL_1: Schema.optional(
			Schema.Struct({
				base: Schema.String,
				monthly_floor: Schema.Number,
				sector: Schema.String,
				steps: Schema.optional(
					Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
				)
			})
		),
		DRIVER_GROUP_A_LEVEL_2: Schema.optional(
			Schema.Struct({
				base: Schema.String,
				monthly_floor: Schema.Number,
				sector: Schema.String,
				steps: Schema.optional(
					Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
				)
			})
		),
		DRIVER_GROUP_B_LEVEL_1: Schema.optional(
			Schema.Struct({
				base: Schema.String,
				monthly_floor: Schema.Number,
				sector: Schema.String,
				steps: Schema.optional(
					Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
				)
			})
		),
		DRIVER_GROUP_B_LEVEL_2: Schema.optional(
			Schema.Struct({
				base: Schema.String,
				monthly_floor: Schema.Number,
				sector: Schema.String,
				steps: Schema.optional(
					Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
				)
			})
		),
		DRIVER_SPECIALISED: Schema.optional(
			Schema.Struct({ base: Schema.String, monthly_floor: Schema.Number, sector: Schema.String })
		),
		FOOD_FS_COOK: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		FOOD_FS_KITCHEN_ASSISTANT: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		FOOD_FS_WAITER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		FOOD_FS_WAITER_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		FOOD_QS_COOK: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		FOOD_QS_KITCHEN_ASSISTANT: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		FOOD_QS_STALL_ASSISTANT: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LANDSCAPE_ASSISTANT_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LANDSCAPE_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LANDSCAPE_TECHNICIAN: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LANDSCAPE_WORKER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LIFT_ASSISTANT_SPECIALIST: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LIFT_PRINCIPAL_SPECIALIST: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LIFT_SENIOR_SPECIALIST: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LIFT_SPECIALIST: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		LIFT_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		RETAIL_ASSISTANT: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		RETAIL_ASSISTANT_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		RETAIL_SENIOR_ASSISTANT: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		SECURITY_INHOUSE_OFFICER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		SECURITY_INHOUSE_SENIOR_OFFICER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		SECURITY_INHOUSE_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		SECURITY_OUTSOURCED_OFFICER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		SECURITY_OUTSOURCED_SENIOR_OFFICER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		SECURITY_OUTSOURCED_SENIOR_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		SECURITY_OUTSOURCED_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_COLLECTION_CREW: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_COLLECTION_DRIVER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_COLLECTION_HOOKLIFT_DRIVER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_COLLECTION_SENIOR_CREW: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_COLLECTION_SENIOR_DRIVER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_COLLECTION_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_COLLECTION_TEAM_LEAD: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_MRF_PLANT_SUPERVISOR: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_MRF_SENIOR_SORTER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_MRF_SORTER: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		}),
		WASTE_MRF_TEAM_LEAD: Schema.Struct({
			base: Schema.String,
			monthly_floor: Schema.Number,
			sector: Schema.String,
			steps: Schema.optional(
				Schema.Array(Schema.Struct({ from: Schema.String, monthly_floor: Schema.Number }))
			)
		})
	}),
	remuneration_grades: Schema.Array(
		Schema.Struct({ amount: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
	),
	retirement: Schema.Array(
		Schema.Struct({
			base_years: Schema.Number,
			birth_months_per_step: Schema.Number,
			category: Schema.String,
			cutoff: Schema.String,
			max_deferral_months: Schema.Number
		})
	),
	retirement_eligibility: Schema.Array(
		Schema.Struct({ age: Schema.Union([Schema.Null, Schema.Number]), months: Schema.Number })
	),
	schedule: Schema.Array(
		Schema.Struct({ amount: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
	),
	si_base: Schema.Array(
		Schema.Struct({ ceiling: Schema.Number, code: Schema.String, floor: Schema.Number })
	)
} as const;

export type TableKey = keyof typeof TABLES;
export const tableOf = (key: string): (typeof TABLES)[TableKey] | undefined =>
	TABLES[key as TableKey];

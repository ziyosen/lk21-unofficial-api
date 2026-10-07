const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
require("dotenv").config();

/* getEpisode (detail series): map struktur HTML tv9.
   Perbaikan 2026-10-08 (Muse, untuk cross-review Hermes):
   - Sinopsis dibersihkan: hanya isi sinopsisnya. Buang awalan
     "Nonton <judul>,", potong di "Dibintangi oleh", dan buang ekor
     promosi "hanya di Lk21 / Streaming kualitas HD subtitle Indonesia".
   - Season TIDAK lagi diambil dari semua span.duration (itu ikut
     membaca kartu series terkait -> S.5/S.13 palsu). Season diambil
     dari pola "Season X dari Y", opsi pemilih season, dan nomor
     season yang benar-benar ada di tautan episode.
   - Episode dikumpulkan dari SEMUA tautan <a href> (relatif maupun
     absolut), dinormalkan, lalu dilengkapi dengan membuka halaman
     episode perwakilan tiap season (grid episode tinggal di sana).
   - Field baru: season_count, episodes_by_season, votes, directors,
     status, release. Field lama tetap dipertahankan. */

function bersihSinopsis(teks, judul) {
    if (!teks) return "N/A";
    let s = String(teks).replace(/\s+/g, " ").trim();
    s = s.replace(/^nonton\s+/i, "");
    if (judul) {
        const j = String(judul).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        s = s.replace(new RegExp("^" + j + "\\s*,?\\s*", "i"), "");
    }
    s = s.split(/\s+Dibintangi oleh\s+/i)[0];
    s = s.split(/\s+hanya di\s+/i)[0];
    s = s.replace(/Streaming kualitas HD subtitle Indonesia\.?/gi, "");
    s = s.replace(/\s+di Lk21\b.*$/i, "");
    s = s.trim();
    if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
    return s || "N/A";
}

function kumpulkanEpisode($, htmlMentah) {
    const ketemu = new Map();
    const pola = /-season-(\d+)-episode-(\d+)-(\d{4})$/i;
    function tambah(path) {
        if (!path) return;
        let bersih = String(path);
        try { bersih = new URL(bersih, "https://tv9.nontondrama.my").pathname; } catch (e) {}
        bersih = bersih.split("?")[0].replace(/\/$/, "");
        const m = pola.exec(bersih);
        if (!m) return;
        const season = parseInt(m[1], 10), episode = parseInt(m[2], 10);
        ketemu.set(bersih, {
            label: bersih.split("/").pop(),
            href: bersih,
            season,
            episode,
            judul: `S${season} E${episode}`
        });
    }
    $("a[href]").each((i, el) => tambah($(el).attr("href")));
    const re = /href="([^"]*-season-\d+-episode-\d+-\d{4})"/gi;
    let m;
    while ((m = re.exec(htmlMentah || "")) !== null) tambah(m[1]);
    return [...ketemu.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

function nomorSeasonDari(teks, episodes) {
    const himpunan = new Set(episodes.map(e => e.season));
    const md = /Season\s+(\d+)\s+dari\s+(\d+)/i.exec(teks || "");
    let total = md ? parseInt(md[2], 10) : 0;
    if (himpunan.size) total = Math.max(total, ...himpunan);
    const daftar = [];
    for (let s = 1; s <= total; s++) daftar.push(s);
    return { total: daftar.length, daftar };
}

async function getEpisode(idSeries) {
    try {
        const url = `${process.env.LK21_BASE_SERIES}${idSeries}`;
        const response = await ambil(url);
        const $ = cheerio.load(response.data);
        const teksHalaman = $("body").text().replace(/\s+/g, " ");

        let title = $("h1").first().text().trim() || "N/A";
        if (/dialihkan/i.test(title)) {
            const og = $('meta[property="og:title"]').attr("content") || "";
            title = og.replace(/\s*[|\-–].*$/, "").trim() || "N/A";
        }
        const image =
            $('meta[property="og:image"]').attr("content") ||
            $("img[itemprop='image']").attr("src") || null;
        const rating =
            $("span[itemprop='ratingValue']").first().text().trim() ||
            $(".rating-score").first().text().trim() || "N/A";
        const genres =
            $('meta[itemprop="genre"]').attr("content") ||
            $("div.genre").first().text().trim() || "N/A";

        /* info <p><span>Label: </span>...</p> */
        const info = {};
        $("p").each((i, el) => {
            const label = $(el).find("span").first().text().trim().replace(/:$/, "");
            if (!label) return;
            const links = [];
            $(el).find("a").each((j, a) => links.push($(a).text().trim()));
            const teks = $(el).clone().children("span").remove().end().text().trim();
            if (links.length) info[label] = links.filter(Boolean);
            else if (teks) info[label] = teks;
        });

        const stars = info["Bintang Film"] || [];
        const country = Array.isArray(info["Negara"]) ? info["Negara"][0] : (info["Negara"] || "N/A");
        const terbaruMentah = info["Terbaru"];
        const terbaru = Array.isArray(terbaruMentah) ? terbaruMentah.join(", ") : (terbaruMentah || "N/A");
        const directorsRaw = info["Sutradara"] || info["Director"] || [];
        const directors = Array.isArray(directorsRaw) ? directorsRaw : String(directorsRaw).split(",").map(s => s.trim()).filter(Boolean);
        const status = info["Status"] || "N/A";
        const release = info["Diterbitkan"] || info["Tanggal Rilis"] || info["Rilis"] || "N/A";
        const mv = /([\d][\d.]*)\s*(pengguna|votes|vote|penilai)/i.exec(teksHalaman);
        const votes = info["Votes"] || info["Vote"] || (mv ? mv[1] : null);

        /* Sinopsis: p panjang yang bukan meta — pilih kandidat TERBAIK
           (terpanjang), buang pemberitahuan/boilerplate situs */
        let synopsis = "N/A";
        $("p").each((i, el) => {
            const t = $(el).text().trim();
            if (t.length > 80 &&
                !/komentar|diskusi|Follow update|Jangan sampai ketinggalan|dialihkan|nontondrama|halaman tidak berganti|melaporkan kendala|telegram group/i.test(t)) {
                if (synopsis === "N/A" || t.length > synopsis.length) synopsis = t;
            }
        });
        synopsis = bersihSinopsis(synopsis, title);

        /* Episode dari halaman series */
        let episodes = kumpulkanEpisode($, response.data);
        let infoSeason = nomorSeasonDari(teksHalaman, episodes);

        /* Lengkapi grid: buka halaman episode perwakilan untuk season
           yang episode-nya belum lengkap/ketemu. Pola slug episode
           ditiru dari episode yang sudah ketemu. */
        if (episodes.length) {
            const contoh = episodes[0].href;
            const perSeason = {};
            episodes.forEach(e => { (perSeason[e.season] ||= []).push(e); });
            const halamanDibuka = new Set();
            for (const s of infoSeason.daftar) {
                const sudah = perSeason[s] || [];
                if (sudah.length > 2) continue;
                const kandidat = contoh.replace(/-season-\d+-episode-\d+-/, `-season-${s}-episode-1-`);
                if (halamanDibuka.has(kandidat) || halamanDibuka.size >= 6) continue;
                halamanDibuka.add(kandidat);
                try {
                    const hal = await ambil(`${process.env.LK21_BASE_SERIES}${kandidat.replace(/^\//, "")}`);
                    const $e = cheerio.load(hal.data);
                    const tambahan = kumpulkanEpisode($e, hal.data);
                    const gabung = new Map(episodes.map(e => [e.href, e]));
                    tambahan.forEach(e => gabung.set(e.href, e));
                    episodes = [...gabung.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
                } catch (e) { /* season itu tidak bisa dibuka: biarkan apa adanya */ }
            }
            infoSeason = nomorSeasonDari(teksHalaman, episodes);
        }

        const episodes_by_season = {};
        episodes.forEach(e => { (episodes_by_season[e.season] ||= []).push(e); });
        const seasons = infoSeason.daftar.map(s => `S.${s}`);
        const total_eps = episodes.length || null;

        return {
            slug: idSeries,
            title,
            image,
            rating,
            genres,
            stars,
            country,
            terbaru,
            seasons,
            season_count: seasons.length,
            total_eps,
            episodes,
            episodes_by_season,
            votes,
            directors,
            status,
            release,
            synopsis
        };

    } catch (err) {
        console.error("Terjadi kesalahan saat mengambil data getEpisode:", err.message);
        throw err;
    }
}

module.exports = {
    getEpisode
};

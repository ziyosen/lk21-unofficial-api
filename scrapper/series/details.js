const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
require("dotenv").config();

/* getEpisode (detail series) — sumber lk21asia.com (tema GMR/muvipro).
   Halaman show: /tv/<slug>/ — judul h1.entry-title, poster og:image,
   meta di baris .gmr-moviedata (Genre/Tahun/Negara/Rilis/Jumlah Episode/
   Direksi/Pemain/Tanggal Terakhir Mengudara), daftar episode di
   .gmr-listseries dgn tautan /eps/<slug>-season-N-episode-N-YYYY/.
   href episode disimpan satu segmen ("/<slug-episode>") supaya playSlug
   frontend (href.split("/").join("")) jadi slug episode yang benar.
   Bentuk balikan sama dgn getEpisode lama (tv9) supaya frontend & route
   /series/:slug/stream tidak berubah. */
async function getEpisode(idSeries) {
    try {
        const url = `${process.env.LK21_BASE_SERIES}tv/${idSeries}/`;
        const response = await ambil(url);
        const $ = cheerio.load(response.data);
        const titleTag = ($("title").text() || "");
        if (/tidak ditemukan|not found/i.test(titleTag)) {
            throw new Error("Series tidak ditemukan: " + idSeries);
        }
        const title = $("h1.entry-title").first().text().trim()
            || $("h1").first().text().trim() || "N/A";
        const image = $("meta[property=\"og:image\"]").attr("content")
            || $("img[itemprop=\"image\"]").attr("src") || null;
        let rating = $("span[itemprop=\"ratingValue\"]").first().text().trim() || "N/A";
        if (rating === "N/A") {
            const rtxt = $(".gmr-rating-item").first().text().trim();
            const rm = rtxt.match(/[\d.]+/);
            if (rm) rating = rm[0];
        }

        const info = {};
        $(".gmr-moviedata").each((i, el) => {
            const label = $(el).find("strong").first().text().trim().replace(/:$/, "");
            if (!label) return;
            const links = [];
            $(el).find("a").each((j, a) => links.push($(a).text().trim()));
            const teks = $(el).clone().children("strong").remove().end().text().trim().replace(/\s+/g, " ");
            if (links.length) info[label] = links.filter(Boolean);
            else if (teks) info[label] = teks;
        });
        const genres = info["Genre"] ? (Array.isArray(info["Genre"]) ? info["Genre"].join(", ") : info["Genre"]) : "N/A";
        const country = Array.isArray(info["Negara"]) ? info["Negara"][0] : (info["Negara"] || "N/A");
        const release = info["Rilis"] || "N/A";
        const terbaru = info["Tanggal Terakhir Mengudara"] || "N/A";
        const totalEpsMeta = info["Jumlah Episode"] ? parseInt(String(info["Jumlah Episode"]).replace(/\D/g, ""), 10) : null;
        const directors = info["Direksi"] ? (Array.isArray(info["Direksi"]) ? info["Direksi"] : String(info["Direksi"]).split(",").map((s) => s.trim()).filter(Boolean)) : [];
        const stars = info["Pemain"] ? (Array.isArray(info["Pemain"]) ? info["Pemain"] : String(info["Pemain"]).split(",").map((s) => s.trim()).filter(Boolean)) : [];
        const status = info["Status"] || "N/A";
        const votes = null;

        let synopsis = "N/A";
        /* Sinopsis asli tinggal di .entry-content-single (paragraf pertama).
           Jangan pakai heuristik <p> terpanjang: footer situs punya
           paragraf boilerplate ("Koleksi yang tersedia diperbarui..."). */
        $(".entry-content-single p").each((i, el) => {
            if (synopsis !== "N/A") return;
            const t = $(el).text().trim();
            if (t.length > 40 && !/lk21|subtitle|streaming online|tanpa buffering|\bnonton\b|koleksi yang tersedia|diperbarui secara berkala/i.test(t)) {
                synopsis = t;
            }
        });
        if (synopsis === "N/A") {
            $("p").each((i, el) => {
                const t = $(el).text().trim();
                if (t.length > 80 && !/lk21|subtitle|streaming online|tanpa buffering|\bnonton\b|koleksi yang tersedia|diperbarui secara berkala/i.test(t)) {
                    if (synopsis === "N/A" || t.length > synopsis.length) synopsis = t;
                }
            });
        }
        if (synopsis === "N/A") {
            const og = $("meta[property=\"og:description\"]").attr("content") || "";
            synopsis = og.replace(/^nonton\s+/i, "").replace(/\s*subtitle indonesia.*$/i, "").trim() || "N/A";
        }

        const episodes = [];
        const seen = new Set();
        const pola = /-season-(\d+)-episode-(\d+)(?:-(\d{4}))?$/i;
        $("a[href*=\"/eps/\"]").each((i, el) => {
            const href = $(el).attr("href") || "";
            const path = href.split("?")[0].replace(/\/$/, "");
            const m = pola.exec(path);
            if (!m) return;
            const slugEp = path.split("/").filter(Boolean).pop();
            const hrefSatu = "/" + slugEp;
            if (seen.has(hrefSatu)) return;
            seen.add(hrefSatu);
            episodes.push({
                label: slugEp,
                href: hrefSatu,
                season: parseInt(m[1], 10),
                episode: parseInt(m[2], 10),
                judul: `S${m[1]} E${m[2]}`
            });
        });
        episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
        const seasonsSet = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
        const episodes_by_season = {};
        episodes.forEach((e) => { (episodes_by_season[e.season] ||= []).push(e); });
        const seasons = seasonsSet.map((s) => `S.${s}`);
        const total_eps = episodes.length || totalEpsMeta || null;

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

module.exports = { getEpisode };

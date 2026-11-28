/* Multi-source film (28 Nov 2026): base 1 lk21asia.com (utama) + base 2
   layarkaca21.city (cadangan). Kedua situs tema WP Muvipro/GMR yang sama,
   parser listing (parseListing) kompatibel tanpa perubahan. */
require("dotenv").config();
const cheerio = require("cheerio");
const { ambil } = require("./fetcher");
const { parseListing } = require("./listing");

function movieBases() {
    // Semua base film (28 Nov 2026): 1 lk21asia + 2 layarkaca21.city + 3 lk21official
    // + 4 idlix + 5 zonafilm. /play butuh semuanya (zonafilm = byselapuix).
    const bases = [process.env.LK21_BASE_MOVIE, process.env.LK21_BASE_MOVIE_2, process.env.LK21_BASE_MOVIE_3, process.env.LK21_BASE_MOVIE_4, process.env.LK21_BASE_MOVIE_5].filter(Boolean);
    return [...new Set(bases.map((b) => (b.endsWith("/") ? b : b + "/")))];
}

function isPrimaryBase(base) {
    const p = (process.env.LK21_BASE_MOVIE || "").replace(/\/+$/, "");
    return base.replace(/\/+$/, "") === p;
}

/* Listing dari semua base film secara paralel, gabung + dedup berdasarkan slug.
   urlForBase: (base) => URL listing untuk base itu. total_pages = nilai terbesar.
   Satu base yang gagal/404 tidak menggagalkan hasil dari base lain. */
async function fetchListings(urlForBase) {
    const bases = movieBases();
    const settled = await Promise.allSettled(bases.map(async (base) => {
        const resp = await ambil(urlForBase(base));
        const $ = cheerio.load(resp.data);
        return parseListing($);
    }));
    const seen = new Set();
    const movies = [];
    let total_pages = 0;
    for (const s of settled) {
        if (s.status !== "fulfilled" || !s.value) continue;
        const tp = s.value.total_pages || 0;
        if (tp > total_pages) total_pages = tp;
        for (const m of (s.value.movies || [])) {
            const key = (m && m.slug) || "";
            if (!key || key === "N/A" || seen.has(key)) continue;
            seen.add(key);
            movies.push(m);
        }
    }
    if (!movies.length) {
        const err = new Error("Semua base film gagal / 0 hasil");
        err.code = "ALL_BASES_FAILED";
        throw err;
    }
    return { total_pages, movies };
}

/* Detail film: coba base 1, kalau gagal (404/500) coba base 2.
   Mengembalikan { base, data }. */
async function fetchDetail(slug) {
    let lastErr = null;
    for (const base of movieBases()) {
        try {
            const resp = await ambil(base + slug);
            return { base, data: resp.data };
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("Detail film tidak ditemukan di semua base");
}

module.exports = { movieBases, isPrimaryBase, fetchListings, fetchDetail };

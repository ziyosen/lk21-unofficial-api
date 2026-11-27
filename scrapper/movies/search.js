const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
const { parseListing } = require("../listing");
require("dotenv").config();

/* searchMovie: pakai API JSON search lk21 (data-search_url di halaman search).
   Wajib header AJAX (X-Requested-With + Referer) — sudah dibawa fetcher.
   Response: { totalPages, data: [{slug,title,poster,quality,rating,runtime,season,episode,is_complete}] } */

const SEARCH_API = process.env.LK21_SEARCH_API || "https://gudangvape.com/";

async function searchMovie(params, page = 1) {
    try {
        const url = `${SEARCH_API}search.php?s=${encodeURIComponent(params)}&page=${encodeURIComponent(page)}`;
        const response = await ambil(url);
        let json;
        try {
            json = JSON.parse(response.data);
        } catch (e) {
            throw new Error("Search API tidak mengembalikan JSON (kemungkinan challenge)");
        }
        const hasil = (json.data || []).map((m) => {
            const type = (m.season > 0 || m.episode > 0 || m.is_complete) ? "series" : "movie";
            return {
                slug: m.slug,
                title: m.title,
                year: (m.slug.match(/-(\d{4})$/) || [])[1] || "",
                /* images: dipakai front end; image: kompatibilitas lama */
                images: m.poster ? "https://poster.assetsy.de/wp-content/uploads/" + m.poster : null,
                image: m.poster ? "https://poster.assetsy.de/wp-content/uploads/" + m.poster : null,
                quality: m.quality || "N/A",
                rating: m.rating || "N/A",
                runtime: m.runtime || "N/A",
                type
            };
        });
        /* Sumber kedua: search situs layarkaca21.city sendiri (/?s=) — slug
           search-API hanya ~40% cocok dengan katalog base 2. Hasil digabung +
           dedup by slug. Gagal tidak menggagalkan search utama. */
        try {
            const base2 = process.env.LK21_BASE_MOVIE_2;
            if (base2 && Number(page) === 1) {
                const r2 = await ambil(base2 + "?s=" + encodeURIComponent(params));
                const $2 = cheerio.load(r2.data);
                const { movies } = parseListing($2);
                const seen = new Set(hasil.map((m) => m.slug));
                for (const m of (movies || [])) {
                    if (!m.slug || m.slug === "N/A" || seen.has(m.slug)) continue;
                    seen.add(m.slug);
                    hasil.push({
                        slug: m.slug, title: m.title, year: m.year || "",
                        images: m.images && m.images !== "N/A" ? m.images : null,
                        image: m.images && m.images !== "N/A" ? m.images : null,
                        quality: m.quality || "N/A", rating: m.rating || "N/A",
                        runtime: m.duration || "N/A",
                        type: m.is_series ? "series" : "movie"
                    });
                }
            }
        } catch (e) { /* search base 2 opsional, abaikan */ }
        return { results: hasil, total_pages: json.totalPages || 1, page: Number(page) || 1 };
    } catch (err) {
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = { searchMovie }

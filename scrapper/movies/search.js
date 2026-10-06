const { ambil } = require("../fetcher");
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
                image: m.poster ? "https://poster.assetsy.de/wp-content/uploads/" + m.poster : null,
                quality: m.quality || "N/A",
                rating: m.rating || "N/A",
                runtime: m.runtime || "N/A",
                type
            };
        });
        return { results: hasil, total_pages: json.totalPages || 1, page: Number(page) || 1 };
    } catch (err) {
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = { searchMovie }

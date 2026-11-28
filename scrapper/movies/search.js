const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
const { parseListing } = require("../listing");
const { wpBases, wpSearch } = require("./wpsource");
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
        /* Sumber tambahan (page 1 saja, paralel, gagal tidak menggagalkan
           search utama):
           - search HTML layarkaca21.city sendiri (/?s=) — slug search-API
             hanya ~40% cocok dengan katalog base 2.
           - search wp-json lk21official + idlix (posts?search=).
           Hasil digabung + dedup by slug+judul (slug sama tapi judul beda
           dipertahankan keduanya). */
        if (Number(page) === 1) {
            const jobs = [];
            const base2 = process.env.LK21_BASE_MOVIE_2;
            if (base2) {
                jobs.push((async () => {
                    const r2 = await ambil(base2 + "?s=" + encodeURIComponent(params));
                    const $2 = cheerio.load(r2.data);
                    const { movies } = parseListing($2);
                    return (movies || []).map((m) => ({
                        slug: m.slug, title: m.title, year: m.year || "",
                        images: m.images && m.images !== "N/A" ? m.images : null,
                        image: m.images && m.images !== "N/A" ? m.images : null,
                        quality: m.quality || "N/A", rating: m.rating || "N/A",
                        runtime: m.duration || "N/A",
                        type: m.is_series ? "series" : "movie"
                    }));
                })());
            }
            for (const s of wpBases()) {
                jobs.push((async () => {
                    const { movies } = await wpSearch(s.base, params, 1);
                    return (movies || []).map((m) => ({
                        slug: m.slug, title: m.title, year: m.year || "",
                        images: m.images || null, image: m.images || null,
                        quality: m.quality || "N/A", rating: m.rating || "N/A",
                        runtime: m.duration || "N/A",
                        type: m.is_series ? "series" : "movie",
                        source: s.name
                    }));
                })());
            }
            const settled = await Promise.allSettled(jobs);
            const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            const seenKey = new Set(hasil.map((m) => `${m.slug}|${norm(m.title)}`));
            for (const s of settled) {
                if (s.status !== "fulfilled") continue;
                for (const m of s.value || []) {
                    if (!m.slug || m.slug === "N/A") continue;
                    const key = `${m.slug}|${norm(m.title)}`;
                    if (seenKey.has(key)) continue;
                    seenKey.add(key);
                    hasil.push(m);
                }
            }
        }
        return { results: hasil, total_pages: json.totalPages || 1, page: Number(page) || 1 };
    } catch (err) {
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = { searchMovie }

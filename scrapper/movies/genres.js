const { movieBases } = require("../bases");
const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
require("dotenv").config()

async function getGenresMovies() {
    try{
        // Genre dari kedua base (homepage masing-masing), gabung + dedup by href.
        // Catatan: lk21asia pakai slug Indonesia (aksi), layarkaca21.city pakai
        // slug Inggris (action) — keduanya dipertahankan, route /genre memakai
        // peta GENRE_ID di bygenre.js.
        const bases = movieBases();
        const settled = await Promise.allSettled(bases.map(async (base) => {
            const response = await ambil(base, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
                }
            });
            const $ = cheerio.load(response.data);
            const genres = [];
            const seen = new Set();
            $('a[href*="/genre/"], a[href*="/category/"]').each((i, el) => {
                const name = $(el).text().trim();
                const link = $(el).attr("href");
                const href = new URL(link, base).pathname.split('/').filter(Boolean).pop();
                if (!href || seen.has(href)) return;
                seen.add(href);
                genres.push({name, href});
            });
            return genres;
        }));
        const seen = new Set();
        const genres = [];
        for (const s of settled) {
            if (s.status !== "fulfilled") continue;
            for (const g of (s.value || [])) {
                if (seen.has(g.href)) continue;
                seen.add(g.href);
                genres.push(g);
            }
        }
        if (!genres.length) throw new Error("Genre tidak ditemukan di semua base");
        return genres;
    } catch(err){
        console.log("error: ", err)
        throw err;
    }
}

module.exports = {
    getGenresMovies
}

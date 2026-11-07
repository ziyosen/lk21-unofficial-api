const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
require("dotenv").config();

/* Listing series — sumber lk21asia.com (tema GMR).
   Genre di sana: /category/<slug>/ (bukan /genre/).
   Hasil difilter series saja (is_series dari parser GMR). */
async function getSeriesByGenre(genreid, page = 1) {
    try {
        const base = process.env.LK21_BASE_SERIES;
        const fetchPage = async (p) => {
            const url = p > 1 ? `${base}category/${genreid}/page/${p}/` : `${base}category/${genreid}/`;
            const response = await ambil(url);
            const $ = cheerio.load(response.data);
            return require("../listing").parseListing($);
        };
        let { total_pages, movies } = await fetchPage(page);
        const series = movies.filter((x) => x.is_series);
        let p = page;
        while (page === 1 && series.length < 8 && p < Math.min(total_pages, 3)) {
            p += 1;
            const next = await fetchPage(p);
            total_pages = next.total_pages;
            for (const it of next.movies.filter((x) => x.is_series)) {
                if (!series.find((s) => s.slug === it.slug)) series.push(it);
            }
        }
        return { total_pages, series };
    } catch (err) {
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = {
    getSeriesByGenre,
};

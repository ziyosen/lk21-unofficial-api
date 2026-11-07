const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
require("dotenv").config();

/* Listing series per negara — sumber lk21asia.com (tema GMR).
   Slug negara di sana beda dgn API lama: south-korea -> korea, uk -> united-kingdom. */
const MAP_NEGARA = {
    "south-korea": "korea", "southkorea": "korea", "korea-selatan": "korea",
    "uk": "united-kingdom", "inggris": "united-kingdom", "britain": "united-kingdom",
    "usa": "usa", "amerika": "usa", "amerika-serikat": "usa", "us": "usa",
    "japan": "japan", "jepang": "japan",
    "china": "china", "cina": "china", "tiongkok": "china",
    "thailand": "thailand", "india": "india", "vietnam": "viet-nam"
};
async function getSeriesByCountry(countryid, page = 1) {
    try {
        const base = process.env.LK21_BASE_SERIES;
        const id = MAP_NEGARA[String(countryid).toLowerCase()] || countryid;
        const fetchPage = async (p) => {
            const url = p > 1 ? `${base}country/${id}/page/${p}/` : `${base}country/${id}/`;
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
    getSeriesByCountry,
};

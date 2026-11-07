const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
require("dotenv").config();

async function getGenresSeries() {
    try {
        const response = await ambil(process.env.LK21_BASE_SERIES);
        const $ = cheerio.load(response.data);
        const genres = [];
        const seen = new Set();
        $("a[href*=\"/category/\"]").each((i, el) => {
            const name = $(el).text().trim();
            const link = $(el).attr("href");
            if (!link || !name) return;
            const href = new URL(link, process.env.LK21_BASE_SERIES).pathname.split("/").filter(Boolean).pop();
            if (!href || href === "uncategorized" || seen.has(href)) return;
            seen.add(href);
            genres.push({ name, href });
        });
        return genres;
    } catch (err) {
        console.log("error: ", err);
        throw err;
    }
}

module.exports = {
    getGenresSeries
};

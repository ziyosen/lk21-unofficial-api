const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
require("dotenv").config();

/* Listing series generik — pakai parser bersama listing.js */
async function getSeriesByGenre(genreid, page = 1) {
    try {
        let url = `${process.env.LK21_BASE_SERIES}genre/${genreid}`;
        if (page > 1) {
            url = `${process.env.LK21_BASE_SERIES}genre/${genreid}/page/${page}`;
        }

        const response = await ambil(url);
        const $ = cheerio.load(response.data);
        const { total_pages, movies: series } = require("../listing").parseListing($);
        return { total_pages, series };

    } catch (err) {
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = {
    getSeriesByGenre,
};

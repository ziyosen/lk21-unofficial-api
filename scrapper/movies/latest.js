const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
const { parseListing } = require("../listing");
require("dotenv").config()

async function latestMovies(page = 1) {
    try {
        let url = `${process.env.LK21_BASE_MOVIE}latest/`;
        if (page > 1) {
            url = `${process.env.LK21_BASE_MOVIE}latest/page/${page}/`;
        }
        const response = await ambil(url);
        const $ = cheerio.load(response.data);
        return parseListing($);
    } catch (err) {
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = { latestMovies }

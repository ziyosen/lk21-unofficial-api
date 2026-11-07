const axios = require("axios");
const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
require("dotenv").config()

async function getGenresMovies() {
    try{
        const response = await ambil(process.env.LK21_BASE_MOVIE, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
            }
        });
        const $ = cheerio.load(response.data);
        const genres = [];
        const seen = new Set();
        $('a[href*="/genre/"]').each((i, el) => {
            const name = $(el).text().trim();
            const link = $(el).attr("href");
            const href = new URL(link, process.env.LK21_BASE_MOVIE).pathname.split('/').filter(Boolean).pop();;
            if (seen.has(href)) return;
            seen.add(href);
            genres.push({name, href});
        });
        return genres;
    } catch(err){
        console.log("error: ", err)
        throw err;
    }
}

module.exports = {
    getGenresMovies
}
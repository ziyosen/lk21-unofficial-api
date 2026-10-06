const axios = require("axios");
const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
require("dotenv").config()

async function getGenresSeries() {
    try{
        const response = await ambil(process.env.LK21_BASE_SERIES);
        const $ = cheerio.load(response.data);
        const genres = [];
        $('a[href^="/genre/"]').each((i, el) => {
            const name = $(el).text().trim();
            const link = $(el).attr("href");
            const href = new URL(link, process.env.LK21_BASE_SERIES).pathname.split('/').filter(Boolean).pop();;
            genres.push({name, href});
        });
        return genres;
    } catch(err){
        console.log("error: ", err)
        throw err;
    }
}

module.exports = {
    getGenresSeries
}
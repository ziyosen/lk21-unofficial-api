const axios = require("axios");
const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
require("dotenv").config()

async function getMovieByCountry(countryid, page = 1) {
    try{
        let url = `${process.env.LK21_BASE_MOVIE}country/${countryid}`;
        if (page > 1){
            url = `${process.env.LK21_BASE_MOVIE}country/${countryid}/page/${page}/`;
        }
        const response = await ambil(url);
        const $ = cheerio.load(response.data);
        const { total_pages, movies } = require("../listing").parseListing($);
        return {
            total_pages,
            movies
        };

    } catch(err){
        console.log("error: ", err.message);
        throw err;
    }
}

module.exports = {
    getMovieByCountry
}
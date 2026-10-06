const axios = require("axios");
const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
require("dotenv").config()

async function getCountriesSeries() {
    try{
        const response = await ambil(process.env.LK21_BASE_SERIES);
        const $ = cheerio.load(response.data);
        const countries = [];
        $('a[href^="/country/"]').each((i, el) => {
            const name = $(el).text().trim();
            const link = $(el).attr("href");
            const href = new URL(link, process.env.LK21_BASE_SERIES).pathname.split('/').filter(Boolean).pop();;
            countries.push({name, href});
        });
        return countries;
    } catch (err){
        console.log('error: ', err);
        throw err;
    }
}

module.exports = {
    getCountriesSeries
}
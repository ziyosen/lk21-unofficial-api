const axios = require("axios");
const { ambil } = require("../fetcher");
const cheerio = require("cheerio");
require("dotenv").config()

async function getYearsSeries(){
    try{
        const response = await ambil(process.env.LK21_BASE_SERIES);
        const $ = cheerio.load(response.data);
        const years = [];
        $('a[href^="/year/"]').each((i, el) => {
            const name = $(el).text().trim();
            const link = $(el).attr("href");
            const href = new URL(link, process.env.LK21_BASE_SERIES).pathname.split('/').filter(Boolean).pop();
            if (!years.find(y => y.href === href)) years.push({name, href});
        });
        return years;
    } catch (err){
        console.log("error: ", err);
        throw err;
    }
}

module.exports = {
    getYearsSeries
}
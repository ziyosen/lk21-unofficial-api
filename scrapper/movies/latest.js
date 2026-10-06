const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
require("dotenv").config()

async function latestMovies(page = 1) {
    try{
            let url = `${process.env.LK21_BASE_MOVIE}latest/`;
            if (page > 1){
                url = `${process.env.LK21_BASE_MOVIE}latest/page/${page}/`;
            }
            const response = await ambil(url);
            const $ = cheerio.load(response.data);
            const h3Text = $("h3").first().text();
            const match = h3Text.match(/Halaman\s+\d+\s+dari\s+(\d+)/i);
            const total_pages = match && match[1] ? parseInt(match[1]) : 1;
            const movies = [];
            $("article").each((i, el) => {
                const elx = $(el);
                const images = elx.find("img").attr("src") || elx.find("source[type='image/jpeg']").attr("srcset") || "N/A";
                const title = elx.find("h3.poster-title").text().trim()
                    || elx.find("figcaption h3").text().trim()
                    || "N/A";
                const rating = elx.find("span[itemprop='ratingValue']").text().trim() || "N/A";
                const quality = elx.find("span.label").text().trim() || "N/A";
                const year = elx.find("span.year").text().trim() || "";
                const duration = elx.find("span.duration").text().trim() || "N/A";
                const genre = elx.find("div.genre").text().trim() || "N/A";
                const link = elx.find("figure > a").attr("href") || elx.find("a[itemprop='url']").attr("href") || "";
                const slug = link ? new URL(link, process.env.LK21_BASE_MOVIE).pathname.split("/").filter(Boolean).pop() : "N/A";
                movies.push({slug, title, year, rating, quality, duration, genre, images})
            });
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
    latestMovies
}

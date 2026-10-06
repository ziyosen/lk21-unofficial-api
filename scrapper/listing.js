const cheerio = require("cheerio");

/* Parser listing film generik — dipakai latest/bygenre/byyears/bycountry.
   Struktur: <article itemscope schema.org/Movie> dgn h3.poster-title, rating,
   year, label kualitas, duration, genre, link & poster. */
function parseListing($) {
    const h3Text = $("h3").first().text();
    const match = h3Text.match(/Halaman\s+\d+\s+dari\s+(\d+)/i);
    const total_pages = match && match[1] ? parseInt(match[1]) : 1;
    const movies = [];
    $("article").each((i, el) => {
        const elx = $(el);
        const images = elx.find("img").attr("src") || elx.find("source[type='image/jpeg']").attr("srcset") || "N/A";
        const title = elx.find("h3.poster-title").text().trim()
            || elx.find("figcaption h3").text().trim() || "N/A";
        const rating = elx.find("span[itemprop='ratingValue']").text().trim() || "N/A";
        const quality = elx.find("span.label").text().trim() || "N/A";
        const year = elx.find("span.year").text().trim() || "";
        const duration = elx.find("span.duration").text().trim() || "N/A";
        const genre = elx.find("div.genre").text().trim() || "N/A";
        const link = elx.find("figure > a").attr("href") || elx.find("a[itemprop='url']").attr("href") || "";
        const slug = link ? link.split("/").filter(Boolean).pop() : "N/A";
        movies.push({slug, title, year, rating, quality, duration, genre, images});
    });
    return { total_pages, movies };
}

module.exports = { parseListing };

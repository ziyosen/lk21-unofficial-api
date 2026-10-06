const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
require("dotenv").config();

/* getEpisode (detail series): map struktur HTML tv9 yang baru.
   - h1 judul, og:image poster, meta genre/rating bila ada
   - info <p><span>Label: </span>...</p> (Bintang Film, Negara, dst)
   - season-list / episode-list: link per episode /slug-season-N-episode-M-tahun */
async function getEpisode(idSeries) {
    try {
        const url = `${process.env.LK21_BASE_SERIES}${idSeries}`;
        const response = await ambil(url);
        const $ = cheerio.load(response.data);

        const title = $("h1").first().text().trim() || "N/A";
        const image =
            $('meta[property="og:image"]').attr("content") ||
            $("img[itemprop='image']").attr("src") || null;
        const rating =
            $("span[itemprop='ratingValue']").first().text().trim() ||
            $(".rating-score").first().text().trim() || "N/A";
        const genres =
            $('meta[itemprop="genre"]').attr("content") ||
            $("div.genre").first().text().trim() || "N/A";

        /* info <p><span>Label: </span>...</p> */
        const info = {};
        $("p").each((i, el) => {
            const label = $(el).find("span").first().text().trim().replace(/:$/, "");
            if (!label) return;
            const links = [];
            $(el).find("a").each((j, a) => links.push($(a).text().trim()));
            const teks = $(el).clone().children("span").remove().end().text().trim();
            if (links.length) info[label] = links.filter(Boolean);
            else if (teks) info[label] = teks;
        });

        const stars = info["Bintang Film"] || [];
        const country = Array.isArray(info["Negara"]) ? info["Negara"][0] : (info["Negara"] || "N/A");
        const terbaru = info["Terbaru"] || "N/A";

        /* Sinopsis: p panjang yang bukan meta */
        let synopsis = "N/A";
        $("p").each((i, el) => {
            const t = $(el).text().trim();
            if (synopsis === "N/A" && t.length > 120 &&
                !/komentar|diskusi|Follow update|Jangan sampai ketinggalan/i.test(t)) synopsis = t;
        });

        /* Season badge (span.duration = "S.N") & total eps badge (EPS<strong>N</strong>) */
        const seasons = [...new Set($("span.duration").map((i, el) => $(el).text().trim()).get())].filter(s => /^S\.?\d+$/i.test(s));
        const total_eps = parseInt($("span.episode strong").first().text().trim(), 10) || null;

        /* Episode terbaru: link /slug-season-N-episode-M-tahun */
        const episodes = [];
        {
            const re = /href="(\/[a-z0-9-]+-season-\d+-episode-\d+-\d{4})"/gi;
            const seen = new Set();
            let m;
            while ((m = re.exec(response.data)) !== null) {
                if (!seen.has(m[1])) {
                    seen.add(m[1]);
                    episodes.push({ label: m[1].split("/").pop(), href: m[1] });
                }
            }
        }

        return {
            slug: idSeries,
            title,
            image,
            rating,
            genres,
            stars,
            country,
            terbaru,
            seasons,
            total_eps,
            episodes,
            synopsis
        };

    } catch (err) {
        console.error("Terjadi kesalahan saat mengambil data getEpisode:", err.message);
        throw err;
    }
}

module.exports = {
    getEpisode
};

const cheerio = require("cheerio");
const { ambil } = require("../fetcher");
require("dotenv").config();

/* streamMovies: ambil detail + link player dari halaman film.
   Struktur HTML lk21 sekarang: h1 judul, meta itemprop (poster/rating/
   duration/genre), iframe#main-player untuk streaming, list "Bintang Film"
   dan "Sutradara" di area info. */
async function streamMovies(idmovies) {
    try {
        const url = `${process.env.LK21_BASE_MOVIE}${idmovies}`;
        const response = await ambil(url);
        const $ = cheerio.load(response.data);

        const title = $("h1").first().text().trim() || "N/A";
        const image =
            $('meta[property="og:image"]').attr("content") ||
            $('meta[itemprop="image"]').attr("content") ||
            $("img[itemprop='image']").attr("src") ||
            $("picture img").first().attr("src") ||
            null;
        const year =
            $("span.year").first().text().trim() ||
            (title.match(/\((\d{4})\)/) ? title.match(/\((\d{4})\)/)[1] : "N/A");
        const rating =
            $("span[itemprop='ratingValue']").first().text().trim() ||
            $(".rating-score").first().text().trim() ||
            "N/A";
        const duration =
            $("span.duration").first().text().trim() || "N/A";
        const genres =
            $('meta[itemprop="genre"]').attr("content") ||
            $("div.genre").first().text().trim() ||
            "N/A";
        const quality =
            $("span.label").first().text().trim() || "N/A";

        /* Bintang & sutradara: <p><span>Label: </span><a>a</a>, <a>b</a></p> */
        function daftarSetelahLabel(label) {
            const hasil = [];
            $("p").each((i, el) => {
                const span = $(el).find("span").first().text().trim();
                if (span.startsWith(label)) {
                    $(el).find("a").each((j, a) => {
                        const nama = $(a).text().trim();
                        if (nama) hasil.push(nama);
                    });
                }
            });
            return [...new Set(hasil)];
        }
        const stars = daftarSetelahLabel("Bintang Film");
        const directors = daftarSetelahLabel("Sutradara");
        const country = ($("p").filter((i, el) =>
            $(el).find("span").first().text().trim().startsWith("Negara")).find("a").first().text().trim()) || "N/A";
        const release = ($("p").filter((i, el) =>
            $(el).find("span").first().text().trim().startsWith("Release")).clone().children().remove().end().text().trim()) || "N/A";

        /* Tahun: dari judul "Nama (2019)" */
        const ym = title.match(/\((\d{4})\)/);
        const year2 = ym ? ym[1] : year;

        /* Sinopsis: p panjang yang BUKAN teks komentar/diskusi */
        let synopsis = "N/A";
        $("p").each((i, el) => {
            const t = $(el).text().trim();
            if (synopsis === "N/A" && t.length > 100 && !/komentar|diskusi|Selamat berdiskusi|Jangan sampai ketinggalan|Follow update|Telegram/i.test(t)) synopsis = t;
        });

        /* Streaming: iframe player utama + link providers kalau ada */
        const stream = [];
        const iframe = $("iframe#main-player").attr("src");
        if (iframe) stream.push({ text: "Player Utama", href: iframe });
        $("#loadProviders > li > a, .provider a").each((i, el) => {
            const href = $(el).attr("href") || null;
            const text = $(el).text().trim();
            if (href) stream.push({ text, href });
        });

        return {
            slug: idmovies,
            title,
            year: year2,
            image,
            quality,
            rating,
            duration,
            genres,
            country,
            release,
            stars,
            directors,
            synopsis,
            stream
        };

    } catch (err) {
        console.error("Terjadi kesalahan saat mengambil data streamMovies:", err.message);
        throw err;
    }
}

module.exports = {
    streamMovies
};

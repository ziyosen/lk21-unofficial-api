const cheerio = require("cheerio");

/* Parser listing film generik — dipakai latest/bygenre/byyears/bycountry.
   Mendukung tiga tema:
   A) tema lama: <article> dgn h3.poster-title, span[itemprop="ratingValue"],
      span.label, span.year, span.duration, div.genre.
   B) tema mega-item (lk21official.website): <article class="mega-item"> dgn
      h2.grid-title, .grid-meta .rating/.quality/.duration, .grid-categories.
   C) tema GMR (lk21asia.com): <article class="item-infinite"> dgn
      a[itemprop="url"], img, .gmr-rating-item, .gmr-quality-item,
      .gmr-posttype-item ("TV Show" = series), .gmr-numbeps (jml episode). */
function parseListing($) {
    const h3Text = $("h3").first().text();
    const match = h3Text.match(/Halaman\s+\d+\s+dari\s+(\d+)/i);
    let total_pages = match && match[1] ? parseInt(match[1], 10) : 1;
    if (total_pages === 1) {
        let mx = 1;
        $("a[href*=\"/page/\"]").each((i, el) => {
            const m = /\/page\/(\d+)\//.exec($(el).attr("href") || "");
            if (m) mx = Math.max(mx, parseInt(m[1], 10));
        });
        total_pages = mx;
    }
    const movies = [];
    $("article").each((i, el) => {
        const elx = $(el);
        const images = elx.find("img").attr("src") || elx.find("source[type=image/jpeg]").attr("srcset") || "N/A";
        const title = elx.find("h3.poster-title").text().trim()
            || elx.find("figcaption h3").text().trim()
            || elx.find("h2.grid-title span").text().trim()
            || elx.find("h2.grid-title a").text().trim()
            || "N/A";
        const rating = elx.find("span[itemprop=ratingValue]").text().trim()
            || elx.find(".grid-meta .rating").text().trim().replace(/[^\d.]/g, "")
            || "N/A";
        const quality = elx.find("span.label").text().trim()
            || elx.find(".grid-meta .quality").text().trim()
            || "N/A";
        let year = elx.find("span.year").text().trim() || "";
        if (!year) {
            const ym = title.match(/\((\d{4})\)/);
            year = ym ? ym[1] : "";
        }
        const duration = elx.find("span.duration").text().trim()
            || elx.find(".grid-meta .duration").text().trim()
            || "N/A";
        const genre = elx.find("div.genre").text().trim()
            || elx.find(".grid-categories a").first().text().trim()
            || "N/A";
        const link = elx.find("figure > a").attr("href") || elx.find("a[itemprop=url]").attr("href") || "";
        const slug = link ? link.split("/").filter(Boolean).pop() : "N/A";
        movies.push({ slug, title, year, rating, quality, duration, genre, images });
    });
    /* Fallback GMR: bila hasil di atas tak terpakai (judul N/A semua),
       parse ulang dgn struktur GMR. */
    const usable = movies.some((m) => m.title && m.title !== "N/A");
    if (!usable) {
        movies.length = 0;
        let gmr = $("article.item-infinite");
        if (!gmr.length) gmr = $(".item-article");
        gmr.each((i, el) => {
            const elx = $(el);
            const a = elx.find("a[itemprop=\"url\"]").first().length ? elx.find("a[itemprop=\"url\"]").first() : elx.find("a").first();
            const href = a.attr("href") || "";
            const slug = href ? href.split("/").filter(Boolean).pop() : "N/A";
            const title = (a.attr("title") || "").replace(/^Permalink ke:\s*/i, "").trim()
                || elx.find("h2 a, h2, .entry-title a").first().text().trim()
                || "N/A";
            const img = elx.find("img").first();
            const images = img.attr("src") || img.attr("data-src") || "N/A";
            const rtxt = elx.find(".gmr-rating-item").text().trim();
            const rm = rtxt.match(/[\d.]+/);
            const rating = rm ? rm[0] : "N/A";
            const qel = elx.find(".gmr-quality-item");
            const quality = qel.text().trim()
                || (qel.attr("class") || "").replace(/.*gmr-quality-item\s*/i, "").trim()
                || "HD";
            const ym = title.match(/\((\d{4})\)/);
            const year = ym ? ym[1] : "";
            const posttype = elx.find(".gmr-posttype-item").text().trim();
            const numbeps = elx.find(".gmr-numbeps span").text().trim();
            const is_series = /tv/i.test(posttype) || !!numbeps;
            const episodes = numbeps ? parseInt(numbeps, 10) : null;
            movies.push({ slug, title, year, rating, quality, duration: "N/A", genre: "N/A", images, is_series, episodes });
        });
    }
    return { total_pages, movies };
}

module.exports = { parseListing };

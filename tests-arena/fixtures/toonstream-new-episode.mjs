// Offline fetch stub for the "naya episode" test in
// tests-arena/toonstream-drops.test.ts.
//
// Shape ye hai (asli site par bhi yahi hota hai): ToonStream ka **home rail**
// din me ek hi baar banta hai, isliye wahan purana episode pada rehta hai
// (S2E4) — par **series page** hamesha latest list karta hai (S2 me 6 episodes).
// Harvest ko series page wala naya episode card par chadhana chahiye.
const HOME = `<html><body>
  <section class="wdgt-home widget section watch_history_widget">
    <header class="section-header"><h3 class="section-title">Fresh Drop</h3></header>
    <div class="swiper-wrapper">
      <article class="post dfx fcl movies">
        <div class="post-thumbnail">
          <figure><img src="https://image.tmdb.org/t/p/w780/ramparts.jpg" alt="The Ramparts of Ice"></figure>
          <span class="post-ql">Season 2</span><span class="year">EP 4</span>
        </div>
        <header class="entry-header"><h2 class="entry-title">The Ramparts of Ice</h2></header>
        <a href="/episode/the-ramparts-of-ice-2x4/" class="lnk-blk"></a>
      </article>
    </div>
  </section>
</body></html>`;

const SERIES = `<html><body>
  <a class="season-btn active" data-season="1" data-url="/series/the-ramparts-of-ice/season/1">Season 1</a>
  <a class="season-btn" data-season="2" data-url="/series/the-ramparts-of-ice/season/2">Season 2</a>
</body></html>`;

function seasonPage(season, count) {
    return `<html><body>${Array.from({ length: count }, (_, i) => {
        const ep = i + 1;
        return `<a href="/episode/the-ramparts-of-ice-${season}x${ep}/">Episode ${ep}</a>`;
    }).join('')}</body></html>`;
}

const NX_SEARCH = `<a href="/tv/555"><img alt="The Ramparts of Ice"><span>8.1</span><span>2025</span></a>`;
const NX_SEASON = {
    success: true,
    episodes: Array.from({ length: 6 }, (_, i) => ({
        episode_number: i + 1,
        name: `Rampart episode ${i + 1}`,
        overview: 'Cold times.',
        still_path: `/still-${i + 1}.jpg`,
        air_date: '2025-10-20',
        runtime: 24,
    })),
};

globalThis.fetch = async (input) => {
    const url = String(input);
    const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

    if (url.endsWith('/home')) return html(HOME);
    if (/\/series\/the-ramparts-of-ice\/season\/2\/?$/.test(url)) return html(seasonPage(2, 6));
    if (/\/series\/the-ramparts-of-ice\/season\/1\/?$/.test(url)) return html(seasonPage(1, 12));
    if (url.includes('/series/the-ramparts-of-ice')) return html(SERIES);
    if (url.includes('nxsha.space/search/tv')) return html(NX_SEARCH);
    if (url.includes('nxsha.space/api/tv/555/season/2')) {
        return new Response(JSON.stringify({ ...NX_SEASON, season: { season_number: 2, episode_count: 6 } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (url.includes('nxsha.space/api/tv/555/season/1')) {
        return new Response(
            JSON.stringify({
                success: true,
                season: { season_number: 1, episode_count: 12 },
                episodes: Array.from({ length: 12 }, (_, i) => ({
                    episode_number: i + 1,
                    name: `Rampart S1E${i + 1}`,
                    overview: '',
                    still_path: `/s1-${i + 1}.jpg`,
                    air_date: '2025-01-10',
                    runtime: 24,
                })),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        );
    }
    if (url.includes('nxsha.space/api/tv/555')) return new Response(JSON.stringify(NX_SEASON), { status: 200 });
    return new Response('not found', { status: 404 });
};

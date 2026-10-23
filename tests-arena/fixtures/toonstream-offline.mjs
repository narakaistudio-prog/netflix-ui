// Offline fetch stub for tests-arena/toonstream-drops.test.ts.
//
// Loaded with `node --import` before scripts/harvest-toonstream-drops.mjs so the
// real harvester runs end-to-end without touching the network. It reproduces the
// shape of the 2026-10-23 outage: the home rail parses fine, one series page
// answers HTTP 500 (toonstream.us/series/naruto-shippūden/ did), one drop has no
// Nxsha show at all. Neither may abort the day's harvest.
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
      <article class="post dfx fcl movies">
        <div class="post-thumbnail">
          <figure><img src="https://image.tmdb.org/t/p/w780/broken.jpg" alt="Broken Show"></figure>
          <span class="post-ql">Season 1</span><span class="year">EP 3</span>
        </div>
        <header class="entry-header"><h2 class="entry-title">Broken Show</h2></header>
        <a href="/episode/broken-show-1x3/" class="lnk-blk"></a>
      </article>
    </div>
  </section>
</body></html>`;

const SEARCH_HIT = `<a href="/tv/555"><img alt="The Ramparts of Ice"><span>8.1</span><span>2025</span></a>`;
const NX_SEASON = {
    success: true,
    episodes: Array.from({ length: 4 }, (_, i) => ({
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
    if (url.endsWith('/home')) {
        return new Response(HOME, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    // The outage: every series page answers 500, in both slug spellings.
    if (url.includes('/series/')) {
        return new Response('server error', { status: 500 });
    }
    if (url.includes('nxsha.space/search/tv')) {
        // Only the first drop has an Nxsha show; the other one stays unmatched.
        return new Response(url.includes('Broken') ? '<html></html>' : SEARCH_HIT, {
            status: 200,
            headers: { 'content-type': 'text/html' },
        });
    }
    if (url.includes('nxsha.space/api/tv/')) {
        return new Response(JSON.stringify(NX_SEASON), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    return new Response('', { status: 404 });
};

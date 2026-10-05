/**
 * Title metadata resolver — artwork + episode list straight from the chain
 * our player actually uses.
 *
 * Nxsha plays by TMDb/IMDb id and renders its own artwork from TMDB
 * (`image.tmdb.org`). So the only way to have banners/episodes that match the
 * embed exactly is to resolve the very same id and pull the same artwork:
 *
 *   1. IMDb id        — public IMDb suggestion endpoint (keyless).
 *   2. TMDb id + banner — read straight off the Nxsha embed page, which
 *      exposes `/dl/<type>/<tmdbId>` and the TMDB backdrop it is about to
 *      show. This is literally "whatever Nxsha is going to play/show".
 *   3. Episodes       — TMDB when TMDB_API_KEY is configured (same stills and
 *      S/E numbering Nxsha uses), otherwise TVmaze / Jikan as keyless
 *      fallbacks so the UI still gets real episode art.
 *
 * GET /api/title-meta?title=Queen%20of%20Tears&type=tv&year=2024[&imdb=tt…][&tmdb=…]
 */

const MOVIE_KINDS = new Set(['movie', 'video', 'tvMovie', 'short', 'tvSpecial']);
const TV_KINDS = new Set(['tvSeries', 'tvMiniSeries', 'tvShort']);
const TMDB_KEY = process.env.TMDB_API_KEY || process.env.EXPO_PUBLIC_TMDB_API_KEY || '';
const TIMEOUT_MS = 6000;
const UA = { 'user-agent': 'netflix-ui/1.0 (+https://github.com/narakaistudio-prog/netflix-ui)' };

const normalize = (value) =>
    String(value || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d]/g, '')
        .replace(/\b(season|part)\s+\d+\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const stripHtml = (value) =>
    String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();

async function get(url, as = 'json') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { headers: UA, signal: controller.signal });
        if (!res.ok) return null;
        return as === 'text' ? await res.text() : await res.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/* ------------------------------ IMDb id ---------------------------------- */

function pickImdb(suggestions, title, mediaType, year) {
    if (!Array.isArray(suggestions)) return null;
    const wanted = normalize(title);
    const kinds = mediaType === 'tv' ? TV_KINDS : MOVIE_KINDS;
    const scored = suggestions
        .filter((item) => typeof item?.id === 'string' && /^tt\d+$/.test(item.id))
        .map((item) => {
            const name = normalize(item.l);
            let score = 0;
            if (name === wanted) score += 100;
            else if (name.startsWith(wanted) || wanted.startsWith(name)) score += 55;
            else if (name.includes(wanted)) score += 25;
            const kind = item.qid || '';
            if (kinds.has(kind)) score += 30;
            else if (kind) score -= 25;
            if (year && item.y) {
                const diff = Math.abs(item.y - year);
                if (diff === 0) score += 25;
                else if (diff === 1) score += 12;
                else if (diff > 3) score -= 10;
            }
            if (typeof item.rank === 'number') score += Math.max(0, 10 - item.rank / 2000);
            return { id: item.id, score, image: item.i?.imageUrl };
        })
        .sort((a, b) => b.score - a.score);
    const best = scored[0];
    return best && best.score >= 40 ? { imdbId: best.id.toLowerCase(), poster: best.image } : null;
}

async function resolveImdb(title, mediaType, year) {
    const query = String(title).trim().toLowerCase().replace(/\s+/g, '%20');
    const data = await get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURI(query)}.json?includeVideos=0`);
    return pickImdb(data?.d, title, mediaType, year);
}

/* ---------------------- Nxsha embed page (tmdb id + banner) --------------- */

/** Read the TMDb id and backdrop Nxsha itself resolved for this title. */
export async function readNxshaPage(mediaType, id) {
    const path = mediaType === 'tv' ? `tv/${id}/1/1` : `movie/${id}`;
    const html = await get(`https://nxsha.space/embed/${path}`, 'text');
    if (!html) return {};

    const dl = html.match(/\/dl\/(?:movie|tv)\/(\d+)/);
    // The page prefixes a size onto an already absolute URL, so grab every
    // image.tmdb.org occurrence and keep the last (fully qualified) one.
    const images = [...html.matchAll(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)/g)]
        .map((match) => match[0]);
    const backdrop = images.length ? images[images.length - 1] : undefined;
    return {
        tmdbId: dl ? dl[1] : undefined,
        banner: backdrop ? backdrop.replace(/\/t\/p\/w\d+\//, '/t/p/w1280/') : undefined,
    };
}

/* ------------------------------- TMDB ------------------------------------ */

const tmdbImg = (path, size = 'w780') => (path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined);

async function tmdbDetails(mediaType, tmdbId) {
    if (!TMDB_KEY || !tmdbId) return null;
    const base = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}`;
    const details = await get(`${base}?api_key=${TMDB_KEY}&language=en-US`);
    if (!details?.id) return null;

    const meta = {
        tmdbId: String(details.id),
        banner: tmdbImg(details.backdrop_path, 'w1280'),
        poster: tmdbImg(details.poster_path, 'w500'),
        description: details.overview || undefined,
        year: String(details.release_date || details.first_air_date || '').slice(0, 4) || undefined,
        runtime: details.runtime ? `${details.runtime}m` : undefined,
    };
    if (mediaType === 'movie') return meta;

    const seasonNumbers = (details.seasons || [])
        .map((season) => season.season_number)
        .filter((number) => Number.isInteger(number) && number > 0)
        .slice(0, 12);

    const seasons = [];
    for (const number of seasonNumbers) {
        const season = await get(`${base}/season/${number}?api_key=${TMDB_KEY}&language=en-US`);
        const episodes = (season?.episodes || [])
            .filter((episode) => Number.isInteger(episode.episode_number) && episode.episode_number > 0)
            .map((episode) => ({
                season: number,
                episode: episode.episode_number,
                name: episode.name || `Episode ${episode.episode_number}`,
                overview: episode.overview || '',
                still_path: tmdbImg(episode.still_path, 'w300'),
                runtime: episode.runtime ? `${episode.runtime}m` : undefined,
                air_date: episode.air_date || undefined,
            }));
        if (episodes.length) {
            seasons.push({
                season_number: number,
                name: season?.name || `Season ${number}`,
                episode_count: episodes.length,
                episodes,
            });
        }
    }
    if (!seasons.length) return meta;
    const seasonEpisodeCounts = seasons.map((season) => season.episode_count);
    return {
        ...meta,
        seasons,
        seasonEpisodeCounts,
        episodeCount: seasonEpisodeCounts.reduce((total, count) => total + count, 0),
    };
}

/* ------------------------ Keyless episode fallbacks ----------------------- */

async function tvmazeEpisodes(title, imdbId) {
    let show = imdbId ? await get(`https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`) : null;
    if (!show?.id) {
        show = await get(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`);
        if (!show?.name || normalize(show.name) !== normalize(title)) return null;
    }
    const list = await get(`https://api.tvmaze.com/shows/${show.id}/episodes`);
    if (!Array.isArray(list) || !list.length) return null;

    const grouped = new Map();
    for (const episode of list) {
        if (!(episode?.season > 0) || !(episode?.number > 0)) continue;
        if (!grouped.has(episode.season)) grouped.set(episode.season, []);
        grouped.get(episode.season).push({
            season: episode.season,
            episode: episode.number,
            name: episode.name || `Episode ${episode.number}`,
            overview: stripHtml(episode.summary),
            still_path: episode.image?.original || episode.image?.medium || undefined,
            runtime: episode.runtime ? `${episode.runtime}m` : undefined,
            air_date: episode.airdate || undefined,
        });
    }
    const seasons = [...grouped.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([number, episodes]) => ({
            season_number: number,
            name: `Season ${number}`,
            episode_count: episodes.length,
            episodes: episodes.sort((a, b) => a.episode - b.episode),
        }));
    if (!seasons.length) return null;
    const seasonEpisodeCounts = seasons.map((season) => season.episode_count);
    return {
        imdbId: show.externals?.imdb || imdbId || undefined,
        poster: show.image?.original || undefined,
        banner: seasons[0].episodes[0]?.still_path,
        description: stripHtml(show.summary) || undefined,
        seasons,
        seasonEpisodeCounts,
        episodeCount: seasonEpisodeCounts.reduce((total, count) => total + count, 0),
    };
}

async function jikanEpisodes(title) {
    const search = await get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=5`);
    const key = normalize(title);
    const match = (search?.data || []).find((anime) =>
        [anime.title, anime.title_english, ...(anime.title_synonyms || [])].some(
            (candidate) => normalize(candidate) === key,
        ),
    );
    if (!match?.mal_id) return null;

    const first = await get(`https://api.jikan.moe/v4/anime/${match.mal_id}/episodes?page=1`);
    const pages = Math.min(first?.pagination?.last_visible_page || 1, 4);
    const all = [...(first?.data || [])];
    for (let page = 2; page <= pages; page += 1) {
        const next = await get(`https://api.jikan.moe/v4/anime/${match.mal_id}/episodes?page=${page}`);
        if (!next?.data?.length) break;
        all.push(...next.data);
    }
    const episodes = all
        .filter((episode) => episode?.mal_id)
        .map((episode) => ({
            season: 1,
            episode: episode.mal_id,
            name: episode.title || `Episode ${episode.mal_id}`,
            overview: '',
            still_path: match.images?.jpg?.large_image_url || undefined,
            air_date: episode.aired ? String(episode.aired).slice(0, 10) : undefined,
        }));
    if (!episodes.length) return null;
    return {
        poster: match.images?.jpg?.large_image_url,
        banner: match.trailer?.images?.maximum_image_url || match.images?.jpg?.large_image_url,
        description: match.synopsis || undefined,
        seasons: [{ season_number: 1, name: 'Season 1', episode_count: episodes.length, episodes }],
        seasonEpisodeCounts: [episodes.length],
        episodeCount: episodes.length,
    };
}

/* ------------------------------- handler --------------------------------- */

export async function resolveTitleMeta({ title, mediaType, year, imdbId, tmdbId }) {
    const clean = String(title || '').trim();
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    let meta = { imdbId: imdbId || undefined, tmdbId: tmdbId || undefined };

    if (clean && !meta.imdbId && !meta.tmdbId) {
        const resolved = await resolveImdb(clean, type, year);
        if (resolved) meta = { ...meta, ...resolved };
    }

    // Ask Nxsha what it resolved: same id, same artwork the player shows.
    const playableId = meta.imdbId || meta.tmdbId;
    if (playableId) {
        const nxsha = await readNxshaPage(type, playableId);
        meta = { ...meta, ...nxsha, poster: meta.poster || nxsha.poster };
    }

    if (meta.tmdbId && TMDB_KEY) {
        const tmdb = await tmdbDetails(type, meta.tmdbId);
        if (tmdb) meta = { ...meta, ...tmdb, banner: tmdb.banner || meta.banner };
    }

    if (type === 'tv' && !meta.seasons) {
        const fallback = (await tvmazeEpisodes(clean, meta.imdbId)) || (await jikanEpisodes(clean));
        if (fallback) {
            meta = {
                ...fallback,
                ...meta,
                seasons: fallback.seasons,
                seasonEpisodeCounts: fallback.seasonEpisodeCounts,
                episodeCount: fallback.episodeCount,
                banner: meta.banner || fallback.banner,
                description: meta.description || fallback.description,
                poster: meta.poster || fallback.poster,
            };
        }
    }

    return meta;
}

// Season-by-season TMDB enrichment can need a few round trips; give the
// function room so a big series still resolves in one request.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
    const { title = '', type = 'movie', year = '', imdb = '', tmdb = '' } = req.query || {};
    res.setHeader('Access-Control-Allow-Origin', '*');

    const clean = String(title).trim();
    if (!clean && !imdb && !tmdb) {
        res.status(400).json({ error: 'title, imdb or tmdb query param required' });
        return;
    }

    const parsedYear = Number.parseInt(String(year).slice(0, 4), 10);
    try {
        const meta = await resolveTitleMeta({
            title: clean,
            mediaType: String(type) === 'tv' ? 'tv' : 'movie',
            year: Number.isFinite(parsedYear) && parsedYear > 1900 ? parsedYear : undefined,
            imdbId: String(imdb) || undefined,
            tmdbId: String(tmdb) || undefined,
        });
        const useful = meta.imdbId || meta.tmdbId || meta.banner || meta.seasons;
        res.setHeader(
            'Cache-Control',
            useful ? 'public, s-maxage=604800, stale-while-revalidate=86400' : 'public, s-maxage=3600',
        );
        res.status(200).json(meta);
    } catch (error) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ error: String(error?.message || error) });
    }
}

/**
 * Keyless AniList metadata (https://graphql.anilist.co).
 *
 * Provides posters, banners, genres, year, description and — via the
 * SEQUEL / PREQUEL relation edges — the full ordered season chain of a
 * multi-season series. No API key, no sign-up.
 */

const ANILIST_URL = 'https://graphql.anilist.co';
const REQUEST_TIMEOUT_MS = 12000;

export interface AniListSearchHit {
    id: number;
    idMal?: number;
    imdbId?: string;
    format?: string;
    year?: number;
    name: string;
    banner?: string;
    poster?: string;
    genres: string[];
    description?: string;
}

export interface ChainNode {
    id: number;
    idMal?: number;
    name?: string;
}

async function anilistQuery<T = Record<string, unknown>>(
    query: string,
    variables: Record<string, unknown> = {},
): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(ANILIST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
        const json = await res.json();
        if (Array.isArray(json?.errors) && json.errors.length) {
            throw new Error(json.errors[0]?.message ?? 'AniList GraphQL error');
        }
        return json?.data as T;
    } finally {
        clearTimeout(timer);
    }
}

const cleanText = (raw: string | null | undefined): string | undefined => {
    if (!raw) return undefined;
    const cleaned = String(raw).replace(/\s+/g, ' ').trim();
    return cleaned || undefined;
};

/**
 * Searches AniList by series name. Returns at most 8 candidates in
 * relevance order; the caller picks the one whose IMDb ID matches the
 * admin-entered id (falling back to the best name match).
 */
export async function searchAniListMedia(name: string): Promise<AniListSearchHit[]> {
    const data = await anilistQuery<{ media: any[] }>(
        `query ($search: String) {
            media(search: $search, type: ANIME, sort: SEARCH_MATCH, perPage: 8) {
                id
                idMal
                imdbId
                format
                startDate { year }
                bannerImage
                coverImage { extraLarge large }
                genres
                description(asHtml: false)
            }
        }`,
        { search: (name ?? '').trim() },
    );

    return (data?.media ?? [])
        .map((m) => ({
            id: m.id as number,
            idMal: m.idMal ?? undefined,
            imdbId: m.imdbId ?? undefined,
            format: m.format ?? undefined,
            year: m.startDate?.year ?? undefined,
            name:
                m.name?.romaji || m.name?.english || m.name?.native || '',
            banner: m.bannerImage ?? undefined,
            poster:
                m.coverImage?.extraLarge || m.coverImage?.large || undefined,
            genres: Array.isArray(m.genres) ? m.genres : [],
            description: cleanText(m.description),
        }))
        .filter((m) => m.name && typeof m.id === 'number');
}

/**
 * Picks the candidate that really is the admin's title: exact IMDb-ID match
 * first, otherwise the best SEARCH_MATCH name hit.
 */
export function pickAniListMatch(
    candidates: AniListSearchHit[],
    imdbId: string,
): AniListSearchHit | undefined {
    if (!candidates.length) return undefined;
    const wanted = (imdbId ?? '').trim().toLowerCase();
    if (wanted) {
        const exact = candidates.find(
            (c) => (c.imdbId ?? '').toLowerCase() === wanted,
        );
        if (exact) return exact;
    }
    return candidates[0];
}

interface RelationEdge {
    relation: string;
    node: { id: number; idMal?: number; name?: string };
}

async function fetchRelationEdges(mediaId: number): Promise<RelationEdge[]> {
    const data = await anilistQuery<{ Media: any }>(
        `query ($id: Int) {
            Media(id: $id) {
                relations {
                    edges {
                        relation
                        node {
                            id
                            idMal
                            name { romaji english }
                        }
                    }
                }
            }
        }`,
        { id: mediaId },
    );

    const edges = data?.Media?.relations?.edges ?? [];
    return (Array.isArray(edges) ? edges : [])
        .map((e: any) => ({
            relation: String(e?.relation ?? ''),
            node: {
                id: Number(e?.node?.id),
                idMal: e?.node?.idMal ?? undefined,
                name:
                    e?.node?.name?.romaji || e?.node?.name?.english || undefined,
            },
        }))
        .filter((e: RelationEdge) => Number.isInteger(e.node.id) && e.node.id > 0);
}

/**
 * Walks PREQUEL edges back to the first season and SEQUEL edges forward to
 * the latest, returning the ordered season chain (first season -> latest).
 *
 * Multi-season anime are separate AniList media linked by SEQUEL/PREQUEL,
 * e.g. "Frieren" S1 (SEQUEL) "Frieren 2" — so each chain node carries its
 * own MAL id for Jikan episode lookup.
 */
export async function fetchSeasonChain(
    start: { id: number; idMal?: number; name?: string },
): Promise<ChainNode[]> {
    const MAX_HOPS = 8; // defensive cap against pathological loops
    const visited = new Set<number>([start.id]);

    const walk = async (direction: 'PREQUEL' | 'SEQUEL'): Promise<ChainNode[]> => {
        const found: ChainNode[] = [];
        let cursor: number | null = start.id;
        for (let hop = 0; hop < MAX_HOPS && cursor; hop += 1) {
            const edges = await fetchRelationEdges(cursor);
            const next = edges.find(
                (e) => e.relation === direction && !visited.has(e.node.id),
            );
            if (!next) break;
            visited.add(next.node.id);
            found.push({
                id: next.node.id,
                idMal: next.node.idMal,
                name: next.node.name,
            });
            cursor = next.node.id;
        }
        return found;
    };

    const prequels = await walk('PREQUEL');
    const sequels = await walk('SEQUEL');

    return [
        ...prequels.reverse(),
        { id: start.id, idMal: start.idMal, name: start.name },
        ...sequels,
    ];
}

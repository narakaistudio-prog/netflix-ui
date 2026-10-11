'use strict';
/**
 * MovieBox / AOneRoom H5 BFF pure extraction and mapping library.
 *
 * Implements:
 *   - Search request payload & response normalization (with Hindi audio detection)
 *   - Play / stream response parsing (HLS .m3u8, MP4, qualities, captions)
 *   - Client header / token generation for MovieBox API mirrors (movieboxonline.net, m2box.org, aoneroom)
 *
 * Pure functions only (no network I/O) — safe for offline unit tests.
 */

const MOVIEBOX_DEFAULT_HOSTS = [
  'https://h5-api.aoneroom.com/wefeed-h5api-bff',
  'https://movieboxonline.net/wefeed-h5api-bff',
  'https://m2box.org/wefeed-h5api-bff',
];

const HINDI_RE = /\bhindi\b|\bhin\b/i;

function getClientToken() {
  return String(Math.floor(Date.now() / 1000));
}

function buildHeaders({ referer = 'https://m2box.org/', token = '' } = {}) {
  let origin = 'https://m2box.org';
  try {
    const u = new URL(referer);
    origin = u.origin;
  } catch (e) {
    /* ignore */
  }

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
    'Content-Type': 'application/json;charset=UTF-8',
    Origin: origin,
    Referer: referer,
    'X-Client-Token': token || getClientToken(),
  };

  return headers;
}

function buildSearchPayload(keyword, page = 1, perPage = 20) {
  return JSON.stringify({
    keyword: String(keyword || '').trim(),
    page: Math.max(1, parseInt(page, 10) || 1),
    perPage: Math.max(1, parseInt(perPage, 10) || 20),
    subjectType: 0,
  });
}

function hasHindi(text, tags) {
  if (HINDI_RE.test(String(text || ''))) return true;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (HINDI_RE.test(String(t || ''))) return true;
    }
  }
  return false;
}

function parseSearchResults(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: 'invalid-json', results: [] };
    }
  }

  const payload = (data && data.data) || data;
  const list =
    (payload && (payload.items || payload.list || payload.subjects)) ||
    (Array.isArray(payload) ? payload : []);

  const results = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;

    const id = item.subject_id || item.id || item.subjectId;
    const title = item.title || item.subject_title || item.name || '';
    const detailPath = item.detail_path || item.detailPath || item.slug || '';
    const year = item.year || item.release_year || '';
    const rating = item.rating || item.score || '';
    const poster =
      item.cover || item.poster || item.img || (item.image && item.image.url) || '';
    const genres = Array.isArray(item.genres)
      ? item.genres
      : (item.genre_names || '').split(',').map((s) => s.trim()).filter(Boolean);
    const languages = Array.isArray(item.languages)
      ? item.languages
      : (item.language_names || '').split(',').map((s) => s.trim()).filter(Boolean);

    const isHindi = hasHindi(title, languages);

    results.push({
      id: String(id || ''),
      title: String(title),
      detailPath: String(detailPath),
      year: String(year),
      rating: String(rating),
      poster: String(poster),
      genres,
      languages,
      isHindi,
      type: item.subject_type === 1 || item.type === 'movie' ? 'movie' : 'tv',
    });
  }

  return { ok: true, count: results.length, results };
}

function parsePlayResponse(raw, preferredLang = 'hi') {
  let json = raw;
  if (typeof raw === 'string') {
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: 'invalid-json' };
    }
  }

  const data = (json && json.data) || json;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'empty-play-data' };
  }

  const streams = [];

  // Check HLS manifests first
  const hlsList = data.hls || data.hls_list || [];
  if (Array.isArray(hlsList)) {
    for (const item of hlsList) {
      const u = typeof item === 'string' ? item : item && (item.url || item.video_url || item.stream_url);
      if (u && typeof u === 'string') {
        const quality = (item && item.quality) || 'auto';
        streams.push({ url: u, quality, kind: 'hls' });
      }
    }
  }

  // Check qualities / video list
  const videoList =
    data.qualities ||
    data.video_list ||
    data.sources ||
    data.downloads ||
    (Array.isArray(data) ? data : []);

  if (Array.isArray(videoList)) {
    for (const v of videoList) {
      if (!v || typeof v !== 'object') continue;
      if (v.vipLocked || v.is_vip || v.vip_locked) continue; // skip VIP locked tiers

      const u = v.video_url || v.real_url || v.url || v.download_url || v.stream_url;
      if (!u || typeof u !== 'string') continue;

      const quality = v.quality || v.resolution || v.name || '720p';
      const kind = /\.m3u8(\?|#|$)/i.test(u) ? 'hls' : 'mp4';
      const lang = v.lang || v.language || v.audio_lang || '';

      streams.push({
        url: u,
        quality: String(quality).toUpperCase(),
        kind,
        lang: String(lang),
        isHindi: HINDI_RE.test(String(lang)),
      });
    }
  }

  // Fallback single stream url if directly present in payload
  if (!streams.length && (data.url || data.stream_url || data.video_url)) {
    const u = data.url || data.stream_url || data.video_url;
    const kind = /\.m3u8(\?|#|$)/i.test(u) ? 'hls' : 'mp4';
    streams.push({ url: u, quality: 'default', kind });
  }

  if (!streams.length) {
    return { ok: false, error: 'no-playable-streams-found' };
  }

  // Pick best stream:
  // 1. If Hindi stream matches preferredLang, prioritize it
  // 2. Otherwise pick HLS stream
  // 3. Otherwise pick highest available quality MP4
  let chosen = null;
  if (preferredLang === 'hi' || preferredLang === 'hindi') {
    chosen = streams.find((s) => s.isHindi);
  }

  if (!chosen) {
    chosen = streams.find((s) => s.kind === 'hls');
  }

  if (!chosen) {
    const order = ['1080P', '720P', '480P', '360P'];
    for (const q of order) {
      chosen = streams.find((s) => s.quality === q);
      if (chosen) break;
    }
  }

  if (!chosen) chosen = streams[0];

  // Captions / Subtitles
  const captions = [];
  const rawCaps = data.captions || data.subtitles || [];
  if (Array.isArray(rawCaps)) {
    for (const c of rawCaps) {
      if (c && typeof c === 'object' && (c.url || c.file)) {
        captions.push({
          lang: c.lang || c.language || 'English',
          url: c.url || c.file,
        });
      }
    }
  }

  return {
    ok: true,
    stream: chosen.url,
    kind: chosen.kind,
    quality: chosen.quality,
    isHindi: !!chosen.isHindi,
    qualities: streams.map((s) => ({ quality: s.quality, kind: s.kind, url: s.url })),
    captions,
  };
}

module.exports = {
  MOVIEBOX_DEFAULT_HOSTS,
  getClientToken,
  buildHeaders,
  buildSearchPayload,
  hasHindi,
  parseSearchResults,
  parsePlayResponse,
};

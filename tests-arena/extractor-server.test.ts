import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = require(join(__dirname, '..', 'server', 'extract-lib.cjs'));

const ROOT = join(__dirname, '..');

const PACKED =
    'eval(function(p,a,c,k,e,d){e=function(c){return c.toString(a)};' +
    "if(!''.replace(/^/,String)){while(c--)d[e(c)]=k[c]||e(c);" +
    "k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};" +
    "while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c]);" +
    "return p}('2={0:\"1\"}',3,3,'file|https://cdn.example.com/v/abc/master.m3u8|player'.split('|'),0,{}))";

test('packer unpacker reveals the hidden stream URL', () => {
    const r = lib.unpackPackerOnce(PACKED);
    expect(r).not.toBeNull();
    expect(r.unpacked).toContain('https://cdn.example.com/v/abc/master.m3u8');
    expect(r.unpacked).toContain('player={file:');
});

test('non-packed pages pass through untouched', () => {
    const junk = '<html><body>hello</body></html>';
    expect(lib.unpackAllPackers(junk)).toBe(junk);
});

test('stream finder prefers m3u8 over mp4', () => {
    const f = lib.findStreamUrl(
        '<script>var x={sources:[{file:"https://h.example/a.mp4"},' +
        '{file:"https://h.example/b.m3u8?tok=1"}]};</script>',
    );
    expect(f).toEqual({ url: 'https://h.example/b.m3u8?tok=1', kind: 'hls' });
});

test('stream finder reads <source> tags and bare URLs', () => {
    expect(lib.findStreamUrl('<video><source src="https://h.example/c.mp4"></video>')).toEqual({
        url: 'https://h.example/c.mp4',
        kind: 'mp4',
    });
    expect(lib.findStreamUrl('play //cdn.example.com/x/y.m3u8 now').url).toBe(
        'https://cdn.example.com/x/y.m3u8',
    );
});

test('extractStream unpacks packed host pages end to end', () => {
    const f = lib.extractStream('<script>' + PACKED + '</script>');
    expect(f.url).toBe('https://cdn.example.com/v/abc/master.m3u8');
    expect(f.kind).toBe('hls');
});

test('embed picker prefers known video hosts', () => {
    const page =
        '<iframe src="https://ads.example/x"></iframe>' +
        '<iframe src="https://streamwish.to/e/xyz"></iframe>';
    expect(lib.pickEmbedUrl(page, 'https://anidisk.org/watch/solo/1/1')).toBe(
        'https://streamwish.to/e/xyz',
    );
});

test('embed picker resolves relative frames and empty pages', () => {
    expect(lib.pickEmbedUrl('<iframe src="/e/abc"></iframe>', 'https://vidmoly.to/w/1')).toBe(
        'https://vidmoly.to/e/abc',
    );
    expect(lib.pickEmbedUrl('<p>nope</p>', 'https://x.example/')).toBeNull();
});

test('playlist rewrite proxies segments and key URIs', () => {
    const pl =
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.key"\n' +
        'seg1.ts\nhttps://cdn.example.com/a/seg2.ts\n';
    const rw = lib.rewritePlaylist(
        pl,
        'https://cdn.example.com/a/list.m3u8',
        (abs: string) => 'P(' + abs + ')',
    );
    expect(rw).toContain('P(https://cdn.example.com/a/seg1.ts)');
    expect(rw).toContain('URI="P(https://cdn.example.com/a/key.key)"');
    expect(rw).toContain('P(https://cdn.example.com/a/seg2.ts)');
    expect(rw).toContain('#EXTM3U');
});

test('SSRF guard blocks private IPs and allows public ones', () => {
    for (const ip of [
        '127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.4.5',
        '169.254.169.254', '::1', '0.0.0.0', '224.0.0.1',
    ]) {
        expect(lib.isBlockedIp(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.1.1']) {
        expect(lib.isBlockedIp(ip)).toBe(false);
    }
});

test('b64u helpers round-trip stream pointers', () => {
    const s = 'https://x.example/a.m3u8?tok=ü&id=1/2+3';
    const enc = lib.b64uEncode(s);
    expect(enc).not.toMatch(/[+/=]/);
    expect(lib.b64uDecode(enc)).toBe(s);
});

test('extractor server self-test passes offline', () => {
    const out = execFileSync(
        process.execPath,
        [join(ROOT, 'server', 'extractor.mjs'), '--self-test'],
        { encoding: 'utf8', timeout: 60000 },
    );
    expect(out).toContain('self-tests passed');
    expect(out).not.toContain('FAIL -');
});

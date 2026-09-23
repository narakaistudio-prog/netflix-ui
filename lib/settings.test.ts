import { buildEmbedUrl, DEFAULT_NXSHA_MOVIE, DEFAULT_NXSHA_TV } from './embeds';
import { DEFAULT_SETTINGS, loadSettings, templateOverridesFor } from './settings';

const STORAGE_KEY = 'netflix-embed-settings-v1';
const V3_MOVIE =
    'https://nxsha.space/embed/movie/{id}?server=VidHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true&one_server=true';
const V3_TV =
    'https://nxsha.space/embed/tv/{id}/{s}/{e}?server=VidHindi&lang=hi&sub=hi&color=netflix&disable_app_ad=true&disable_dl_button=true&one_server=true';

let saved: Map<string, string>;
let originalLocalStorage: PropertyDescriptor | undefined;

beforeAll(() => {
    originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
});

beforeEach(() => {
    saved = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => saved.get(key) ?? null,
            setItem: (key: string, value: string) => { saved.set(key, value); },
            removeItem: (key: string) => { saved.delete(key); },
        },
    });
});

afterAll(() => {
    if (originalLocalStorage) {
        Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    } else {
        Reflect.deleteProperty(globalThis, 'localStorage');
    }
});

it('restores the old Nxsha server for browsers that saved the temporary v3 defaults', () => {
    saved.set(STORAGE_KEY, JSON.stringify({
        ...DEFAULT_SETTINGS,
        settingsVersion: 3,
        nxshaMovieTemplate: V3_MOVIE,
        nxshaTvTemplate: V3_TV,
    }));

    const settings = loadSettings();
    expect(settings.nxshaMovieTemplate).toBe(DEFAULT_NXSHA_MOVIE);
    expect(settings.nxshaTvTemplate).toBe(DEFAULT_NXSHA_TV);
    expect(settings.settingsVersion).toBe(DEFAULT_SETTINGS.settingsVersion);
    expect(JSON.parse(saved.get(STORAGE_KEY)!)).toMatchObject({
        nxshaMovieTemplate: DEFAULT_NXSHA_MOVIE,
        nxshaTvTemplate: DEFAULT_NXSHA_TV,
        settingsVersion: DEFAULT_SETTINGS.settingsVersion,
    });
    const url = buildEmbedUrl(
        'nxsha', 'movie', { tmdbId: 1, strictHindi: settings.strictHindi },
        templateOverridesFor(settings, 'nxsha'),
    );
    expect(url).toContain('server=GbruHindi');
});

it('keeps custom templates and explicit settings while undoing only the v3 default', () => {
    const customMovie = 'https://web.nxsha.app/embed/movie/{id}?server=Neon';
    saved.set(STORAGE_KEY, JSON.stringify({
        ...DEFAULT_SETTINGS,
        settingsVersion: 3,
        strictHindi: false,
        defaultProvider: 'nhd',
        nxshaMovieTemplate: customMovie,
        nxshaTvTemplate: V3_TV,
    }));

    const settings = loadSettings();
    expect(settings.nxshaMovieTemplate).toBe(customMovie);
    expect(settings.nxshaTvTemplate).toBe(DEFAULT_NXSHA_TV);
    expect(settings.strictHindi).toBe(false);
    expect(settings.defaultProvider).toBe('nhd');
});

it('retains original v2 settings without replacing a chosen strict-mode value', () => {
    saved.set(STORAGE_KEY, JSON.stringify({
        ...DEFAULT_SETTINGS,
        settingsVersion: 2,
        strictHindi: false,
        nxshaMovieTemplate: DEFAULT_NXSHA_MOVIE,
    }));

    const settings = loadSettings();
    expect(settings.nxshaMovieTemplate).toBe(DEFAULT_NXSHA_MOVIE);
    expect(settings.strictHindi).toBe(false);
});

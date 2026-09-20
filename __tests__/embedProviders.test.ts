import {
    PROVIDERS,
    buildEmbedUrl,
    CUSTOM_PROVIDER_ID,
    fallbackProvider,
    isValidImdbId,
    isValidTemplate,
    missingPlaceholders,
    providerLabel,
    resolveTemplate,
    templateError,
} from '@/services/embedProviders';

describe('embedProviders presets', () => {
    it('ships the Nxsha (Hindi) and NHD presets', () => {
        expect(PROVIDERS.map(p => p.id)).toEqual(['nxsha', 'nhd']);

        const nxsha = PROVIDERS.find(p => p.id === 'nxsha')!;
        expect(nxsha.name).toBe('Nxsha (Hindi)');
        expect(nxsha.template).toBe(
            'https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true',
        );

        const nhd = PROVIDERS.find(p => p.id === 'nhd')!;
        expect(nhd.template).toBe('https://nhdapi.com/tv/{id}/{s}/{e}');
    });

    it('keeps the ad-reducing Nxsha params intact', () => {
        const nxsha = PROVIDERS.find(p => p.id === 'nxsha')!;
        expect(nxsha.template).toContain('one_server=true');
        expect(nxsha.template).toContain('disable_app_ad=true');
        expect(nxsha.template).toContain('lang=hi');
    });
});

describe('buildEmbedUrl (string-replace {id}/{s}/{e})', () => {
    it('builds the Nxsha URL for a given id/s/e', () => {
        const nxsha = PROVIDERS.find(p => p.id === 'nxsha')!;
        expect(buildEmbedUrl(nxsha.template, { id: 'tt1234567', s: 2, e: 5 })).toBe(
            'https://nxsha.space/embed/tv/tt1234567/2/5?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true',
        );
    });

    it('builds the NHD URL for a given id/s/e', () => {
        const nhd = PROVIDERS.find(p => p.id === 'nhd')!;
        expect(buildEmbedUrl(nhd.template, { id: 'tt9999999', s: 1, e: 1 })).toBe(
            'https://nhdapi.com/tv/tt9999999/1/1',
        );
    });

    it('replaces every occurrence (global replace)', () => {
        expect(buildEmbedUrl('{id}/{id}/{s}', { id: 'tt1', s: 3, e: 9 })).toBe(
            'tt1/tt1/3',
        );
    });

    it('leaves unknown braces untouched', () => {
        expect(buildEmbedUrl('x/{id}/{q}', { id: 'tt1', s: 1, e: 1 })).toBe(
            'x/tt1/{q}',
        );
    });
});

describe('template validation', () => {
    it('accepts a full valid custom template', () => {
        expect(
            isValidTemplate('https://web.nxsha.app/embed/tv/{id}/{s}/{e}?lang=hi'),
        ).toBe(true);
    });

    it('rejects templates missing each placeholder', () => {
        expect(missingPlaceholders('https://a.com/{s}/{e}')).toEqual(['id']);
        expect(missingPlaceholders('https://a.com/{id}/{e}')).toEqual(['s']);
        expect(missingPlaceholders('https://a.com/{id}/{s}')).toEqual(['e']);
        expect(missingPlaceholders('https://a.com/tv')).toEqual(['id', 's', 'e']);
    });

    it('rejects non-URL templates', () => {
        expect(isValidTemplate('nxsha.space/{id}/{s}/{e}')).toBe(false);
        expect(isValidTemplate('{id}/{s}/{e}')).toBe(false);
        expect(isValidTemplate('')).toBe(false);
    });

    it('templateError explains what is missing', () => {
        expect(templateError('https://a.com/{id}/{s}')).toMatch(/\{e\}/);
        expect(templateError('not a url')).toMatch(/http/);
        expect(templateError('https://a.com/{id}/{s}/{e}')).toBe('');
    });
});

describe('resolveTemplate / providerLabel', () => {
    it('uses the preset template for preset providers', () => {
        expect(resolveTemplate({ providerId: 'nhd' })).toBe(
            'https://nhdapi.com/tv/{id}/{s}/{e}',
        );
    });

    it('prefers the stored custom template', () => {
        const t = 'https://web.nxsha.app/embed/tv/{id}/{s}/{e}';
        expect(resolveTemplate({ providerId: CUSTOM_PROVIDER_ID, template: t })).toBe(
            t,
        );
        expect(providerLabel({ providerId: CUSTOM_PROVIDER_ID })).toBe(
            'Custom template',
        );
    });

    it('falls back to Nxsha for unknown provider ids', () => {
        expect(resolveTemplate({ providerId: 'mystery' })).toBe(
            PROVIDERS[0].template,
        );
    });
});

describe('fallbackProvider (switch player)', () => {
    it('nxsha -> NHD', () => {
        expect(fallbackProvider({ providerId: 'nxsha' }).id).toBe('nhd');
    });
    it('nhd -> Nxsha', () => {
        expect(fallbackProvider({ providerId: 'nhd' }).id).toBe('nxsha');
    });
    it('custom -> Nxsha', () => {
        expect(fallbackProvider({ providerId: CUSTOM_PROVIDER_ID }).id).toBe('nxsha');
    });
});

describe('isValidImdbId', () => {
    it('accepts tt + 4..10 digits (case-insensitive)', () => {
        expect(isValidImdbId('tt1234567')).toBe(true);
        expect(isValidImdbId('TT0000001')).toBe(true);
        expect(isValidImdbId('  tt8843592  ')).toBe(true);
    });
    it('rejects malformed ids', () => {
        expect(isValidImdbId('1234567')).toBe(false);
        expect(isValidImdbId('tt')).toBe(false);
        expect(isValidImdbId('tt12ab')).toBe(false);
        expect(isValidImdbId('')).toBe(false);
    });
});

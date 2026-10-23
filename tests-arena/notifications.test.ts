import { notificationsFromHistory, unseenCount, NOTIFICATIONS, ContentNotification } from '@/lib/notifications';

const history = {
    weeks: [
        { week: '9/28/26 - 10/4/26', firstSeen: '2026-10-13', movies: [{ rank: 1, title: 'A' }, { rank: 2, title: 'B' }, { rank: 3, title: 'C' }, { rank: 4, title: 'D' }] },
        { week: '9/21/26 - 9/27/26', firstSeen: '2026-10-06', movies: [{ rank: 1, title: 'Old' }] },
    ],
};

describe('bell notifications', () => {
    test('one notification per weekly update, newest first, with real titles', () => {
        const items = notificationsFromHistory(history);
        expect(items.map(i => i.id)).toEqual(['top10-9/28/26 - 10/4/26', 'top10-9/21/26 - 9/27/26']);
        expect(items[0].text).toBe('Week 9/28/26 - 10/4/26: new entries A, B, C and more.');
        expect(items[0].title).toBe('New in India Top 10');
        expect(items[0].date).toBe('2026-10-13');
    });

    test('nothing is shown without real updates', () => {
        expect(notificationsFromHistory({ weeks: [] })).toEqual([]);
    });

    test('the badge counts only items newer than the last time the bell was opened', () => {
        const items = notificationsFromHistory(history);
        expect(unseenCount(items, null)).toBe(2);
        expect(unseenCount(items, '2026-10-13')).toBe(0);
        expect(unseenCount(items, '2026-10-06')).toBe(1);
    });

    test('the app bell reads the real history file', () => {
        const items: ContentNotification[] = NOTIFICATIONS;
        expect(items.length).toBeGreaterThan(0);
        expect(items.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.date))).toBe(true);
    });
});

// Owner: "crunchyroll ka notification netflix mae nhi aana chiyea" — Crunchyroll
// drops Netflix ke bell me nahi aate, isliye NOTIFICATIONS me koi `ts-` id nahi
// hona chahiye (aur helper bhi list se hata diya gaya hai).
describe('crunchyroll drops netflix bell se bahar', () => {
    test('bell me sirf netflix/tudum items hain', () => {
        expect(NOTIFICATIONS.every((i) => !i.id.startsWith('ts-'))).toBe(true);
        expect(NOTIFICATIONS.every((i) => !/Fresh Drop Toon/i.test(i.text))).toBe(true);
    });
});

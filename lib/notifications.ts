import historyData from '@/data/tudum-top10-india-history.json';

/**
 * Bell notifications come from real catalog updates only. Each weekly Tudum Top 10
 * India entry (written by the daily job) is one notification. Nothing is made up.
 */
export interface ContentNotification {
    id: string;
    /** Day the update first appeared, YYYY-MM-DD. */
    date: string;
    title: string;
    text: string;
}

export interface TudumHistory {
    weeks: { week: string; firstSeen: string; movies: { rank: number; title: string }[] }[];
}

/** localStorage key holding the day the bell was last opened (YYYY-MM-DD). */
export const NOTIFICATIONS_SEEN_KEY = 'netflix-notifications-seen-v1';

export function notificationsFromHistory(history: TudumHistory): ContentNotification[] {
    return [...history.weeks]
        .sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0))
        .map((week, i, sorted) => {
            // New entries = titles not in the next-older recorded week (none for the oldest = baseline).
            const older = sorted[i + 1];
            const before = new Set((older?.movies ?? []).map((m) => m.title.toLowerCase()));
            const entries = older ? week.movies.filter((m) => !before.has(m.title.toLowerCase())) : [];
            const top = week.movies.slice(0, 3).map((m) => m.title).join(', ');
            const more = week.movies.length > 3 ? ' and more' : '';
            return {
                id: `top10-${week.week}`,
                date: week.firstSeen,
                title: entries.length ? 'New in India Top 10' : 'Top 10 in India updated',
                text: entries.length
                    ? `Week ${week.week}: new entries ${entries.slice(0, 3).map((m) => m.title).join(', ')}${entries.length > 3 ? ' and more' : ''}.`
                    : `Week ${week.week}: ${top}${more}.`,
            };
        });
}

/** Items dated after the day the bell was last opened. Never opened = all are new. */
export function unseenCount(items: ContentNotification[], seenDate: string | null): number {
    return items.filter((item) => !seenDate || item.date > seenDate).length;
}

/*
 * Crunchyroll (ToonStream "Fresh Drop") ki entries Netflix ke bell me NAHI aati.
 * Owner: "crunchyroll ka notification netflix mae nhi aana chiyea" — Crunchyroll
 * ke naye drops us page ke apne bell me dikhte hain (crunchyroll.html ke TS_DROPS
 * se), Netflix app ka bell sirf Netflix/Tudum catalog update dikhata hai.
 */

export const NOTIFICATIONS: ContentNotification[] = notificationsFromHistory(historyData as TudumHistory);

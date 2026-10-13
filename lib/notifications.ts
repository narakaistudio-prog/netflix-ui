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
        .map((week) => {
            const top = week.movies.slice(0, 3).map((m) => m.title).join(', ');
            const more = week.movies.length > 3 ? ' and more' : '';
            return {
                id: `top10-${week.week}`,
                date: week.firstSeen,
                title: 'Top 10 in India updated',
                text: `Week ${week.week}: ${top}${more}.`,
            };
        });
}

/** Items dated after the day the bell was last opened. Never opened = all are new. */
export function unseenCount(items: ContentNotification[], seenDate: string | null): number {
    return items.filter((item) => !seenDate || item.date > seenDate).length;
}

export const NOTIFICATIONS: ContentNotification[] = notificationsFromHistory(historyData as TudumHistory);

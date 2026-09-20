export interface Movie {
    id: string;
    imageUrl: string;
    title?: string;
    type?: string;
    videoUrl?: string;
    year?: string;
    duration?: string;
    rating?: string;
    description?: string;
    cast?: string[];
    director?: string;
    ranking_text?: string;
    /** YouTube video id of the official trailer (embedded on web). */
    youtubeId?: string;
    logo?: string;
    logoWidth?: number;
    logoHeight?: number;
    subText?: string;
    rated?: string;
}

export interface MovieRow {
    rowTitle: string;
    movies: Movie[];
    type?: 'normal' | 'top_10' | 'games';
}

export interface MoviesData {
    movies: MovieRow[];
}

export interface FeaturedMovie {
    id: string;
    title: string;
    thumbnail: string;
    categories: string[];
    logo?: string;
}

export type DeviceMotionData = {
    rotation: {
        alpha: number;
        beta: number;
        gamma: number;
    };
}; 
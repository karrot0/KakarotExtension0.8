export interface AtsumaruMetadata {
  page?: number;
}

export interface AtsuHomePageResponse {
  homePage: {
    sections: AtsuSection[];
  };
}

export interface AtsuSection {
  key: string;
  layout: string;
  title?: string;
  items?: AtsuMangaItem[];
}

export interface AtsuMangaItem {
  id: string;
  image: string;
  title: string;
  type: string;
}

export interface AtsuInfiniteResponse {
  items: AtsuMangaItem[];
}

export interface AtsuMangaPageResponse {
  mangaPage: AtsuMangaDetails;
}

export interface AtsuMangaDetails {
  id: string;
  authors: Array<{ id: string; name: string }>;
  scanlators: Array<{ id: string; name: string }>;
  genres: AtsuTag[];
  englishTitle: string;
  poster: {
    id: string;
    image: string;
  };
  title: string;
  type: string;
  otherNames: string[];
  synopsis: string;
  status: string;
}

export interface AtsuTag {
  id: string;
  name: string;
}

export interface AtsuChapter {
  id: string;
  number: number;
  title: string;
  createdAt: number;
  scanlationMangaId: string | null;
}

export interface AtsuChaptersResponse {
  chapters: AtsuChapter[];
}

export interface AtsuReadChapterResponse {
  readChapter: {
    id: string;
    pages: AtsuPage[];
  };
}

export interface AtsuPage {
  id: string;
  image: string;
  number: number;
}

export interface AtsuSearchDocument {
  id: string;
  title: string;
  englishTitle?: string;
  poster: string;
  posterSmall?: string;
  posterMedium?: string;
  type: string;
}

export interface AtsuSearchResponse {
  found: number;
  hits?: Array<{ document: AtsuSearchDocument }>;
  page: number;
}

export interface AtsuAvailableFiltersResponse {
  genres: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string }>;
  statuses: Array<{ id: string; name: string }>;
}

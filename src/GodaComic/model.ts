export interface GodaComicMetadata {
  page?: number;
  collectedIds?: string[];
}

export interface ApiResponse<T> {
  data: T;
}

export interface ChapterInfo {
  manga_id: string;
  chapter_id: string;
  images?: string[];
}

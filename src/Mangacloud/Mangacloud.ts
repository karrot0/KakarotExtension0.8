import {
  ChapterProviding,
  ContentRating,
  HomePageSectionsProviding,
  MangaProviding,
  PagedResults,
  Request,
  Response,
  SearchRequest,
  SearchResultsProviding,
  SourceInfo,
  SourceIntents,
  SourceManga,
  ChapterDetails,
  Chapter,
  HomeSection,
  TagSection,
  PartialSourceManga
} from "@paperback/types";

import {
  MangacloudMetadata,
  MostViewedMangaResponse,
  ApiResponse,
  UpdatedMangaResponse,
  MangaInfo,
  ChapterInfo,
  BrowseMangaResponse,
  Types,
  Statuses,
  SortOptions,
  Genres,
  Themes,
  Formats
} from "./model";

const DOMAIN = "https://mangacloud.org";
const API_DOMAIN = "https://api.mangacloud.org";

export const MangacloudInfo: SourceInfo = {
  version: "1.0.0",
  name: "Mangacloud",
  description: `Extension that pulls content from ${DOMAIN}`,
  author: "Karrot",
  icon: "icon.png",
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: DOMAIN,
  intents:
    SourceIntents.MANGA_CHAPTERS |
    SourceIntents.HOMEPAGE_SECTIONS,
  sourceTags: []
};

export class Mangacloud
  implements
    ChapterProviding,
    HomePageSectionsProviding,
    MangaProviding,
    SearchResultsProviding
{
  requestManager = App.createRequestManager({
    requestsPerSecond: 10,
    requestTimeout: 10000,
    interceptor: {
      interceptRequest: async (request: Request): Promise<Request> => {
        request.headers = {
          ...(request.headers ?? {}),
          ...{
            referer: DOMAIN,
            "user-agent": await this.requestManager.getDefaultUserAgent(),
            accept: "*/*",
          }
        };
        return request;
      },
      interceptResponse: async (response: Response): Promise<Response> => {
        return response;
      }
    }
  });

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const request = App.createRequest({
      url: `${API_DOMAIN}/comic/${mangaId}`,
      method: "GET"
    });

    const response = await this.requestManager.schedule(request, 1);
    const jsonStr = response.data as string;
    const resp = JSON.parse(jsonStr) as ApiResponse<MangaInfo>;
    const info = resp.data;

    let status = "UNKNOWN";
    if (info.status === "Ongoing") status = "ONGOING";
    else if (info.status === "Completed") status = "COMPLETED";

    const tagGroups: TagSection[] = [];
    if (info.tags && info.tags.length > 0) {
      tagGroups.push(App.createTagSection({
        id: "tags",
        label: "Tags",
        tags: info.tags.map(t => App.createTag({ id: t.id, label: t.name }))
      }));
    }

    const genres = info.tags?.filter(t => t.type === "genre");
    if (genres && genres.length > 0) {
      tagGroups.push(App.createTagSection({
        id: "genres",
        label: "Genres",
        tags: genres.map(g => App.createTag({ id: g.id, label: g.name }))
      }));
    }

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        titles: [info.title, ...(info.alt_titles ? [info.alt_titles] : [])],
        image: info.cover ? `https://pika.mangacloud.org/${mangaId}/${info.cover.id}.${info.cover.f}` : "",
        desc: info.description || "",
        status: status,
        rating: 0,
        tags: tagGroups,
        hentai: false
      })
    });
  }

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const request = App.createRequest({
      url: `${API_DOMAIN}/comic/${mangaId}`,
      method: "GET"
    });

    const response = await this.requestManager.schedule(request, 1);
    const jsonStr = response.data as string;
    const resp = JSON.parse(jsonStr) as ApiResponse<MangaInfo>;
    const info = resp.data;
    const chapters: Chapter[] = [];

    if (info.chapters && info.chapters.length > 0) {
      for (const ch of info.chapters) {
        chapters.push(App.createChapter({
          id: ch.id,
          name: ch.name || `${ch.number}`,
          chapNum: ch.number,
          time: ch.created_date ? new Date(ch.created_date) : new Date(),
          volume: 0,
          langCode: "en"
        }));
      }
    }

    return chapters;
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const request = App.createRequest({
      url: `${API_DOMAIN}/chapter/${chapterId}`,
      method: "GET"
    });

    const response = await this.requestManager.schedule(request, 1);
    const jsonStr = response.data as string;
    const resp = JSON.parse(jsonStr) as ApiResponse<ChapterInfo>;
    const info = resp.data;

    const pages: string[] = [];
    if (info.images && info.images.length > 0) {
      for (const img of info.images) {
        pages.push(`https://pika.mangacloud.org/${info.comic_id}/${info.id}/${img.id}.${img.f}`);
      }
    }

    return App.createChapterDetails({
      id: chapterId,
      mangaId,
      pages
    });
  }

  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    sectionCallback(App.createHomeSection({
      id: "popular_section",
      title: "Popular",
      type: "singleRowNormal",
      items: [],
      containsMoreItems: true
    }));

    sectionCallback(App.createHomeSection({
      id: "updated_section",
      title: "Recently Updated",
      type: "singleRowNormal",
      items: [],
      containsMoreItems: true
    }));
  }

  async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
    const page = metadata?.page ?? 1;
    const collectedIds = metadata?.collectedIds ?? [];

    switch (homepageSectionId) {
      case "popular_section":
        return this.getPopularSectionItems(page, collectedIds);
      case "updated_section":
        return this.getUpdatedSectionItems(page, collectedIds);
      default:
        return App.createPagedResults({ results: [] });
    }
  }

  private async getPopularSectionItems(page: number, collectedIds: string[]): Promise<PagedResults> {
    let url = `${API_DOMAIN}/comic-popular-view/today`;
    if (page > 1) url += `?page=${page}`;

    const request = App.createRequest({ url, method: "GET" });
    const response = await this.requestManager.schedule(request, 1);
    const jsonStr = response.data as string;
    const resp = JSON.parse(jsonStr) as ApiResponse<MostViewedMangaResponse>;
    const list = resp.data?.list || [];

    const items: PartialSourceManga[] = [];
    for (const m of list) {
      if (!m.id || collectedIds.includes(m.id)) continue;
      collectedIds.push(m.id);

      items.push(App.createPartialSourceManga({
        mangaId: m.id,
        title: m.title,
        image: m.cover ? `https://pika.mangacloud.org/${m.id}/${m.cover.id}.${m.cover.f}` : "",
        subtitle: m.number !== undefined ? `Chapters: ${m.number}` : undefined
      }));
    }

    return App.createPagedResults({
      results: items,
      metadata: list.length > 0 ? { page: page + 1, collectedIds } : undefined
    });
  }

  private async getUpdatedSectionItems(page: number, collectedIds: string[]): Promise<PagedResults> {
    const request = App.createRequest({
      url: `${API_DOMAIN}/comic-updates`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ page })
    });

    const response = await this.requestManager.schedule(request, 1);
    const jsonStr = response.data as string;
    const resp = JSON.parse(jsonStr) as ApiResponse<UpdatedMangaResponse>;
    const list = resp.data?.list || [];

    const items: PartialSourceManga[] = [];
    for (const m of list) {
      if (!m.id || collectedIds.includes(m.id)) continue;
      collectedIds.push(m.id);

      items.push(App.createPartialSourceManga({
        mangaId: m.id,
        title: m.title,
        image: m.cover ? `https://pika.mangacloud.org/${m.id}/${m.cover.id}.${m.cover.f}` : "",
        subtitle: m.chapters && m.chapters.length > 0 ? `${m.chapters.length} chapters` : undefined
      }));
    }

    return App.createPagedResults({
      results: items,
      metadata: list.length > 0 ? { page: page + 1, collectedIds } : undefined
    });
  }

  async getSearchTags(): Promise<TagSection[]> {
    const tags: TagSection[] = [];

    tags.push(App.createTagSection({
      id: "type",
      label: "Type",
      tags: Types.map(t => App.createTag({ id: `type-${t.name}`, label: t.name }))
    }));

    tags.push(App.createTagSection({
      id: "status",
      label: "Status",
      tags: Statuses.map(s => App.createTag({ id: `status-${s.id}`, label: s.name }))
    }));

    tags.push(App.createTagSection({
      id: "sort",
      label: "Sort Options",
      tags: SortOptions.map(s => App.createTag({ id: `sort-${s.id}`, label: s.name }))
    }));

    tags.push(App.createTagSection({
      id: "genres",
      label: "Genres",
      tags: Genres.map(g => App.createTag({ id: g.id, label: g.name }))
    }));

    tags.push(App.createTagSection({
      id: "themes",
      label: "Themes",
      tags: Themes.map(t => App.createTag({ id: t.id, label: t.name }))
    }));

    tags.push(App.createTagSection({
      id: "formats",
      label: "Formats",
      tags: Formats.map(f => App.createTag({ id: f.id, label: f.name }))
    }));

    return tags;
  }

  async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
    const page = metadata?.page ?? 1;
    const body: Record<string, any> = { page };

    if (query.title && query.title.trim() !== "") {
      body.title = query.title;
    }

    const includes: string[] = [];
    const excludes: string[] = [];

    // Paperback 0.8 splits filter selections into includedTags and excludedTags
    for (const tag of query.includedTags ?? []) {
      if (tag.id.startsWith("type-")) {
        body.type = tag.id.replace("type-", "");
      } else if (tag.id.startsWith("status-")) {
        body.status = tag.id.replace("status-", "");
      } else if (tag.id.startsWith("sort-")) {
        body.sort = tag.id.replace("sort-", "");
      } else {
        includes.push(tag.id);
      }
    }

    for (const tag of query.excludedTags ?? []) {
      if (!tag.id.startsWith("type-") && !tag.id.startsWith("status-") && !tag.id.startsWith("sort-")) {
        excludes.push(tag.id);
      }
    }

    if (!body.sort) {
       body.sort = "updated_date-DESC";
    }

    if (includes.length > 0) body.includes = includes;
    if (excludes.length > 0) body.excludes = excludes;

    const request = App.createRequest({
      url: `${API_DOMAIN}/comic/browse`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(body)
    });

    const response = await this.requestManager.schedule(request, 1);
    const jsonStr = response.data as string;
    const resp = JSON.parse(jsonStr) as ApiResponse<BrowseMangaResponse>;
    const list = resp.data || [];

    const items: PartialSourceManga[] = [];
    for (const m of list) {
      if (!m.id) continue;
      items.push(App.createPartialSourceManga({
        mangaId: m.id,
        title: m.title,
        image: m.cover ? `https://pika.mangacloud.org/${m.id}/${m.cover.id}.${m.cover.f}` : "",
        subtitle: undefined
      }));
    }

    return App.createPagedResults({
      results: items,
      metadata: list.length > 0 ? { page: page + 1, collectedIds: metadata?.collectedIds } : undefined
    });
  }
}

import {
  Badge,
  BadgeColor,
  Chapter,
  ChapterDetails,
  ChapterProviding,
  ContentRating,
  HomePageSectionsProviding,
  HomeSection,
  HomeSectionType,
  MangaProviding,
  PagedResults,
  PartialSourceManga,
  Request,
  Response,
  SearchRequest,
  SearchResultsProviding,
  SourceInfo,
  SourceIntents,
  SourceManga,
  TagSection,
} from "@paperback/types";

import * as cheerio from "cheerio";
import { RawkumaMetadata } from "./model";

const BASE_URL = "https://rawkuma.net";

export const RawkumaInfo: SourceInfo = {
  version: "1.1",
  name: "Rawkuma",
  description: `Extension that pulls content from ${BASE_URL}`,
  author: "Karrot",
  icon: "icon.png",
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: BASE_URL,
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
  sourceTags: [{ text: "Raw", type: BadgeColor.GREY } as Badge],
};

export class Rawkuma
  implements
    ChapterProviding,
    HomePageSectionsProviding,
    MangaProviding,
    SearchResultsProviding
{
  requestManager = App.createRequestManager({
    requestsPerSecond: 5,
    requestTimeout: 20000,
    interceptor: {
      interceptRequest: async (request: Request): Promise<Request> => {
        request.headers = {
          ...(request.headers ?? {}),
          origin: `${BASE_URL}/`,
          referer: `${BASE_URL}/`,
          "user-agent": await this.requestManager.getDefaultUserAgent(),
        };
        return request;
      },
      interceptResponse: async (response: Response): Promise<Response> => {
        return response;
      },
    },
  });

  async getHomePageSections(
    sectionCallback: (section: HomeSection) => void
  ): Promise<void> {
    const sections: HomeSection[] = [
      App.createHomeSection({
        id: "popular_section",
        title: "Popular",
        type: HomeSectionType.featured,
        containsMoreItems: false,
      }),
      App.createHomeSection({
        id: "popular_today_section",
        title: "Popular Today",
        type: HomeSectionType.singleRowLarge,
        containsMoreItems: false,
      }),
      App.createHomeSection({
        id: "latest_updates_section",
        title: "Latest Updates",
        type: HomeSectionType.singleRowNormal,
        containsMoreItems: false,
      }),
      App.createHomeSection({
        id: "top_series_section",
        title: "Top Series",
        type: HomeSectionType.singleRowLarge,
        containsMoreItems: false,
      }),
    ];

    for (const section of sections) {
      sectionCallback(section);
    }

    const response = await this.requestManager.schedule(
      App.createRequest({ url: BASE_URL, method: "GET" }),
      1
    );
    const $ = cheerio.load(response.data as string);

    const popularItems: PartialSourceManga[] = [];
    $(".swiper-slide")
      .not(".manga-swipe")
      .each((_, element) => {
        const slide = $(element);
        const titleAnchor = slide.find("a").first();
        const mangaUrl = titleAnchor.attr("href") || "";
        const mangaIdMatch = mangaUrl.match(/\/manga\/([^/]+)\/?/);
        if (!mangaIdMatch) return;
        const mangaId = mangaIdMatch[1];
        let title = titleAnchor.find("span.font-semibold").first().text().trim();
        if (!title) title = titleAnchor.text().trim();
        const image = slide.find("img").first().attr("src") || "";
        if (!mangaId || !title) return;
        popularItems.push(
          App.createPartialSourceManga({ mangaId, image, title })
        );
      });

    const carouselItems: PartialSourceManga[] = [];
    $(".swiper-slide.manga-swipe").each((_, element) => {
      const slide = $(element);
      const titleAnchor = slide.find("a").first();
      const mangaUrl = titleAnchor.attr("href") || "";
      const mangaIdMatch = mangaUrl.match(/\/manga\/([^/]+)\/?/);
      if (!mangaIdMatch) return;
      const mangaId = mangaIdMatch[1];
      const title = slide.find(".title h4").first().text().trim();
      const image = slide.find("img.cover-image").attr("src") || "";
      const rating = slide.find(".details p.inline-block").first().text().trim();
      const subtitle = rating ? `Rating: ${rating}` : "";
      if (!mangaId || !title) return;
      carouselItems.push(
        App.createPartialSourceManga({ mangaId, image, title, subtitle })
      );
    });

    for (const section of sections) {
      switch (section.id) {
        case "popular_section":
          section.items = popularItems;
          break;
        case "popular_today_section":
        case "latest_updates_section":
        case "top_series_section":
          section.items = carouselItems;
          break;
      }
      sectionCallback(section);
    }
  }

  async getViewMoreItems(
    _sectionId: string,
    _metadata: RawkumaMetadata | undefined
  ): Promise<PagedResults> {
    return App.createPagedResults({ results: [] });
  }

  async getSearchResults(
    query: SearchRequest,
    metadata: RawkumaMetadata | undefined
  ): Promise<PagedResults> {
    const collectedIds: string[] = metadata?.collectedIds ?? [];
    const page: number = metadata?.page ?? 1;
    const searchTerm = query.title ?? "";

    const libResponse = await this.requestManager.schedule(
      App.createRequest({ url: `${BASE_URL}/library/`, method: "GET" }),
      1
    );
    const $lib = cheerio.load(libResponse.data as string);
    let nonce = "";
    $lib("script").each((_, el) => {
      const text = $lib(el).html() || "";
      const match = text.match(/"nonce"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        nonce = match[1];
        return false as any;
      }
    });

    const params: Record<string, string> = {
      nonce,
      inclusion: "OR",
      exclusion: "OR",
      page: String(page),
      genre: "[]",
      genre_exclude: "[]",
      author: "[]",
      artist: "[]",
      project: "0",
      type: "[]",
      status: "[]",
      order: "desc",
      orderby: "popular",
      query: searchTerm,
    };
    const body = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const response = await this.requestManager.schedule(
      App.createRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=advanced_search`,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: BASE_URL,
          referer: `${BASE_URL}/library/?search_term=${encodeURIComponent(searchTerm)}`,
        },
        data: body as any,
      }),
      1
    );
    const $ = cheerio.load(response.data as string);

    const results: PartialSourceManga[] = [];
    const seenIds = new Set<string>(collectedIds);

    $("a[href*='/manga/']").each((_, element) => {
      const anchor = $(element);
      if (!anchor.hasClass("text-base")) return;

      const mangaUrl = anchor.attr("href") || "";
      const mangaIdMatch = mangaUrl.match(/\/manga\/([^/]+)\/?/);
      const mangaId = mangaIdMatch ? mangaIdMatch[1] : "";
      if (!mangaId || seenIds.has(mangaId)) return;
      seenIds.add(mangaId);

      const title = anchor.text().trim();
      const container = anchor.closest("div");
      const image =
        container.find("img.wp-post-image").first().attr("src") ||
        container
          .parents("div")
          .find("img.wp-post-image")
          .first()
          .attr("src") ||
        "";

      if (!title || !mangaId) return;
      collectedIds.push(mangaId);
      results.push(App.createPartialSourceManga({ mangaId, image, title }));
    });

    const hasNextPage =
      $(`button[onclick*="'page', '${page + 1}'"]`).length > 0;

    return App.createPagedResults({
      results,
      metadata:
        results.length > 0 && hasNextPage
          ? { page: page + 1, collectedIds }
          : undefined,
    });
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const response = await this.requestManager.schedule(
      App.createRequest({ url: `${BASE_URL}/manga/${mangaId}`, method: "GET" }),
      1
    );
    const $ = cheerio.load(response.data as string);

    const title = $('h1[itemprop="name"]').first().text().trim();
    const rawImage =
      $('div[itemprop="image"] img').first().attr("src") || "";
    const image = rawImage.startsWith("/")
      ? `${BASE_URL}${rawImage}`
      : rawImage;

    const description = $('div[itemprop="description"][data-show="true"]')
      .first()
      .text()
      .trim();

    const status = "ONGOING";

    const genres = $('a[itemprop="genre"]')
      .map((_, el) => $(el).text().trim())
      .get();

    let publisher = "";
    const serializationHeading = $("h4")
      .filter((_, el) => {
        const text = $(el).text().trim().toLowerCase();
        return text.includes("serialization") || text.includes("publisher");
      })
      .first();
    if (serializationHeading?.length) {
      publisher = serializationHeading.next().text().trim();
    }

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
      tagGroups.push(
        App.createTagSection({
          id: "genres",
          label: "Genres",
          tags: genres.map((genre) =>
            App.createTag({
              id: genre.toLowerCase().replace(/[^a-z0-9]/g, ""),
              label: genre,
            })
          ),
        })
      );
    }

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        titles: [title],
        image,
        author: publisher,
        desc: description,
        status,
        tags: tagGroups,
      }),
    });
  }

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const response = await this.requestManager.schedule(
      App.createRequest({ url: `${BASE_URL}/manga/${mangaId}`, method: "GET" }),
      1
    );
    const $manga = cheerio.load(response.data as string);

    const hxGet =
      $manga("[hx-get*='chapter_list']").first().attr("hx-get") || "";
    const mangaIdMatch = hxGet.match(/manga_id=(\d+)/);
    if (!mangaIdMatch) return [];
    const mangaDbId = mangaIdMatch[1];

    const chapResponse = await this.requestManager.schedule(
      App.createRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?manga_id=${mangaDbId}&action=chapter_list`,
        method: "GET",
        headers: {
          "hx-request": "true",
          "hx-target": "chapter-list",
          "hx-trigger": "chapter-list",
          referer: `${BASE_URL}/manga/${mangaId}/`,
        },
      }),
      1
    );
    const $ = cheerio.load(chapResponse.data as string);

    const chapters: Chapter[] = [];

    $("div[data-chapter-number]").each((_, element) => {
      const el = $(element);
      const href = el.find("a").first().attr("href") || "";
      if (!href) return;

      const chapterTitle = el
        .find("div.flex.flex-row span")
        .first()
        .text()
        .trim();
      const chapNum = parseFloat(el.attr("data-chapter-number") || "0");
      const dateAttr = el.find("time").attr("datetime") || "";
      const chapterId =
        href.replace(/\/$/, "").split("/").pop() ?? "";

      chapters.push(
        App.createChapter({
          id: chapterId,
          name: chapterTitle,
          chapNum,
          time: dateAttr ? new Date(dateAttr) : new Date(),
          langCode: "🇯🇵",
        })
      );
    });

    return chapters;
  }

  async getChapterDetails(
    mangaId: string,
    chapterId: string
  ): Promise<ChapterDetails> {
    const response = await this.requestManager.schedule(
      App.createRequest({
        url: `${BASE_URL}/manga/${mangaId}/${chapterId}`,
        method: "GET",
      }),
      1
    );
    const $ = cheerio.load(response.data as string);

    const pages: string[] = [];
    $("section[data-image-data] img").each((_, element) => {
      const image = $(element).attr("src") || "";
      if (!image || image.includes("preloader.gif")) return;
      pages.push(image.trim());
    });

    return App.createChapterDetails({
      id: chapterId,
      mangaId,
      pages,
    });
  }
}

import {
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
  CloudflareBypassRequestProviding,
} from "@paperback/types";

import * as cheerio from "cheerio";
import { ElftoonMetadata } from "./model";

const DOMAIN = "https://elftoon.com";

export const ElftoonInfo: SourceInfo = {
  version: "1.0.0",
  name: "Elftoon",
  description: `Extension that pulls content from ${DOMAIN}`,
  author: "Karrot",
  icon: "icon.png",
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: DOMAIN,
  intents:
    SourceIntents.MANGA_CHAPTERS |
    SourceIntents.HOMEPAGE_SECTIONS |
    SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
  sourceTags: [],
};

export class Elftoon
  implements
    ChapterProviding,
    HomePageSectionsProviding,
    MangaProviding,
    SearchResultsProviding,
    CloudflareBypassRequestProviding
{
  requestManager = App.createRequestManager({
    requestsPerSecond: 4,
    requestTimeout: 20000,
    interceptor: {
      interceptRequest: async (request: Request): Promise<Request> => {
        request.headers = {
          ...(request.headers ?? {}),
          referer: `${DOMAIN}/`,
          origin: DOMAIN,
          "user-agent": await this.requestManager.getDefaultUserAgent(),
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.5",
          "cache-control": "no-cache",
          pragma: "no-cache",
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
        id: "trending_section",
        title: "Trending",
        type: HomeSectionType.featured,
        containsMoreItems: false,
      }),
      App.createHomeSection({
        id: "latest_updates_section",
        title: "Latest Updates",
        type: HomeSectionType.singleRowNormal,
        containsMoreItems: true,
      }),
      App.createHomeSection({
        id: "popular_section",
        title: "Popular",
        type: HomeSectionType.singleRowLarge,
        containsMoreItems: true,
      }),
    ];

    for (const section of sections) {
      sectionCallback(section);
    }

    const trending = await this.getTrendingSectionItems(undefined);
    const latest = await this.getMangaListItems(undefined, "update");
    const popular = await this.getMangaListItems(undefined, "popular");

    for (const section of sections) {
      switch (section.id) {
        case "trending_section":
          section.items = trending.results;
          break;
        case "latest_updates_section":
          section.items = latest.results;
          break;
        case "popular_section":
          section.items = popular.results;
          break;
      }
      sectionCallback(section);
    }
  }

  async getViewMoreItems(
    homepageSectionId: string,
    metadata: ElftoonMetadata | undefined
  ): Promise<PagedResults> {
    switch (homepageSectionId) {
      case "latest_updates_section":
        return this.getMangaListItems(metadata, "update");
      case "popular_section":
        return this.getMangaListItems(metadata, "popular");
      default:
        return App.createPagedResults({ results: [] });
    }
  }

  async getSearchResults(
    query: SearchRequest,
    metadata: ElftoonMetadata | undefined
  ): Promise<PagedResults> {
    const page = metadata?.page ?? 1;
    const collectedIds = metadata?.searchCollectedIds ?? [];
    const searchTitle = (query.title ?? "").trim();

    if (!searchTitle) {
      const paged = await this.getMangaListItems(
        { page, collectedIds },
        "update",
        true
      );
      return App.createPagedResults({
        results: paged.results,
        metadata: paged.metadata
          ? {
              page: (paged.metadata as ElftoonMetadata).page,
              searchCollectedIds: (paged.metadata as ElftoonMetadata).collectedIds,
            }
          : undefined,
      });
    }

    const request = App.createRequest({
      url: `${DOMAIN}/page/${page}/?s=${encodeURIComponent(searchTitle)}&post_type=wp-manga`,
      method: "GET",
    });

    const response = await this.requestManager.schedule(request, 1);
    const $ = cheerio.load(response.data as string);

    const results: PartialSourceManga[] = [];
    const seen = new Set<string>(collectedIds);

    this.extractSearchCards($, ".bs", results, seen);
    this.extractSearchCards($, ".c-tabs-item__content, .row.c-tabs-item, .utao.styletwo", results, seen);

    const hasNextPage = $(".pagination a.next, .hpage .r").length > 0;

    return App.createPagedResults({
      results,
      metadata: hasNextPage
        ? { page: page + 1, searchCollectedIds: Array.from(seen) }
        : undefined,
    });
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const request = App.createRequest({
      url: `${DOMAIN}/manga/${mangaId}`,
      method: "GET",
    });

    const response = await this.requestManager.schedule(request, 1);
    const $ = cheerio.load(response.data as string);

    let title = $(".entry-title").first().text().trim();
    if (!title) title = $("h1.entry-title").first().text().trim();
    if (!title) title = $("title").first().text().split(" - ")[0]?.trim() ?? mangaId;

    const altTitles: string[] = [];
    $(".alternative").each((_, element) => {
      const text = $(element).text().trim();
      if (text) altTitles.push(text);
    });

    let image = $(".main-info .info-left .thumb img").first().attr("src") ||
      $(".main-info .info-left .thumb img").first().attr("data-src") ||
      "";
    if (image && !image.startsWith("http")) {
      image = image.startsWith("/") ? `${DOMAIN}${image}` : `${DOMAIN}/${image}`;
    }

    const description =
      $(".entry-content p, .entry-content-single p")
        .map((_, el) => $(el).text().trim())
        .get()
        .join("\n")
        .trim() || $(".entry-content, .description-summary").first().text().trim();

    const authors: string[] = [];
    $(".tsinfo .imptdt").each((_, element) => {
      const text = $(element).text();
      if (text.includes("Posted By")) {
        const author = $(element).find("i").text().trim();
        if (author && author !== "hyyh gth") {
          authors.push(author);
        }
      }
    });

    let status = "UNKNOWN";
    $(".tsinfo .imptdt").each((_, element) => {
      const text = $(element).text();
      if (text.includes("Status")) {
        const value = $(element).find("i").text().trim().toLowerCase();
        if (value.includes("ongoing")) status = "ONGOING";
        if (value.includes("complete")) status = "COMPLETED";
      }
    });

    const genres: string[] = [];
    $(".wd-full .mgen a").each((_, element) => {
      const genre = $(element).text().trim();
      if (genre) genres.push(genre);
    });

    const tags: TagSection[] = [];
    if (genres.length > 0) {
      tags.push(
        App.createTagSection({
          id: "genres",
          label: "Genres",
          tags: genres.map((genre) =>
            App.createTag({
              id: genre.toLowerCase().replace(/\s+/g, "-"),
              label: genre,
            })
          ),
        })
      );
    }

    let rating = 0;
    const ratingText = $(".rating .num").first().text().trim();
    if (ratingText) {
      rating = parseFloat(ratingText) || 0;
    }

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        titles: [title, ...altTitles],
        image,
        author: authors.join(", ") || undefined,
        desc: description,
        status,
        tags,
        rating: rating / 10,
        hentai: false,
      }),
    });
  }

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const request = App.createRequest({
      url: `${DOMAIN}/manga/${mangaId}`,
      method: "GET",
    });

    const response = await this.requestManager.schedule(request, 1);
    const $ = cheerio.load(response.data as string);

    const chapters: Chapter[] = [];
    $(".eplister ul li").each((_, element) => {
      const chapterElement = $(element);
      const chapterLink = chapterElement.find(".eph-num a").first();
      const href = chapterLink.attr("href") || "";
      const isLocked =
        href === "#" ||
        chapterLink.attr("data-bs-target") === "#lockedChapterModal" ||
        chapterElement.find('[data-bs-target="#lockedChapterModal"]').length > 0;

      if (!href || isLocked) {
        return;
      }

      const chapterNumText = chapterElement.find(".chapternum").text().trim();
      const chapterTitle = chapterNumText || chapterLink.text().trim();

      let chapterId = href
        .replace(DOMAIN, "")
        .replace(/^\//, "")
        .replace(/\/$/, "");

      const chapterMatch = chapterId.match(/-chapter-(\d+(?:\.\d+)?)$/i);
      const normalizedId = chapterMatch ? `chapter-${chapterMatch[1]}` : chapterId;

      let chapNum = 0;
      const dataNum = chapterElement.attr("data-num");
      if (dataNum) {
        chapNum = parseFloat(dataNum);
      } else {
        const parsed = chapterTitle.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
        if (parsed?.[1]) {
          chapNum = parseFloat(parsed[1]);
        }
      }

      const dateText = chapterElement.find(".chapterdate").text().trim();
      const parsedDate = this.parseDate(dateText);

      if (!chapterId.startsWith("manga/")) {
        chapterId = `manga/${chapterId}`;
      }

      chapters.push(
        App.createChapter({
          id: chapterId || normalizedId,
          name: chapterTitle,
          chapNum,
          volume: 0,
          time: parsedDate,
          langCode: "en",
        })
      );
    });

    return chapters.reverse();
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const chapterUrl = chapterId.startsWith("http")
      ? chapterId
      : `${DOMAIN}/${chapterId.replace(/^\//, "")}`;

    const request = App.createRequest({ url: chapterUrl, method: "GET" });
    const response = await this.requestManager.schedule(request, 1);
    const html = response.data as string;
    const $ = cheerio.load(html);

    const pages: string[] = [];

    const scriptRegex = /ts_reader\.run\((\{[\s\S]*?\})\);<\/script>/;
    const match = html.match(scriptRegex);

    if (match?.[1]) {
      try {
        const parsed = JSON.parse(match[1]) as {
          sources?: Array<{ images?: string[] }>;
        };

        for (const source of parsed.sources ?? []) {
          for (const imageUrl of source.images ?? []) {
            if (
              typeof imageUrl === "string" &&
              imageUrl.startsWith("http") &&
              !imageUrl.includes("readerarea.svg")
            ) {
              pages.push(imageUrl);
            }
          }
        }
      } catch {
        // Fallback selector parsing below
      }
    }

    if (pages.length === 0) {
      $(".reading-content img, .reader-area img").each((_, img) => {
        const image =
          $(img).attr("data-src") ||
          $(img).attr("src") ||
          "";
        if (image && !image.includes("readerarea.svg")) {
          pages.push(image);
        }
      });
    }

    return App.createChapterDetails({
      id: chapterId,
      mangaId,
      pages: Array.from(new Set(pages)),
    });
  }

  async getCloudflareBypassRequestAsync(): Promise<Request> {
    return App.createRequest({
      url: DOMAIN,
      method: "GET",
      headers: {
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await this.requestManager.getDefaultUserAgent(),
      },
    });
  }

  getMangaShareUrl(mangaId: string): string {
    return `${DOMAIN}/manga/${mangaId}`;
  }

  private async getTrendingSectionItems(
    metadata: ElftoonMetadata | undefined
  ): Promise<PagedResults> {
    const collectedIds = metadata?.collectedIds ?? [];

    const response = await this.requestManager.schedule(
      App.createRequest({ url: DOMAIN, method: "GET" }),
      1
    );
    const $ = cheerio.load(response.data as string);

    const items: PartialSourceManga[] = [];
    const seen = new Set<string>(collectedIds);

    $(".swiper-slide .mainslider").each((_, element) => {
      const unit = $(element);
      const titleLink = unit.find(".sliderinfolimit .name").first();
      const title = titleLink.text().trim();
      const href = titleLink.closest("a").attr("href") || "";

      const mangaId = href
        .replace(DOMAIN, "")
        .replace(/^\//, "")
        .replace(/^manga\//, "")
        .replace(/\/$/, "");

      const imageElem = unit.find(".slidtrithumb img").first();
      let image = imageElem.attr("src") || imageElem.attr("data-src") || "";
      if (image && !image.startsWith("http")) {
        image = image.startsWith("/") ? `${DOMAIN}${image}` : `${DOMAIN}/${image}`;
      }

      const subtitle = unit.find(".slidlc").first().text().trim();

      if (title && mangaId && !seen.has(mangaId)) {
        seen.add(mangaId);
        items.push(
          App.createPartialSourceManga({
            mangaId,
            title,
            image,
            subtitle: subtitle || undefined,
          })
        );
      }
    });

    return App.createPagedResults({
      results: items,
      metadata: undefined,
    });
  }

  private async getMangaListItems(
    metadata: ElftoonMetadata | undefined,
    orderType: "update" | "popular",
    forSearch: boolean = false
  ): Promise<PagedResults> {
    const page = metadata?.page ?? 1;
    const collectedIds = metadata?.collectedIds ?? [];

    const request = App.createRequest({
      url: `${DOMAIN}/manga?page=${page}&order=${orderType}`,
      method: "GET",
    });

    const response = await this.requestManager.schedule(request, 1);
    const $ = cheerio.load(response.data as string);

    const items: PartialSourceManga[] = [];
    const seen = new Set<string>(collectedIds);

    $(".bs").each((_, element) => {
      const unit = $(element);
      const titleLink = unit.find(".bsx a").first();
      const title = unit.find(".tt").text().trim();
      const href = titleLink.attr("href") || "";

      const mangaId = href
        .replace(DOMAIN, "")
        .replace(/^\//, "")
        .replace(/^manga\//, "")
        .replace(/\/$/, "");

      const imgElem = unit.find(".limit img").first();
      let image = imgElem.attr("src") || imgElem.attr("data-src") || "";
      if (image && !image.startsWith("http")) {
        image = image.startsWith("/") ? `${DOMAIN}${image}` : `${DOMAIN}/${image}`;
      }

      const latestChapter = unit.find(".epxs").first().text().trim();

      if (title && mangaId && !seen.has(mangaId)) {
        seen.add(mangaId);
        items.push(
          App.createPartialSourceManga({
            mangaId,
            title,
            image,
            subtitle: latestChapter || undefined,
          })
        );
      }
    });

    const hasNextPage = $(".hpage .r, .pagination a.next").length > 0;

    return App.createPagedResults({
      results: items,
      metadata: hasNextPage
        ? forSearch
          ? { page: page + 1, searchCollectedIds: Array.from(seen) }
          : { page: page + 1, collectedIds: Array.from(seen) }
        : undefined,
    });
  }

  private extractSearchCards(
    $: cheerio.CheerioAPI,
    selector: string,
    target: PartialSourceManga[],
    seen: Set<string>
  ): void {
    $(selector).each((_, element) => {
      const unit = $(element);

      let titleLink = unit.find(".post-title a").first();
      if (!titleLink.length) {
        titleLink = unit.find("h3 a, h4 a, .luf h4 a, .tt a").first();
      }

      let title = titleLink.text().trim();
      if (!title) title = unit.find(".tt").first().text().trim();

      const href = titleLink.attr("href") || "";
      if (!href.includes("/manga/")) {
        return;
      }

      const mangaId = href
        .replace(DOMAIN, "")
        .replace(/^\//, "")
        .replace(/^manga\//, "")
        .replace(/\/$/, "");

      const imgElem = unit.find("img").first();
      let image = imgElem.attr("src") || imgElem.attr("data-src") || "";
      if (image && !image.startsWith("http")) {
        image = image.startsWith("/") ? `${DOMAIN}${image}` : `${DOMAIN}/${image}`;
      }

      const subtitle =
        unit.find(".epxs").first().text().trim() ||
        unit.find(".latestchap").first().text().trim();

      if (title && mangaId && !seen.has(mangaId)) {
        seen.add(mangaId);
        target.push(
          App.createPartialSourceManga({
            mangaId,
            title,
            image,
            subtitle: subtitle || undefined,
          })
        );
      }
    });
  }

  private parseDate(raw: string): Date {
    const text = raw.trim();
    if (!text) return new Date();

    const direct = new Date(text);
    if (!isNaN(direct.getTime())) {
      return direct;
    }

    const now = Date.now();
    const rel = text.toLowerCase();
    const amount = parseInt(rel.match(/\d+/)?.[0] ?? "0", 10);

    if (rel.includes("minute")) return new Date(now - amount * 60000);
    if (rel.includes("hour")) return new Date(now - amount * 3600000);
    if (rel.includes("day")) return new Date(now - amount * 86400000);
    if (rel.includes("week")) return new Date(now - amount * 604800000);

    return new Date();
  }
}

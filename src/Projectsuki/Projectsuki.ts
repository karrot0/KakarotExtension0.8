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
  PartialSourceManga,
} from "@paperback/types";

import * as cheerio from "cheerio";
import { ProjectsukiMetadata } from "./model";

const DOMAIN = "https://projectsuki.com";

export const ProjectsukiInfo: SourceInfo = {
  version: "1.0.0",
  name: "Projectsuki",
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

export class Projectsuki implements
  ChapterProviding,
  HomePageSectionsProviding,
  MangaProviding,
  SearchResultsProviding {

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
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
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
      url: `${DOMAIN}/book/${mangaId}`,
      method: "GET"
    });

    const response = await this.requestManager.schedule(request, 1);
    const $ = cheerio.load(response.data as string);

    const primaryTitle = $("h2[itemprop=title]").first().text().trim() || "";
    const altTitles: string[] = [];
    $(".row.py-1").each((_, el) => {
      const label = $(el).find(".col-4").first().text().trim();
      if (label.startsWith("Alternative titles")) {
        const text = $(el).find(".col-8").text().trim();
        if (text) {
          altTitles.push(...text.split(",").map((s) => s.trim()).filter(Boolean));
        }
      }
    });

    let thumbnailUrl = $(".img-thumbnail").first().attr("src") || "";
    if (thumbnailUrl && thumbnailUrl.startsWith("/")) {
      thumbnailUrl = DOMAIN + thumbnailUrl;
    }

    const synopsis = $(".description").text().trim();

    let statusText = "";
    $(".row.py-1").each((_, el) => {
      const label = $(el).find(".col-4").first().text().trim();
      if (label.startsWith("Status")) {
        statusText = $(el).find(".col-8").text().trim();
      }
    });
    
    let status = "UNKNOWN";
    if (/completed/i.test(statusText)) status = "COMPLETED";
    else if (/ongoing/i.test(statusText)) status = "ONGOING";

    const genres: string[] = [];
    $(".row.py-1").each((_, el) => {
      const label = $(el).find(".col-4").first().text().trim();
      if (label.startsWith("Genre")) {
        $(el).find(".col-8 a").each((_, g) => {
          genres.push($(g).text().trim());
        });
      }
    });

    const tagGroups: TagSection[] = [];
    if (genres.length) {
      const tags = genres.map((g, i) => {
        let id = g.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!id) id = `genre${i}`;
        return App.createTag({ id, label: g });
      });
      tagGroups.push(App.createTagSection({
        id: "genres",
        label: "Genres",
        tags,
      }));
    }

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        titles: [primaryTitle, ...altTitles],
        image: thumbnailUrl,
        desc: synopsis,
        status: status,
        tags: tagGroups,
      }),
    });
  }

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const request = App.createRequest({
      url: `${DOMAIN}/book/${mangaId}`,
      method: "GET"
    });

    const response = await this.requestManager.schedule(request, 1);
    const $ = cheerio.load(response.data as string);

    const chapters: Chapter[] = [];
    let rows = $("table tbody tr");
    if (rows.length === 0) {
      rows = $("tr.row.mx-0").filter((_, r) => $(r).find("td a").length > 0);
    }

    rows.each((_, row) => {
      const anchor = $(row).find("td a").first();
      const href = anchor.attr("href") || "";
      const match = href.match(/\/read\/\d+\/(\d+)/);
      const chapterId = match ? match[1] : undefined;
      if (!chapterId) return;

      const title = anchor.text().trim();
      
      let chapNum = 0;
      const chapMatch = title.match(/(?:Ch(?:apter)?\.?\s*)(\d+(?:\.\d+)?)/i);
      if (chapMatch && chapMatch[1]) {
        chapNum = parseFloat(chapMatch[1]);
      } else {
        const numMatch = title.match(/(\d+(?:\.\d+)?)/);
        chapNum = numMatch && numMatch[1] ? parseFloat(numMatch[1]) : 0;
      }

      let publishDate: Date | undefined;
      const dateSpan = $(row).find("span[itemscope][itemtype*=dateCreated]").first();
      const dateTitle = dateSpan.attr("title") || dateSpan.text().trim();
      if (dateTitle) {
        const parts = dateTitle.split("-");
        if (parts.length === 3) {
          publishDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        } else {
          publishDate = new Date(dateTitle);
        }
      }

      const lang = $(row).find("td").eq(1).text().trim();
      const langCode = lang ? lang.substring(0, 2).toLowerCase() : "en";

      let volume = 0;
      const volumeMatch = title.match(/Vol\.(\d+)/i);
      if (volumeMatch && volumeMatch[1]) {
        volume = parseInt(volumeMatch[1], 10);
      }

      chapters.push(App.createChapter({
        id: chapterId,
        chapNum,
        time: publishDate,
        volume,
        langCode,
        name: title,
      }));
    });

    return chapters.sort((a, b) => {
      if ((a.volume ?? 0) !== (b.volume ?? 0)) {
        return (a.volume ?? 0) - (b.volume ?? 0);
      }
      return a.chapNum - b.chapNum;
    });
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const apiUrl = `https://api.mangacloud.org/chapter/${chapterId}`;
    const request = App.createRequest({ url: apiUrl, method: "GET" });

    const response = await this.requestManager.schedule(request, 1);
    const jsonStr = response.data as string;
    const resp = JSON.parse(jsonStr);
    const info = resp.data;

    const pages: string[] = [];
    if (info.images && info.images.length > 0) {
      for (const img of info.images) {
        pages.push(`https://pika.mangacloud.org/${info.comic_id}/${info.id}/${img.id}.${img.f}`);
      }
    }

    return App.createChapterDetails({
      id: chapterId,
      mangaId: mangaId,
      pages,
    });
  }

  async getSearchResults(query: SearchRequest, metadata: ProjectsukiMetadata): Promise<PagedResults> {
    const page = metadata?.page ?? 1;
    const request = App.createRequest({
      url: `${DOMAIN}/search?q=${encodeURIComponent(query.title ?? "")}&page=${page}`,
      method: "GET",
    });

    const response = await this.requestManager.schedule(request, 1);
    const $ = cheerio.load(response.data as string);
    const items: PartialSourceManga[] = [];
    
    $(".browse").each((_, el) => {
      const titleAnchor = $(el).find(".details h4 a").first();
      const href = titleAnchor.attr("href") ?? "";
      const idMatch = href.match(/\/book\/(\d+)/);
      const mangaId = idMatch ? idMatch[1] : undefined;
      if (!mangaId) return;

      const title = titleAnchor.text().trim();
      let imageUrl = $(el).find(".mr-2 img").first().attr("src") ?? "";
      if (imageUrl && imageUrl.startsWith("/")) {
        imageUrl = DOMAIN + imageUrl;
      }

      items.push(App.createPartialSourceManga({
        mangaId,
        image: imageUrl,
        title: title,
      }));
    });

    return App.createPagedResults({
      results: items,
      metadata: { page: page + 1 },
    });
  }

  async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
    return App.createPagedResults({ results: [] });
  }

  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    const sections = [
      App.createHomeSection({ id: "popular", title: "Popular", type: "featured", containsMoreItems: false }),
      App.createHomeSection({ id: "updated", title: "Recently Updated", type: "chapter_updates", containsMoreItems: false }),
    ];

    for (const section of sections) {
      sectionCallback(section);
      const request = App.createRequest({
        url: DOMAIN,
        method: "GET",
      });
      const response = await this.requestManager.schedule(request, 1);
      const $ = cheerio.load(response.data as string);
      const items: PartialSourceManga[] = [];

      if (section.id === "popular") {
        $(".trending").each((_, el) => {
          const anchor = $(el).find("a").first();
          const href = anchor.attr("href") ?? "";
          const idMatch = href.match(/\/book\/(\d+)/);
          const mangaId = idMatch ? idMatch[1] : undefined;
          if (!mangaId) return;

          const img = $(el).find("img").first();
          items.push(App.createPartialSourceManga({
            mangaId,
            image: img.attr("src") ?? "",
            title: anchor.text().trim() || img.attr("alt")?.trim() || "",
          }));
        });
      } else {
        $(".item").each((_, el) => {
          const anchor = $(el).find(".mr-2 a").first();
          const href = anchor.attr("href") ?? "";
          const idMatch = href.match(/(\d+)/);
          const mangaId = idMatch ? idMatch[1] : undefined;
          if (!mangaId) return;

          const img = anchor.find("img").first();
          const titleAnchor = $(el).find(".title a").first();
          const chapterAnchor = $(el).find(".pages a").first();

          items.push(App.createPartialSourceManga({
            mangaId,
            image: img.attr("src") ?? "",
            title: titleAnchor.text().trim() || "",
            subtitle: chapterAnchor.text().trim(),
          }));
        });
      }
      section.items = items;
      sectionCallback(section);
    }
  }
}

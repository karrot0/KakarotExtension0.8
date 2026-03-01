import {
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    MangaProviding,
    PagedResults,
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
import { GodaComicMetadata } from "./model";

const BASE_URL = "https://manhuascans.org";

export const GodaComicInfo: SourceInfo = {
    version: "1.0.0",
    name: "GodaComic",
    description: `Extension that pulls content from ${BASE_URL}`,
    author: "Karrot",
    icon: "icon.png",
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: BASE_URL,
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
    sourceTags: [],
};

export class GodaComic
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
                        referer: `${BASE_URL}/`,
                        "user-agent": await this.requestManager.getDefaultUserAgent(),
                        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    },
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
        const sections = [
            App.createHomeSection({
                id: "trending_section",
                title: "Trending",
                view_more: true,
            }),
            App.createHomeSection({
                id: "updated_section",
                title: "Recently Updated",
                view_more: true,
            }),
            App.createHomeSection({
                id: "top_and_hot_section",
                title: "Top & Hot",
                view_more: true,
            }),
            App.createHomeSection({
                id: "new_section",
                title: "New",
                view_more: true,
            }),
        ];

        for (const section of sections) {
            sectionCallback(section);
            const path = this.getSectionPath(section.id);
            const request = App.createRequest({
                url: `${BASE_URL}${path}`,
                method: "GET",
            });
            const response = await this.requestManager.schedule(request, 1);
            const $ = cheerio.load(response.data as string);
            section.items = this.parseSectionItems($);
            sectionCallback(section);
        }
    }

    async getViewMoreItems(
        sectionId: string,
        metadata: GodaComicMetadata | undefined
    ): Promise<PagedResults> {
        const page = metadata?.page ?? 1;
        const path = this.getSectionPath(sectionId);
        const url =
            page > 1
                ? `${BASE_URL}${path}/page/${page}`
                : `${BASE_URL}${path}`;

        const request = App.createRequest({
            url: url,
            method: "GET",
        });

        const response = await this.requestManager.schedule(request, 1);
        const $ = cheerio.load(response.data as string);
        const items = this.parseSectionItems($);

        const hasNextPage =
            $("button:contains('NEXT'), a:contains('NEXT')").length > 0 ||
            $("span:contains('NEXT')").closest("button").length > 0;

        return App.createPagedResults({
            results: items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        });
    }

    private getSectionPath(sectionId: string): string {
        switch (sectionId) {
            case "trending_section":
                return "/dayup";
            case "updated_section":
                return "/";
            case "top_and_hot_section":
                return "/hots";
            case "new_section":
                return "/newss";
            default:
                return "/";
        }
    }

    private parseSectionItems($: cheerio.CheerioAPI): any[] {
        const items: any[] = [];
        $(".trending, a.slicarda, div.pb-2 a").each((_, el) => {
            const anchor = $(el).is("a") ? $(el) : $(el).find("a").first();
            const href = anchor.attr("href") ?? "";
            const mangaId = this.extractMangaId(href);
            if (!mangaId) return;

            const img = anchor.find("img").first();
            let imageUrl = img.attr("src") ?? "";
            if (imageUrl.startsWith("/")) {
                imageUrl = BASE_URL + imageUrl;
            }

            let title = anchor.find("h3.slicardtitle, h3.cardtitle").first().text().trim();
            if (!title) {
                title = anchor.text().trim() || img.attr("alt")?.trim() || "";
            }

            const subtitle = anchor.find("p.slicardtitlep").first().text().trim();

            items.push(
                App.createPartialSourceManga({
                    mangaId,
                    image: imageUrl,
                    title,
                    subtitle,
                })
            );
        });
        return items;
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${BASE_URL}/manga/${mangaId}`,
            method: "GET",
        });

        const response = await this.requestManager.schedule(request, 1);
        const $ = cheerio.load(response.data as string);

        let primaryTitle = "";
        const h1 = $("h1.mb-2").first();
        if (h1 && h1.length) {
            h1.find("span").remove();
            primaryTitle = h1.text().trim();
        }
        if (!primaryTitle) {
            primaryTitle = $("h2[itemprop=title]").first().text().trim() || "";
        }

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

        const ogImage = $("meta[property='og:image']").attr("content") || $("meta[name='og:image']").attr("content");

        let synopsis = $(".text-medium.line-clamp-4").first().text().trim();
        if (!synopsis) synopsis = $(".description").first().text().trim();

        let statusText = $("h1.mb-2 span").first().text().trim();
        if (!statusText) {
            $(".row.py-1").each((_, el) => {
                const label = $(el).find(".col-4").first().text().trim();
                if (label.startsWith("Status")) {
                    statusText = $(el).find(".col-8").text().trim();
                }
            });
        }
        let status = "UNKNOWN";
        if (/completed/i.test(statusText)) status = "COMPLETED";
        else if (/ongoing/i.test(statusText)) status = "ONGOING";

        const genres: string[] = [];
        $("div").each((_, el) => {
            const label = $(el).find("span.font-medium").first().text().trim();
            if (label.startsWith("Genres")) {
                $(el).find("a").each((_, g) => {
                    const text = $(g).text().trim();
                    if (text) genres.push(text);
                });
            }
        });

        const tagGroups: TagSection[] = [];
        if (genres.length) {
            tagGroups.push(
                App.createTagSection({
                    id: "genres",
                    label: "Genres",
                    tags: genres.map((g) => App.createTag({ id: g.toLowerCase().replace(/[^a-z0-9]/g, ""), label: g })),
                })
            );
        }

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [primaryTitle, ...altTitles],
                image: ogImage || "",
                status: status,
                author: "",
                artist: "",
                desc: synopsis,
                tags: tagGroups,
            }),
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: `${BASE_URL}/chapterlist/${mangaId}`,
            method: "GET",
        });

        const response = await this.requestManager.schedule(request, 1);
        let $ = cheerio.load(response.data as string);

        const allChaptersDiv = $("#allchapters");
        if (allChaptersDiv.length) {
            const mid = allChaptersDiv.attr("data-mid") || mangaId;
            const host = allChaptersDiv.attr("data-host") || BASE_URL;
            const apiUrl = `${host}/manga/get?mid=${mid}&mode=all`;
            const apiResp = await this.requestManager.schedule(App.createRequest({ url: apiUrl, method: "GET" }), 1);
            $ = cheerio.load(apiResp.data as string);
        }

        const chapters: Chapter[] = [];
        $("#allchapterlist .chapteritem a").each((_, el) => {
            const anchor = $(el);
            const href = anchor.attr("href") || "";
            const mData = anchor.attr("data-ms");
            const cData = anchor.attr("data-cs");
            let chapterId: string | undefined;
            if (mData && cData) {
                chapterId = `${mData}_${cData}`;
            } else {
                const parts = href.split("/").filter(Boolean);
                chapterId = parts.length ? parts[parts.length - 1] : undefined;
            }
            if (!chapterId) return;

            const title = anchor.find("span.chaptertitle").first().text().trim() || anchor.attr("data-ct") || "";
            let chapNum = 0;
            const numMatch = (anchor.attr("data-ct") || title).match(/(\d+(?:\.\d+)?)/);
            if (numMatch && numMatch[1]) chapNum = parseFloat(numMatch[1]);

            chapters.push(
                App.createChapter({
                    id: chapterId,
                    mangaId: mangaId,
                    name: title,
                    chapNum: chapNum,
                    langCode: "en",
                })
            );
        });

        return chapters.sort((a, b) => a.chapNum - b.chapNum);
    }

    async getChapterDetails(
        mangaId: string,
        chapterId: string
    ): Promise<ChapterDetails> {
        const [m, c] = chapterId.split("_");
        if (!m || !c) {
            throw new Error("Missing m/c identifiers");
        }
        const apiUrl = `${BASE_URL}/chapter/getcontent?m=${m}&c=${c}`;
        const request = App.createRequest({
            url: apiUrl,
            method: "GET",
        });

        const response = await this.requestManager.schedule(request, 1);
        const $ = cheerio.load(response.data as string);
        const pages: string[] = [];

        $("#chapcontent img").each((_, el) => {
            const img = $(el);
            let src = img.attr("data-src") || img.attr("src") || "";
            src = src.trim();
            if (!src) return;

            if (src.startsWith("//")) src = `https:${src}`;
            else if (src.startsWith("/")) src = BASE_URL + src;

            if (src && !pages.includes(src)) pages.push(src);
        });

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
            longStrip: true,
        });
    }

    async getSearchResults(
        query: SearchRequest,
        metadata: GodaComicMetadata | undefined
    ): Promise<PagedResults> {
        const page = metadata?.page ?? 1;
        const url = `${BASE_URL}/s/${encodeURIComponent(query.title ?? "")}?page=${page}`;

        const request = App.createRequest({
            url: url,
            method: "GET",
        });

        const response = await this.requestManager.schedule(request, 1);
        const $ = cheerio.load(response.data as string);
        const items = this.parseSectionItems($);

        return App.createPagedResults({
            results: items,
            metadata: { page: page + 1 },
        });
    }

    private extractMangaId(href: string): string | undefined {
        let match = href.match(/\/book\/(\d+)/);
        if (match) return match[1];
        match = href.match(/\/manga\/([^\/?#]+)/);
        if (match) return match[1];
        return undefined;
    }
}

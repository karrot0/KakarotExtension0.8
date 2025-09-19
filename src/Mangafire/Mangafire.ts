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
} from '@paperback/types'

import * as cheerio from 'cheerio'

const DOMAIN = "https://mangafire.to";

// Helper function to properly construct image URLs
function constructImageUrl(imagePath: string): string {
    if (imagePath.startsWith("http")) {
        return imagePath;
    }
    // Remove leading slash if present, then add domain
    const cleanPath = imagePath.startsWith("/") ? imagePath.slice(1) : imagePath;
    return `${DOMAIN}/${cleanPath}`;
}

export const MangafireInfo: SourceInfo = {
    version: '0.0.1',
    name: 'MangaFire',
    description: `Extension that pulls manga from ${DOMAIN}`,
    author: 'Karrot',
    icon: 'icon.png',
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: DOMAIN,
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS,
    sourceTags: []
}

export class Mangafire
    implements
        ChapterProviding,
        HomePageSectionsProviding,
        MangaProviding,
        SearchResultsProviding
{
    requestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 10000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}), ...{
                        "referer": DOMAIN,
                        "user-agent": await this.requestManager.getDefaultUserAgent(),
                        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        "accept-language": "en-US,en;q=0.5",
                        "accept-encoding": "gzip, deflate, br",
                    },
                };

                request.url = request.url.replace(/^http:/, 'https:')

                return request;
            },

            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    })

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${DOMAIN}/manga/${mangaId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const title = $(".manga-detail .info h1").text().trim();
        const altTitles = [$(".manga-detail .info h6").text().trim()];
        const image = $(".manga-detail .poster img").attr("src") || "";
        const imageUrl = constructImageUrl(image);
        const description =
            $("#synopsis .modal-content").text().trim() ||
            $(".manga-detail .info .description").text().trim();
        const authors: string[] = [];
        $("#info-rating .meta div").each((_: number, element: any) => {
            const label = $(element).find("span").first().text().trim();
            if (label === "Author:") {
                $(element)
                    .find("a")
                    .each((_: number, authorElement: any) => {
                        authors.push($(authorElement).text().trim());
                    });
            }
        });
        let status = "UNKNOWN";
        let statusText = "Unknown";
        $(".manga-detail .info p").each((_: number, element: any) => {
            statusText = $(element).text().trim();
        });

        if (statusText.includes("Releasing")) {
            status = "ONGOING";
        } else if (statusText.includes("Completed")) {
            status = "COMPLETED";
        } else if (
            statusText.includes("hiatus") ||
            statusText.includes("discontinued") ||
            statusText.includes("not yet published") ||
            statusText.includes("completed")
        ) {
            status = statusText.toLocaleUpperCase().replace(/\s+/g, "_");
        }

        const tags: TagSection[] = [];
        const genres: string[] = [];
        let rating = 1;

        $("#info-rating .meta div").each((_: number, element: any) => {
            const label = $(element).find("span").first().text().trim();
            if (label === "Genres:") {
                $(element)
                    .find("a")
                    .each((_: number, genreElement: any) => {
                        genres.push($(genreElement).text().trim());
                    });
            }
        });

        const ratingValue = $("#info-rating .score .live-score").text().trim();
        if (ratingValue) {
            rating = parseFloat(ratingValue);
        }

        if (genres.length > 0) {
            tags.push({
                id: "genres",
                label: "Genres",
                tags: genres.map((genre) => ({
                    id: genre
                        .toLowerCase()
                        .replace(/\s+/g, "-")
                        .replace(/[^a-z0-9-]/g, ""),
                    label: genre,
                })),
            });
        }

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [title, ...altTitles],
                image: imageUrl,
                desc: description,
                status: status,
                rating: rating,
                tags: tags,
                hentai: false
            })
        });
    }

    async getHomePageSections(
        sectionCallback: (section: HomeSection) => void
    ): Promise<void> {
        // Popular section - most viewed
        const popularRequest = App.createRequest({
            url: `${DOMAIN}/filter?keyword=&language[]=en&sort=most_viewed&page=1`,
            method: 'GET',
        });
        const popularResponse = await this.requestManager.schedule(popularRequest, 1);
        const $popular = cheerio.load(popularResponse.data as string);
        const popularItems: PartialSourceManga[] = [];

        $popular(".unit .inner").each((_: number, element: any) => {
            const unit = $popular(element);
            const infoLink = unit.find(".info > a").last();
            const title = infoLink.text().trim();
            const image = unit.find(".poster img").attr("src") || "";
            const imageUrl = constructImageUrl(image);
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";

            if (title && mangaId && popularItems.length < 10) {
                popularItems.push(App.createPartialSourceManga({
                    mangaId,
                    image: imageUrl,
                    title: title,
                    subtitle: undefined
                }));
            }
        });

        sectionCallback(App.createHomeSection({
            id: 'popular',
            title: 'Popular',
            type: 'singleRowNormal',
            items: popularItems,
            containsMoreItems: true
        }));

        // Recently Updated section
        const updatedRequest = App.createRequest({
            url: `${DOMAIN}/filter?keyword=&language[]=en&sort=recently_updated&page=1`,
            method: 'GET',
        });
        const updatedResponse = await this.requestManager.schedule(updatedRequest, 1);
        const $updated = cheerio.load(updatedResponse.data as string);
        const updatedItems: PartialSourceManga[] = [];

        $updated(".unit .inner").each((_: number, element: any) => {
            const unit = $updated(element);
            const infoLink = unit.find(".info > a").last();
            const title = infoLink.text().trim();
            const image = unit.find(".poster img").attr("src") || "";
            const imageUrl = constructImageUrl(image);
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";

            const latestChapter = unit
                .find(".content[data-name='chap']")
                .find("a")
                .eq(0)
                .text()
                .trim();
            const latestChapterMatch = latestChapter.match(/Chap (\d+)/);
            const subtitle = latestChapterMatch
                ? `Ch. ${latestChapterMatch[1]}`
                : undefined;

            if (title && mangaId && updatedItems.length < 10) {
                updatedItems.push(App.createPartialSourceManga({
                    mangaId,
                    image: imageUrl,
                    title: title,
                    subtitle: subtitle
                }));
            }
        });

        sectionCallback(App.createHomeSection({
            id: 'recently_updated',
            title: 'Recently Updated',
            type: 'singleRowNormal',
            items: updatedItems,
            containsMoreItems: true
        }));

        // New Manga section
        const newRequest = App.createRequest({
            url: `${DOMAIN}/added`,
            method: 'GET',
        });
        const newResponse = await this.requestManager.schedule(newRequest, 1);
        const $new = cheerio.load(newResponse.data as string);
        const newItems: PartialSourceManga[] = [];

        $new(".unit .inner").each((_: number, element: any) => {
            const unit = $new(element);
            const infoLink = unit.find(".info > a").last();
            const title = infoLink.text().trim();
            const image = unit.find(".poster img").attr("src") || "";
            const imageUrl = constructImageUrl(image);
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";

            const latestChapter = unit
                .find(".content[data-name='chap'] a")
                .first()
                .find("span")
                .first()
                .text()
                .trim();
            const latestChapterMatch = latestChapter.match(/Chap (\d+)/);
            const subtitle = latestChapterMatch
                ? `Ch. ${latestChapterMatch[1]}`
                : undefined;

            if (title && mangaId && newItems.length < 10) {
                newItems.push(App.createPartialSourceManga({
                    mangaId,
                    image: imageUrl,
                    title: title,
                    subtitle: subtitle
                }));
            }
        });

        sectionCallback(App.createHomeSection({
            id: 'new_manga',
            title: 'New Manga',
            type: 'singleRowNormal',
            items: newItems,
            containsMoreItems: true
        }));
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        const collectedIds: string[] = metadata?.collectedIds ?? []

        // Build search URL with filters
        let searchUrl = `${DOMAIN}/filter?keyword=${encodeURIComponent(query.title || "")}&page=${page}&genre_mode=and`;

        // Add language filter (default to English if no title)
        if (!query.title) {
            searchUrl += `&language[]=en&sort=recently_updated`;
        } else {
            searchUrl += `&language[]=en&sort=most_relevance`;
        }

        const request = App.createRequest({
            url: searchUrl,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const items: PartialSourceManga[] = [];
        $(".unit .inner").each((_: number, element: any) => {
            const unit = $(element);
            const infoLink = unit.find(".info > a").last();
            const title = infoLink.text().trim();
            const image = unit.find(".poster img").attr("src") || "";
            const imageUrl = constructImageUrl(image);
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";

            let subtitle: string | undefined;
            if (!query.title) {
                // For recently updated, show latest chapter
                const latestChapter = unit
                    .find(".content[data-name='chap'] a")
                    .first()
                    .find("span")
                    .first()
                    .text()
                    .trim();
                const latestChapterMatch = latestChapter.match(/Chap (\d+)/);
                subtitle = latestChapterMatch
                    ? `Ch. ${latestChapterMatch[1]}`
                    : undefined;
            } else {
                // For search results, show latest chapter
                const latestChapter = unit
                    .find(".content[data-name='chap'] a")
                    .first()
                    .find("span")
                    .first()
                    .text()
                    .trim();
                const latestChapterMatch = latestChapter.match(/Chap (\d+)/);
                subtitle = latestChapterMatch
                    ? `Ch. ${latestChapterMatch[1]}`
                    : undefined;
            }

            if (!title || !mangaId || collectedIds.includes(mangaId)) {
                return;
            }

            collectedIds.push(mangaId);

            items.push(App.createPartialSourceManga({
                mangaId,
                image: imageUrl,
                title: title,
                subtitle: subtitle
            }));
        });

        const hasNextPage = !!$(".page-item.active + .page-item .page-link").length;

        return App.createPagedResults({
            results: items,
            metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined
        });
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1;
        const collectedIds: string[] = metadata?.collectedIds ?? [];

        let url: string;
        if (homepageSectionId === 'popular') {
            url = `${DOMAIN}/filter?keyword=&language[]=en&sort=most_viewed&page=${page}`;
        } else if (homepageSectionId === 'recently_updated') {
            url = `${DOMAIN}/filter?keyword=&language[]=en&sort=recently_updated&page=${page}`;
        } else if (homepageSectionId === 'new_manga') {
            url = `${DOMAIN}/added?page=${page}`;
        } else {
            // Default to recently updated
            url = `${DOMAIN}/filter?keyword=&language[]=en&sort=recently_updated&page=${page}`;
        }

        const request = App.createRequest({
            url: url,
            method: 'GET',
        });

        const response = await this.requestManager.schedule(request, 1);
        const $ = cheerio.load(response.data as string);

        const items: PartialSourceManga[] = [];
        $(".unit .inner").each((_: number, element: any) => {
            const unit = $(element);
            const infoLink = unit.find(".info > a").last();
            const title = infoLink.text().trim();
            const image = unit.find(".poster img").attr("src") || "";
            const imageUrl = constructImageUrl(image);
            const mangaId = infoLink.attr("href")?.replace("/manga/", "") || "";

            let subtitle: string | undefined;
            if (homepageSectionId === 'recently_updated') {
                const latestChapter = unit
                    .find(".content[data-name='chap']")
                    .find("a")
                    .eq(0)
                    .text()
                    .trim();
                const latestChapterMatch = latestChapter.match(/Chap (\d+)/);
                subtitle = latestChapterMatch
                    ? `Ch. ${latestChapterMatch[1]}`
                    : undefined;
            } else if (homepageSectionId === 'new_manga') {
                const latestChapter = unit
                    .find(".content[data-name='chap'] a")
                    .first()
                    .find("span")
                    .first()
                    .text()
                    .trim();
                const latestChapterMatch = latestChapter.match(/Chap (\d+)/);
                subtitle = latestChapterMatch
                    ? `Ch. ${latestChapterMatch[1]}`
                    : undefined;
            }

            if (title && mangaId && !collectedIds.includes(mangaId)) {
                collectedIds.push(mangaId);
                items.push(App.createPartialSourceManga({
                    mangaId,
                    image: imageUrl,
                    title: title,
                    subtitle: subtitle
                }));
            }
        });

        const hasNextPage = !!$(".page-item.active + .page-item .page-link").length;

        return App.createPagedResults({
            results: items,
            metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const extractedId = mangaId.split(".")[1];
        const languages = this.getLanguages();
        const allRequests = [];

        for (const lang of languages) {
            for (const type of ["read", "manga"]) {
                allRequests.push({
                    url: `${DOMAIN}/ajax/${type}/${extractedId}/chapter/${lang}`,
                    method: "GET" as const,
                    language: lang,
                    type: type,
                });
            }
        }

        const responses = await Promise.allSettled(
            allRequests.map((req) =>
                this.requestManager.schedule(App.createRequest(req), 1).then((response) => ({
                    data: response.data,
                    language: req.language,
                    type: req.type,
                }))
            )
        );

        const chapters: Chapter[] = [];
        const timestampMaps = new Map<string, Map<string, string>>();

        for (const response of responses) {
            if (response.status === "fulfilled" && response.value.type === "manga") {
                try {
                    const data = JSON.parse(response.value.data as string);
                    const language = response.value.language;

                    const html = typeof data?.result === "string" ? data.result : data?.result?.html || "";

                    if (html) {
                        const $ = cheerio.load(html);
                        const timestampMap = new Map<string, string>();

                        $("li").each((_: number, el: any) => {
                            const li = $(el);
                            const chapterNumber = li.attr("data-number") || "0";
                            const dateText = li.find("span").last().text().trim();
                            timestampMap.set(chapterNumber, dateText);
                        });

                        if (timestampMap.size > 0) {
                            timestampMaps.set(language, timestampMap);
                        }
                    }
                } catch (error) {
                    console.error(
                        `Failed to parse buffer for language ${response.value.language}:`,
                        error,
                    );
                }
            }
        }

        for (const response of responses) {
            if (response.status === "fulfilled" && response.value.type === "read") {
                try {
                    const data = JSON.parse(response.value.data as string);
                    const language = response.value.language;

                    if (data?.result && typeof data.result !== "string" && data.result.html) {
                        const $ = cheerio.load(data.result.html);
                        const timestampMap = timestampMaps.get(language);

                        $("li").each((_: number, el: any) => {
                            const li = $(el);
                            const link = li.find("a");
                            const chapterNumber = link.attr("data-number") || "0";
                            const timestamp = timestampMap?.get(chapterNumber);

                            chapters.push(App.createChapter({
                                id: link.attr("data-id") || "0",
                                chapNum: parseFloat(String(chapterNumber)),
                                volume: 0,
                                name: link.find("span").first().text().trim(),
                                time: timestamp ? this.convertToDate(timestamp) : new Date(),
                                langCode: this.getLanguageFlag(language),
                                group: this.getLanguageVersion(language),
                            }));
                        });
                    }
                } catch (error) {
                    console.error(
                        `Failed to parse buffer for language ${response.value.language}:`,
                        error,
                    );
                }
            }
        }

        // Sort chapters by chapter number descending (latest first)
        chapters.sort((a, b) => (b.chapNum ?? 0) - (a.chapNum ?? 0));
        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${DOMAIN}/ajax/read/chapter/${chapterId}`,
            method: 'GET',
        });

        const response = await this.requestManager.schedule(request, 1);
        const data = JSON.parse(response.data as string);

        const pages: string[] = [];
        if (data?.result?.images) {
            data.result.images.forEach((imageData: any) => {
                if (Array.isArray(imageData) && imageData.length > 0) {
                    pages.push(constructImageUrl(imageData[0]));
                }
            });
        }

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        });
    }

    getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/manga/${mangaId}`;
    }

    // Helper methods for language handling
    private getLanguages(): string[] {
        // Return all supported languages
        return ["en", "fr", "es", "es-la", "pt", "pt-br", "ja"];
    }

    private getLanguageFlag(language: string): string {
        switch (language) {
            case "en":
                return "🇬🇧";
            case "fr":
                return "🇫🇷";
            case "es":
                return "🇪🇸";
            case "es-la":
                return "🇲🇽";
            case "pt":
                return "🇵🇹";
            case "pt-br":
                return "🇧🇷";
            case "ja":
                return "🇯🇵";
            default:
                return "🇬🇧";
        }
    }

    private getLanguageVersion(language: string): string {
        switch (language) {
            case "en":
                return "EN";
            case "fr":
                return "FR";
            case "es":
                return "ES";
            case "es-la":
                return "ESLA";
            case "pt":
                return "PT";
            case "pt-br":
                return "PTBR";
            case "ja":
                return "JP";
            default:
                return "EN";
        }
    }

    // Helper function to convert date strings to Date objects
    private convertToDate(dateText: string): Date {
        const now = new Date();

        if (!dateText?.trim()) return now;

        if (/^yesterday$/i.test(dateText)) {
            now.setDate(now.getDate() - 1);
            return now;
        }

        const relativeMatch = dateText.match(
            /(\d+)\s+(second|minute|hour|day)s?\s+ago/i,
        );
        if (relativeMatch) {
            const [_, value, unit] = relativeMatch;
            if (value && unit) {
                switch (unit.toLowerCase()) {
                    case "second":
                        now.setSeconds(now.getSeconds() - +value);
                        break;
                    case "minute":
                        now.setMinutes(now.getMinutes() - +value);
                        break;
                    case "hour":
                        now.setHours(now.getHours() - +value);
                        break;
                    case "day":
                        now.setDate(now.getDate() - +value);
                        break;
                }
            }
            return now;
        }

        const parsedDate = new Date(dateText);
        return isNaN(parsedDate.getTime()) ? now : parsedDate;
    }
}
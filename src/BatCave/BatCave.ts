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

import {
    parseHomeSections,
} from './BatCaveParser'

const DOMAIN = "https://batcave.biz";

export const BatCaveInfo: SourceInfo = {
    version: '0.0.5',
    name: 'BatCave',
    description: `Extension that pulls manga from ${DOMAIN}`,
    author: 'Karrot',
    icon: 'icon.png',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: DOMAIN,
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS,
    sourceTags: []
}

export class BatCave
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
                        origin: `https://batcave.biz`,
                        referer: `https://batcave.biz`,
                        "user-agent": await this.requestManager.getDefaultUserAgent(),
                        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        "accept-language": "en-US,en;q=0.5",
                        "accept-encoding": "gzip, deflate, br",
                        "x-requested-with": "com.batcave.android",
                    },
                };

                request.url = request.url.replace(/^http:/, 'https:')

                return request;
            },

            interceptResponse: async (response: Response): Promise<Response> => {
                if (response.headers.location) {
                    response.headers.location = response.headers.location.replace(/^http:/, 'https:')
                }
                return response
            }
        }
    })

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${DOMAIN}/${mangaId}.html`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const title = $("h1").first().text().trim();
            const rawImage = $(".page__poster img").attr("src") || "";
            const image = rawImage.startsWith("/")
                ? `https://batcave.biz${rawImage}`
                : rawImage;
            const description = $(".page__text").text().trim();

            const ratingMatch = $(".page__rating-votes")
                .text()
                .match(/(\d+(\.\d+)?)/);
            const rating = ratingMatch?.[1] ? parseFloat(ratingMatch[1]) : 0;

            const statusText = $(".page__list li")
                .filter((_, el) => $(el).text().includes("Release type"))
                .first()
                .text()
                .toLowerCase();

            const status = statusText.includes("completed")
                ? "COMPLETED"
                : statusText.includes("ongoing")
                  ? "ONGOING"
                  : "UNKNOWN";

            const tags: TagSection[] = [];
            const genres: string[] = [];

            $(".page__tags a").each((_, element) => {
                genres.push($(element).text().trim());
            });

            if (genres.length > 0) {
                tags.push({
                id: "genres",
                label: "Genres",
                tags: genres.map((genre) => ({
                    id: genre.toLowerCase().replace(/[^a-z0-9]/g, ""),
                    label: genre,
                })),
                });
            }

            return App.createSourceManga({
                id: mangaId,
                mangaInfo: App.createMangaInfo({
                    titles: [title],
                    image: image,
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
        await parseHomeSections(this, sectionCallback)
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1;
        const collectedIds: string[] = metadata?.collectedIds ?? [];

        const searchTerm = query.title ?? "";
        
        let url: string;
        if (searchTerm.trim() === "") {
            url = page > 1 ? `${DOMAIN}/comix/page/${page}/` : `${DOMAIN}/comix/`;
        } else {
            const encodedSearchTerm = encodeURIComponent(searchTerm);
            url = `${DOMAIN}/search/${encodedSearchTerm}/page/${page}/`;
        }
        
        const request = App.createRequest({
            url: url,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const results: PartialSourceManga[] = []
        const newCollectedIds = [...collectedIds];
        
        if (searchTerm.trim() === "") {
            $("#dle-content .readed").each((_, element) => {
                const unit = $(element);
                const infoLink = unit.find(".readed__title a");
                const title = infoLink.text().trim();
                const rawImage = unit.find("img").attr("data-src") || "";
                const image = rawImage.startsWith("/")
                    ? `https://batcave.biz${rawImage}`
                    : rawImage;
                const rawMangaId = infoLink.attr("href");
                const mangaId = rawMangaId
                    ?.replace(/^https?:\/\/batcave\.biz\//, "") // Remove domain prefix if present
                    .replace(/\.html$/, "") // Remove the ".html" extension
                    .trim();

                const latestChapterText = unit
                    .find(".readed__info li:last-child span")
                    .parent()
                    .text()
                    .trim();
                const latestChapter = latestChapterText
                    .replace(/Last issue:/, "")
                    .trim();
                
                if (!mangaId || newCollectedIds.includes(mangaId)) return;
                newCollectedIds.push(mangaId);

                results.push(App.createPartialSourceManga({
                    mangaId: mangaId,
                    image: image,
                    title: title,
                    subtitle: latestChapter
                }));
            });
        } else {
            $(".readed").each((_, element) => {
                const unit = $(element);
                const infoLink = unit.find(".readed__title a");
                const title = infoLink.text().trim();
                const rawImage = unit.find("img").attr("data-src") || "";
                const image = rawImage.startsWith("/")
                ? `https://batcave.biz${rawImage}`
                : rawImage;
                const rawMangaId = infoLink.attr("href");
                const mangaId = rawMangaId
                    ?.replace(/^https?:\/\/batcave\.biz\//, "")
                    .replace(/\.html$/, "")
                    .trim();
                
                const latestChapterText = unit
                    .find(".readed__info li:last-child")
                    .text()
                    .trim();
                const latestChapter = latestChapterText
                    .replace("Last issue:", "")
                    .trim();

                if (!mangaId || newCollectedIds.includes(mangaId)) return;
                newCollectedIds.push(mangaId);

                results.push(App.createPartialSourceManga({
                    mangaId: mangaId,
                    image: image,
                    title: title,
                    subtitle: latestChapter
                }));
            });
        }

        const currentPage =
            parseInt($(".pagination__pages > span").first().text()) || page;
        const hasNextPage = $(".pagination__pages > a")
            .filter((_, el) => {
            const pageNum = parseInt($(el).text());
            return !isNaN(pageNum) && pageNum > currentPage;
            }).length > 0 || $(".pagination__pages > a:last-child").text().includes("»");

        return App.createPagedResults({
            results: results,
            metadata: hasNextPage ? {
                page: page + 1,
                collectedIds: newCollectedIds
            } : undefined
        });
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1;
        const collectedIds: string[] = metadata?.collectedIds ?? [];

        let url: string;
        
        switch (homepageSectionId) {
            case 'catalogue':
                url = page > 1 ? `${DOMAIN}/comix/page/${page}/` : `${DOMAIN}/comix/`;
                break;
            case 'newComics':
                url = page > 1 ? `${DOMAIN}/page/${page}/` : `${DOMAIN}`;
                break;
            default:
                throw new Error(`Unsupported section ID: ${homepageSectionId}`);
        }
        
        const request = App.createRequest({
            url: url,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const results: PartialSourceManga[] = []
        const newCollectedIds = [...collectedIds]

        if (homepageSectionId === 'catalogue') {
            $("#dle-content .readed").each((_, element) => {
                const unit = $(element)
                const infoLink = unit.find(".readed__title a")
                const title = infoLink.text().trim()
                const rawImage = unit.find("img").attr("data-src") || ""
                const image = rawImage.startsWith("/")
                    ? `https://batcave.biz${rawImage}`
                    : rawImage
                const rawMangaId = infoLink.attr("href")
                const mangaId = rawMangaId
                    ?.replace(/^.*?\/([^/]+)$/, "$1")
                    .replace(/\.html$/, "")
                    .trim()
                const latestChapterText = unit
                    .find(".readed__info li:last-child")
                    .text()
                    .trim()
                const latestChapter = latestChapterText
                    .replace("Last issue:", "")
                    .trim()

                if (title && mangaId && !newCollectedIds.includes(mangaId)) {
                    newCollectedIds.push(mangaId)
                    results.push(App.createPartialSourceManga({
                        mangaId: mangaId,
                        image: image,
                        title: title,
                        subtitle: latestChapter
                    }))
                }
            })
        } else if (homepageSectionId === 'newComics') {
            $(".sect--latest .latest.grid-item, .latest-chapter").each((_, element) => {
                const unit = $(element);
                const title = unit
                    .find(".latest__title, .latest-chapter__title")
                    .clone()
                    .children()
                    .remove()
                    .end()
                    .text()
                    .trim();
                const rawImage = unit.find(".latest__img img, .latest-chapter__img img").attr("src") || "";
                const image = rawImage.startsWith("/")
                    ? `https://batcave.biz${rawImage}`
                    : rawImage;
                const rawMangaId = unit
                    .find(".latest__title, .latest-chapter__title")
                    .closest("a")
                    .attr("href");
                const mangaId = rawMangaId
                    ?.replace(/^.*?\/([^/]+)$/, "$1")
                    .replace(/\.html$/, "")
                    .trim();
                const latestChapter = unit.find(".latest__chapter a, .latest-chapter__chapter a").text().trim();

                if (title && mangaId && !newCollectedIds.includes(mangaId)) {
                    newCollectedIds.push(mangaId);
                    results.push(App.createPartialSourceManga({
                        mangaId: mangaId,
                        image: image,
                        title: title,
                        subtitle: latestChapter
                    }));
                }
            });
        }

        let hasNextPage = false;
        
        if (homepageSectionId === 'newComics') {
            hasNextPage = $(".sect--latest .more-comics, .pagination a:contains('»'), .pagination__btn-loader a").length > 0;
        } else {
            const currentPage = parseInt($(".pagination__pages > span").first().text()) || page;
            hasNextPage = $(".pagination__pages > a")
                .filter((_, el) => {
                    const pageNum = parseInt($(el).text());
                    return !isNaN(pageNum) && pageNum > currentPage;
                }).length > 0 || $(".pagination__pages > a:last-child").text().includes("»");
        }

        metadata = hasNextPage ? {
            page: page + 1,
            collectedIds: newCollectedIds
        } : undefined

        return App.createPagedResults({
            results: results,
            metadata: metadata
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: `${DOMAIN}/${mangaId}.html`,
            method: 'GET',
        });

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const chapters: Chapter[] = [];
        const chapterScript = $(".page__chapters-list script")
            .filter((_, el) => {
            const content = $(el).html();
            return content ? content.includes("__DATA__") : false;
            })
            .first()
            .html() || "";

        const jsonMatch = chapterScript.match(/window\.__DATA__\s*=\s*({[\s\S]*?});/);
        const jsonData = jsonMatch ? jsonMatch[1] : null;

        try {
            if (!jsonData) throw new Error("No JSON data found");

            const parsedData = JSON.parse(jsonData);

            if (parsedData.chapters) {
            parsedData.chapters.forEach((chapter: any) => {
                if (chapter.id && typeof chapter.id === "number") {
                const [day, month, year] = chapter.date
                    .split(".")
                    .map(Number);
                const isoDate = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
                chapters.push(App.createChapter({
                    id: chapter.id.toString(),
                    chapNum: chapter.posi,
                    name: chapter.title || `Chapter ${chapter.posi}`,
                    time: new Date(isoDate),
                    langCode: "🇬🇧"
                }));
                } else {
                console.error("Invalid Chapter");
                }
            });
            }
        } catch (err) {
            console.error("Error parsing JSON data:", err);
        }

        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${DOMAIN}/reader/${mangaId.split("-")[0]}/${chapterId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const pages: string[] = [];

        const scriptData = $("script")
            .filter((_, el) => $(el).html()?.includes("__DATA__") ?? false)
            .first()
            .html();

        if (scriptData) {
            const jsonMatch = scriptData.match(/window\.__DATA__\s*=\s*({[\s\S]*?})\s*;/);
            if (jsonMatch?.[1]) {
                try {
                    const data = JSON.parse(jsonMatch[1]);
                    if (data.images && Array.isArray(data.images)) {
                        pages.push(...data.images.map((img: string) => img.replace(/\\\//g, "/")));
                    }
                } catch (error) {
                    console.error("Failed to parse JSON:", error);
                }
            }
        }

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        })
    }

    getMangaShareUrl(mangaId: string): string { return `${DOMAIN}/${mangaId}.html` }
}
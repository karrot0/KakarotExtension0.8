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
} from '@paperback/types'

import * as cheerio from 'cheerio'

import {
    parseHomeSections,
} from './BatCaveParser'

const DOMAIN = "https://batcave.biz";

export const BatCaveInfo: SourceInfo = {
    version: '0.0.1',
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
        requestTimeout: 10000, // 10 seconds
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

                return request;
            },

            interceptResponse: async (response: Response): Promise<Response> => {
                if (response.status === 403) {
                    throw new Error("403 Forbidden: Access Denied");
                }
                return response;
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

        const results: SourceManga[] = []
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
                    ?.replace(/^.*?\/([^/]+)$/, "$1")
                    .replace(/\.html$/, "")
                    .trim();

                if (!mangaId || newCollectedIds.includes(mangaId)) return;
                newCollectedIds.push(mangaId);

                results.push(App.createSourceManga({
                    id: mangaId,
                    mangaInfo: App.createMangaInfo({
                        titles: [title],
                        image: image,
                        desc: "",
                        status: "UNKNOWN",
                        rating: 0,
                        tags: [],
                        hentai: false,
                    })
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
                ?.replace(/^.*?\/([^/]+)$/, "$1")
                .replace(/\.html$/, "")
                .trim();
                
                if (!mangaId || newCollectedIds.includes(mangaId)) return;
                newCollectedIds.push(mangaId);

                results.push(App.createSourceManga({
                    id: mangaId,
                    mangaInfo: App.createMangaInfo({
                        titles: [title],
                        image: image,
                        desc: "",
                        status: "UNKNOWN",
                        rating: 0,
                        tags: [],
                        hentai: false
                    })
                }));
            });
        }

        const partialResults = results.map(manga => ({
            mangaId: manga.id,
            title: manga.mangaInfo.titles[0] ?? 'Unknown Title',
            image: manga.mangaInfo.image
        }));

        const currentPage =
            parseInt($(".pagination__pages > span").first().text()) || 1;
        const hasNextPage =
            $(".pagination__pages > a").filter((_, el) => {
                const pageNum = parseInt($(el).text());
                return !isNaN(pageNum) && pageNum > currentPage;
            }).length > 0;

        console.log("hasNextPage", hasNextPage);

        return App.createPagedResults({
            results: partialResults,
            metadata: {
                page: hasNextPage ? page + 1 : undefined,
                collectedIds: newCollectedIds,
                ...(metadata as object || {})
            }
        });
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        return App.createPagedResults({
            results: [],
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
}
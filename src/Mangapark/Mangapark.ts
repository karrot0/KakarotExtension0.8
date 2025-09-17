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
} from './MangaparkParser'

const DOMAIN = "https://mangapark.io";

export const MangaparkInfo: SourceInfo = {
    version: '0.0.1',
    name: 'Mangapark',
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

export class Mangapark
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
            url: `${DOMAIN}/title/${mangaId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const title = $("h3 a").first().text().trim();
        const altTitles = [$("div[q\\:key='tz_2'] span").first().text().trim()];
        const imageElem = $("img[alt]").first();
        let image = imageElem.attr("src") || imageElem.attr("data-src") || "";
        if (image && !image.startsWith("http")) {
            image = image.startsWith("/") ? `${DOMAIN}${image.slice(1)}` : `${DOMAIN}${image}`;
        }
        const description = $(".limit-html").first().text().trim() || $(".manga-detail .info .description").text().trim();

        const authors: string[] = [];
        $("div[q\\:key='tz_4'] a").each((_, authorElement) => {
            authors.push($(authorElement).text().trim());
        });

        let status = "UNKNOWN";
        let statusText = "";
        $("div[q\\:key='Yn_8'] span").last().each((_, element) => {
            statusText = $(element).text().trim();
        });

        if (statusText.includes("Ongoing")) {
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

        // Parse genres from the flex items-center flex-wrap div
        $("div[q\\:key='30_2'] span").each((_, element) => {
            const genreText = $(element).find("span").text().trim();
            if (genreText && !genreText.includes(",") && genreText !== "Manga") {
                genres.push(genreText);
            }
        });

        // Try to get rating from the star rating section
        const ratingText = $(".text-sm.opacity-80.whitespace-nowrap").first().text().trim();
        const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
        if (ratingMatch && ratingMatch[1]) {
            rating = parseFloat(ratingMatch[1]);
        }

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
                titles: [title, ...altTitles],
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
            url = `${DOMAIN}/search?page=${page}`;
        } else {
            url = `${DOMAIN}/search?word=${encodeURIComponent(searchTerm)}&page=${page}`;
        }

        const request = App.createRequest({
            url: url,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const results: PartialSourceManga[] = []
        const newCollectedIds = [...collectedIds];

        $(".flex.border-b.border-b-base-200.pb-5").each((_, element) => {
            const unit = $(element);
            const titleLink = unit.find("h3 a");
            const title = titleLink.find("span").text().trim();
            const imageSrc = unit.find("img").attr("src") || "";
            const image = imageSrc.startsWith("http") ? imageSrc : `${DOMAIN}${imageSrc}`;
            const mangaId = titleLink.attr("href")?.replace("/title/", "") || "";
            const chapterLink = unit.find(".flex.flex-nowrap.justify-between a");
            const latestChapter = chapterLink.find("span").text().trim();
            const latestChapterMatch = latestChapter.match(/Chapter (\d+)/);
            const subtitle = latestChapterMatch ? `Ch. ${latestChapterMatch[1]}` : undefined;

            if (!title || !mangaId || newCollectedIds.includes(mangaId)) return;
            newCollectedIds.push(mangaId);

            results.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: subtitle
            }));
        });

        const hasNextPage = !!$(".btn-accent").next("a").length;

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
        if (homepageSectionId === 'latest') {
            url = `${DOMAIN}/search?page=${page}`;
        } else if (homepageSectionId === 'newReleases') {
            url = `${DOMAIN}/search?sortby=field_create&page=${page}`;
        } else {
            url = `${DOMAIN}/search?page=${page}`;
        }

        const request = App.createRequest({
            url: url,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const results: PartialSourceManga[] = []
        const newCollectedIds = [...collectedIds];

        $(".flex.border-b.border-b-base-200.pb-5").each((_, element) => {
            const unit = $(element);
            const titleLink = unit.find("h3 a");
            const title = titleLink.find("span").text().trim();
            const imageSrc = unit.find("img").attr("src") || "";
            const image = imageSrc.startsWith("http") ? imageSrc : `${DOMAIN}${imageSrc}`;
            const mangaId = titleLink.attr("href")?.replace("/title/", "") || "";
            const chapterLink = unit.find(".flex.flex-nowrap.justify-between a");
            const latestChapter = chapterLink.find("span").text().trim();
            const latestChapterMatch = latestChapter.match(/Chapter (\d+)/);
            const subtitle = latestChapterMatch ? `Ch. ${latestChapterMatch[1]}` : undefined;

            if (!title || !mangaId || newCollectedIds.includes(mangaId)) return;
            newCollectedIds.push(mangaId);

            results.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: subtitle
            }));
        });

        const hasNextPage = !!$(".btn-accent").next("a").length;

        return App.createPagedResults({
            results: results,
            metadata: hasNextPage ? {
                page: page + 1,
                collectedIds: newCollectedIds
            } : undefined
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: `${DOMAIN}/title/${mangaId}`,
            method: 'GET',
        });

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const chapters: Chapter[] = [];

        $(".px-2.py-2.flex.flex-wrap.justify-between").each((_, element) => {
            const row = $(element);
            const chapterElement = row.find("a").first();
            const href = chapterElement.attr("href") || "";
            const lastSegment = href.split("/").filter(Boolean).pop() || "";
            const chapterId = lastSegment.split(/[?#]/)[0];

            if (!chapterId) return;
            const title = chapterElement.text().trim();
            // Remove any Volume prefix like "Vol.02" before extracting chapter
            const cleanedTitle = title.replace(/Vol\.?\s*\d+(?:\.\d+)?/gi, "").trim();
            let chapNum = 0;
            const match = cleanedTitle.match(/(?:Ch(?:apter)?\.?\s*)(\d+(?:\.\d+)?)/i);
            if (match && match[1]) {
                chapNum = parseFloat(match[1]);
            } else {
                // Fallback: try extracting from href like /.../ch-020 or /.../chapter-020
                const hrefLower = href.toLowerCase();
                const hrefMatch = hrefLower.match(/\/(?:ch|chapter)[-_]?(\d+(?:\.\d+)?)(?:\b|\/|$)/i);
                if (hrefMatch && hrefMatch[1]) {
                    chapNum = parseFloat(hrefMatch[1]);
                }
            }

            const timeElement = row.find("time").first();
            const timestamp = timeElement.attr("data-time");
            const publishDate = timestamp ? new Date(parseInt(timestamp)) : new Date();

            chapters.push(App.createChapter({
                id: chapterId,
                chapNum: chapNum,
                name: title,
                time: publishDate,
                langCode: "🇬🇧"
            }));
        });

        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${DOMAIN}/title/${mangaId}/${chapterId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const pages: string[] = [];

        $('script[type="qwik/json"]').each((_, script) => {
            const scriptContent = $(script).text();
            if (scriptContent) {
                const urlRegex = /https?:\/\/[^"'()\s]*\.org\/media\/[^\s"'()]+/g;
                const matches = scriptContent.match(urlRegex);
                if (matches) {
                    pages.push(...matches);
                }
            }
        });

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        })
    }

    getMangaShareUrl(mangaId: string): string { return `${DOMAIN}/title/${mangaId}` }
}
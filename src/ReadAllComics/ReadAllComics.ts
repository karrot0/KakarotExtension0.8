import {
    ChapterProviding,
    ContentRating,
    CloudflareBypassRequestProviding,
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
} from './ReadAllComicsParser'

const DOMAIN = "https://readallcomics.com";

export const ReadAllComicsInfo: SourceInfo = {
    version: '1.0',
    name: 'ReadAllComics',
    description: `Extension that pulls manga from ${DOMAIN}`,
    author: 'Karrot',
    icon: 'icon.png',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: DOMAIN,
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS |
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
    sourceTags: []
}

export class ReadAllComics
    implements
        ChapterProviding,
        HomePageSectionsProviding,
        MangaProviding,
        SearchResultsProviding,
        CloudflareBypassRequestProviding
{
    requestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 10000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}), ...{
                        origin: `https://readallcomics.com`,
                        referer: `https://readallcomics.com`,
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
                if (response.headers.location) {
                    response.headers.location = response.headers.location.replace(/^http:/, 'https:')
                }
                return response
            }
        }
    })

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${DOMAIN}/category/${mangaId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const title = $("h1").first().text().trim();
        const rawImage = $(".description-archive img").first().attr("src") || "";
        const image = rawImage.startsWith("/")
            ? `https://2.bp.blogspot.com${rawImage}`
            : rawImage;
            
        const description = $(".b strong").map((_, el) => $(el).parent().text().trim())
            .get()
            .filter(text => !text.startsWith("Vol") && !text.includes("Publisher:") && !text.includes("Genres:"))
            .join("\n")
            .trim();

        // Status is always ONGOING for comics unless explicitly stated as completed
        const status = "ONGOING";

        // Rating - No rating shown on the site, default to 0
        const rating = 0;

        const tags: TagSection[] = [];
        const genreText = $(".b strong").filter((_, el) => {
            const prevText = $(el).parent().text().trim();
            return prevText.includes("Genres:");
        }).first().text();
        const genres = genreText.split(",").map(g => g.trim());
        const publisher = $(".b strong").filter((_, el) => {
            const prevText = $(el).parent().text().trim();
            return prevText.includes("Publisher:");
        }).first().parent().text().trim().replace("Publisher:", "").trim();

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
                author: publisher,
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
        const collectedIds: string[] = metadata?.collectedIds ?? [];
        const page: number = metadata?.page ?? 1;
        const searchTerm = query.title ?? "";
        
        // If search term is empty, just return catalogue results (same parsing as viewMore)
        if (!searchTerm.trim()) {
            return await this.getViewMoreItems('catalogue', { page, collectedIds });
        }
        
        // Original search logic for when search term is provided
        const request = App.createRequest({
            url: `${DOMAIN}/?story=${searchTerm}&s=&type=comic`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const results: PartialSourceManga[] = []
        const newCollectedIds = [...collectedIds];
        
        $(".list-story.categories > li").each((_, element) => {
            const unit = $(element);
            const infoLink = unit.find("a.cat-title");

            const title = infoLink.text().trim();
            const imageEl = unit.find("img.book-cover");
            const rawImage = imageEl.attr("data-src") || imageEl.attr("src") || "";
            const image = rawImage;
            const categoryLink = unit.find("a.book-link").attr("href") || "";

            const mangaIdMatch = categoryLink.match(/category\/([^/]+)\//);
            const mangaId = mangaIdMatch ? mangaIdMatch[1] : "";

            const dateText = unit.find(".latest-date").text().replace("Updated:", "").trim();
            const totalIssues = unit.find(".cat-total-issues").text().trim();
            const fullSubtitle = totalIssues ? `${dateText} | ${totalIssues}` : dateText;
            
            if (title && mangaId && !newCollectedIds.includes(mangaId)) {
                newCollectedIds.push(mangaId);
                results.push(App.createPartialSourceManga({
                    mangaId: mangaId,
                    image: image,
                    title: title,
                    subtitle: fullSubtitle
                }));
            }
        });

        return App.createPagedResults({
            results: results,
            metadata: undefined
        });
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1;
        const collectedIds: string[] = metadata?.collectedIds ?? [];

        let url: string;
        
        switch (homepageSectionId) {
            case 'catalogue':
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
            $(".list-story.categories > li").each((_, element) => {
                const unit = $(element);
                const infoLink = unit.find("a.cat-title");

                const title = infoLink.text().trim();
                const imageEl = unit.find("img.book-cover");
                const rawImage = imageEl.attr("src") || "";
                const image = rawImage;
                const categoryLink = unit.find("a.book-link").attr("href") || "";

                const mangaIdMatch = categoryLink.match(/category\/([^/]+)\//);
                const mangaId = mangaIdMatch ? mangaIdMatch[1] : "";

                const dateText = unit.find(".latest-date").text().replace("Updated:", "").trim();
                const totalIssues = unit.find(".cat-total-issues").text().trim();
                const fullSubtitle = totalIssues ? `${dateText} | ${totalIssues}` : dateText;

                if (title && mangaId && !newCollectedIds.includes(mangaId)) {
                    newCollectedIds.push(mangaId);
                    results.push(App.createPartialSourceManga({
                        mangaId: mangaId,
                        image: image,
                        title: title,
                        subtitle: fullSubtitle
                    }));
                }
            });
        }

        let hasNextPage = false;
        
        if (homepageSectionId === 'catalogue') {
            $(".pagination .page-numbers").each((_, element) => {
                const pageNumber = $(element).text().trim();
                if (pageNumber && !isNaN(Number(pageNumber))) {
                    hasNextPage = Number(pageNumber) > page;
                }
            });
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
            url: `${DOMAIN}/category/${mangaId}`,
            method: 'GET',
        });

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const chapters: Chapter[] = [];
        $(".list-story li").each((_, element) => {
            const link = $(element).find("a");
            const url = link.attr("href") || "";
            const title = link.text().trim();

            const yearMatch = title.match(/\((\d{4})\)/);
            const year = yearMatch?.[1] ?? "2000";
            // Get volume number from title (e.g., "v1", "v2")
            const volumeMatch = title.match(/v(\d+)/i);
            const volNum = volumeMatch?.[1] ? parseInt(volumeMatch[1]) : 0;

            // Handle special cases where chapter number is the year
            const chapterMatch = title.match(/(?:v\d+\s)?(\d+)/);
            const chapNum = chapterMatch?.[1] 
                ? parseInt(chapterMatch[1]) > 2000 ? 0 : parseInt(chapterMatch[1]) 
                : 0;
            
            // Get chapter ID from URL
            const urlParts = url.split("/").filter(Boolean);
            const chapterId = urlParts[urlParts.length - 1];

            if (chapterId) {
                chapters.push(App.createChapter({
                    id: chapterId,
                    chapNum: chapNum,
                    name: title,
                    volume: volNum,
                    time: new Date(year),
                    langCode: "🇬🇧"
                }));
            }
        });

        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${DOMAIN}/${chapterId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)

        const pages: string[] = [];
        $('img[decoding="async"]').each((_, element) => {
            const image = $(element).attr('src') || ''
            if (!image || image.includes('preloader.gif')) {
            return
            }
            pages.push(image.trim())
        })
        
        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        })
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: DOMAIN,
            method: 'GET',
            headers: {
                'referer': DOMAIN,
                'origin': DOMAIN,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        });
    }

    getMangaShareUrl(mangaId: string): string { return `${DOMAIN}/category/${mangaId}` }
}
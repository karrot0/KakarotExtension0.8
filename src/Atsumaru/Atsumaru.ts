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

const DOMAIN = "https://atsu.moe";

export const AtsumaruInfo: SourceInfo = {
    version: '1.0.0-alpha.4',
    name: 'Atsumaru',
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

// Helper function to properly construct image URLs
function constructImageUrl(imagePath: string): string {
    if (imagePath.startsWith("http")) {
        return imagePath;
    }
    // If it starts with "/static/", use as is after domain
    if (imagePath.startsWith("/static/")) {
        return `${DOMAIN}${imagePath}`;
    }
    // If it starts with "/", remove the leading slash and append to domain
    if (imagePath.startsWith("/")) {
        return `${DOMAIN}${imagePath.substring(1)}`;
    }
    // Default: prepend "static/" to the domain
    return `${DOMAIN}/static/${imagePath}`;
}

export class Atsumaru
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
            url: `${DOMAIN}/api/manga/page?id=${mangaId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const data = JSON.parse(response.data as string)

        const mangaPage = data.mangaPage;

        const title = mangaPage.englishTitle || mangaPage.title;
        const altTitles = mangaPage.otherNames || [];
        const image = mangaPage.poster?.image;
        const imageUrl = image ? constructImageUrl(image) : "";
        const description = mangaPage.synopsis || "";
        const authors: string[] = mangaPage.authors?.map((author: any) => author.name) || [];

        let status = "UNKNOWN";
        const statusText = mangaPage.status;
        if (statusText?.toLowerCase().includes("ongoing")) {
            status = "ONGOING";
        } else if (statusText?.toLowerCase().includes("completed")) {
            status = "COMPLETED";
        }

        const tags: TagSection[] = [];
        const genres: string[] = mangaPage.tags?.map((tag: any) => tag.name) || [];

        if (genres.length > 0) {
            tags.push({
                id: "genres",
                label: "Genres",
                tags: genres.map((genre: string) => ({
                    id: genre
                        .toLowerCase()
                        .replace(/\s+/g, "-")
                        .replace(/[^a-z0-9-]/g, ""),
                    label: genre,
                })),
            });
        }

        // Add authors as a separate tag section if available
        if (authors.length > 0) {
            tags.push({
                id: "authors",
                label: "Authors",
                tags: authors.map((author: string) => ({
                    id: author
                        .toLowerCase()
                        .replace(/\s+/g, "-")
                        .replace(/[^a-z0-9-]/g, ""),
                    label: author,
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
                rating: 1, // API doesn't provide rating
                tags: tags,
                hentai: false
            })
        });
    }

    async getHomePageSections(
        sectionCallback: (section: HomeSection) => void
    ): Promise<void> {
        // Popular Updates section - load from home API
        const popularRequest = App.createRequest({
            url: `${DOMAIN}/api/home/page`,
            method: 'GET',
        });
        const popularResponse = await this.requestManager.schedule(popularRequest, 1);
        const popularData = JSON.parse(popularResponse.data as string);
        const homePage = popularData.homePage;
        const trendingSection = homePage.sections.find((s: any) => s.type === "slideshow" && s.key === "trending");

        const popularItems: PartialSourceManga[] = [];
        if (trendingSection) {
            for (const item of trendingSection.items || []) {
                const mangaId = item.id;
                const imageUrl = constructImageUrl(item.banner);
                popularItems.push(App.createPartialSourceManga({
                    mangaId,
                    image: imageUrl,
                    title: item.title,
                    subtitle: undefined
                }));
            }
        }

        sectionCallback(App.createHomeSection({
            id: 'popular_updates',
            title: 'Popular Updates',
            type: 'singleRowNormal',
            items: popularItems,
            containsMoreItems: true
        }));

        // Trending section
        sectionCallback(App.createHomeSection({
            id: 'trending',
            title: 'Trending',
            type: 'singleRowNormal',
            items: [],
            containsMoreItems: true
        }));

        // Recently Updated section
        sectionCallback(App.createHomeSection({
            id: 'recently_updated',
            title: 'Recently Updated',
            type: 'singleRowNormal',
            items: [],
            containsMoreItems: true
        }));
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        const collectedIds: string[] = metadata?.collectedIds ?? []

        if (!query.title) {
            // Show recently updated instead
            const apiPage = page - 1; // API starts from 0
            const request = App.createRequest({
                url: `${DOMAIN}/api/infinite/recentlyUpdated?page=${apiPage}`,
                method: 'GET',
            })

            const response = await this.requestManager.schedule(request, 1)
            const data = JSON.parse(response.data as string)
            const items: PartialSourceManga[] = [];

            for (const item of data.items || []) {
                const mangaId = item.id;
                if (collectedIds.includes(mangaId)) continue;
                collectedIds.push(mangaId);
                const imageUrl = constructImageUrl(item.image);
                items.push(App.createPartialSourceManga({
                    mangaId,
                    image: imageUrl,
                    title: item.title,
                    subtitle: undefined
                }));
            }

            return App.createPagedResults({
                results: items,
                metadata: items.length > 0 ? { page: page + 1, collectedIds } : undefined
            });
        }

        // Use search API
        const searchUrl = `${DOMAIN}/api/search/page?query=${encodeURIComponent(query.title.replace(/\s+/g, "+"))}`;
        const request = App.createRequest({
            url: searchUrl,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const data = JSON.parse(response.data as string)

        const items: PartialSourceManga[] = [];
        for (const hit of data.hits || []) {
            const mangaId = hit.id;
            if (collectedIds.includes(mangaId)) continue;
            collectedIds.push(mangaId);
            const imageUrl = constructImageUrl(hit.image);
            items.push(App.createPartialSourceManga({
                mangaId,
                image: imageUrl,
                title: hit.title,
                subtitle: undefined
            }));
        }

        return App.createPagedResults({
            results: items,
            metadata: items.length > 0 ? { page: page + 1, collectedIds } : undefined
        });
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1;
        const collectedIds: string[] = metadata?.collectedIds ?? [];

        if (homepageSectionId === 'popular_updates') {
            // For popular section, return the same items from home API (no pagination needed)
            const request = App.createRequest({
                url: `${DOMAIN}/api/home/page`,
                method: 'GET',
            });
            const response = await this.requestManager.schedule(request, 1);
            const data = JSON.parse(response.data as string);
            const homePage = data.homePage;
            const trendingSection = homePage.sections.find((s: any) => s.type === "slideshow" && s.key === "trending");

            const items: PartialSourceManga[] = [];
            if (trendingSection) {
                for (const item of trendingSection.items || []) {
                    const mangaId = item.id;
                    if (collectedIds.includes(mangaId)) continue;
                    collectedIds.push(mangaId);
                    const imageUrl = constructImageUrl(item.banner);
                    items.push(App.createPartialSourceManga({
                        mangaId,
                        image: imageUrl,
                        title: item.title,
                        subtitle: undefined
                    }));
                }
            }

            return App.createPagedResults({
                results: items,
                metadata: undefined // No pagination for popular section
            });
        }

        let url: string;
        if (homepageSectionId === 'trending') {
            url = `${DOMAIN}/api/infinite/trending?page=${page}`;
        } else if (homepageSectionId === 'recently_updated') {
            url = `${DOMAIN}/api/infinite/recentlyUpdated?page=${page}`;
        } else {
            // Default to recently updated
            url = `${DOMAIN}/api/infinite/recentlyUpdated?page=${page}`;
        }

        const request = App.createRequest({
            url: url,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const data = JSON.parse(response.data as string)

        const items: PartialSourceManga[] = [];
        for (const item of data.items || []) {
            const mangaId = item.id;
            if (collectedIds.includes(mangaId)) continue;
            collectedIds.push(mangaId);
            const imageUrl = constructImageUrl(item.image);
            items.push(App.createPartialSourceManga({
                mangaId,
                image: imageUrl,
                title: item.title,
                subtitle: undefined
            }));
        }

        return App.createPagedResults({
            results: items,
            metadata: items.length > 0 ? { page: page + 1, collectedIds } : undefined
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const chapters: Chapter[] = [];
        let currentPage = 0;
        let totalPages = 1;

        do {
            const request = App.createRequest({
                url: `${DOMAIN}/api/manga/chapters?id=${mangaId}&filter=all&sort=desc&page=${currentPage}`,
                method: 'GET',
            });

            try {
                const response = await this.requestManager.schedule(request, 1);
                const data = JSON.parse(response.data as string);

                if (!data?.chapters?.length) {
                    console.warn(`[chapters] No chapters found on page ${currentPage} for ${mangaId}`);
                    break;
                }

                for (const ch of data.chapters) {
                    const stripped = ch.title?.replace(/^Chapter\s*/i, "").trim();
                    const isNumeric = /^\d+$/.test(stripped ?? "");

                    chapters.push(App.createChapter({
                        id: ch.id,
                        chapNum: ch.number ?? 0,
                        volume: 0,
                        name: isNumeric ? undefined : stripped, // let Paperback generate title if number only
                        time: new Date(ch.createdAt),
                        langCode: "🇬🇧",
                        group: "Default"
                    }));
                }

                totalPages = data.pages ?? 1;
                currentPage++;
            } catch (err: unknown) {
                console.error(`[chapters] fetchJson error on page ${currentPage}:`, err);
                break;
            }
        } while (currentPage <= totalPages);

        chapters.sort((a, b) => (b.chapNum ?? 0) - (a.chapNum ?? 0));

        console.log(`[chapters] Loaded ${chapters.length} chapters for ${mangaId} (${totalPages} pages)`);

        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${DOMAIN}/api/read/chapter?mangaId=${mangaId}&chapterId=${chapterId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const data = JSON.parse(response.data as string)

        const pages: string[] = data.readChapter.pages.map((page: any) => {
            return constructImageUrl(page.image);
        });

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        })
    }

    getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/title/${mangaId}`;
    }
}
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
    PartialSourceManga,
} from '@paperback/types'
import * as cheerio from "cheerio";

const DOMAIN = "https://mangaball.net";

export const MangaballInfo: SourceInfo = {
    version: '1.0.0-alpha.1',
    name: 'Mangaball',
    description: `Extension that pulls content from ${DOMAIN}`,
    author: 'Karrot',
    icon: 'icon.png',
    contentRating: ContentRating.ADULT,
    websiteBaseURL: DOMAIN,
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS,
    sourceTags: []
}

// Helper function to construct URLs
function constructUrl(path: string): string {
    return `${DOMAIN}${path.startsWith('/') ? path : '/' + path}`;
}

// Helper function for relative time
function toRelativeTime(dateText: string): string {
    if (!dateText || typeof dateText !== "string" || !dateText.trim()) {
        return "";
    }

    const now = Date.now();
    let date: Date | undefined;

    // Try parsing as timestamp (seconds or ms)
    const trimmed = dateText.trim();
    if (/^\d{10,13}$/.test(trimmed)) {
        if (trimmed.length === 13) {
            date = new Date(Number(trimmed));
        } else if (trimmed.length === 10) {
            date = new Date(Number(trimmed) * 1000);
        }
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
        const m = dateText.trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        if (m) {
            date = new Date(
                Number(m[1]),
                Number(m[2]) - 1,
                Number(m[3]),
                Number(m[4]),
                Number(m[5]),
                Number(m[6])
            );
        }
    } else if (!isNaN(Date.parse(trimmed))) {
        date = new Date(trimmed);
    }

    if (!date || isNaN(date.getTime())) {
        return trimmed;
    }

    const diff = Math.floor((now - date.getTime()) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} minute${Math.floor(diff / 60) === 1 ? "" : "s"} ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hour${Math.floor(diff / 3600) === 1 ? "" : "s"} ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? "" : "s"} ago`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} month${Math.floor(diff / 2592000) === 1 ? "" : "s"} ago`;
    return `${Math.floor(diff / 31536000)} year${Math.floor(diff / 31536000) === 1 ? "" : "s"} ago`;
}

interface APIItem {
    _id: string;
    name: string;
    alternateName: string;
    cover: string;
    background: string;
    tags: string;
    authors: string;
    status: string;
    last_chapter?: string;
    url: string;
    description: string;
    updated_at: string;
    languageFlag: string;
}

interface SearchAPIResponse {
    code: number;
    data: APIItem[];
    message: string;
    pagination?: {
        total: number;
        limit: number;
        start: number;
        current_page: number;
        last_page: number;
        from: number;
        to: number;
    };
}

export class Mangaball
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
                    ...(request.headers ?? {}), ...{
                        "referer": DOMAIN,
                        "origin": DOMAIN,
                        "user-agent": await this.requestManager.getDefaultUserAgent(),
                        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        "accept-language": "en-US,en;q=0.5",
                        "accept-encoding": "gzip, deflate, br",
                    },
                };

                return request;
            },

            interceptResponse: async (response: Response): Promise<Response> => {
                return response;
            }
        }
    });

    // Cached CSRF/cookie state
    private cachedCsrfToken: string | undefined;
    private cachedXsrfToken: string | undefined;
    private cachedFormToken: string | undefined;
    private csrfReady: boolean = false;

    async initialise(): Promise<void> {
        // One-time CSRF/cookie fetch and cache
        try {
            const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
            const request = App.createRequest({
                url: DOMAIN,
                method: "GET",
                headers: {
                    Accept: "*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": ua,
                },
            });
            const response = await this.requestManager.schedule(request, 1);
            const html = response.data as string;
            const $ = cheerio.load(html);
            const metaToken = ($("meta[name=\"csrf-token\"]").attr("content") || "").trim();
            let cookieToken: string | undefined;
            // Note: Cookie handling might need adaptation for 0.8
            let scriptToken: string | undefined;
            if (!metaToken) {
                const scriptsCombined = $("script")
                    .map((_, el) => $(el).html() || "")
                    .get()
                    .join("\n");
                const m1 = scriptsCombined.match(/csrfToken\s*[:=]\s*["']([^"']+)["']/i);
                if (m1) scriptToken = m1[1];
                else {
                    const m2 = scriptsCombined.match(/window\.Laravel\s*=\s*\{[\s\S]*?csrfToken\s*:\s*["']([^"']+)["']/i);
                    if (m2) scriptToken = m2[1];
                }
            }
            this.cachedCsrfToken = metaToken || cookieToken || scriptToken || "";
            this.cachedXsrfToken = cookieToken || metaToken || scriptToken || "";
            this.cachedFormToken = metaToken || cookieToken || scriptToken || "";
            this.csrfReady = true;
        } catch (err) {
            this.csrfReady = false;
        }
    }

    async getHomePageSections(
        sectionCallback: (section: HomeSection) => void
    ): Promise<void> {
        // Popular Updates
        sectionCallback(App.createHomeSection({
            id: 'popular_updates',
            title: 'Popular Updates',
            type: 'singleRowNormal',
            items: [],
            containsMoreItems: true
        }));

        // Latest Releases
        sectionCallback(App.createHomeSection({
            id: 'latest_releases',
            title: 'Latest Releases',
            type: 'singleRowNormal',
            items: [],
            containsMoreItems: true
        }));

        // Manga Recommend
        sectionCallback(App.createHomeSection({
            id: 'manga_recommend',
            title: 'Manga Recommend',
            type: 'singleRowNormal',
            items: [],
            containsMoreItems: true
        }));

        // Manga of the Day
        sectionCallback(App.createHomeSection({
            id: 'manga_of_day',
            title: 'Manga of the Day',
            type: 'singleRowNormal',
            items: [],
            containsMoreItems: true
        }));

        // Chapter of the Day
        sectionCallback(App.createHomeSection({
            id: 'chapter_of_day',
            title: 'Chapter of the Day',
            type: 'singleRowNormal',
            items: [],
            containsMoreItems: true
        }));
    }

    private formEncode(params: Record<string, string | number | undefined>): string {
        return Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join("&");
    }

    private async searchAPI(
        search_type: string,
        search_limit?: number,
    ): Promise<SearchAPIResponse> {
        const bodyParams: Record<string, string | number | undefined> = { search_type };
        if (search_limit !== undefined) bodyParams.search_limit = search_limit;
        const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
        if (!this.csrfReady) {
            await this.initialise();
            if (!this.csrfReady) throw new Error("CSRF/cookie fetch failed");
        }
        const headers: Record<string, string> = {
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: DOMAIN.replace(/\/$/, ""),
            Referer: DOMAIN,
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": ua,
        };
        if (this.cachedCsrfToken) { headers["X-CSRF-TOKEN"] = this.cachedCsrfToken; }
        if (this.cachedXsrfToken) { headers["X-XSRF-TOKEN"] = this.cachedXsrfToken; }
        if (this.cachedFormToken) { bodyParams._token = this.cachedFormToken; }
        const apiUrl = constructUrl("/api/v1/title/search");
        const formBody = this.formEncode(bodyParams);
        const request = App.createRequest({
            url: apiUrl,
            method: "POST",
            data: formBody,
            headers,
        });
        try {
            const response = await this.requestManager.schedule(request, 1);
            const jsonStr = response.data as string;
            const responseData = JSON.parse(jsonStr) as SearchAPIResponse;
            return responseData;
        } catch (err) {
            throw err;
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1;
        const collectedIds: string[] = metadata?.collectedIds ?? [];

        switch (homepageSectionId) {
            case "popular_updates":
                return this.getPopularSectionItems(page, collectedIds);
            case "latest_releases":
                return this.getUpdatedSectionItems(page, collectedIds);
            case "manga_recommend":
                return this.getMangaRecommendSectionItems(page, collectedIds);
            case "manga_of_day":
                return this.getMangaOfDaySectionItems(page, collectedIds);
            case "chapter_of_day":
                return this.getChapterOfDaySectionItems(page, collectedIds);
            default:
                return App.createPagedResults({
                    results: [],
                    metadata: undefined
                });
        }
    }

    private async getPopularSectionItems(page: number, collectedIds: string[]): Promise<PagedResults> {
        const Popular = await this.searchAPI("getFeatured");
        const parsed = this.parseApiItemsToDiscoverItems(Popular.data, collectedIds);
        return App.createPagedResults({
            results: parsed.items,
            metadata: { page: page + 1, collectedIds: parsed.collectedIds }
        });
    }

    private async getUpdatedSectionItems(page: number, collectedIds: string[]): Promise<PagedResults> {
        const latest = await this.searchAPI("getLatestTable");
        const parsed = this.parseApiItemsToDiscoverItems(latest?.data ?? [], collectedIds, {
            extractChapterInfo: true,
            customSubtitleExtractor: (raw: APIItem) => String(raw.updated_at || "")
        });
        return App.createPagedResults({
            results: parsed.items,
            metadata: { page: page + 1, collectedIds: parsed.collectedIds }
        });
    }

    private async getMangaOfDaySectionItems(page: number, collectedIds: string[]): Promise<PagedResults> {
        const recent = await this.searchAPI("getRecentRead");
        const parsed = this.parseApiItemsToDiscoverItems(recent?.data ?? [], collectedIds, {
            customSubtitleExtractor: (raw: APIItem) => String(raw.updated_at || "")
        });
        return App.createPagedResults({
            results: parsed.items,
            metadata: { page: page + 1, collectedIds: parsed.collectedIds }
        });
    }

    private async getMangaRecommendSectionItems(page: number, collectedIds: string[]): Promise<PagedResults> {
        const recommend = await this.searchAPI("getRecommend");
        const parsed = this.parseApiItemsToDiscoverItems(recommend?.data ?? [], collectedIds);
        return App.createPagedResults({
            results: parsed.items,
            metadata: { page: page + 1, collectedIds: parsed.collectedIds }
        });
    }

    private async getChapterOfDaySectionItems(page: number, collectedIds: string[]): Promise<PagedResults> {
        const recent = await this.searchAPI("getRecentChapterRead");
        const parsed = this.parseApiItemsToDiscoverItems(recent?.data ?? [], collectedIds, {
            customSubtitleExtractor: (raw: APIItem) => String(raw.updated_at || "")
        });
        return App.createPagedResults({
            results: parsed.items,
            metadata: { page: page + 1, collectedIds: parsed.collectedIds }
        });
    }

    private parseApiItemsToDiscoverItems(
        apiItems: APIItem[],
        collectedIds?: string[],
        options?: {
            extractChapterInfo?: boolean;
            customSubtitleExtractor?: (raw: APIItem) => string;
        }
    ): { items: PartialSourceManga[]; collectedIds: string[] } {
        const items: PartialSourceManga[] = [];
        const seen = new Set<string>(collectedIds || []);
        const { extractChapterInfo = false, customSubtitleExtractor } = options || {};

        for (const raw of apiItems || []) {
            const mangaId = raw.url.replace(/^https?:\/\/[^\/]+\/title-detail\//, "").replace(/\/$/, "");

            if (!mangaId || seen.has(mangaId)) continue;
            seen.add(mangaId);

            const title = String(raw.name || "");
              const cover = String(raw.cover || raw.background || "") || "https://raw.githubusercontent.com/paperback-ios/app-assets/main/Placeholder.jpg";
            let subtitle: string | undefined = undefined;

            if (extractChapterInfo && raw.last_chapter) {
                try {
                    const $lc = cheerio.load(String(raw.last_chapter));
                    const anchor = $lc('a').first();
                    const href = anchor.attr('href') || anchor.attr('data-href') || "";
                    this.deriveIdFromUrl(href || "") || "";
                    const txt = anchor.text().trim();
                    if (txt) subtitle = txt;
                } catch {
                    subtitle = undefined;
                }
            }

            if (customSubtitleExtractor) {
                const customSubtitle = customSubtitleExtractor(raw);
                if (customSubtitle !== undefined) subtitle = customSubtitle;
            }

            if (!subtitle && !extractChapterInfo) {
                subtitle = String(raw.updated_at || "");
            }

            const baseItem = {
                mangaId,
                image: cover,
                title,
                subtitle,
            };

            items.push(App.createPartialSourceManga(baseItem));
        }

        return { items, collectedIds: Array.from(seen) };
    }

    private deriveIdFromUrl(url: string): string {
        if (!url) return "";
        const segments = url.split("/").filter(Boolean);
        return segments.pop()?.split(/[?#]/)[0] || "";
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1;
        const collectedIds = metadata?.searchCollectedIds ?? [];

        // For simplicity, use the search API with title
        if (!query.title) {
            // Return empty or default
            return App.createPagedResults({
                results: [],
                metadata: undefined
            });
        }

        // Use advanced search API
        const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
        if (!this.csrfReady) {
            await this.initialise();
            if (!this.csrfReady) throw new Error("CSRF/cookie fetch failed");
        }
        const headers: Record<string, string> = {
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: DOMAIN.replace(/\/$/, ""),
            Referer: constructUrl("/search-advanced"),
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": ua,
        };
        if (this.cachedCsrfToken) headers["X-CSRF-TOKEN"] = this.cachedCsrfToken;
        if (this.cachedXsrfToken) headers["X-XSRF-TOKEN"] = this.cachedXsrfToken;
        if (this.cachedFormToken) headers["x-csrf-token"] = this.cachedFormToken;

        const filters: Record<string, any> = {
            sort: "none",
            tag_included_mode: "and",
            tag_excluded_mode: "and",
            page,
        };
        filters["page"] = page;

        const formBody = [
            `search_input=${encodeURIComponent(query.title)}`,
            ...Object.entries(filters).flatMap(([k, v]) => {
                if (Array.isArray(v)) {
                    return v.map((val) => `${encodeURIComponent("filters[" + k + "]")}=${encodeURIComponent(String(val))}`);
                } else {
                    return `${encodeURIComponent("filters[" + k + "]")}=${encodeURIComponent(String(v))}`;
                }
            }),
        ].join("&");

        const apiUrl = constructUrl("/api/v1/title/search-advanced");
        const request = App.createRequest({
            url: apiUrl,
            method: "POST",
            data: formBody,
            headers,
        });
        try {
            const response = await this.requestManager.schedule(request, 1);
            const jsonStr = response.data as string;
            const responseData = JSON.parse(jsonStr) as SearchAPIResponse;
            const searchResults: PartialSourceManga[] = [];
            for (const raw of responseData.data ?? []) {
                const mangaId = raw.url.replace(/^https?:\/\/[^\/]+\/title-detail\//, "").replace(/\/$/, "");
                if (collectedIds.includes(mangaId)) continue;
                collectedIds.push(mangaId);

                searchResults.push(App.createPartialSourceManga({
                    mangaId: mangaId,
                      image: String(raw.cover || raw.background || "") || "https://raw.githubusercontent.com/paperback-ios/app-assets/main/Placeholder.jpg",
                    title: String(raw.name || ""),
                    subtitle: toRelativeTime(raw.updated_at),
                }));
            }
            let nextPage: number | undefined = undefined;
            if (responseData.pagination && responseData.pagination.current_page < responseData.pagination.last_page) {
                nextPage = responseData.pagination.current_page + 1;
            }
            return App.createPagedResults({
                results: searchResults,
                metadata: nextPage ? { page: nextPage, searchCollectedIds: collectedIds } : undefined,
            });
        } catch (err) {
            throw err;
        }
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const id = mangaId.replace(/^https?:\/\/[^\/]+\/title-detail\//, "").replace(/\/$/, "");
        const request = App.createRequest({
            url: constructUrl(`/title-detail/${id}`),
            method: "GET",
        });
        const response = await this.requestManager.schedule(request, 1);
        const $ = cheerio.load(response.data as string);

        // Title header where title and genre infos are in
        const titleHeader = $(".comic-detail-card .mb-2").first();
        const title = (titleHeader.find("h6, .comic-title").first().text().trim() || "");
        const altTitles: string[] = [];
        $(".alternate-name-container span").each((_, el) => {
            const t = $(el).text().trim();
            if (t) altTitles.push(t);
        });

        // Cover image
        let image = $(".featured-cover").attr("src") || $(".featured-cover").attr("data-src") || "";
        if (image && !image.startsWith("http")) {
            image = image.startsWith("/") ? `${DOMAIN}${image.slice(1)}` : `${DOMAIN}${image}`;
        }
        const description = $(".description-text p").html() || "";
        const authors: string[] = [];
        $(".badge.bg-secondary.bg-opacity-75 i.fa-user-edit").parent().nextAll("span").each((_, el) => {
            const t = $(el).text().trim();
            if (t) authors.push(t);
        });

        let status = "UNKNOWN";
        const statusText = $(".badge.bg-success.me-3").first().text().trim() || $(".badge.bg-danger.me-3").first().text().trim();
        if (statusText?.toLowerCase().includes("ongoing")) {
            status = "ONGOING";
        } else if (statusText?.toLowerCase().includes("completed")) {
            status = "COMPLETED";
        }

        const tagGroups: any[] = [];
        
        // Process standard tags
        const tagBadges = $(".badge").filter(function() {
            return !!$(this).attr("data-tag-id");
        });
        if (tagBadges.length > 0) {
            tagGroups.push(App.createTagSection({
                id: "tags",
                label: "Tags",
                tags: tagBadges.toArray().map((el) => App.createTag({
                    id: $(el).attr("data-tag-id") || "",
                    label: $(el).text().trim(),
                })),
            }));
        }

        // Process keywords
        const keywordBadges = $(".keyword-item").filter(function() {
            return !!$(this).attr("data-keyword-id");
        });
        if (keywordBadges.length > 0) {
            tagGroups.push(App.createTagSection({
                id: "keywords",
                label: "Keywords",
                tags: keywordBadges.toArray().map((el) => App.createTag({
                    id: $(el).attr("data-keyword-id") || "",
                    label: $(el).text().trim(),
                })),
            }));
        }

        let rating = 0;
        const ratingText = $(".fa-star.text-warning").parent().find("span").text().trim();
        if (ratingText) {
            const parsed = parseFloat(ratingText);
            if (!isNaN(parsed)) rating = parsed;
        }

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [title, ...altTitles],
                image: image,
                desc: description,
                status: status,
                rating: rating,
                tags: tagGroups,
                hentai: false,
                author: authors.join(", "),
            })
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const match = mangaId.match(/([a-f0-9]{24})$/);
        const titleId = match?.[1] || mangaId;

        const csrfToken = this.cachedFormToken || this.cachedCsrfToken || "";
        const apiUrl = constructUrl("/api/v1/chapter/chapter-listing-by-title-id/");
        const headers: Record<string, string> = {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "origin": DOMAIN.replace(/\/$/, ""),
            "referer": constructUrl(`/title-detail/${mangaId}/`),
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
            "x-csrf-token": csrfToken,
            "x-requested-with": "XMLHttpRequest",
        };

        const body = `title_id=${encodeURIComponent(titleId)}`;
        const request = App.createRequest({
            url: apiUrl,
            method: "POST",
            headers,
            data: body,
        });

        const response = await this.requestManager.schedule(request, 1);
        const json = JSON.parse(response.data as string) as {
            code: number;
            TOTAL_CHAPTERS: number;
            ALL_CHAPTERS: {
                number: string;
                number_float: number;
                title: string;
                translations: {
                    id: string;
                    name: string;
                    language: string;
                    languageName: string;
                    group?: { name?: string };
                    date?: string;
                    volume?: number;
                }[];
            }[];
        };
        const chapters: Chapter[] = [];
        const seen = new Set<string>();

        for (const ch of json.ALL_CHAPTERS ?? []) {
            for (const t of ch.translations ?? []) {
                if (seen.has(t.id)) continue;
                seen.add(t.id);
                chapters.push(App.createChapter({
                    id: t.id,
                    chapNum: ch.number_float || 0,
                    volume: t.volume || 0,
                    name: t.name || ch.title || ch.number || "",
                    time: t.date ? new Date(t.date) : new Date(),
                    langCode: t.languageName || t.language || "",
                    group: t.group?.name || "",
                }));
            }
        }

        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: constructUrl(`/chapter-detail/${chapterId}`),
            method: 'GET',
        });

        const response = await this.requestManager.schedule(request, 1);
        const $ = cheerio.load(response.data as string);
        const pages: string[] = [];

        const script = $('script').filter((_, el) => {
            const html = $(el).html() || "";
            return html.includes('const chapterImages = JSON.parse(');
        }).first().html();

        if (script) {
            const match = script.match(/const chapterImages\s*=\s*JSON\.parse\(`(.+?)`\)/s);
            if (match && match[1]) {
                try {
                    const images = JSON.parse(match[1]);
                    if (Array.isArray(images)) {
                        pages.push(...images);
                    }
                } catch {
                    // Ignore
                }
            }
        }

        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        });
    }

    getMangaShareUrl(mangaId: string): string {
        return constructUrl(`/title-detail/${mangaId}`);
    }
}

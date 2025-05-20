import {
    BadgeColor,
    ChapterProviding,
    ContentRating,
    HomePageSectionsProviding,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    MangaInfo,
    ChapterDetails,
    Chapter,
    HomeSection,
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

    async getMangaDetails(mangaId: string): Promise<SourceManga> {}

    async getHomePageSections(
        sectionCallback: (section: HomeSection) => void
    ): Promise<void> {
        const request = App.createRequest({
            url: DOMAIN,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        await parseHomeSections(this, $, sectionCallback)
    }

    async getSearchResults(query: string, metadata: any): Promise<PagedResults> {}

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        
    }

    async getChapter(mangaId: string, chapterId: string): Promise<ChapterDetails> {}

    async getChapterDetails(mangaId: string, chapterId: string): Promise<Chapter> {
        
    }
}
import {
    HomeSection,
    HomeSectionType,
    PartialSourceManga,
} from '@paperback/types'

import * as cheerio from 'cheerio'

const DOMAIN = "https://mangapark.io";

export const parseHomeSections = async (
    source: any,
    sectionCallback: (section: HomeSection) => void,
): Promise<void> => {
    const request = App.createRequest({
        url: DOMAIN,
        method: 'GET',
    })

    const newReleasesRequest = App.createRequest({
        url: `${DOMAIN}/search?sortby=field_create&page=1`,
        method: 'GET',
    })

    const [response, newReleasesResponse] = await Promise.all([
        source.requestManager.schedule(request, 1),
        source.requestManager.schedule(newReleasesRequest, 1)
    ])

    const [$, $newReleases] = await Promise.all([
        cheerio.load(response.data as string),
        cheerio.load(newReleasesResponse.data as string)
    ])

    const popularSection = App.createHomeSection({
        id: 'popular',
        title: 'Popular',
        containsMoreItems: false,
        type: HomeSectionType.singleRowLarge,
    })

    const latestSection = App.createHomeSection({
        id: 'latest',
        title: 'Latest',
        containsMoreItems: true,
        type: HomeSectionType.singleRowNormal,
    })

    const newReleasesSection = App.createHomeSection({
        id: 'newReleases',
        title: 'New Releases',
        containsMoreItems: true,
        type: HomeSectionType.singleRowNormal,
    })

    const popularArray: PartialSourceManga[] = []
    const collectedIds: string[] = []

    // Updated selectors based on current Mangapark HTML structure
    $(".relative.w-full.group").each((_, element) => {
        const unit = $(element);
        const titleLink = unit.find("div.absolute a.link.link-hover.text-sm").first();
        const title = titleLink.text().trim();
              const imageSrc = unit.find("a.block.w-full img").attr("src") || "";
      const image = imageSrc.startsWith("http") ? imageSrc : imageSrc.startsWith("/") ? `${DOMAIN}${imageSrc.slice(1)}` : `${DOMAIN}${imageSrc}`;
        const mangaId = titleLink.attr("href")?.replace("/title/", "") || "";

        const chapterLink = unit.find("div.absolute span.line-clamp-1 a.link.link-hover.text-xs").first();
        const latestChapter = chapterLink.text().trim();
        const latestChapterMatch = latestChapter.match(/Chapter (\d+)/);
        const subtitle = latestChapterMatch
        ? `Ch. ${latestChapterMatch[1]}`
        : undefined;

        if (title && mangaId && !collectedIds.includes(mangaId)) {
            collectedIds.push(mangaId);
            popularArray.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: subtitle
            }));
        }
    });

    popularSection.items = popularArray
    sectionCallback(popularSection)

    // For latest section
    const latestArray: PartialSourceManga[] = []

    // Adapt selectors for latest - using search results format
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

        if (title && mangaId && !collectedIds.includes(mangaId)) {
            collectedIds.push(mangaId);
            latestArray.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: subtitle
            }));
        }
    });

    latestSection.items = latestArray
    sectionCallback(latestSection)
    
    const newReleasesArray: PartialSourceManga[] = []
    const newReleasesIds: string[] = []
    
    $newReleases(".flex.border-b.border-b-base-200.pb-5").each((_, element) => {
        const unit = $newReleases(element);
        const titleLink = unit.find("h3 a");
        const title = titleLink.find("span").text().trim();
        const imageSrc = unit.find("img").attr("src") || "";
        const image = imageSrc.startsWith("http") ? imageSrc : `${DOMAIN}${imageSrc}`;
        const mangaId = titleLink.attr("href")?.replace("/title/", "") || "";
        const chapterLink = unit.find(".flex.flex-nowrap.justify-between a");
        const latestChapter = chapterLink.find("span").text().trim();
        const latestChapterMatch = latestChapter.match(/Chapter (\d+)/);
        const subtitle = latestChapterMatch ? `Ch. ${latestChapterMatch[1]}` : undefined;

        if (title && mangaId && !newReleasesIds.includes(mangaId)) {
            newReleasesIds.push(mangaId);
            newReleasesArray.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: subtitle
            }));
        }
    });
    
    newReleasesSection.items = newReleasesArray
    sectionCallback(newReleasesSection)
}
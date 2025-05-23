import {
    HomeSection,
    HomeSectionType,
    PartialSourceManga,
} from '@paperback/types'

import * as cheerio from 'cheerio'

const DOMAIN = "https://readallcomics.com";

export const parseHomeSections = async (
    source: any,
    sectionCallback: (section: HomeSection) => void,
): Promise<void> => {
    const [request] = [
        App.createRequest({
            url: DOMAIN,
            method: 'GET',
        }),
    ]

    const [response] = await Promise.all([
        source.requestManager.schedule(request, 1),
    ])

    const [$] = await Promise.all([
        cheerio.load(response.data as string),
    ])

    const catalogueSection = App.createHomeSection({
        id: 'catalogue',
        title: 'Catalogue',
        containsMoreItems: true,
        type: HomeSectionType.singleRowLarge,
    })
    
    const catalogueArray: PartialSourceManga[] = []
    const catalogueIds: string[] = []
    
    $("#post-area .post").each((_, element) => {
        const unit = $(element);
        const infoLink = unit.find(".pinbin-copy a");
        const title = infoLink.attr("title")?.trim() || infoLink.text().trim();
        const imageEl = unit.find("img");
        const rawImage = imageEl.attr("data-src") || imageEl.attr("src") || "";
        const image = rawImage.startsWith("/")
            ? `https://2.bp.blogspot.com${rawImage}`
            : rawImage;
        const rawMangaId = unit.attr('class')?.match(/category-([^\s]+)/)?.[1] ?? '';
        const mangaId = rawMangaId || '';
        const dateText = unit.find(".pinbin-copy span").text().trim();

        if (title && mangaId && !catalogueIds.includes(mangaId)) {
            catalogueIds.push(mangaId);
            catalogueArray.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: dateText
            }));
        }
    });
    
    catalogueSection.items = catalogueArray
    sectionCallback(catalogueSection)
}
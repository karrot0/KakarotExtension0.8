import {
    HomeSection,
    HomeSectionType,
    PartialSourceManga,
} from '@paperback/types'

import { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio'

export const parseHomeSections = async (
    source: any,
    $: CheerioAPI,
    sectionCallback: (section: HomeSection) => void,
): Promise<void> => {
    const popularSection = App.createHomeSection({
        id: 'popular',
        title: 'Popular',
        containsMoreItems: false,
        type: HomeSectionType.singleRowLarge,
    })

    // const catalogueSection = App.createHomeSection({
    //     id: 'catalogue',
    //     title: 'Catalogue',
    //     containsMoreItems: false,
    //     type: HomeSectionType.singleRowNormal,
    // })

    // const newComicsSection = App.createHomeSection({
    //     id: 'newComics',
    //     title: 'New Comics',
    //     containsMoreItems: false,
    //     type: HomeSectionType.singleRowNormal,
    // })

    // Popular Section
    const popularArray: PartialSourceManga[] = []
    const collectedIds: string[] = []
    
    $(".poster.grid-item").each((_, element) => {
        const unit = $(element);
        const title = unit.find(".poster__title").text().trim();
        const rawImage = (
            unit.find(".poster__img img").attr("data-src") || ""
        ).trim();
        const image = rawImage.startsWith("/")
            ? `https://batcave.biz${rawImage}`
            : rawImage;
        const rawMangaId = unit.attr("href");
        const mangaId = rawMangaId
            ?.replace(/^.*?\/([^/]+)$/, "$1")
            .replace(/\.html$/, "")
            .trim();
        const rating = unit.find(".poster__label--rate").text().trim();

        if (title && mangaId && !collectedIds.includes(mangaId)) {
            collectedIds.push(mangaId);
            popularArray.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: `Rating: ${rating}`
            }));
        }
    });
    
    popularSection.items = popularArray
    sectionCallback(popularSection)
}
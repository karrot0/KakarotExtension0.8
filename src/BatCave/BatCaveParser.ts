import {
    HomeSection,
    HomeSectionType,
    PartialSourceManga,
} from '@paperback/types'

import * as cheerio from 'cheerio'

const DOMAIN = "https://batcave.biz";

export const parseHomeSections = async (
    source: any,
    sectionCallback: (section: HomeSection) => void,
): Promise<void> => {
    const catalogueURL = `${DOMAIN}/comix/`;

    const [request, requestCatalogue] = [
        App.createRequest({
            url: DOMAIN,
            method: 'GET',
        }),
        App.createRequest({
            url: catalogueURL,
            method: 'GET',
        })
    ]

    const [response, responseCatalogue] = await Promise.all([
        source.requestManager.schedule(request, 1),
        source.requestManager.schedule(requestCatalogue, 1)
    ])

    const [$, $catalogue] = await Promise.all([
        cheerio.load(response.data as string),
        cheerio.load(responseCatalogue.data as string)
    ])

    const popularSection = App.createHomeSection({
        id: 'popular',
        title: 'Popular',
        containsMoreItems: false,
        type: HomeSectionType.singleRowLarge,
    })

    const catalogueSection = App.createHomeSection({
        id: 'catalogue',
        title: 'Catalogue',
        containsMoreItems: true,
        type: HomeSectionType.singleRowNormal,
        
    })

    const newComicsSection = App.createHomeSection({
        id: 'newComics',
        title: 'New Comics',
        containsMoreItems: true,
        type: HomeSectionType.singleRowNormal,
    })

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
            ?.replace(/^https?:\/\/batcave\.biz\//, "")
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

    const catalogueArray: PartialSourceManga[] = []
    const catalogueIds: string[] = []
    
    $catalogue("#dle-content .readed").each((_, element) => {
        const unit = $catalogue(element);
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

        if (title && mangaId && !catalogueIds.includes(mangaId)) {
            catalogueIds.push(mangaId);
            catalogueArray.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: latestChapter
            }));
        }
    });
    
    catalogueSection.items = catalogueArray
    sectionCallback(catalogueSection)
    
    const newComicsArray: PartialSourceManga[] = []
    const newComicsIds: string[] = []
    
    $(".sect--latest .latest.grid-item").each((_, element) => {
        const unit = $(element);
        const title = unit
            .find(".latest__title")
            .clone()
            .children()
            .remove()
            .end()
            .text()
            .trim();
        const rawImage = unit.find(".latest__img img").attr("src") || "";
        const image = rawImage.startsWith("/")
            ? `https://batcave.biz${rawImage}`
            : rawImage;
        const rawMangaId = unit
            .find(".latest__title")
            .closest("a")
            .attr("href");
        const mangaId = rawMangaId
            ?.replace(/^https?:\/\/batcave\.biz\//, "")
            .replace(/\.html$/, "")
            .trim();
        const latestChapter = unit.find(".latest__chapter a").text().trim();

        if (title && mangaId && !newComicsIds.includes(mangaId)) {
            newComicsIds.push(mangaId);
            newComicsArray.push(App.createPartialSourceManga({
                mangaId: mangaId,
                image: image,
                title: title,
                subtitle: latestChapter
            }));
        }
    });
    
    newComicsSection.items = newComicsArray
    sectionCallback(newComicsSection)
}
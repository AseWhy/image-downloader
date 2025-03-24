/** Интервал обновления */
const CONTENT_UDADTE_INTERVAL = 1000;

/** Набор уже загруженных файлов */
const DOWNLOADED = new Set();

/** SRC для загрузки с истечением срока давности */
const TIMEOUT_SRC = "https://timeout/timeout.png";

/**
 * Фильтр изображений
 * @param {string[]} images  исходный массив изображений
 * @param {Record<string, string>} options опции фильтрации
 * @returns отфильтрованный массив изображений
 */
const filterImages = async (images, options) => {
  let filterValue = options.filter_url;

  if (filterValue) {
    switch (options.filter_url_mode) {
      case 'normal':
        const terms = filterValue.split(/\s+/);
        images = images.filter((url) => {
          for (let index = 0; index < terms.length; index++) {
            let term = terms[index];
            if (term.length !== 0) {
              const expected = term[0] !== '-';
              if (!expected) {
                term = term.substr(1);
                if (term.length === 0) {
                  continue;
                }
              }
              const found = url.indexOf(term) !== -1;
              if (found !== expected) {
                return false;
              }
            }
          }
          return true;
        });
        break;
      case 'wildcard':
        filterValue = filterValue
          .replace(/([.^$[\]\\(){}|-])/g, '\\$1')
          .replace(/([?*+])/, '.$1');
      /* fall through */
      case 'regex':
        images = images.filter((url) => {
          try {
            return url.match(filterValue);
          } catch (error) {
            return false;
          }
        });
        break;
    }
  }

  images = await Promise.all(images.map(src => {
    const image = new Image();
    image.src = src;
    return new Promise(res => {
      function resImage() {
        clearTimeout(timeout);
        res(image.src === TIMEOUT_SRC ? null : image);
      }

      image.onload = resImage;
      image.onerror = resImage;
      image.onabort = resImage;
      image.oncancel = resImage;

      const timeout = setTimeout(() => image.src = TIMEOUT_SRC, 10000);
    });
  }))

  return images.filter((image) => {
    return (
      image != null &&
      (options.filter_min_width_enabled !== 'true' ||
          options.filter_min_width <= image.naturalWidth) &&
      (options.filter_max_width_enabled !== 'true' ||
          image.naturalWidth <= options.filter_max_width) &&
      (options.filter_min_height_enabled !== 'true' ||
          options.filter_min_height <= image.naturalHeight) &&
      (options.filter_max_height_enabled !== 'true' ||
          image.naturalHeight <= options.filter_max_height)
    );
  }).map(image => image.src);
}

// @ts-check
chrome.runtime.onInstalled.addListener(() => {
    // Признак текущей загрузки
    let currentInDownloading = false;

    setInterval(() => {
        if (localStorage.enable_auto_save !== "true")
          return;
        // Get images on the page
        chrome.windows.getCurrent((currentWindow) => {
            chrome.tabs.query(
            { active: true, windowId: currentWindow.id },
            (activeTabs) => {
                chrome.tabs.executeScript(activeTabs[0].id, {
                  file: '/src/Popup/sendImages.js',
                    allFrames: true,
                });
            }
            );
        });
    }, CONTENT_UDADTE_INTERVAL);

    chrome.runtime.onMessage.addListener(async (message) => {
        if (message.type !== "sendImages" || localStorage.enable_auto_save !== "true" || currentInDownloading) {
          return;
        }
        currentInDownloading = true;
        const imagesToDownload = [];
        try {
          const imagesToFilter = (localStorage.only_images_from_links === "true" ? message.linkedImages : message.allImages)
              .filter(url => !DOWNLOADED.has(url.replace(/\?.*$/, "")));
          for (const image of await filterImages(imagesToFilter, localStorage)) {
              imagesToDownload.push(image);
              DOWNLOADED.add(image.replace(/\?.*$/, ""));
          }
        } finally {
          currentInDownloading = false;
        }
        console.log(imagesToDownload);
        if (imagesToDownload.length > 0) {
          const { results: [ asyn, promise ] } = chrome.runtime.onMessage.dispatch({ type: 'downloadImages', imagesToDownload, options: {
            folder_name: localStorage.folder_name } });

          if (asyn) {
            await promise;
          }
        }
    });
});
/** @typedef {{ numberOfProcessedImages: number, imagesToDownload: string[], options: any, next: () => void }} Task */

/** @type {Set<Task>} */
const TASKS = new Set();

/** Задача по умолчанию */
const DEFAULT_TASK = { options: {}, imagesToDownload: [], numberOfProcessedImages: 0, next: () => {} };

// Constants
const CONTENT_UPDATE_INTERVAL = 1000;
const DOWNLOADED = new Set();

// Flag for tracking download status
let isCurrentlyDownloading = false;

// Use storage.local instead of localStorage in service worker
/**
 * Get data from storage
 * @param {string|string[]|null} [keys=null] - Keys to get from storage
 * @returns {Promise<Record<string, any>>} Storage data
 */
async function getStorageData(keys = null) {
  return chrome.storage.local.get(keys);
}

/**
 * Set data in storage
 * @param {Record<string, any>} items - Items to set in storage
 * @returns {Promise<void>}
 */
async function setStorageData(items) {
  return chrome.storage.local.set(items);
}

/**
 * Clear storage
 * @returns {Promise<void>}
 */
async function clearStorage() {
  return chrome.storage.local.clear();
}

/**
 * Initialize storage with default values if needed
 * @returns {Promise<void>}
 */
async function initializeStorage() {
  const data = await getStorageData();
  if (Object.keys(data).length === 0) {
    // Set default values if storage is empty
    await setStorageData({
      enable_auto_save: "false",
      only_images_from_links: "false",
      folder_name: "",
      new_file_name: ""
    });
  }
}

// Initialize storage when service worker starts
initializeStorage();

// Setup declarativeNetRequest rules for referrer modification
async function setupReferrerRules(origin) {
  try {
    // Remove any existing rules
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1]
    });

    if (!origin) {
      // If no origin is provided, just remove the rules
      return;
    }

    // Add rule to modify referrer header
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'Referer',
            operation: 'set',
            value: origin
          }]
        },
        condition: {
          resourceTypes: ['image', 'media', 'object'],
          initiatorDomains: [chrome.runtime.id]
        }
      }]
    });
    
    console.log('Referrer rules updated successfully');
  } catch (error) {
    console.error('Error setting up referrer rules:', error);
  }
}

// Handle installation and updates
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Open the options page after install
    chrome.tabs.create({ url: '/src/Options/index.html' });
  } else if (
    details.reason === 'update' &&
    /^(((0|1)\..*)|(2\.(0|1)(\..*)?))$/.test(details.previousVersion || '')
  ) {
    // Clear data from versions before 2.1 after update
    await clearStorage();
    await initializeStorage();
  }
  
  // Initialize referrer rules
  const data = await getStorageData(['active_tab_origin']);
  if (data.active_tab_origin) {
    await setupReferrerRules(data.active_tab_origin);
  }
});

// Store active tab origin for referrer modification
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId).then(tab => {
    if (tab && tab.url) {
      const url = new URL(tab.url);
      getStorageData().then(data => {
        setStorageData({ ...data, active_tab_origin: url.origin });
      });
    }
  }).catch(error => {
    console.error('Error getting tab info:', error);
  });
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'downloadImages') {
    downloadImages({
      numberOfProcessedImages: 0,
      imagesToDownload: message.imagesToDownload,
      options: message.options,
      next() {
        this.numberOfProcessedImages += 1;
        if (this.numberOfProcessedImages === this.imagesToDownload.length + 1) {
          TASKS.delete(this);
        }
      },
    }).then(sendResponse);
    return true; // Keeps the message channel open until `sendResponse` is called
  } else if (message.type === 'sendImages') {
    handleSendImages(message).catch(error => {
      console.error('Error handling sendImages:', error);
    });
  } else if (message.type === 'setActiveTabOrigin') {
    getStorageData().then(data => {
      setStorageData({ ...data, active_tab_origin: message.origin });
      // Update referrer rules with the new origin
      setupReferrerRules(message.origin).catch(error => {
        console.error('Error updating referrer rules:', error);
      });
    }).catch(error => {
      console.error('Error setting active tab origin:', error);
    });
  }
});

/**
 * Запускает загрузку изображения
 * @param {string} image    ссылка на изображение
 * @param {string | undefined} filename имя файла
 * @returns идентификатор загрузки
 */
function download(image, filename) {
  return new Promise((res) => chrome.downloads.download({ url: image, filename }, res));
}

/**
 * Выполняет загрузку изображений в задаче
 * @param {Task} task задача загрузки
 */
async function downloadImages(task) {
  const downloaded = [];

  TASKS.add(task);

  for (const image of task.imagesToDownload) {
    const downloadId = await download(image, undefined);

    if (downloadId == null) {
      if (chrome.runtime.lastError) {
        console.error(`${image}:`, chrome.runtime.lastError.message);
      }

      task.next();
    }
    if (!image.includes(";base64")) {
      const [ , filename ] = /[^\\]+\/([^\/?]+)/gm.exec(image) ?? [ 'unknown' ];
      downloaded.push(`"${filename}";"${image}";`);
    }
  }

  // Загружаем csv файл
  await download(`data:text/csv;charset=UTF-8,${encodeURIComponent(downloaded.join("\n"))}`, Date.now() + ".csv");
}

// https://developer.chrome.com/docs/extensions/reference/downloads/#event-onDeterminingFilename
chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
  const task = [...TASKS][0];

  if (task) {
    let newFilename = '';

    if (task.options.folder_name) {
      newFilename += `${task.options.folder_name}/`;
    }

    if (task.options.new_file_name) {
      const extension = /(?:\.([^.]+))?$/.exec(item.filename)?.[1];
      const numberOfDigits = task.imagesToDownload.length.toString().length;
      const formattedImageNumber = `${task.numberOfProcessedImages + 1}`.padStart(
        numberOfDigits,
        '0'
      );
      newFilename += `${task.options.new_file_name}${formattedImageNumber}.${extension}`;
    } else {
      newFilename += item.filename === 'Без названия.csv' ? `${Date.now()}.csv` : item.filename;
    }

    suggest({ filename: normalizeSlashes(newFilename) });

    task.next();
  } else {
    suggest();
  }
});

function normalizeSlashes(filename) {
  return filename.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

/**
 * Фильтр изображений
 * @param {string[]} images  исходный массив изображений
 * @param {Record<string, string>} options опции фильтрации
 * @returns {Promise<string[]>} отфильтрованный массив изображений
 */
async function filterImages(images, options) {
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

  // In a service worker, we can't use the Image object directly
  // We'll skip the image dimension filtering in the service worker
  // and just return the filtered URLs
  return images;
}

/**
 * Setup auto-save functionality
 */
function setupAutoSave() {
  // Check if auto-save is enabled
  getStorageData()
    .then(data => {
      if (data.enable_auto_save !== "true") {
        return;
      }

      // Get active tab
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(tabs => {
          if (tabs.length === 0 || !tabs[0].id) {
            return;
          }

          // Execute content script to get images
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['/src/Popup/sendImages.js']
          }).catch(error => {
            console.error('Error executing script:', error);
          });
        }).catch(error => {
          console.error('Error querying tabs:', error);
        });
    })
    .catch(error => {
      console.error('Error getting storage data:', error);
    })
    .finally(() => {
      // Schedule next check
      setTimeout(setupAutoSave, CONTENT_UPDATE_INTERVAL);
    });
}

// Start auto-save functionality
setTimeout(setupAutoSave, 1000);

/**
 * Handle sendImages message
 * @param {any} message - Message from content script
 * @returns {Promise<void>}
 */
async function handleSendImages(message) {
  const data = await getStorageData();
  if (data.enable_auto_save !== "true") {
    return;
  }

  if (isCurrentlyDownloading) {
    return;
  }

  isCurrentlyDownloading = true;
  const imagesToDownload = [];
  try {
    const imagesToFilter = (data.only_images_from_links === "true" ? message.linkedImages : message.allImages)
        .filter(url => !DOWNLOADED.has(url.replace(/\?.*$/, "")));
    
    const filteredImages = await filterImages(imagesToFilter, data);
    for (const image of filteredImages) {
        imagesToDownload.push(image);
        DOWNLOADED.add(image.replace(/\?.*$/, ""));
    }
  } finally {
    isCurrentlyDownloading = false;
  }

  console.log(imagesToDownload);
  if (imagesToDownload.length > 0) {
    await downloadImages({
      numberOfProcessedImages: 0,
      imagesToDownload,
      options: {
        folder_name: data.folder_name || ""
      },
      next() {
        this.numberOfProcessedImages += 1;
        if (this.numberOfProcessedImages === imagesToDownload.length + 1) {
          TASKS.delete(this);
        }
      }
    });
  }
}

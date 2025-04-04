// @ts-check
/** @typedef {{ numberOfProcessedImages: number, imagesToDownload: string[], options: any, next: () => void }} Task */

/** @type {Set<Task>} */
const tasks = new Set();

/** Задача по умолчанию */
const DEFAULT_TASK = { options: localStorage, imagesToDownload: [], numberOfProcessedImages: 0, next: () => {} };

chrome.runtime.onMessage.addListener(startDownload);
chrome.downloads.onDeterminingFilename.addListener(suggestNewFilename);

/**
 * Запускает загрузку
 * @param {any} message 
 * @param {chrome.runtime.MessageSender} sender 
 * @param {(response?: any) => void} resolve 
 */
function startDownload(message, sender, resolve) {
  if (!(message && message.type === 'downloadImages')) return;

  downloadImages({
    numberOfProcessedImages: 0,
    imagesToDownload: message.imagesToDownload,
    options: message.options,
    next() {
      this.numberOfProcessedImages += 1;
      if (this.numberOfProcessedImages === this.imagesToDownload.length + 1) {
        tasks.delete(this);
      }
    },
  }).then(resolve);

  return true; // Keeps the message channel open until `resolve` is called
}

/**
 * Запускает загрузку изображения
 * @param {string} image    ссылка на изображение
 * @param {string | undefined} filename имя файла
 * @returns идентификатор загрузки
 */
function downalod(image, filename) {
  return new Promise((res) => chrome.downloads.download({ url: image, filename }, res));
}

/**
 * Выполняет загрузку изображений в задаче
 * @param {Task} task задача загрузки
 */
async function downloadImages(task) {
  const downloaded = [];

  tasks.add(task);

  for (const image of task.imagesToDownload) {
    const downloadId = await downalod(image, undefined);

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
  await downalod(`data:text/csv;charset=UTF-8,${encodeURIComponent(downloaded.join("\n"))}`, Date.now() + ".csv");
}

// https://developer.chrome.com/docs/extensions/reference/downloads/#event-onDeterminingFilename
/** @type {Parameters<chrome.downloads.DownloadDeterminingFilenameEvent['addListener']>[0]} */
function suggestNewFilename(item, suggest) {
  const task = [...tasks][0];

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
}

function normalizeSlashes(filename) {
  return filename.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

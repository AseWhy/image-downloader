// Default values for extension options

const defaults = {
  // Filters
  folder_name: '',
  new_file_name: '',
  filter_url: '',
  filter_url_mode: 'normal',
  filter_min_width: 0,
  filter_min_width_enabled: 'false',
  filter_max_width: 3000,
  filter_max_width_enabled: 'false',
  filter_min_height: 0,
  filter_min_height_enabled: 'false',
  filter_max_height: 3000,
  filter_max_height_enabled: 'false',
  only_images_from_links: 'false',
  show_advanced_filters: 'true',
  enable_auto_save: 'false',
  // Options
  // General
  show_download_confirmation: 'true',
  show_file_renaming: 'true',
  // Images
  show_image_url: 'true',
  show_open_image_button: 'true',
  show_download_image_button: 'true',
  columns: 2,
  image_min_width: 50,
  image_max_width: 200,
};

// Initialize storage with default values
chrome.storage.local.get(null).then(data => {
  const updates = {};
  const defaultUpdates = {};
  
  // For each default option
  Object.keys(defaults).forEach(option => {
    // If the option doesn't exist in storage, add it with the default value
    if (data[option] === undefined) {
      updates[option] = defaults[option];
    }
    
    // Always store the default value with _default suffix
    defaultUpdates[`${option}_default`] = defaults[option];
  });
  
  // Update storage with any missing options
  if (Object.keys(updates).length > 0) {
    chrome.storage.local.set(updates);
  }
  
  // Update storage with default values
  chrome.storage.local.set(defaultUpdates);
});

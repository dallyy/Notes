export const state = {
  notes: [],
  currentNoteId: null,
  settings: {
    background_image: null, blur: 0, transparency: 1.0, theme: "cyan",
    brightness: 1.0, mode: "light",
  },
  isPreview: false,
  saveTimer: null,
  saving: false,
  lastSavedTitle: "",
  lastSavedContent: "",
  searchQuery: "",
  folders: [],
  noteFolder: {},
  expandedFolders: {},
};

export const THEME_COLORS = {
  cyan:    { c1: "#22d3ee", c2: "#06b6d4", cursor: "#dd2c11" },
  emerald: { c1: "#34d399", c2: "#10b981", cursor: "#cb2c66" },
  violet:  { c1: "#a78bfa", c2: "#8b5cf6", cursor: "#587405" },
  rose:    { c1: "#fb7185", c2: "#f43f5e", cursor: "#048e7a" },
  amber:   { c1: "#fbbf24", c2: "#f59e0b", cursor: "#0440db" },
};

export const BRIGHTNESS_KEY = "notes-bg-brightness";
export const MODE_KEY = "notes-mode";
export const FOLDERS_KEY = "notes-folders";
export const EXPANDED_KEY = "notes-folders-expanded";

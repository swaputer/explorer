export const DOCS_URL = import.meta.env.VITE_DOCS_URL
  || (import.meta.env.DEV ? "http://127.0.0.1:4177/" : "https://docs.swaputer.com");

export const STUDIO_URL = import.meta.env.VITE_STUDIO_URL
  || (import.meta.env.DEV ? "http://127.0.0.1:4176/" : "https://studio.swaputer.com");

export const GITHUB_URL = "https://github.com/swaputer";

export function normalizeNewsItem(raw) {
  return {
    title: typeof raw.title === "string" ? raw.title : raw.title?.["#text"] || "",
    link: typeof raw.link === "string" ? raw.link : raw.link?.["#text"] || "",
    pubDate: raw.pubDate || null,
    description: typeof raw.description === "string" ? raw.description : raw.description?.["#text"] || "",
  };
}

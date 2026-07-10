import { XMLParser } from "fast-xml-parser";

const FEED_URL = "https://feeds.bbci.co.uk/sport/football/rss.xml";
const parser = new XMLParser({ ignoreAttributes: false });

export async function fetchNewsFeed() {
  const res = await fetch(FEED_URL);
  if (!res.ok) {
    throw new Error(`BBC RSS ${res.status}`);
  }
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item || [];
  return Array.isArray(items) ? items : [items];
}

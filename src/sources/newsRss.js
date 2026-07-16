import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false });

// 해외 소식은 BBC(영문), 국내는 이적/영입 보도가 빠른 스포츠동아 축구 섹션을 함께 쓴다.
// 사용자 다수가 국내(한국어) 독자라 국내 영입 기사가 뉴스 탭에 바로 보이는 게 중요하다.
export const NEWS_FEEDS = [
  { source: "bbc", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  // https(TLS)가 아니라 http로만 응답하는 피드라 그대로 http로 요청한다.
  { source: "donga", url: "http://rss.donga.com/sportsdonga/soccer.xml" },
];

export async function fetchNewsFeed(feedUrl) {
  const res = await fetch(feedUrl);
  if (!res.ok) {
    throw new Error(`RSS fetch failed (${feedUrl}): ${res.status}`);
  }
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item || [];
  return Array.isArray(items) ? items : [items];
}

// 피드 하나가 죽어도(개편/일시 장애 등) 나머지 소스는 정상적으로 뉴스를 보여줘야 하므로
// 소스별로 개별 try/catch 후 성공한 것만 모은다.
export async function fetchAllNewsFeeds() {
  const results = await Promise.all(
    NEWS_FEEDS.map(async ({ source, url }) => {
      try {
        const items = await fetchNewsFeed(url);
        return items.map((item) => ({ item, source }));
      } catch (err) {
        console.error(`news feed fetch failed (${source}):`, err);
        return [];
      }
    })
  );
  return results.flat();
}

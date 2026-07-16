// description에 섞여 들어오는 이미지 태그 등 HTML을 걷어내 목록 카드에 순수 텍스트만 보이게 한다.
function stripHtml(text) {
  return text.replace(/<[^>]*>/g, "").trim();
}

// BBC는 media:thumbnail(작은 240px 썸네일)을 따로 주는데, ichef 이미지 서버가 경로의 너비 숫자를
// 그대로 리사이즈 키로 쓰므로 카드 그리드에 덜 흐릿하게 보이도록 480px로 올려서 쓴다.
function extractBbcImage(raw) {
  const url = raw["media:thumbnail"]?.["@_url"];
  return url ? url.replace(/\/standard\/\d+\//, "/standard/480/") : null;
}

// 동아 피드는 별도 이미지 필드 없이 description 안에 <img src="...">로 섞어서 준다.
function extractDongaImage(description) {
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(description);
  return match ? match[1] : null;
}

export function normalizeNewsItem({ item: raw, source }) {
  const rawDescription = typeof raw.description === "string" ? raw.description : raw.description?.["#text"] || "";
  const image = source === "bbc" ? extractBbcImage(raw) : extractDongaImage(rawDescription);
  return {
    title: typeof raw.title === "string" ? raw.title : raw.title?.["#text"] || "",
    link: typeof raw.link === "string" ? raw.link : raw.link?.["#text"] || "",
    pubDate: raw.pubDate || null,
    description: stripHtml(rawDescription),
    image,
    source: source || "bbc",
  };
}

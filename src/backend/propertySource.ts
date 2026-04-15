import {
  ALL_RUNTIME_FACETS,
  FACET_POLICIES,
  type RuntimeFacet,
} from "./facets.js";
import type {
  LiveReviewSample,
  PropertyFacetEvidence,
  PropertyFacetLiveSignal,
  PropertySourceVendor,
} from "./types.js";
import type { FacetClassifierArtifact } from "./ml.js";
import { predictFacetMentions } from "./ml.js";

type FetchLike = typeof fetch;

export interface FirecrawlScrapeResult {
  markdown?: string;
  html?: string;
  metadata?: {
    title?: string;
    description?: string;
    language?: string;
    [key: string]: unknown;
  };
}

export interface ExpediaReviewSnippet {
  headline?: string;
  text: string;
  rating?: number;
  reviewDate?: string;
  reviewerType?: string;
}

export interface ReviewSnippet {
  headline?: string;
  text: string;
  reviewDate?: string;
}

export interface ExpediaSnapshot {
  sourceVendor: PropertySourceVendor;
  sourceUrl: string;
  propertySummary?: string;
  popularAmenities?: string;
  city?: string;
  province?: string;
  country?: string;
  guestRating?: number;
  facetListingTexts: Partial<Record<RuntimeFacet, string>>;
  reviews: ExpediaReviewSnippet[];
}

export interface PropertySourceProvider {
  readonly vendor: PropertySourceVendor;
  normalizeUrl(url: string): string;
  scrapeProperty(url: string): Promise<FirecrawlScrapeResult>;
}

const EXPEDIA_HOST_SUFFIXES = [
  "expedia.com",
  "www.expedia.com",
];

const MONTH_NAMES =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

const SECTION_STOP_WORDS = [
  "room options",
  "choose your room",
  "about the area",
  "policies",
  "important information",
  "property amenities",
  "nearby attractions",
];

const FACET_KEYWORDS: Record<RuntimeFacet, string[]> = {
  check_in: ["check-in", "check in", "front desk", "late arrival", "self check"],
  check_out: ["check-out", "check out", "late checkout", "depart"],
  amenities_breakfast: ["breakfast", "buffet", "continental", "coffee"],
  amenities_parking: ["parking", "garage", "valet", "self parking"],
  know_before_you_go: ["know before you go", "important information", "deposit", "fee", "restriction"],
  amenities_pool: ["pool", "hot tub", "jacuzzi", "swim"],
  pet: ["pet", "dog", "cat", "animal"],
  children_extra_bed: ["children", "extra bed", "crib", "rollaway"],
  amenities_wifi: ["wifi", "wi-fi", "internet"],
  amenities_gym: ["gym", "fitness", "workout"],
};

const FACET_CONFLICT_PATTERNS: Record<RuntimeFacet, RegExp[]> = {
  check_in: compilePatterns(["\\bwait", "\\bline\\b", "not ready", "delay", "problem"]),
  check_out: compilePatterns(["charge", "fee", "delay", "problem", "denied late checkout"]),
  amenities_breakfast: compilePatterns(["closed", "ran out", "limited", "fee", "charge", "no breakfast"]),
  amenities_parking: compilePatterns(["fee", "charge", "tight", "full", "difficult", "no parking"]),
  know_before_you_go: compilePatterns(["unexpected", "fee", "deposit", "construction", "noise", "restriction"]),
  amenities_pool: compilePatterns(["closed", "dirty", "crowded", "unusable", "limited hours"]),
  pet: compilePatterns(["fee", "charge", "restriction"]),
  children_extra_bed: compilePatterns(["not available", "fee", "charge"]),
  amenities_wifi: compilePatterns(["slow", "broken", "did not work", "spotty"]),
  amenities_gym: compilePatterns(["closed", "broken", "small", "limited"]),
};

export class FirecrawlExpediaSourceProvider implements PropertySourceProvider {
  readonly vendor = "expedia" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  normalizeUrl(url: string): string {
    return normalizeExpediaPropertyUrl(url);
  }

  async scrapeProperty(url: string): Promise<FirecrawlScrapeResult> {
    return scrapeExpediaPage(this.apiKey, this.normalizeUrl(url), this.fetchImpl);
  }
}

export function normalizeExpediaPropertyUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a full Expedia hotel URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isExpediaHost = EXPEDIA_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (!isExpediaHost) {
    throw new Error("Only Expedia hotel URLs are supported.");
  }
  if (!/hotel\./i.test(parsed.pathname) && !/Hotel-Information/i.test(parsed.pathname)) {
    throw new Error("Paste an Expedia hotel page URL, not a search results page.");
  }

  parsed.hash = "";
  parsed.searchParams.delete("chkin");
  parsed.searchParams.delete("chkout");
  parsed.searchParams.delete("x_pwa");
  return parsed.toString();
}

export async function scrapeExpediaPage(
  apiKey: string,
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<FirecrawlScrapeResult> {
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY.");
  }

  const attempts = [
    { onlyMainContent: true },
    { onlyMainContent: false },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    const response = await fetchImpl("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: attempt.onlyMainContent,
      }),
    });

    if (!response.ok) {
      lastError = new Error(`Firecrawl scrape failed with ${response.status}.`);
      continue;
    }

    const payload = (await response.json()) as {
      success?: boolean;
      data?: FirecrawlScrapeResult;
    };
    if (payload.success && payload.data) {
      return payload.data;
    }
    lastError = new Error("Firecrawl did not return scrape data.");
  }

  throw lastError ?? new Error("Firecrawl scrape failed.");
}

export function extractExpediaSnapshot(
  scrape: FirecrawlScrapeResult,
  sourceUrl: string,
): ExpediaSnapshot {
  const markdown = sanitizeMarkdown(scrape.markdown ?? stripHtml(scrape.html ?? ""));
  const metadataTitle = cleanInlineText(scrape.metadata?.title);
  const metadataDescription = cleanInlineText(scrape.metadata?.description);
  const location = parseLocation([metadataTitle, metadataDescription, markdown]);
  const facetListingTexts = Object.fromEntries(
    ALL_RUNTIME_FACETS.map((facet) => [
      facet,
      extractFacetListingText(markdown, FACET_KEYWORDS[facet]),
    ]).filter((entry): entry is [RuntimeFacet, string] => Boolean(entry[1])),
  ) as Partial<Record<RuntimeFacet, string>>;
  const reviews = extractReviewSnippets(markdown);

  return {
    sourceVendor: "expedia",
    sourceUrl,
    propertySummary:
      metadataDescription ??
      firstMeaningfulParagraph(markdown) ??
      undefined,
    popularAmenities: extractAmenities(markdown),
    city: location?.city,
    province: location?.province,
    country: location?.country,
    guestRating: extractGuestRating(`${metadataTitle ?? ""}\n${metadataDescription ?? ""}\n${markdown}`),
    facetListingTexts,
    reviews,
  };
}

export function deriveLiveFacetSignals(
  propertyId: string,
  snapshot: ExpediaSnapshot,
  classifierArtifact: FacetClassifierArtifact | undefined,
  fetchedAt: string,
): PropertyFacetLiveSignal[] {
  return deriveLiveFacetSignalsFromReviewSnippets(
    propertyId,
    snapshot.facetListingTexts,
    snapshot.reviews,
    classifierArtifact,
    fetchedAt,
  );
}

export function deriveLiveFacetSignalsFromReviewSnippets(
  propertyId: string,
  facetListingTexts: Partial<Record<RuntimeFacet, string>>,
  reviews: ReviewSnippet[],
  classifierArtifact: FacetClassifierArtifact | undefined,
  fetchedAt: string,
): PropertyFacetLiveSignal[] {
  return ALL_RUNTIME_FACETS.map((facet) => {
    const supportingReviews = reviews.filter((review) =>
      reviewMentionsFacet(review.text, facet, classifierArtifact),
    );
    const conflictingReviews = supportingReviews.filter((review) =>
      FACET_CONFLICT_PATTERNS[facet].some((pattern) => pattern.test(review.text.toLowerCase())),
    );
    const latestReviewDate = latestDate(
      supportingReviews.map((review) => review.reviewDate).filter(Boolean) as string[],
    );
    return {
      propertyId,
      facet,
      mentionRate: roundRate(supportingReviews.length / Math.max(1, reviews.length)),
      conflictScore: facetListingTexts[facet]
        ? roundRate(conflictingReviews.length / Math.max(1, reviews.length))
        : 0,
      latestReviewDate,
      daysSince: latestReviewDate ? daysSinceIsoDate(latestReviewDate, fetchedAt) : 9999,
      listingTextPresent: Boolean(facetListingTexts[facet]),
      reviewCountSampled: reviews.length,
      supportSnippetCount: supportingReviews.length,
      fetchedAt,
    };
  });
}

export function buildExpediaFacetEvidence(
  propertyId: string,
  snapshot: ExpediaSnapshot,
  classifierArtifact: FacetClassifierArtifact | undefined,
): Record<RuntimeFacet, PropertyFacetEvidence[]> {
  const evidence = buildFacetEvidenceFromReviewSnippets(
    propertyId,
    "expedia_review",
    snapshot.reviews,
    classifierArtifact,
  );

  for (const facet of ALL_RUNTIME_FACETS) {
    const listingText = snapshot.facetListingTexts[facet];
    if (listingText) {
      evidence[facet].unshift({
        propertyId,
        facet,
        sourceType: "expedia_listing",
        snippet: truncateSnippet(listingText),
        evidenceScore: 0.82,
      });
    }
  }

  return evidence;
}

export function buildFacetEvidenceFromReviewSnippets(
  propertyId: string,
  sourceType: "expedia_review" | "first_party_review",
  reviews: ReviewSnippet[],
  classifierArtifact: FacetClassifierArtifact | undefined,
): Record<RuntimeFacet, PropertyFacetEvidence[]> {
  const evidence = Object.fromEntries(
    ALL_RUNTIME_FACETS.map((facet) => [facet, [] as PropertyFacetEvidence[]]),
  ) as Record<RuntimeFacet, PropertyFacetEvidence[]>;

  for (const facet of ALL_RUNTIME_FACETS) {
    const supportingReviews = reviews
      .filter((review) => reviewMentionsFacet(review.text, facet, classifierArtifact))
      .slice(0, 2);
    for (const review of supportingReviews) {
      evidence[facet].push({
        propertyId,
        facet,
        sourceType,
        snippet: truncateSnippet(
          [review.reviewDate, review.headline, review.text].filter(Boolean).join(" — "),
        ),
        acquisitionDate: review.reviewDate,
        evidenceScore: FACET_CONFLICT_PATTERNS[facet].some((pattern) =>
          pattern.test(review.text.toLowerCase()),
        )
          ? 0.92
          : 0.74,
      });
    }
  }

  return evidence;
}

export function buildLiveReviewSamples(
  propertyId: string,
  sourceUrl: string,
  reviews: ExpediaReviewSnippet[],
  fetchedAt: string,
): LiveReviewSample[] {
  return reviews.map((review) => ({
    propertyId,
    sourceVendor: "expedia",
    sourceUrl,
    reviewIdHash: stableReviewHash(
      [review.headline ?? "", review.text, review.reviewDate ?? ""].join("|"),
    ),
    headline: review.headline,
    text: review.text,
    rating: review.rating,
    reviewDate: review.reviewDate,
    reviewerType: review.reviewerType,
    fetchedAt,
  }));
}

export function buildFirstPartyLiveReviewSample(args: {
  propertyId: string;
  tokenIdentifier: string;
  sessionId: string;
  text: string;
  reviewDate: string;
}): LiveReviewSample {
  return {
    propertyId: args.propertyId,
    sourceVendor: "first_party",
    reviewIdHash: stableReviewHash(
      ["first_party", args.propertyId, args.tokenIdentifier].join("|"),
    ),
    text: args.text,
    reviewDate: args.reviewDate,
    tokenIdentifier: args.tokenIdentifier,
    sessionId: args.sessionId,
    fetchedAt: args.reviewDate,
  };
}

function extractAmenities(markdown: string): string | undefined {
  const section = sliceSection(markdown, ["popular amenities", "amenities"]);
  if (!section) {
    return undefined;
  }
  const lines = normalizeLines(section)
    .filter((line) => /^(free|pool|parking|wifi|breakfast|gym|pet|spa|restaurant|bar)/i.test(line))
    .slice(0, 6);
  return lines.length > 0 ? lines.join(", ") : undefined;
}

function extractFacetListingText(markdown: string, keywords: string[]): string | undefined {
  const lines = normalizeLines(markdown)
    .filter((line) =>
      keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase())),
    )
    .slice(0, 3);
  return lines.length > 0 ? lines.join(" | ") : undefined;
}

function extractReviewSnippets(markdown: string): ExpediaReviewSnippet[] {
  const section = sliceSection(markdown, ["guest reviews", "reviews"]) ?? markdown;
  const blocks = section
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const reviews: ExpediaReviewSnippet[] = [];

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.replace(/^[>*#\-\s]+/, "").trim())
      .filter(Boolean);
    const cleaned = lines.join(" ").trim();
    if (cleaned.length < 30) {
      continue;
    }
    const textCandidates = lines.filter((line) => !isReviewMetaLine(line));
    const text = textCandidates.join(" ").trim();
    if (text.length < 25) {
      continue;
    }
    const rating = parseRating(cleaned);
    const reviewDate = extractReviewDate(cleaned);
    const reviewerType = extractReviewerType(cleaned);
    if (!rating && !reviewDate && !reviewerType && !/\breview\b/i.test(cleaned)) {
      continue;
    }
    const headline = textCandidates.find((line) => line.length <= 80 && line.length >= 6);
    reviews.push({
      headline,
      text: text === headline ? text : text.replace(`${headline ?? ""} `, "").trim(),
      rating,
      reviewDate,
      reviewerType,
    });
  }

  return dedupeReviews(reviews).slice(0, 12);
}

function parseLocation(
  sources: Array<string | undefined>,
): { city?: string; province?: string; country?: string } | null {
  const lines = sources
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => cleanInlineText(line))
    .filter((line): line is string => Boolean(line));

  for (const line of lines) {
    const threePart = line.match(
      /\b([A-Z][A-Za-z .'-]+),\s*([A-Z][A-Za-z .'-]+),\s*(United States|USA|US|Canada|Mexico)\b/,
    );
    if (threePart) {
      return {
        city: cleanInlineText(threePart[1]),
        province: cleanInlineText(threePart[2]),
        country: normalizeCountry(threePart[3]),
      };
    }
  }

  for (const line of lines) {
    const twoPart = line.match(/\b([A-Z][A-Za-z .'-]+),\s*([A-Z][A-Za-z .'-]+)\b/);
    if (!twoPart) {
      continue;
    }
    const city = cleanInlineText(twoPart[1]);
    const province = cleanInlineText(twoPart[2]);
    if (!city || !province) {
      continue;
    }
    if (/hotel|expedia/i.test(city) || /hotel|expedia/i.test(province)) {
      continue;
    }
    return {
      city,
      province,
      country: "United States",
    };
  }

  return null;
}

function extractGuestRating(text: string): number | undefined {
  const match = text.match(/\b([0-9](?:\.[0-9])?)\s*(?:out of|\/)\s*10\b/i);
  if (!match) {
    return undefined;
  }
  return Number(match[1]);
}

function firstMeaningfulParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n{2,}/)
    .map((block) => cleanBlock(block))
    .find(
      (block) =>
        block.length >= 40 &&
        !block.startsWith("#") &&
        !/^(guest reviews|popular amenities|amenities|overview)$/i.test(block),
    );
}

function sliceSection(markdown: string, headings: string[]): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const lowerHeadings = headings.map((heading) => heading.toLowerCase());
  let start = -1;
  let end = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim().toLowerCase();
    if (start === -1 && lowerHeadings.some((heading) => line.includes(heading))) {
      start = index;
      continue;
    }
    if (
      start !== -1 &&
      line.startsWith("#") &&
      SECTION_STOP_WORDS.some((stop) => line.includes(stop))
    ) {
      end = index;
      break;
    }
  }

  if (start === -1) {
    return undefined;
  }
  return lines.slice(start, end).join("\n");
}

function reviewMentionsFacet(
  text: string,
  facet: RuntimeFacet,
  classifierArtifact: FacetClassifierArtifact | undefined,
): boolean {
  if (classifierArtifact) {
    const prediction = predictFacetMentions(classifierArtifact, text);
    const probability = prediction.mentionProbabilities[facet];
    const model = classifierArtifact.models.find((entry) => entry.facet === facet);
    if (probability !== undefined && model && probability >= model.threshold) {
      return true;
    }
  }
  return FACET_POLICIES[facet].reviewPatterns.some((pattern) => pattern.test(text));
}

function latestDate(values: string[]): string | undefined {
  return values
    .map((value) => ({ original: value, parsed: Date.parse(value) }))
    .filter((value) => Number.isFinite(value.parsed))
    .sort((left, right) => right.parsed - left.parsed)[0]?.original;
}

function daysSinceIsoDate(date: string, nowIso: string): number {
  const now = new Date(nowIso).getTime();
  const then = new Date(date).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(then)) {
    return 9999;
  }
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

function extractReviewDate(text: string): string | undefined {
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return isoMatch[1];
  }
  const monthMatch = text.match(
    new RegExp(`\\b(${MONTH_NAMES})\\s+\\d{1,2},\\s+20\\d{2}\\b`, "i"),
  );
  if (!monthMatch) {
    return undefined;
  }
  const parsed = new Date(monthMatch[0]);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString().slice(0, 10);
}

function extractReviewerType(text: string): string | undefined {
  const match = text.match(/\b(family|couple|business|solo|friends?)\s+traveler\b/i);
  return match?.[0]?.toLowerCase();
}

function parseRating(text: string): number | undefined {
  const match = text.match(/\b([0-9](?:\.[0-9])?)\s*\/\s*10\b/);
  return match ? Number(match[1]) : undefined;
}

function isReviewMetaLine(line: string): boolean {
  return (
    /^#+\s*/.test(line) ||
    /\b([0-9](?:\.[0-9])?)\s*\/\s*10\b/.test(line) ||
    /\b(20\d{2}-\d{2}-\d{2})\b/.test(line) ||
    new RegExp(`\\b(${MONTH_NAMES})\\s+\\d{1,2},\\s+20\\d{2}\\b`, "i").test(line) ||
    /\btraveler\b/i.test(line)
  );
}

function sanitizeMarkdown(markdown: string): string {
  return markdown.replace(/\r/g, "").trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanBlock(block: string): string {
  return block
    .replace(/^[>*#\-\s]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanInlineText(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function normalizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => cleanInlineText(line))
    .filter((line): line is string => Boolean(line));
}

function dedupeReviews(reviews: ExpediaReviewSnippet[]): ExpediaReviewSnippet[] {
  const seen = new Set<string>();
  return reviews.filter((review) => {
    const key = `${review.headline ?? ""}|${review.text}|${review.reviewDate ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function truncateSnippet(text: string): string {
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function normalizeCountry(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (/^(usa|us)$/i.test(value)) {
    return "United States";
  }
  return cleanInlineText(value);
}

function roundRate(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function stableReviewHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `rv_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "i"));
}

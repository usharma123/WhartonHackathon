import type { ReviewGapStore } from "./store.js";
import type {
  PropertyEvidenceUpdate,
  PropertyFacetEvidence,
  PropertyFacetMetric,
  PropertyRecord,
  StoredFollowUpAnswer,
  StoredFollowUpQuestion,
  StoredReviewSession,
} from "./types.js";

type ConvexDb = any;

export function createConvexStore(db: ConvexDb): ReviewGapStore {
  return {
    now: () => new Date().toISOString(),

    async getProperty(propertyId) {
      const doc = await db
        .query("properties")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .unique();
      return doc ? mapProperty(doc) : null;
    },

    async upsertProperty(property) {
      const existing = await db
        .query("properties")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", property.propertyId))
        .unique();
      const payload = propertyToDoc(property);
      if (existing) {
        await db.patch(existing._id, payload);
        return;
      }
      await db.insert("properties", payload);
    },

    async listPropertyFacetMetrics(propertyId) {
      const docs = await db
        .query("propertyFacetMetrics")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      return docs.map(mapMetric);
    },

    async upsertPropertyFacetMetric(metric) {
      const existing = await db
        .query("propertyFacetMetrics")
        .withIndex("by_property_id_facet", (q: any) =>
          q.eq("propertyId", metric.propertyId).eq("facet", metric.facet),
        )
        .unique();
      if (existing) {
        await db.patch(existing._id, metric);
        return;
      }
      await db.insert("propertyFacetMetrics", metric);
    },

    async listPropertyFacetEvidence(propertyId, facet) {
      const docs = facet
        ? await db
            .query("propertyFacetEvidence")
            .withIndex("by_property_id_facet", (q: any) =>
              q.eq("propertyId", propertyId).eq("facet", facet),
            )
            .collect()
        : await db
            .query("propertyFacetEvidence")
            .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
            .collect();
      return docs
        .map(mapEvidence)
        .sort(
          (left: PropertyFacetEvidence, right: PropertyFacetEvidence) =>
            (right.evidenceScore ?? 0) - (left.evidenceScore ?? 0),
        );
    },

    async replacePropertyFacetEvidence(propertyId, facet, evidence) {
      const existing = await db
        .query("propertyFacetEvidence")
        .withIndex("by_property_id_facet", (q: any) =>
          q.eq("propertyId", propertyId).eq("facet", facet),
        )
        .collect();
      for (const row of existing) {
        await db.delete(row._id);
      }
      for (const item of evidence) {
        await db.insert("propertyFacetEvidence", item);
      }
    },

    async createReviewSession(session) {
      const id = await db.insert("reviewSessions", sessionDoc(session));
      return { ...session, id: String(id) };
    },

    async getReviewSession(sessionId) {
      const doc = await db.get(sessionId);
      return doc ? mapSession(doc) : null;
    },

    async updateReviewSession(sessionId, patch) {
      await db.patch(sessionId, sessionPatchDoc(patch));
      const doc = await db.get(sessionId);
      if (!doc) {
        throw new Error(`Missing review session ${sessionId}`);
      }
      return mapSession(doc);
    },

    async createFollowUpQuestion(question) {
      const id = await db.insert("followUpQuestions", questionDoc(question));
      return { ...question, id: String(id) };
    },

    async getLatestFollowUpQuestion(sessionId) {
      const docs = await db
        .query("followUpQuestions")
        .withIndex("by_session_id", (q: any) => q.eq("sessionId", sessionId))
        .collect();
      const doc = docs.sort((left: any, right: any) =>
        String(right.createdAt).localeCompare(String(left.createdAt)),
      )[0];
      return doc ? mapQuestion(doc) : null;
    },

    async createFollowUpAnswer(answer) {
      const id = await db.insert("followUpAnswers", answerDoc(answer));
      return { ...answer, id: String(id) };
    },

    async getLatestFollowUpAnswer(sessionId) {
      const docs = await db
        .query("followUpAnswers")
        .withIndex("by_session_id", (q: any) => q.eq("sessionId", sessionId))
        .collect();
      const doc = docs.sort((left: any, right: any) =>
        String(right.createdAt).localeCompare(String(left.createdAt)),
      )[0];
      return doc ? mapAnswer(doc) : null;
    },

    async appendPropertyEvidenceUpdates(updates) {
      const stored: PropertyEvidenceUpdate[] = [];
      for (const update of updates) {
        const id = await db.insert("propertyEvidenceUpdates", updateDoc(update));
        stored.push({ ...update, id: String(id) });
      }
      return stored;
    },

    async listPropertyEvidenceUpdatesBySession(sessionId) {
      const docs = await db
        .query("propertyEvidenceUpdates")
        .withIndex("by_source_session_id", (q: any) => q.eq("sourceSessionId", sessionId))
        .collect();
      return docs
        .map(mapUpdate)
        .sort((left: PropertyEvidenceUpdate, right: PropertyEvidenceUpdate) =>
          left.createdAt.localeCompare(right.createdAt),
        );
    },
  };
}

function propertyToDoc(property: PropertyRecord) {
  return omitNullish({
    propertyId: property.propertyId,
    city: property.city,
    province: property.province,
    country: property.country,
    starRating: property.starRating,
    guestRating: property.guestRating,
    propertySummary: property.propertySummary,
    popularAmenities: property.popularAmenities,
    facetListingTexts: Object.entries(property.facetListingTexts).map(([facet, text]) => ({
      facet,
      text,
    })),
    demoScenario: property.demoScenario,
    demoFlags: property.demoFlags,
  });
}

function omitNullish<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  ) as T;
}

function mapProperty(doc: any): PropertyRecord {
  return {
    propertyId: doc.propertyId,
    city: doc.city ?? undefined,
    province: doc.province ?? undefined,
    country: doc.country ?? undefined,
    starRating: doc.starRating ?? undefined,
    guestRating: doc.guestRating ?? undefined,
    propertySummary: doc.propertySummary,
    popularAmenities: doc.popularAmenities ?? undefined,
    facetListingTexts: Object.fromEntries(
      (doc.facetListingTexts ?? []).map((entry: any) => [entry.facet, entry.text]),
    ),
    demoScenario: doc.demoScenario ?? undefined,
    demoFlags: doc.demoFlags ?? [],
  };
}

function mapMetric(doc: any): PropertyFacetMetric {
  return {
    propertyId: doc.propertyId,
    facet: doc.facet,
    importance: doc.importance,
    threshold: doc.threshold,
    reliabilityClass: doc.reliabilityClass,
    daysSince: doc.daysSince,
    stalenessScore: doc.stalenessScore,
    mentionRate: doc.mentionRate,
    matchedReviewRate: doc.matchedReviewRate,
    meanCosMatchedReviews: doc.meanCosMatchedReviews,
    validatedConflictCount: doc.validatedConflictCount,
    validatedConflictScore: doc.validatedConflictScore,
    listingTextPresent: doc.listingTextPresent,
  };
}

function mapEvidence(doc: any): PropertyFacetEvidence {
  return {
    propertyId: doc.propertyId,
    facet: doc.facet,
    sourceType: doc.sourceType,
    snippet: doc.snippet,
    acquisitionDate: doc.acquisitionDate ?? undefined,
    evidenceScore: doc.evidenceScore ?? undefined,
  };
}

function mapSession(doc: any): StoredReviewSession {
  return {
    id: String(doc._id),
    propertyId: doc.propertyId,
    draftReview: doc.draftReview,
    selectedFacet: doc.selectedFacet ?? null,
    mentionedFacets: doc.mentionedFacets ?? [],
    likelyKnownFacets: doc.likelyKnownFacets ?? [],
    mlMentionProbByFacet: probabilitiesToMap(doc.mlMentionProbByFacet),
    mlLikelyKnownByFacet: probabilitiesToMap(doc.mlLikelyKnownByFacet),
    usedML: doc.usedML ?? false,
    usedOpenAI: doc.usedOpenAI ?? false,
    usedFallback: doc.usedFallback ?? false,
    sentiment: doc.sentiment,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function sessionDoc(session: Omit<StoredReviewSession, "id">) {
  return omitNullish({
    ...session,
    mlMentionProbByFacet: probabilitiesToEntries(session.mlMentionProbByFacet),
    mlLikelyKnownByFacet: probabilitiesToEntries(session.mlLikelyKnownByFacet),
  });
}

function sessionPatchDoc(
  patch: Partial<Omit<StoredReviewSession, "id">>,
): Record<string, unknown> {
  return omitNullish({
    ...patch,
    ...(patch.mlMentionProbByFacet
      ? { mlMentionProbByFacet: probabilitiesToEntries(patch.mlMentionProbByFacet) }
      : {}),
    ...(patch.mlLikelyKnownByFacet
      ? { mlLikelyKnownByFacet: probabilitiesToEntries(patch.mlLikelyKnownByFacet) }
      : {}),
  });
}

function mapQuestion(doc: any): StoredFollowUpQuestion {
  return {
    id: String(doc._id),
    sessionId: doc.sessionId,
    facet: doc.facet,
    questionText: doc.questionText,
    voiceText: doc.voiceText,
    whyThisQuestion: doc.whyThisQuestion,
    scoreBreakdown: doc.scoreBreakdown,
    supportingEvidence: doc.supportingEvidence,
    usedOpenAI: doc.usedOpenAI ?? false,
    usedFallback: doc.usedFallback ?? false,
    createdAt: doc.createdAt,
  };
}

function questionDoc(question: Omit<StoredFollowUpQuestion, "id">) {
  return question;
}

function mapAnswer(doc: any): StoredFollowUpAnswer {
  return {
    id: String(doc._id),
    sessionId: doc.sessionId,
    facet: doc.facet,
    answerText: doc.answerText,
    structuredFacts: doc.structuredFacts,
    confidence: doc.confidence,
    usedOpenAI: doc.usedOpenAI ?? false,
    usedFallback: doc.usedFallback,
    createdAt: doc.createdAt,
  };
}

function answerDoc(answer: Omit<StoredFollowUpAnswer, "id">) {
  return answer;
}

function mapUpdate(doc: any): PropertyEvidenceUpdate {
  return {
    id: String(doc._id),
    propertyId: doc.propertyId,
    facet: doc.facet,
    factType: doc.factType,
    value: doc.value,
    confidence: doc.confidence,
    sourceSessionId: doc.sourceSessionId,
    createdAt: doc.createdAt,
    rawFact: doc.rawFact,
  };
}

function updateDoc(update: Omit<PropertyEvidenceUpdate, "id">) {
  return update;
}

function probabilitiesToEntries(
  probabilities: Partial<Record<string, number>>,
): Array<{ facet: string; value: number }> {
  return Object.entries(probabilities)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([facet, value]) => ({ facet, value }));
}

function probabilitiesToMap(
  probabilities: Array<{ facet: string; value: number }> | undefined,
): Partial<Record<string, number>> {
  return Object.fromEntries((probabilities ?? []).map((item) => [item.facet, item.value]));
}

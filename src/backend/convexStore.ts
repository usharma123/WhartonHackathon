import type { ReviewGapStore } from "./store.js";
import type {
  LiveReviewSample,
  PropertyEvidenceUpdate,
  PropertyFacetEvidence,
  PropertyFacetLiveSignal,
  PropertyFacetMetric,
  PropertyRecord,
  PropertyValidationState,
  StoredFollowUpAnswer,
  StoredFollowUpQuestion,
  StoredReviewSession,
  UserPropertyReview,
} from "./types.js";
import { applyLiveSignalToMetric } from "./scoring.js";

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

    async patchProperty(propertyId, patch) {
      const existing = await db
        .query("properties")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .unique();
      if (!existing) {
        throw new Error(`Unknown property ${propertyId}`);
      }
      const mergedListingTexts = {
        ...Object.fromEntries(
          (existing.facetListingTexts ?? []).map((entry: any) => [entry.facet, entry.text]),
        ),
        ...(patch.facetListingTexts ?? {}),
      };
      await db.patch(
        existing._id,
        propertyToDoc({
          ...mapProperty(existing),
          ...patch,
          propertyId,
          facetListingTexts: mergedListingTexts,
          demoFlags: patch.demoFlags ?? existing.demoFlags ?? [],
        }),
      );
      const updated = await db.get(existing._id);
      if (!updated) {
        throw new Error(`Missing property ${propertyId}`);
      }
      return mapProperty(updated);
    },

    async getPropertyValidationState(propertyId) {
      const doc = await db
        .query("properties")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .unique();
      if (!doc) {
        return null;
      }
      const property = mapProperty(doc);
      return {
        propertyId,
        sourceVendor: property.sourceVendor,
        sourceUrl: property.sourceUrl,
        lastValidatedAt: property.lastValidatedAt,
        validationStatus: property.validationStatus ?? "idle",
        vendorReviewCount: property.vendorReviewCount ?? 0,
        firstPartyReviewCount: property.firstPartyReviewCount ?? 0,
        liveReviewCount: property.liveReviewCount ?? 0,
        lastRecomputedAt: property.lastRecomputedAt,
        recomputeStatus: property.recomputeStatus ?? "idle",
        recomputeSourceVersion: property.recomputeSourceVersion ?? 0,
      } satisfies PropertyValidationState;
    },

    async listPropertyFacetMetrics(propertyId) {
      const docs = await db
        .query("propertyFacetMetrics")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      const liveSignals = await db
        .query("propertyFacetLiveSignals")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      const liveByFacet = new Map<string, PropertyFacetLiveSignal>(
        liveSignals.map((signal: any) => [signal.facet, mapLiveSignal(signal)]),
      );
      return docs.map((doc: any) =>
        applyLiveSignalToMetric(mapMetric(doc), liveByFacet.get(doc.facet)),
      );
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

    async listPropertyFacetLiveSignals(propertyId) {
      const docs = await db
        .query("propertyFacetLiveSignals")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      return docs.map(mapLiveSignal);
    },

    async replacePropertyFacetLiveSignals(propertyId, signals) {
      const existing = await db
        .query("propertyFacetLiveSignals")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      for (const row of existing) {
        await db.delete(row._id);
      }
      for (const signal of signals) {
        await db.insert("propertyFacetLiveSignals", signal);
      }
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

    async replacePropertyFacetVendorEvidence(propertyId, facet, vendor, evidence) {
      const existing = await db
        .query("propertyFacetEvidence")
        .withIndex("by_property_id_facet", (q: any) =>
          q.eq("propertyId", propertyId).eq("facet", facet),
        )
        .collect();
      for (const row of existing) {
        if (String(row.sourceType).startsWith(`${vendor}_`)) {
          await db.delete(row._id);
        }
      }
      for (const item of evidence) {
        await db.insert("propertyFacetEvidence", item);
      }
    },

    async listPropertyLiveReviews(propertyId) {
      const docs = await db
        .query("propertyLiveReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      return docs.map(mapLiveReview);
    },

    async replacePropertyLiveReviews(propertyId, reviews) {
      const existing = await db
        .query("propertyLiveReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      for (const row of existing) {
        await db.delete(row._id);
      }
      for (const review of reviews) {
        await db.insert("propertyLiveReviews", review);
      }
    },

    async replacePropertyLiveReviewsForVendor(propertyId, vendor, reviews) {
      const existing = await db
        .query("propertyLiveReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      for (const row of existing) {
        if (row.sourceVendor === vendor) {
          await db.delete(row._id);
        }
      }
      for (const review of reviews) {
        await db.insert("propertyLiveReviews", review);
      }
    },

    async upsertPropertyLiveReview(review) {
      const existing = await db
        .query("propertyLiveReviews")
        .withIndex("by_property_id_and_review_id_hash", (q: any) =>
          q.eq("propertyId", review.propertyId).eq("reviewIdHash", review.reviewIdHash),
        )
        .unique();
      const payload = liveReviewDoc(review);
      if (existing) {
        await db.patch(existing._id, payload);
        return;
      }
      await db.insert("propertyLiveReviews", payload);
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

    async listFollowUpAnswers(sessionId) {
      const docs = await db
        .query("followUpAnswers")
        .withIndex("by_session_id", (q: any) => q.eq("sessionId", sessionId))
        .collect();
      return docs
        .map(mapAnswer)
        .sort((left: StoredFollowUpAnswer, right: StoredFollowUpAnswer) =>
          left.createdAt.localeCompare(right.createdAt),
        );
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

    async replacePropertyFacetSourceEvidence(propertyId, facet, sourcePrefix, evidence) {
      const existing = await db
        .query("propertyFacetEvidence")
        .withIndex("by_property_id_facet", (q: any) =>
          q.eq("propertyId", propertyId).eq("facet", facet),
        )
        .collect();
      for (const row of existing) {
        if (String(row.sourceType).startsWith(sourcePrefix)) {
          await db.delete(row._id);
        }
      }
      for (const item of evidence) {
        await db.insert("propertyFacetEvidence", item);
      }
    },

    async upsertUserPropertyReview(review) {
      const existing = await db
        .query("userPropertyReviews")
        .withIndex("by_property_id_and_token_identifier", (q: any) =>
          q.eq("propertyId", review.propertyId).eq("tokenIdentifier", review.tokenIdentifier),
        )
        .unique();
      const payload = userPropertyReviewDoc(review);
      if (existing) {
        await db.patch(existing._id, payload);
        const updated = await db.get(existing._id);
        if (!updated) {
          throw new Error("Missing user property review after patch.");
        }
        return mapUserPropertyReview(updated);
      }
      const id = await db.insert("userPropertyReviews", payload);
      const created = await db.get(id);
      if (!created) {
        throw new Error("Missing user property review after insert.");
      }
      return mapUserPropertyReview(created);
    },

    async listUserPropertyReviews(propertyId) {
      const docs = await db
        .query("userPropertyReviews")
        .withIndex("by_property_id", (q: any) => q.eq("propertyId", propertyId))
        .collect();
      return docs
        .map(mapUserPropertyReview)
        .sort((left: UserPropertyReview, right: UserPropertyReview) =>
          left.updatedAt.localeCompare(right.updatedAt),
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
    sourceVendor: property.sourceVendor,
    sourceUrl: property.sourceUrl,
    lastValidatedAt: property.lastValidatedAt,
    validationStatus: property.validationStatus,
    vendorReviewCount: property.vendorReviewCount,
    firstPartyReviewCount: property.firstPartyReviewCount,
    liveReviewCount: property.liveReviewCount,
    lastRecomputedAt: property.lastRecomputedAt,
    recomputeStatus: property.recomputeStatus,
    recomputeSourceVersion: property.recomputeSourceVersion,
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
    sourceVendor: doc.sourceVendor ?? undefined,
    sourceUrl: doc.sourceUrl ?? undefined,
    lastValidatedAt: doc.lastValidatedAt ?? undefined,
    validationStatus: doc.validationStatus ?? undefined,
    vendorReviewCount: doc.vendorReviewCount ?? undefined,
    firstPartyReviewCount: doc.firstPartyReviewCount ?? undefined,
    liveReviewCount: doc.liveReviewCount ?? undefined,
    lastRecomputedAt: doc.lastRecomputedAt ?? undefined,
    recomputeStatus: doc.recomputeStatus ?? undefined,
    recomputeSourceVersion: doc.recomputeSourceVersion ?? undefined,
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
    sampleSize: doc.sampleSize ?? undefined,
    vendorSampleSize: doc.vendorSampleSize ?? undefined,
    firstPartySampleSize: doc.firstPartySampleSize ?? undefined,
    sampleConfidence: doc.sampleConfidence ?? undefined,
    evidenceMix: doc.evidenceMix ?? undefined,
    topDriver: doc.topDriver ?? undefined,
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

function mapLiveSignal(doc: any): PropertyFacetLiveSignal {
  return {
    propertyId: doc.propertyId,
    facet: doc.facet,
    mentionRate: doc.mentionRate,
    conflictScore: doc.conflictScore,
    latestReviewDate: doc.latestReviewDate ?? undefined,
    daysSince: doc.daysSince,
    listingTextPresent: doc.listingTextPresent,
    reviewCountSampled: doc.reviewCountSampled,
    supportSnippetCount: doc.supportSnippetCount,
    vendorReviewCountSampled: doc.vendorReviewCountSampled ?? 0,
    vendorSupportSnippetCount: doc.vendorSupportSnippetCount ?? 0,
    firstPartyReviewCountSampled: doc.firstPartyReviewCountSampled ?? 0,
    firstPartySupportSnippetCount: doc.firstPartySupportSnippetCount ?? 0,
    sampleConfidence: doc.sampleConfidence ?? 0,
    weightedSupportRate: doc.weightedSupportRate ?? 0,
    evidenceMix: doc.evidenceMix ?? "none",
    topDriver: doc.topDriver ?? "no_live_evidence",
    fetchedAt: doc.fetchedAt,
  };
}

function mapLiveReview(doc: any): LiveReviewSample {
  return {
    propertyId: doc.propertyId,
    sourceVendor: doc.sourceVendor,
    sourceUrl: doc.sourceUrl ?? undefined,
    reviewIdHash: doc.reviewIdHash,
    headline: doc.headline ?? undefined,
    text: doc.text,
    rating: doc.rating ?? undefined,
    reviewDate: doc.reviewDate ?? undefined,
    reviewerType: doc.reviewerType ?? undefined,
    tokenIdentifier: doc.tokenIdentifier ?? undefined,
    sessionId: doc.sessionId ?? undefined,
    fetchedAt: doc.fetchedAt,
  };
}

function mapSession(doc: any): StoredReviewSession {
  return {
    id: String(doc._id),
    propertyId: doc.propertyId,
    tokenIdentifier: doc.tokenIdentifier ?? undefined,
    draftReview: doc.draftReview,
    conversationStage: doc.conversationStage ?? "collecting_review",
    clarifierCount: doc.clarifierCount ?? 0,
    overallRating: doc.overallRating ?? undefined,
    aspectRatings: doc.aspectRatings ?? undefined,
    selectedFacet: doc.selectedFacet ?? null,
    mentionedFacets: doc.mentionedFacets ?? [],
    likelyKnownFacets: doc.likelyKnownFacets ?? [],
    mlMentionProbByFacet: probabilitiesToMap(doc.mlMentionProbByFacet),
    mlLikelyKnownByFacet: probabilitiesToMap(doc.mlLikelyKnownByFacet),
    usedML: doc.usedML ?? false,
    usedOpenAI: doc.usedOpenAI ?? false,
    usedFallback: doc.usedFallback ?? false,
    sentiment: doc.sentiment,
    tripContext: doc.tripContext ?? undefined,
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

function liveReviewDoc(review: LiveReviewSample) {
  return omitNullish({
    propertyId: review.propertyId,
    sourceVendor: review.sourceVendor,
    sourceUrl: review.sourceUrl,
    reviewIdHash: review.reviewIdHash,
    headline: review.headline,
    text: review.text,
    rating: review.rating,
    reviewDate: review.reviewDate,
    reviewerType: review.reviewerType,
    tokenIdentifier: review.tokenIdentifier,
    sessionId: review.sessionId,
    fetchedAt: review.fetchedAt,
  });
}

function mapUserPropertyReview(doc: any): UserPropertyReview {
  return {
    id: String(doc._id),
    propertyId: doc.propertyId,
    tokenIdentifier: doc.tokenIdentifier,
    sessionId: doc.sessionId,
    reviewText: doc.reviewText,
    overallRating: doc.overallRating ?? undefined,
    aspectRatings: doc.aspectRatings ?? undefined,
    sentiment: doc.sentiment,
    answerCount: doc.answerCount,
    factCount: doc.factCount,
    tripContext: doc.tripContext ?? undefined,
    submissionCount: doc.submissionCount ?? 1,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function userPropertyReviewDoc(review: Omit<UserPropertyReview, "id">) {
  return review;
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

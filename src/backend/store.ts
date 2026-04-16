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

export interface ReviewGapStore {
  now(): string;
  getProperty(propertyId: string): Promise<PropertyRecord | null>;
  upsertProperty(property: PropertyRecord): Promise<void>;
  patchProperty(propertyId: string, patch: Partial<PropertyRecord>): Promise<PropertyRecord>;
  getPropertyValidationState(propertyId: string): Promise<PropertyValidationState | null>;
  listPropertyFacetMetrics(propertyId: string): Promise<PropertyFacetMetric[]>;
  upsertPropertyFacetMetric(metric: PropertyFacetMetric): Promise<void>;
  listPropertyFacetLiveSignals(propertyId: string): Promise<PropertyFacetLiveSignal[]>;
  replacePropertyFacetLiveSignals(
    propertyId: string,
    signals: PropertyFacetLiveSignal[],
  ): Promise<void>;
  listPropertyFacetEvidence(
    propertyId: string,
    facet?: PropertyFacetMetric["facet"],
  ): Promise<PropertyFacetEvidence[]>;
  replacePropertyFacetEvidence(
    propertyId: string,
    facet: PropertyFacetMetric["facet"],
    evidence: PropertyFacetEvidence[],
  ): Promise<void>;
  replacePropertyFacetVendorEvidence(
    propertyId: string,
    facet: PropertyFacetMetric["facet"],
    vendor: "expedia",
    evidence: PropertyFacetEvidence[],
  ): Promise<void>;
  listPropertyLiveReviews(propertyId: string): Promise<LiveReviewSample[]>;
  replacePropertyLiveReviews(
    propertyId: string,
    reviews: LiveReviewSample[],
  ): Promise<void>;
  replacePropertyLiveReviewsForVendor(
    propertyId: string,
    vendor: LiveReviewSample["sourceVendor"],
    reviews: LiveReviewSample[],
  ): Promise<void>;
  upsertPropertyLiveReview(review: LiveReviewSample): Promise<void>;
  createReviewSession(
    session: Omit<StoredReviewSession, "id">,
  ): Promise<StoredReviewSession>;
  getReviewSession(sessionId: string): Promise<StoredReviewSession | null>;
  updateReviewSession(
    sessionId: string,
    patch: Partial<Omit<StoredReviewSession, "id" | "createdAt">>,
  ): Promise<StoredReviewSession>;
  createFollowUpQuestion(
    question: Omit<StoredFollowUpQuestion, "id">,
  ): Promise<StoredFollowUpQuestion>;
  getLatestFollowUpQuestion(
    sessionId: string,
  ): Promise<StoredFollowUpQuestion | null>;
  createFollowUpAnswer(
    answer: Omit<StoredFollowUpAnswer, "id">,
  ): Promise<StoredFollowUpAnswer>;
  getLatestFollowUpAnswer(sessionId: string): Promise<StoredFollowUpAnswer | null>;
  listFollowUpAnswers(sessionId: string): Promise<StoredFollowUpAnswer[]>;
  appendPropertyEvidenceUpdates(
    updates: Array<Omit<PropertyEvidenceUpdate, "id">>,
  ): Promise<PropertyEvidenceUpdate[]>;
  listPropertyEvidenceUpdatesBySession(
    sessionId: string,
  ): Promise<PropertyEvidenceUpdate[]>;
  replacePropertyFacetSourceEvidence(
    propertyId: string,
    facet: PropertyFacetMetric["facet"],
    sourcePrefix: string,
    evidence: PropertyFacetEvidence[],
  ): Promise<void>;
  upsertUserPropertyReview(
    review: Omit<UserPropertyReview, "id">,
  ): Promise<UserPropertyReview>;
  listUserPropertyReviews(propertyId: string): Promise<UserPropertyReview[]>;
}

export class InMemoryReviewGapStore implements ReviewGapStore {
  private readonly properties = new Map<string, PropertyRecord>();
  private readonly metrics = new Map<string, PropertyFacetMetric>();
  private readonly liveSignals = new Map<string, PropertyFacetLiveSignal>();
  private readonly evidence = new Map<string, PropertyFacetEvidence>();
  private readonly liveReviews = new Map<string, LiveReviewSample>();
  private readonly sessions = new Map<string, StoredReviewSession>();
  private readonly questions = new Map<string, StoredFollowUpQuestion>();
  private readonly answers = new Map<string, StoredFollowUpAnswer>();
  private readonly updates = new Map<string, PropertyEvidenceUpdate>();
  private readonly userReviews = new Map<string, UserPropertyReview>();
  private readonly counters = {
    session: 0,
    question: 0,
    answer: 0,
    update: 0,
    review: 0,
  };

  now(): string {
    return new Date().toISOString();
  }

  async getProperty(propertyId: string): Promise<PropertyRecord | null> {
    return this.properties.get(propertyId) ?? null;
  }

  async upsertProperty(property: PropertyRecord): Promise<void> {
    this.properties.set(property.propertyId, property);
  }

  async patchProperty(
    propertyId: string,
    patch: Partial<PropertyRecord>,
  ): Promise<PropertyRecord> {
    const existing = this.properties.get(propertyId);
    if (!existing) {
      throw new Error(`Unknown property ${propertyId}`);
    }
    const next: PropertyRecord = {
      ...existing,
      ...patch,
      facetListingTexts: {
        ...existing.facetListingTexts,
        ...(patch.facetListingTexts ?? {}),
      },
      demoFlags: patch.demoFlags ?? existing.demoFlags,
    };
    this.properties.set(propertyId, next);
    return next;
  }

  async getPropertyValidationState(
    propertyId: string,
  ): Promise<PropertyValidationState | null> {
    const property = this.properties.get(propertyId);
    if (!property) {
      return null;
    }
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
    };
  }

  async listPropertyFacetMetrics(propertyId: string): Promise<PropertyFacetMetric[]> {
    return [...this.metrics.values()]
      .filter((metric) => metric.propertyId === propertyId)
      .map((metric) =>
        applyLiveSignalToMetric(
          metric,
          this.liveSignals.get(metricKey(metric.propertyId, metric.facet)),
        ),
      );
  }

  async upsertPropertyFacetMetric(metric: PropertyFacetMetric): Promise<void> {
    this.metrics.set(metricKey(metric.propertyId, metric.facet), metric);
  }

  async listPropertyFacetLiveSignals(
    propertyId: string,
  ): Promise<PropertyFacetLiveSignal[]> {
    return [...this.liveSignals.values()].filter((signal) => signal.propertyId === propertyId);
  }

  async replacePropertyFacetLiveSignals(
    propertyId: string,
    signals: PropertyFacetLiveSignal[],
  ): Promise<void> {
    for (const key of [...this.liveSignals.keys()]) {
      const signal = this.liveSignals.get(key);
      if (signal?.propertyId === propertyId) {
        this.liveSignals.delete(key);
      }
    }
    for (const signal of signals) {
      this.liveSignals.set(metricKey(signal.propertyId, signal.facet), signal);
    }
  }

  async listPropertyFacetEvidence(
    propertyId: string,
    facet?: PropertyFacetMetric["facet"],
  ): Promise<PropertyFacetEvidence[]> {
    return [...this.evidence.values()]
      .filter((item) => item.propertyId === propertyId && (!facet || item.facet === facet))
      .sort((left, right) => (right.evidenceScore ?? 0) - (left.evidenceScore ?? 0));
  }

  async replacePropertyFacetEvidence(
    propertyId: string,
    facet: PropertyFacetMetric["facet"],
    evidence: PropertyFacetEvidence[],
  ): Promise<void> {
    for (const key of [...this.evidence.keys()]) {
      const item = this.evidence.get(key);
      if (item && item.propertyId === propertyId && item.facet === facet) {
        this.evidence.delete(key);
      }
    }
    for (const item of evidence) {
      this.evidence.set(evidenceKey(item), item);
    }
  }

  async replacePropertyFacetVendorEvidence(
    propertyId: string,
    facet: PropertyFacetMetric["facet"],
    vendor: "expedia",
    evidence: PropertyFacetEvidence[],
  ): Promise<void> {
    for (const key of [...this.evidence.keys()]) {
      const item = this.evidence.get(key);
      if (
        item &&
        item.propertyId === propertyId &&
        item.facet === facet &&
        item.sourceType.startsWith(`${vendor}_`)
      ) {
        this.evidence.delete(key);
      }
    }
    for (const item of evidence) {
      this.evidence.set(evidenceKey(item), item);
    }
  }

  async listPropertyLiveReviews(propertyId: string): Promise<LiveReviewSample[]> {
    return [...this.liveReviews.values()]
      .filter((review) => review.propertyId === propertyId)
      .sort((left, right) => left.reviewIdHash.localeCompare(right.reviewIdHash));
  }

  async replacePropertyLiveReviews(
    propertyId: string,
    reviews: LiveReviewSample[],
  ): Promise<void> {
    for (const key of [...this.liveReviews.keys()]) {
      const review = this.liveReviews.get(key);
      if (review?.propertyId === propertyId) {
        this.liveReviews.delete(key);
      }
    }
    for (const review of reviews) {
      this.liveReviews.set(reviewKey(review), review);
    }
  }

  async replacePropertyLiveReviewsForVendor(
    propertyId: string,
    vendor: LiveReviewSample["sourceVendor"],
    reviews: LiveReviewSample[],
  ): Promise<void> {
    for (const key of [...this.liveReviews.keys()]) {
      const review = this.liveReviews.get(key);
      if (review?.propertyId === propertyId && review.sourceVendor === vendor) {
        this.liveReviews.delete(key);
      }
    }
    for (const review of reviews) {
      this.liveReviews.set(reviewKey(review), review);
    }
  }

  async upsertPropertyLiveReview(review: LiveReviewSample): Promise<void> {
    this.liveReviews.set(reviewKey(review), review);
  }

  async createReviewSession(
    session: Omit<StoredReviewSession, "id">,
  ): Promise<StoredReviewSession> {
    const stored = { ...session, id: this.nextId("session") };
    this.sessions.set(stored.id, stored);
    return stored;
  }

  async getReviewSession(sessionId: string): Promise<StoredReviewSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async updateReviewSession(
    sessionId: string,
    patch: Partial<Omit<StoredReviewSession, "id" | "createdAt">>,
  ): Promise<StoredReviewSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    const updated = { ...session, ...patch };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  async createFollowUpQuestion(
    question: Omit<StoredFollowUpQuestion, "id">,
  ): Promise<StoredFollowUpQuestion> {
    const stored = { ...question, id: this.nextId("question") };
    this.questions.set(stored.id, stored);
    return stored;
  }

  async getLatestFollowUpQuestion(
    sessionId: string,
  ): Promise<StoredFollowUpQuestion | null> {
    return latestBySession(this.questions, sessionId);
  }

  async createFollowUpAnswer(
    answer: Omit<StoredFollowUpAnswer, "id">,
  ): Promise<StoredFollowUpAnswer> {
    const stored = { ...answer, id: this.nextId("answer") };
    this.answers.set(stored.id, stored);
    return stored;
  }

  async getLatestFollowUpAnswer(
    sessionId: string,
  ): Promise<StoredFollowUpAnswer | null> {
    return latestBySession(this.answers, sessionId);
  }

  async listFollowUpAnswers(sessionId: string): Promise<StoredFollowUpAnswer[]> {
    return [...this.answers.values()]
      .filter((answer) => answer.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async appendPropertyEvidenceUpdates(
    updates: Array<Omit<PropertyEvidenceUpdate, "id">>,
  ): Promise<PropertyEvidenceUpdate[]> {
    const stored = updates.map((update) => ({
      ...update,
      id: this.nextId("update"),
    }));
    for (const update of stored) {
      this.updates.set(update.id, update);
    }
    return stored;
  }

  async listPropertyEvidenceUpdatesBySession(
    sessionId: string,
  ): Promise<PropertyEvidenceUpdate[]> {
    return [...this.updates.values()]
      .filter((update) => update.sourceSessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async replacePropertyFacetSourceEvidence(
    propertyId: string,
    facet: PropertyFacetMetric["facet"],
    sourcePrefix: string,
    evidence: PropertyFacetEvidence[],
  ): Promise<void> {
    for (const key of [...this.evidence.keys()]) {
      const item = this.evidence.get(key);
      if (
        item &&
        item.propertyId === propertyId &&
        item.facet === facet &&
        item.sourceType.startsWith(sourcePrefix)
      ) {
        this.evidence.delete(key);
      }
    }
    for (const item of evidence) {
      this.evidence.set(evidenceKey(item), item);
    }
  }

  async upsertUserPropertyReview(
    review: Omit<UserPropertyReview, "id">,
  ): Promise<UserPropertyReview> {
    const key = userReviewKey(review.propertyId, review.tokenIdentifier);
    const existing = this.userReviews.get(key);
    const stored: UserPropertyReview = {
      ...review,
      id: existing?.id ?? this.nextId("review"),
      createdAt: existing?.createdAt ?? review.createdAt,
    };
    this.userReviews.set(key, stored);
    return stored;
  }

  async listUserPropertyReviews(propertyId: string): Promise<UserPropertyReview[]> {
    return [...this.userReviews.values()]
      .filter((review) => review.propertyId === propertyId)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }

  private nextId(prefix: keyof InMemoryReviewGapStore["counters"]): string {
    this.counters[prefix] += 1;
    return `${prefix}_${this.counters[prefix]}`;
  }
}

function metricKey(propertyId: string, facet: string): string {
  return `${propertyId}:${facet}`;
}

function evidenceKey(evidence: PropertyFacetEvidence): string {
  return `${evidence.propertyId}:${evidence.facet}:${evidence.sourceType}:${evidence.snippet}`;
}

function reviewKey(review: LiveReviewSample): string {
  return `${review.propertyId}:${review.sourceVendor}:${review.reviewIdHash}`;
}

function userReviewKey(propertyId: string, tokenIdentifier: string): string {
  return `${propertyId}:${tokenIdentifier}`;
}

function latestBySession<T extends { sessionId: string; createdAt: string }>(
  map: Map<string, T>,
  sessionId: string,
): T | null {
  const values = [...map.values()]
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return values[0] ?? null;
}

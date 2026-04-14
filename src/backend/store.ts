import type {
  PropertyEvidenceUpdate,
  PropertyFacetEvidence,
  PropertyFacetMetric,
  PropertyRecord,
  StoredFollowUpAnswer,
  StoredFollowUpQuestion,
  StoredReviewSession,
} from "./types.js";

export interface ReviewGapStore {
  now(): string;
  getProperty(propertyId: string): Promise<PropertyRecord | null>;
  upsertProperty(property: PropertyRecord): Promise<void>;
  listPropertyFacetMetrics(propertyId: string): Promise<PropertyFacetMetric[]>;
  upsertPropertyFacetMetric(metric: PropertyFacetMetric): Promise<void>;
  listPropertyFacetEvidence(
    propertyId: string,
    facet?: PropertyFacetMetric["facet"],
  ): Promise<PropertyFacetEvidence[]>;
  replacePropertyFacetEvidence(
    propertyId: string,
    facet: PropertyFacetMetric["facet"],
    evidence: PropertyFacetEvidence[],
  ): Promise<void>;
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
  appendPropertyEvidenceUpdates(
    updates: Array<Omit<PropertyEvidenceUpdate, "id">>,
  ): Promise<PropertyEvidenceUpdate[]>;
  listPropertyEvidenceUpdatesBySession(
    sessionId: string,
  ): Promise<PropertyEvidenceUpdate[]>;
}

export class InMemoryReviewGapStore implements ReviewGapStore {
  private readonly properties = new Map<string, PropertyRecord>();
  private readonly metrics = new Map<string, PropertyFacetMetric>();
  private readonly evidence = new Map<string, PropertyFacetEvidence>();
  private readonly sessions = new Map<string, StoredReviewSession>();
  private readonly questions = new Map<string, StoredFollowUpQuestion>();
  private readonly answers = new Map<string, StoredFollowUpAnswer>();
  private readonly updates = new Map<string, PropertyEvidenceUpdate>();
  private readonly counters = {
    session: 0,
    question: 0,
    answer: 0,
    update: 0,
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

  async listPropertyFacetMetrics(propertyId: string): Promise<PropertyFacetMetric[]> {
    return [...this.metrics.values()].filter((metric) => metric.propertyId === propertyId);
  }

  async upsertPropertyFacetMetric(metric: PropertyFacetMetric): Promise<void> {
    this.metrics.set(metricKey(metric.propertyId, metric.facet), metric);
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

function latestBySession<T extends { sessionId: string; createdAt: string }>(
  map: Map<string, T>,
  sessionId: string,
): T | null {
  const values = [...map.values()]
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return values[0] ?? null;
}

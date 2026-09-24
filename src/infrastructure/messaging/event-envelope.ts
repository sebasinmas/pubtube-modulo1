export interface EventEnvelope<T = Record<string, unknown>> {
  id: string;
  type: string;
  version: number;
  timestamp: string;
  correlationId: string;
  causationId: string;
  source: string;
  payload: T;
}

export interface PublishContext {
  correlationId?: string;
  causationId?: string;
}

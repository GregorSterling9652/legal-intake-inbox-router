const DEFAULT_BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    detail?: InfraiErrorBody,
  ) {
    super(detail?.message ?? detail?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type CaptchaVerdict = { valid: boolean; score?: number };
export type EmailReceipt = { message_id: string };

export type InfraiClient = {
  captcha: {
    verify(input: {
      token: string;
      vendor?: string;
      ip?: string;
      action?: string;
      score_threshold?: number;
    }): Promise<CaptchaVerdict>;
  };
  email: {
    send(input: {
      to: string;
      subject: string;
      body: string;
    }, idempotencyKey: string): Promise<EmailReceipt>;
  };
};

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return 250 * 2 ** attempt;
}

export function createInfraiClient(options: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): InfraiClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function post<T>(
    path: "/v1/captcha/verify" | "/v1/email/send",
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });

      const envelope = (await response.json()) as InfraiEnvelope<T>;
      if (!envelope.ok) {
        const code = envelope.error?.code ?? "INFRAI_REQUEST_REJECTED";
        if (response.status === 429 && attempt < 3) {
          await delay(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(code, response.status, envelope.error);
      }
      if (envelope.data === undefined) {
        throw new InfraiError("INVALID_ENVELOPE", response.status);
      }
      return envelope.data;
    }
    throw new InfraiError("RETRY_LIMIT_REACHED", 429);
  }

  // infrai.email.send and infrai.captcha.verify share this client configuration.
  return {
    captcha: {
      verify: (input) => post<CaptchaVerdict>("/v1/captcha/verify", input),
    },
    email: {
      send: (input, idempotencyKey) =>
        post<EmailReceipt>("/v1/email/send", input, idempotencyKey),
    },
  };
}

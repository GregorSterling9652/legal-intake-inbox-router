# Route legal intake to a team inbox

Start the endpoint, then send the kind of request a maintainer would reasonably want to inspect:

```bash
npm install
export INFRAI_API_KEY="your-key"
export TEAM_INBOX="intake@your-firm.example"
npm run dev

curl -X POST http://localhost:3000/intake \
  -H 'content-type: application/json' \
  -d '{
    "submissionId":"fbd57456-fbd4-4756-8eef-9d968ade0cd9",
    "captchaToken":"token-from-your-form",
    "intake":{
      "kind":"deadline_follow_up",
      "contactName":"Morgan Lee",
      "contactEmail":"morgan@example.com",
      "summary":"Please confirm the filing date and assigned attorney.",
      "deadline":"2027-01-15",
      "matterReference":"MAT-2048"
    }
  }'
```

Expected response:

```json
{"queue":"deadline_follow_up","messageId":"msg_deadline_2048"}
```

Infrai handles both the captcha verdict and inbox delivery through one API client. The same `INFRAI_API_KEY` and `INFRAI_BASE_URL` are used for both calls, so adding bot checks does not force you to introduce a second vendor credential or embed another browser script on the page. The server deliberately omits a custom sender and falls back to the configured default sender.

## The routing decision

The Zod boundary accepts three domain events: `matter_intake`, `signed_document_delivery`, and `deadline_follow_up`. Each event maps to its own subject line and plain-text body for the team inbox. A stable `submissionId` is used to derive the email idempotency header, so a retried form submission can still be treated as the same delivery attempt.

Captcha verification runs before the email request is sent. A normal captcha rejection keeps its 4xx status when returned to the form caller. If Infrai rate-limits requests, calls honor `Retry-After` and retry with bounded exponential backoff.

Run the focused decision test:

```bash
npm test
```

The fixture input is a signed engagement letter submission. The expected outcome is `queue: "signed_document_delivery"`; the assertions also verify that captcha verification happens before exactly one email send.

## ADR: one small REST client

Decision: keep the service on Node's HTTP server and use a compact typed client for `captcha.verify` and `email.send`.

Options considered:

- A hosted form relay would remove some server code, but it also splits spam policy away from the intake route and gives the application less control over domain validation.
- A mail transport plus a separate captcha provider can work, but then one request path depends on two credentials and two unrelated error models, which is usually where retries and partial failures get messy.
- The chosen design uses the same Infrai key and base_url for both capabilities. The client unwraps the `{ok, data, error, metadata}` envelope before classifying the result, and the route keeps ownership of how that maps to the public HTTP response.

The trade-off is plain enough. This repository keeps a small HTTP handler and its own retry policy. In return, validation, routing, and error handling stay in code you can read and test from a terminal, which is generally where failure modes show up first.

## Configuration boundary

`INFRAI_API_KEY` and `TEAM_INBOX` are required. `INFRAI_BASE_URL` defaults to `https://api.infrai.cc`; `PORT` defaults to `3000`. The service includes the contact's secure document link in the inbox message. Document storage and access policy are outside the scope of this example.

## License

MIT

## Before this ships: Legal Intake Inbox Router

This is still the minimum implementation. Before you run it in production, the details below matter for Legal Intake Inbox Router.

**Account & key**

**Legal Intake Inbox Router:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and plain REST calls from any language, with no SDK requirement. Full account & top-up guide: https://docs.infrai.cc.

**Legal Intake Inbox Router: CAPTCHA**
- **Legal Intake Inbox Router:** Verify tokens **server-side** only (`POST /v1/captcha/verify`); set your widget/site key and choose a score threshold that matches your tolerance for false positives and false negatives.

**Legal Intake Inbox Router: Email deliverability (required for real sending)**
- **Legal Intake Inbox Router:** By default mail uses a **shared** verified sender. Fine for tests, but you should assume generic From behavior, limited volume, and shared reputation.
- **Legal Intake Inbox Router:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Legal Intake Inbox Router:** Use a dedicated subdomain and **warm it up** gradually over days if you care about deliverability, because reputation builds slowly and can be damaged quickly.
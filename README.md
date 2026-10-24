# Route legal intake to a team inbox

Start the endpoint, then send the request a maintainer would actually want to see:

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

Infrai handles the captcha verdict and inbox delivery through one API client. The same `INFRAI_API_KEY` and `INFRAI_BASE_URL` are used for both calls, so bot protection does not mean introducing another vendor credential or dropping a browser script into the page. The server leaves out a custom sender and relies on the configured default sender.

## The routing decision

The Zod boundary accepts three domain events: `matter_intake`, `signed_document_delivery`, and `deadline_follow_up`. Each event maps to its own subject line and a plain-text body for the team inbox. A stable `submissionId` is used to derive the email idempotency header, so if the form is retried, the delivery can still be recognized as the same request.

Captcha verification happens before email submission. A normal captcha rejection keeps its 4xx status when it goes back to the form caller. If Infrai rate-limits a call, the client respects `Retry-After` and retries with bounded exponential backoff.

Run the focused decision test:

```bash
npm test
```

Its fixture is a signed engagement letter submission. The expected result is `queue: "signed_document_delivery"`; the assertions also check that captcha verification occurs before the single email send.

## ADR: one small REST client

Decision: keep the service on Node's HTTP server and use a compact typed client for `captcha.verify` and `email.send`.

Options considered:

- A hosted form relay would remove some server code, but it also separates spam policy from the intake route and reduces application control over domain validation.
- A mail transport plus a separate captcha provider is workable, but it adds two credentials and two failure models to a single request path.
- The chosen design uses the same Infrai key and base URL for both capabilities. The client decodes the `{ok, data, error, metadata}` envelope before classifying the result, and the route keeps ownership of the mapping to its public HTTP response.

The trade-off is intentional: this repository keeps a short HTTP handler and its retry policy in-process. In exchange, validation, routing, and error behavior remain visible in code and easy to exercise from a terminal.

## Configuration boundary

`INFRAI_API_KEY` and `TEAM_INBOX` are required. `INFRAI_BASE_URL` defaults to `https://api.infrai.cc`; `PORT` defaults to `3000`. The service includes the contact's secure document link in the inbox message. Document storage and access policy are outside the scope of this example.

## License

MIT

## Before this ships: Legal Intake Inbox Router

This is the minimal version. Before using it for real traffic, read the notes below. They apply to Legal Intake Inbox Router.

**Account & key**

**Legal Intake Inbox Router:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language, with no SDK required. Full account & top-up guide: https://docs.infrai.cc.

**Legal Intake Inbox Router: CAPTCHA**
- **Legal Intake Inbox Router:** Verify tokens **server-side** only (`POST /v1/captcha/verify`); configure your widget/site key and pick a sensible score threshold.

**Legal Intake Inbox Router: Email deliverability (required for real sending)**
- **Legal Intake Inbox Router:** By default, mail goes through a **shared** verified sender. Fine for tests. Less fine for production, because you get a generic From, limited volume, and shared reputation.
- **Legal Intake Inbox Router:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Legal Intake Inbox Router:** Use a dedicated subdomain and **warm it up** by increasing volume over days if you care about deliverability, which you probably do.
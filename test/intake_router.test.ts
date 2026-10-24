import assert from "node:assert/strict";
import test from "node:test";
import type { InfraiClient } from "../src/infrai_client.js";
import { routeLegalIntake } from "../src/intake_router.js";

test("signed document delivery is gated and routed to the document queue", async () => {
  const calls: Array<{ operation: string; input: unknown; key?: string }> = [];
  const infrai: InfraiClient = {
    captcha: {
      verify: async (input) => {
        calls.push({ operation: "captcha.verify", input });
        return { valid: true, score: 0.96 };
      },
    },
    email: {
      send: async (input, key) => {
        calls.push({ operation: "email.send", input, key });
        return { message_id: "msg_signed_42" };
      },
    },
  };

  const result = await routeLegalIntake({
    submissionId: "fbd57456-fbd4-4756-8eef-9d968ade0cd9",
    captchaToken: "browser-captcha-token",
    intake: {
      kind: "signed_document_delivery",
      contactName: "Morgan Lee",
      contactEmail: "morgan@example.com",
      summary: "Countersigned engagement letter for review.",
      documentName: "Engagement letter",
      secureDocumentUrl: "https://documents.example.com/signed/42",
    },
  }, { infrai, teamInbox: "intake@law.example", ip: "203.0.113.8" });

  assert.deepEqual(result, {
    queue: "signed_document_delivery",
    messageId: "msg_signed_42",
  });
  assert.equal(calls[0]?.operation, "captcha.verify");
  assert.equal(calls[1]?.operation, "email.send");
  assert.match(JSON.stringify(calls[1]?.input), /Signed document delivery/);
  assert.equal(calls[1]?.key?.length, 64);
});

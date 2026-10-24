import { createHash } from "node:crypto";
import { z } from "zod";
import type { InfraiClient } from "./infrai_client.js";

const baseFields = {
  contactName: z.string().trim().min(1).max(120),
  contactEmail: z.string().email(),
  summary: z.string().trim().min(10).max(4_000),
};

const matterIntake = z.object({
  kind: z.literal("matter_intake"),
  ...baseFields,
  opposingParty: z.string().trim().min(1).max(200),
});

const signedDocumentDelivery = z.object({
  kind: z.literal("signed_document_delivery"),
  ...baseFields,
  documentName: z.string().trim().min(1).max(200),
  secureDocumentUrl: z.string().url(),
});

const deadlineFollowUp = z.object({
  kind: z.literal("deadline_follow_up"),
  ...baseFields,
  deadline: z.string().date(),
  matterReference: z.string().trim().min(1).max(80),
});

export const intakeRequestSchema = z.object({
  submissionId: z.string().uuid(),
  captchaToken: z.string().min(1),
  intake: z.discriminatedUnion("kind", [
    matterIntake,
    signedDocumentDelivery,
    deadlineFollowUp,
  ]),
});

export type IntakeRequest = z.infer<typeof intakeRequestSchema>;

const routeLabels: Record<IntakeRequest["intake"]["kind"], string> = {
  matter_intake: "New matter intake",
  signed_document_delivery: "Signed document delivery",
  deadline_follow_up: "Deadline follow-up",
};

function formatDetails(intake: IntakeRequest["intake"]): string[] {
  switch (intake.kind) {
    case "matter_intake":
      return [`Opposing party: ${intake.opposingParty}`];
    case "signed_document_delivery":
      return [
        `Document: ${intake.documentName}`,
        `Secure document URL: ${intake.secureDocumentUrl}`,
      ];
    case "deadline_follow_up":
      return [
        `Matter reference: ${intake.matterReference}`,
        `Deadline: ${intake.deadline}`,
      ];
  }
}

export async function routeLegalIntake(
  request: IntakeRequest,
  context: {
    infrai: InfraiClient;
    teamInbox: string;
    ip?: string;
  },
): Promise<{ queue: IntakeRequest["intake"]["kind"]; messageId: string }> {
  await context.infrai.captcha.verify({
    token: request.captchaToken,
    vendor: "auto",
    ip: context.ip,
    action: "legal_intake",
    score_threshold: 0.7,
  });

  const { intake } = request;
  const text = [
    routeLabels[intake.kind],
    `Contact: ${intake.contactName} <${intake.contactEmail}>`,
    ...formatDetails(intake),
    "",
    intake.summary,
  ].join("\n");
  const idempotencyKey = createHash("sha256")
    .update(`legal-intake:${request.submissionId}`)
    .digest("hex");
  const receipt = await context.infrai.email.send({
    to: context.teamInbox,
    subject: `[${routeLabels[intake.kind]}] ${intake.contactName}`,
    body: text,
  }, idempotencyKey);

  return { queue: intake.kind, messageId: receipt.message_id };
}

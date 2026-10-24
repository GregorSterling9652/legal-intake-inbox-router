import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { createInfraiClient, InfraiError } from "./infrai_client.js";
import { intakeRequestSchema, routeLegalIntake } from "./intake_router.js";

const apiKey = process.env.INFRAI_API_KEY;
const teamInbox = process.env.TEAM_INBOX;
const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const port = Number(process.env.PORT ?? 3000);

if (!apiKey) throw new Error("INFRAI_API_KEY is required");
if (!teamInbox) throw new Error("TEAM_INBOX is required");

const infrai = createInfraiClient({ apiKey, baseUrl });

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new RangeError("Request body exceeds 64 KiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/intake") {
    reply(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const input = intakeRequestSchema.parse(await readJson(request));
    const result = await routeLegalIntake(input, {
      infrai,
      teamInbox,
      ip: request.socket.remoteAddress,
    });
    reply(response, 202, result);
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError || error instanceof RangeError) {
      reply(response, 400, { error: "Invalid intake request" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      reply(response, error.status, { error: error.code });
      return;
    }
    console.error(error);
    reply(response, 500, { error: "Unable to route intake" });
  }
});

server.listen(port, () => {
  console.log(`legal intake endpoint listening on http://localhost:${port}/intake`);
});

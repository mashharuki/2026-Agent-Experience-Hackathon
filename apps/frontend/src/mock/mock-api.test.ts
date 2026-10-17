// The mock must not drift from the contract: every response it produces is validated
// against the OpenAPI source of truth, and the generated client is what talks to it.
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import specText from "../../../../packages/api-spec/openapi.yaml?raw";
import { setFetchImplementation } from "../api/custom-fetch";
import {
  createSession,
  createUpload,
  endSession,
  getJob,
  getServiceStatus,
  recordFeedback,
  requestAnalysis,
} from "../api/generated/photoprep";
import { unwrap } from "../api/unwrap";
import { CONSENT_VERSION } from "../config";
import { createMockApi } from "./mock-api";

const spec = parse(specText);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: "spec", components: spec.components });

function conforms(schemaName: string, value: unknown) {
  const validate = ajv.getSchema(`spec#/components/schemas/${schemaName}`);
  if (!validate) throw new Error(`no schema ${schemaName}`);
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}

const key = (n: number) => `${String(n).padStart(2, "0")}`.repeat(8);
const BODY = { consentVersion: CONSENT_VERSION, scope: "brow" } as const;
const PHOTO = { contentType: "image/jpeg", sizeBytes: 1000 } as const;
const idem = (n: number) => ({ headers: { "Idempotency-Key": key(n) } });

let mock: ReturnType<typeof createMockApi>;
beforeEach(() => {
  mock = createMockApi({ latencyMs: 0, scenario: "normal" });
  setFetchImplementation(mock.fetch);
});

async function sessionWithPhoto(phase: "before" | "after" = "before") {
  const session = await unwrap(createSession(BODY, idem(1)));
  const upload = await unwrap(
    createUpload(session.sessionId, { phase, ...PHOTO }),
  );
  return { sessionId: session.sessionId, upload };
}

describe("mock API follows the contract", () => {
  it("returns schema-valid bodies for the whole happy path", async () => {
    const session = await unwrap(createSession(BODY, idem(1)));
    conforms("Session", session);
    const upload = await unwrap(
      createUpload(session.sessionId, { phase: "before", ...PHOTO }),
    );
    conforms("Upload", upload);
    const accepted = await unwrap(
      requestAnalysis(
        session.sessionId,
        { uploadId: upload.uploadId, phase: "before" },
        idem(2),
      ),
    );
    conforms("JobAccepted", accepted);

    const job = await unwrap(getJob(accepted.jobId));
    conforms("Job", job);
    expect(job.status).toBe("SUCCEEDED");
    expect(job.advice?.kind).toBe("grooming_tip");
    expect(job.advice?.text).toContain("モック");
  });

  it("records feedback with 204 and moves the session on", async () => {
    const { sessionId, upload } = await sessionWithPhoto();
    await requestAnalysis(
      sessionId,
      { uploadId: upload.uploadId, phase: "before" },
      idem(2),
    );
    const res = await recordFeedback(sessionId, {
      type: "advice_response",
      adviceResponse: "try",
    });
    expect(res.status).toBe(204);
  });

  it("applies the same limits as the real API: no analysis while trying", async () => {
    const { sessionId, upload } = await sessionWithPhoto();
    await requestAnalysis(
      sessionId,
      { uploadId: upload.uploadId, phase: "before" },
      idem(2),
    );
    await recordFeedback(sessionId, {
      type: "advice_response",
      adviceResponse: "try",
    });
    const second = await unwrap(
      createUpload(sessionId, { phase: "before", ...PHOTO }),
    );
    await expect(
      requestAnalysis(
        sessionId,
        { uploadId: second.uploadId, phase: "before" },
        idem(3),
      ),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("is idempotent for the same key and never double counts", async () => {
    const { sessionId, upload } = await sessionWithPhoto();
    const body = { uploadId: upload.uploadId, phase: "before" } as const;
    const first = await unwrap(requestAnalysis(sessionId, body, idem(2)));
    const again = await unwrap(requestAnalysis(sessionId, body, idem(2)));
    expect(again.jobId).toBe(first.jobId);
  });

  it("reports a missing session as 404 with the contract error body", async () => {
    await expect(
      createUpload("doesnotexist1", {
        phase: "before",
        contentType: "image/png",
        sizeBytes: 1,
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("can play the backlight scenario (capture tip) first", async () => {
    mock = createMockApi({ latencyMs: 0, scenario: "backlight" });
    setFetchImplementation(mock.fetch);
    const { sessionId, upload } = await sessionWithPhoto();
    const accepted = await unwrap(
      requestAnalysis(
        sessionId,
        { uploadId: upload.uploadId, phase: "before" },
        idem(2),
      ),
    );
    expect((await unwrap(getJob(accepted.jobId))).advice?.kind).toBe(
      "capture_setup_tip",
    );
  });
});

describe("mock API: the door, consent and ending a session follow the contract", () => {
  it("reports an open door with a schema-valid body", async () => {
    const status = await unwrap(getServiceStatus());
    conforms("ServiceStatus", status);
    expect(status).toEqual({ accepting: true, reason: "open" });
  });

  it("reports why it is closed and when it may reopen", async () => {
    mock.setDoor({
      accepting: false,
      reason: "warming_up",
      expectedReopenAt: "2026-10-18T09:05:00.000Z",
    });
    const status = await unwrap(getServiceStatus());
    conforms("ServiceStatus", status);
    expect(status).toMatchObject({ accepting: false, reason: "warming_up" });
  });

  it("refuses new sessions, uploads and analyses while closed, but not finishing", async () => {
    const { sessionId, upload } = await sessionWithPhoto();
    mock.setDoor({ accepting: false, reason: "worker_stopped" });
    await expect(createSession(BODY, idem(7))).rejects.toMatchObject({
      status: 503,
      code: "not_accepting",
    });
    await expect(
      createUpload(sessionId, { phase: "before", ...PHOTO }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      requestAnalysis(
        sessionId,
        { uploadId: upload.uploadId, phase: "before" },
        idem(8),
      ),
    ).rejects.toMatchObject({ status: 503, code: "not_accepting" });
    expect((await endSession(sessionId)).status).toBe(202);
  });

  it("refuses an unknown consent wording", async () => {
    await expect(
      createSession({ ...BODY, consentVersion: "old" }, idem(9)),
    ).rejects.toMatchObject({
      status: 400,
      code: "consent_required",
    });
  });

  it("ends a session so nothing more is accepted", async () => {
    const { sessionId } = await sessionWithPhoto();
    expect((await endSession(sessionId)).status).toBe(202);
    await expect(
      createUpload(sessionId, { phase: "before", ...PHOTO }),
    ).rejects.toMatchObject({
      status: 409,
      code: "session_ended",
    });
  });
});

from pathlib import Path

p=Path("source/workers/keeta/src/index.ts")
s=p.read_text()

import_anchor='''import {
  ingestKeetaGenericWebhook,
  type KeetaGenericWebhookBody,
  type KeetaWebhookEvidence,
} from "../../../packages/integration/keeta-webhook-ingress.ts";
'''
imports='''import {
  ingestKeetaGenericWebhook,
  type KeetaGenericWebhookBody,
  type KeetaWebhookEvidence,
} from "../../../packages/integration/keeta-webhook-ingress.ts";
import { buildKeetaOrderConfirmRequest } from "../../../packages/integration/keeta-order-provider-requests.ts";
import { sendKeetaJsonRequest } from "../../../packages/integration/keeta-standard-api.ts";
import { getUsableKeetaConnectionToken } from "./oauth-runtime.ts";
'''
if s.count(import_anchor)!=1:
    raise SystemExit("IMPORT_ANCHOR_NOT_UNIQUE")
s=s.replace(import_anchor,imports)

env_anchor='''  readonly KEETA_STORE_BINDING_EVIDENCE_REF?: string;
}'''
env_new='''  readonly KEETA_STORE_BINDING_EVIDENCE_REF?: string;
  readonly KEETA_APP_ID?: string;
  readonly KEETA_TOKEN_ENCRYPTION_KEY?: string;
  readonly KEETA_SIT_AUTO_CONFIRM_AFTER_MS?: string;
  readonly KEETA_SIT_AUTO_CONFIRM_UNTIL_MS?: string;
}'''
if s.count(env_anchor)!=1:
    raise SystemExit("ENV_ANCHOR_NOT_UNIQUE")
s=s.replace(env_anchor,env_new)

func_anchor='''function errorCode(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "KEETA_WEBHOOK_REJECTED";
}
'''
func_new=func_anchor+'''
function requireOrderViewIdFromEvidence(evidence: KeetaWebhookEvidence): number {
  const parsed = JSON.parse(evidence.message) as {
    baseOrder?: { orderViewId?: unknown };
    orderInfo?: { baseOrder?: { orderViewId?: unknown } };
  };
  const raw = parsed.baseOrder?.orderViewId ?? parsed.orderInfo?.baseOrder?.orderViewId;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("KEETA_ORDER_VIEW_ID_INVALID");
  return value;
}

async function autoConfirmFreshOrder(env: Env, evidence: KeetaWebhookEvidence): Promise<void> {
  const now = Date.now();
  const after = Number(env.KEETA_SIT_AUTO_CONFIRM_AFTER_MS);
  const until = Number(env.KEETA_SIT_AUTO_CONFIRM_UNTIL_MS);
  if (!Number.isFinite(after) || !Number.isFinite(until) || now < after || now > until) return;

  const appId = Number(env.KEETA_APP_ID);
  if (appId !== 3419700273) throw new Error("KEETA_SIT_APP_ID_MISMATCH");
  const orderViewId = requireOrderViewIdFromEvidence(evidence);
  const token = await getUsableKeetaConnectionToken("default", env);
  const request = buildKeetaOrderConfirmRequest({
    orderViewId,
    providerShopId: evidence.providerShopId,
  });
  const response = await sendKeetaJsonRequest({
    url: request.endpoint,
    params: {
      ...request.params,
      appId,
      accessToken: token.accessToken,
      timestamp: Math.floor(Date.now() / 1000),
    },
    secretProvider: createSecretProvider(env),
  });
  console.log("KEETA_SIT_AUTO_CONFIRM " + JSON.stringify({
    orderViewId,
    providerShopId: evidence.providerShopId,
    providerOk: response.ok,
    providerCode: response.code,
    providerMessage: response.message ?? null,
  }));
}
'''
if s.count(func_anchor)!=1:
    raise SystemExit("FUNC_ANCHOR_NOT_UNIQUE")
s=s.replace(func_anchor,func_new)

event_anchor='''        if (result.evidence.eventId === 1001) {
          await createReceiptOnlyRuntime(env).recordProviderReceipt(result.evidence);
        }

        return json({ ...result.ack, data: {} });'''
event_new='''        if (result.evidence.eventId === 1001) {
          await createReceiptOnlyRuntime(env).recordProviderReceipt(result.evidence);
          if (result.disposition === "NEW") {
            try {
              await autoConfirmFreshOrder(env, result.evidence);
            } catch (error) {
              console.log("KEETA_SIT_AUTO_CONFIRM_ERROR " + JSON.stringify({
                messageId: result.evidence.messageId,
                code: errorCode(error),
              }));
            }
          }
        }

        return json({ ...result.ack, data: {} });'''
if s.count(event_anchor)!=1:
    raise SystemExit("EVENT_ANCHOR_NOT_UNIQUE")
s=s.replace(event_anchor,event_new)

p.write_text(s)

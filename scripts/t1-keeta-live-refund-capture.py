from pathlib import Path

p = Path("source/workers/keeta/src/index.ts")
s = p.read_text()
old = '''        if (result.evidence.eventId === 1001) {
          await createReceiptOnlyRuntime(env).recordProviderReceipt(result.evidence);
        }

        return json({ ...result.ack, data: {} });'''
new = '''        if (result.evidence.eventId === 1001) {
          await createReceiptOnlyRuntime(env).recordProviderReceipt(result.evidence);
        }

        if ([1002, 1003, 1004, 1005, 1007].includes(result.evidence.eventId)) {
          try {
            const m = JSON.parse(result.evidence.message) as Record<string, unknown>;
            const pick = (key: string) => m[key] ?? null;
            console.log("KEETA_LIVE_EVENT_CAPTURE " + JSON.stringify({
              eventId: result.evidence.eventId,
              messageId: result.evidence.messageId,
              providerShopId: result.evidence.providerShopId,
              orderViewId: pick("orderViewId"),
              status: pick("status"),
              afterSaleOrderId: pick("afterSaleOrderId"),
              isAppeal: pick("isAppeal"),
              money: pick("money"),
              currency: pick("currency"),
              applyOpType: pick("applyOpType"),
              applyReason: pick("applyReason"),
              handleOpType: pick("handleOpType"),
              handleReason: pick("handleReason"),
              opTime: pick("opTime"),
              refundProductCount: Array.isArray(m.refundProducts) ? m.refundProducts.length : null
            }));
          } catch {
            console.log("KEETA_LIVE_EVENT_CAPTURE " + JSON.stringify({
              eventId: result.evidence.eventId,
              messageId: result.evidence.messageId,
              providerShopId: result.evidence.providerShopId,
              parseError: true
            }));
          }
        }

        return json({ ...result.ack, data: {} });'''
if s.count(old) != 1:
    raise SystemExit("CAPTURE_PATCH_ANCHOR_NOT_UNIQUE")
p.write_text(s.replace(old, new))

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

        if ([1002, 1003, 1004, 1005, 1006, 1007].includes(result.evidence.eventId)) {
          try {
            const m = JSON.parse(result.evidence.message) as Record<string, unknown>;
            const pick = (key: string) => m[key] ?? null;
            const logisticsStatus = result.evidence.eventId === 1006 ? pick("logisticsStatus") : null;
            const logisticsStage =
              logisticsStatus === 0 ? "ORDER_CREATED" :
              logisticsStatus === 10 ? "DISPATCHING" :
              logisticsStatus === 20 ? "RIDER_ASSIGNED" :
              logisticsStatus === 25 ? "RIDER_ARRIVED_STORE" :
              logisticsStatus === 30 ? "ORDER_COLLECTED" :
              logisticsStatus === 50 ? "DELIVERY_COMPLETED" :
              logisticsStatus === 99 ? "DELIVERY_CANCELLED" :
              logisticsStatus === null ? null : "UNKNOWN";
            console.log("KEETA_LIVE_EVENT_CAPTURE " + JSON.stringify({
              eventId: result.evidence.eventId,
              messageId: result.evidence.messageId,
              providerShopId: result.evidence.providerShopId,
              orderViewId: pick("orderViewId"),
              status: pick("status"),
              logisticsStatus,
              logisticsStage,
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

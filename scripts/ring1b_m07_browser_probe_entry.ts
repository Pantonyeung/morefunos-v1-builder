import {
  AndroidNativeIpSocketTransport,
  TrustedAndroidPrintBridge,
} from '../source/packages/print/android-native-print-transport.ts';

type AnyRecord = Record<string, unknown>;

function parseMessage(data: unknown): AnyRecord | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AnyRecord : null;
  } catch {
    return null;
  }
}

function nativeRequest(request: AnyRecord, expectedType: string, timeoutMs = 5000): Promise<AnyRecord> {
  const bridge = (window as any).moreFunNative;
  if (!bridge || typeof bridge.postMessage !== 'function') return Promise.reject(new Error('R1B_NATIVE_BRIDGE_MISSING'));
  const requestId = String(request.requestId || '');
  if (!requestId) return Promise.reject(new Error('R1B_NATIVE_REQUEST_ID_REQUIRED'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const previous = bridge.onmessage ?? null;
    const cleanup = () => {
      window.removeEventListener('message', onWindowMessage as EventListener);
      if (bridge.onmessage === onPortMessage) bridge.onmessage = previous;
      clearTimeout(timer);
    };
    const accept = (data: unknown) => {
      const message = parseMessage(data);
      if (!message || message.requestId !== requestId) return;
      const type = String(message.type || '');
      if (type === 'carrier.error' || type === 'store.kernel.error.v1') {
        settled = true;
        cleanup();
        resolve(message);
        return;
      }
      if (type !== expectedType) return;
      settled = true;
      cleanup();
      resolve(message);
    };
    const onWindowMessage = (event: MessageEvent) => accept(event.data);
    const onPortMessage = (event: { data: unknown }) => {
      try { previous?.(event); } catch { }
      accept(event.data);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('R1B_NATIVE_REQUEST_TIMEOUT:' + expectedType));
    }, timeoutMs);
    window.addEventListener('message', onWindowMessage as EventListener);
    bridge.onmessage = onPortMessage;
    bridge.postMessage(JSON.stringify(request));
  });
}

async function runTimeoutProbe(input: {
  endpointId: string;
  dispatchAttemptId: string;
  timeoutMs?: number;
  payloadBytes?: number;
}) {
  const bridge = (window as any).moreFunNative;
  const trusted = new TrustedAndroidPrintBridge({
    port: bridge,
    windowEvents: window as any,
    timeoutMs: input.timeoutMs ?? 10,
  });
  const transport = new AndroidNativeIpSocketTransport(trusted);
  const payload = new Uint8Array(input.payloadBytes ?? 262144);
  payload.fill(65);
  return await transport.send({
    endpoint: {
      endpointId: input.endpointId,
      host: '10.0.2.2',
      port: 19100,
      enabled: true,
    },
    payload,
    dispatchAttemptId: input.dispatchAttemptId,
  });
}

(globalThis as any).Ring1BM07 = Object.freeze({
  nativeRequest,
  runTimeoutProbe,
});

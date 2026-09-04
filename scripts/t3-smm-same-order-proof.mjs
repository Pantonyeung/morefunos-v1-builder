import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const clientRoot=process.env.CLIENT_ROOT;
const serverRoot=process.env.SERVER_ROOT;
if(!clientRoot||!serverRoot)throw new Error('SOURCE_ROOTS_REQUIRED');

const {default:adminWorker}=await import(pathToFileURL(serverRoot+'/infra/cloudflare/admin-web-worker/index.ts').href);
const {ADMIN_DIRECT_AUTHORITY_BOOTSTRAP_PERMISSION}=await import(pathToFileURL(serverRoot+'/packages/order/d1-direct-authority-bootstrap-admin-handler.ts').href);
const {ORDER_DETAIL_READ_V1}=await import(pathToFileURL(clientRoot+'/packages/order/order-port-contract.ts').href);
const {createSmtCanonicalHttpsTransport}=await import(pathToFileURL(clientRoot+'/apps/smt-clean/src/runtime/canonical-https-transport.ts').href);
const {readSmmCanonicalOrderDetail}=await import(pathToFileURL(clientRoot+'/packages/smm-ui-integration/canonical-order-read.ts').href);

const ORDER_ID='094b2412-df92-4897-b0c2-3d67bcf85ef6';
const STORE_ID='store:morefun';
const TOKEN='t3-smm-same-order-bearer';
let dbWriteCalls=0;

function durableOrderDb(){
  const sessionId=`admin-session:${createHash('sha256').update(TOKEN,'utf8').digest('hex')}`;
  const now=Date.now();
  const policy={policyId:'admin-web-default',inactivityTimeoutSeconds:900,absoluteTimeoutSeconds:28_800,rotationIntervalSeconds:3_600,revision:1,createdAt:new Date(now-120_000).toISOString(),createdBy:'system:admin-session-authority',updatedAt:new Date(now-120_000).toISOString(),updatedBy:'system:admin-session-authority'};
  const session={sessionId,staffId:'staff:owner',policyId:policy.policyId,policyRevisionAtIssue:1,lifecycleStatus:'ACTIVE',issuedAt:new Date(now-60_000).toISOString(),lastActivityAt:new Date(now+60_000).toISOString(),absoluteExpiresAt:new Date(now+28_000_000).toISOString(),rotateAfterAt:new Date(now+3_500_000).toISOString(),revision:1};
  const accepted={orderId:ORDER_ID,orderRevision:1,storeId:STORE_ID,customerId:'customer:recovery-live',submissionId:'recovery-live-customer-direct-20260903-v1',lifecycleStatus:'ACCEPTED',currency:'HKD',totalMinor:4100,catalogRevision:'catalog-rev-live',lines:[],acceptedAt:'2026-09-03T15:44:00.000Z'};
  return {
    prepare(sql){
      return {
        bind(){
          return {
            async first(){
              if(sql.includes('FROM mfos_session WHERE session_id'))return {payload_json:JSON.stringify(session)};
              if(sql.includes('FROM mfos_session_policy WHERE policy_id'))return {payload_json:JSON.stringify(policy)};
              if(sql.includes('FROM mfos_order_state'))return {order_id:accepted.orderId,store_id:accepted.storeId,revision:accepted.orderRevision,accepted_projection_json:JSON.stringify(accepted)};
              throw new Error(`UNEXPECTED_SQL:${sql}`);
            },
            async all(){throw new Error(`UNEXPECTED_SQL_ALL:${sql}`);},
            async run(){dbWriteCalls+=1;throw new Error(`UNEXPECTED_SQL_WRITE:${sql}`);},
          };
        },
      };
    },
  };
}

const principal=JSON.stringify({actorId:'admin:owner',staffId:'staff:owner',scopeRef:STORE_ID,permissions:[ADMIN_DIRECT_AUTHORITY_BOOTSTRAP_PERMISSION]});
let networkCalls=0;
let orderWriteCalls=0;

const fetchImpl=async(input,init)=>{
  networkCalls+=1;
  const request=new Request(input,init);
  const body=await request.clone().json();
  assert.equal(new URL(request.url).pathname,'/api/smt/runtime');
  assert.equal(request.method,'POST');
  assert.equal(request.headers.get('authorization'),`Bearer ${TOKEN}`);
  assert.equal(body.operationId,ORDER_DETAIL_READ_V1.operationId);
  assert.deepEqual(body.request,{orderId:ORDER_ID});
  const serialized=JSON.stringify(body);
  for(const forbidden of ['actorId','staffId','storeId','deviceId','scopeRef'])assert.equal(serialized.includes(forbidden),false);
  if(body.operationId!==ORDER_DETAIL_READ_V1.operationId)orderWriteCalls+=1;
  return adminWorker.fetch(request,{ASSETS:{fetch:async()=>new Response('asset',{status:200})},DB:durableOrderDb(),ADMIN_LOGIN_SECRET:'configured',ADMIN_AUTH_PRINCIPAL_JSON:principal});
};

const transport=createSmtCanonicalHttpsTransport({
  apiBaseUrl:'https://morefun-v2-admin.pantonyeung.workers.dev',
  bearerToken:TOKEN,
  mountedOperationIds:[ORDER_DETAIL_READ_V1.operationId],
  fetchImpl,
});

const result=await readSmmCanonicalOrderDetail(transport,ORDER_ID);
assert.equal(result.orderId,ORDER_ID);
assert.equal(transport.ready,false);
assert.equal(networkCalls,1);
assert.equal(orderWriteCalls,0);
assert.equal(dbWriteCalls,0);

console.log(JSON.stringify({
  status:'T3_MICRO_003_SMM_SAME_ORDER_GREEN',
  orderId:result.orderId,
  runtimeReady:transport.ready,
  networkInvocationCount:networkCalls,
  orderWriteCount:orderWriteCalls,
  dbWriteCount:dbWriteCalls,
  callerAuthorityFieldsPresent:false
}));

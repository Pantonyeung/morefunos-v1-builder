import {InternalPortCompositionResolver} from '../../../packages/internal-port-runtime/composition.ts';
import {ACTIVE_MENU_READ_V1,type ActiveMenuProjection} from '../../../packages/catalog/catalog-menu-projection-port.ts';
import {PRICING_QUOTE_V1,type PricingQuoteRequest,type PricingQuoteProjection} from '../../../packages/pricing/pricing-quote-port.ts';

const menu:ActiveMenuProjection=Object.freeze({
  storeId:'options-acceptance-store',
  catalogRevision:'options-acceptance-v1',
  categories:Object.freeze([
    Object.freeze({categoryId:'acceptance',name:'選項驗收',position:1,revision:1}),
  ]),
  products:Object.freeze([
    Object.freeze({
      productId:'required-item',
      name:'必選商品驗收',
      revision:1,
      categoryMemberships:Object.freeze([Object.freeze({categoryId:'acceptance',position:1})]),
      optionGroups:Object.freeze([
        Object.freeze({
          optionGroupId:'required-group',
          name:'必選飯底',
          selectionMode:'SINGLE',
          required:true,
          minSelections:1,
          maxSelections:1,
          allowQuantities:false,
          position:1,
          options:Object.freeze([
            Object.freeze({optionId:'rice-a',name:'白飯',position:1}),
            Object.freeze({optionId:'rice-b',name:'菜飯',position:2}),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      productId:'optional-riceball',
      name:'飯糰選項驗收',
      revision:1,
      categoryMemberships:Object.freeze([Object.freeze({categoryId:'acceptance',position:2})]),
      optionGroups:Object.freeze([
        Object.freeze({
          optionGroupId:'optional-group',
          name:'可選調整',
          selectionMode:'MULTIPLE',
          required:false,
          minSelections:0,
          maxSelections:2,
          allowQuantities:false,
          position:1,
          options:Object.freeze([
            Object.freeze({optionId:'no-cucumber',name:'走青瓜',position:1}),
            Object.freeze({optionId:'no-scallion',name:'走蔥',position:2}),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      productId:'plain-item',
      name:'無選項商品驗收',
      revision:1,
      categoryMemberships:Object.freeze([Object.freeze({categoryId:'acceptance',position:3})]),
      optionGroups:Object.freeze([]),
    }),
  ]),
});

const priceByProduct:Record<string,number>={
  'required-item':5000,
  'optional-riceball':4300,
  'plain-item':3800,
};

const resolver=new InternalPortCompositionResolver();
resolver.register({
  adapterId:'builder.options.acceptance.menu',
  port:'SMM',
  operation:ACTIVE_MENU_READ_V1,
  requirements:{authorizationContextRequired:true},
  translator:{translate(){return {}}},
  executor:{execute(){return menu}},
});
resolver.register({
  adapterId:'builder.options.acceptance.pricing',
  port:'SMM',
  operation:PRICING_QUOTE_V1,
  requirements:{authorizationContextRequired:true},
  translator:{translate(request:PricingQuoteRequest){return request}},
  executor:{execute(invocation):PricingQuoteProjection{
    const request=invocation.payload as PricingQuoteRequest;
    const lines=request.lines.map(line=>{
      const unit=priceByProduct[line.productId]??1000;
      return Object.freeze({
        lineId:line.lineId,
        currency:'HKD',
        quantity:line.quantity,
        listUnitPriceMinor:unit,
        adjustments:Object.freeze([]),
        finalUnitPriceMinor:unit,
        lineTotalMinor:unit*line.quantity,
        pricingRevisionOrRuleProvenance:Object.freeze(['builder-options-acceptance']),
      });
    });
    return Object.freeze({
      storeId:'options-acceptance-store',
      salesPriceContext:'DIRECT',
      currency:'HKD',
      lines:Object.freeze(lines),
      totalMinor:lines.reduce((sum,line)=>sum+line.lineTotalMinor,0),
      pricingRevisionOrRuleProvenance:Object.freeze(['builder-options-acceptance']),
    });
  }},
});

(globalThis as typeof globalThis&{__MOREFUNOS_V2_SMM_RUNTIME__?:unknown}).__MOREFUNOS_V2_SMM_RUNTIME__=Object.freeze({
  resolver,
  authorization:()=>Object.freeze({
    actorId:'options-acceptance-actor',
    authorizationContextRef:'options-acceptance-session',
    scopeRef:'options-acceptance-store',
  }),
  nextRequestId:()=>crypto.randomUUID(),
});

'use strict';
// Normal regression entry: execute actual installed handlers/helper, never the
// preparation's candidate-only mode. Keep each original behavioral assertion.
const keys=['BUYER_LOG_UI_USE_PRODUCT','BUYER_LOG_UI_USE_BASELINE'];
const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
try{
 process.env.BUYER_LOG_UI_USE_PRODUCT='1';delete process.env.BUYER_LOG_UI_USE_BASELINE;
 require('./fixtures/orders-ui/tests/orders-ui-command.test.cjs');
 require('./fixtures/orders-ui/tests/orders-ui-lifecycle-composition.test.cjs');
 require('./fixtures/orders-ui/tests/orders-ui-corrected-retirement.test.cjs');
}finally{
 for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
}

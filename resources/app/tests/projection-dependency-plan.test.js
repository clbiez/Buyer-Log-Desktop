'use strict';
const prior=process.env.BUYERLOG_DEPENDENCY_MODULE;
process.env.BUYERLOG_DEPENDENCY_MODULE=require.resolve('../public/projection-dependency-plan');
try{require('./contracts/dependency/dependency-plan.test.cjs');}
finally{if(prior===undefined)delete process.env.BUYERLOG_DEPENDENCY_MODULE;else process.env.BUYERLOG_DEPENDENCY_MODULE=prior;}

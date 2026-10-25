'use strict';
const {chromium}=require(process.env.BL_PLAYWRIGHT||'/workspace/.buyerlog-tools/node_modules/playwright');
module.exports=async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+(process.env.BL_AUDIT_CDP||9231));
 const context=browser.contexts()[0],page=context.pages().find(p=>p.url().includes('127.0.0.1'))||await context.newPage();
 page.setDefaultTimeout(12000);
 return {browser,context,page};
};

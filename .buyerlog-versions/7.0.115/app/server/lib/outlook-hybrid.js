'use strict';

function clean(value,max=2000){return String(value==null?'':value).trim().slice(0,max);}
function createOutlookHybridService(options={}){
  const graph=options.graph,local=options.local;
  if(!graph||!local)throw new Error('Graph and local Outlook services are required.');
  function graphStatus(userId){return graph.publicStatus(userId);}
  function publicStatus(userId){
    const g=graphStatus(userId),l=local.status(),active=g&&g.connected?'MICROSOFT_GRAPH':l&&l.connected?'CLASSIC_OUTLOOK_LOCAL':'OUTLOOK_BRIDGE';
    const connected=active==='MICROSOFT_GRAPH'||active==='CLASSIC_OUTLOOK_LOCAL';
    return {
      enabled:true,configured:connected||Boolean(g&&g.configured),connected,state:connected?'CONNECTED':(g&&g.state)||l.state||'BRIDGE_ONLY',
      email:active==='MICROSOFT_GRAPH'?g.email:'',accountName:active==='MICROSOFT_GRAPH'?g.accountName:(l.profileName||l.storeName||''),
      connectedAt:active==='MICROSOFT_GRAPH'?g.connectedAt:null,lastValidatedAt:active==='MICROSOFT_GRAPH'?g.lastValidatedAt:null,
      activeEngine:active,bridgeAvailable:Boolean(l.bridgeAvailable),local:{...l},graph:{...g},
      message:connected?(active==='CLASSIC_OUTLOOK_LOCAL'?'Classic Outlook yerel profili kullanılıyor.':'Microsoft Graph bağlantısı kullanılıyor.'):'Classic Outlook yerel araması kullanılamıyor; Outlook Bridge kullanılabilir.',
    };
  }
  async function search(userId,context,searchOptions={}){
    const preference=clean(searchOptions.enginePreference,40).toUpperCase()||'AUTO',g=graphStatus(userId),l=local.status();
    if(preference==='MICROSOFT_GRAPH')return graph.search(userId,context,searchOptions);
    if(preference==='CLASSIC_OUTLOOK_LOCAL')return local.search(context,searchOptions);
    if(g&&g.connected)return graph.search(userId,context,searchOptions);
    if(l&&l.connected)return local.search(context,searchOptions);
    throw Object.assign(new Error('Classic Outlook yerel araması kullanılamıyor ve Microsoft Graph bağlı değil. Outlook Bridge kullanabilirsiniz.'),{code:'OUTLOOK_BRIDGE_REQUIRED',statusCode:503});
  }
  async function messageDetail(userId,messageId){return String(messageId||'').startsWith('local:')?local.detail(messageId):graph.messageDetail(userId,messageId);}
  async function mailboxMessageDetail(userId,mailboxType,mailbox,messageId,useApplication=false){const type=clean(mailboxType,80).toUpperCase();if(type==='CLASSIC_OUTLOOK_LOCAL'||String(messageId||'').startsWith('local:'))return local.detail(messageId);return graph.mailboxMessageDetail(userId,mailboxType,mailbox,messageId,useApplication);}
  async function attachmentContent(userId,mailboxType,mailbox,messageId,attachmentId,useApplication=false){const type=clean(mailboxType,80).toUpperCase();if(type==='CLASSIC_OUTLOOK_LOCAL'||String(messageId||'').startsWith('local:'))return local.attachmentContent(messageId,attachmentId);return graph.attachmentContent(userId,mailboxType,mailbox,messageId,attachmentId,useApplication);}
  async function openLocal(messageId,fallback={}){return local.open(messageId,fallback);}
  async function bridge(context,searchOptions){return local.bridge(context,searchOptions);}
  async function accessibleSharedMailboxes(userId,candidates){const g=graphStatus(userId);if(!g||!g.connected)return[];return graph.accessibleSharedMailboxes(userId,candidates);}
  async function probeSharedMailbox(userId,mailbox){const g=graphStatus(userId);if(!g||!g.connected)return null;return graph.probeSharedMailbox(userId,mailbox);}
  async function searchSharedMailbox(userId,mailbox,context,searchOptions){return graph.searchSharedMailbox(userId,mailbox,context,searchOptions);}
  return {
    setup:graph.setup,config:graph.config,publicStatus,search,messageDetail,mailboxMessageDetail,attachmentContent,openLocal,bridge,
    beginConnect:graph.beginConnect,handleCallback:graph.handleCallback,disconnect:graph.disconnect,contextHash:graph.contextHash,
    accessibleSharedMailboxes,probeSharedMailbox,searchSharedMailbox,applicationGraph:graph.applicationGraph,applicationAccessToken:graph.applicationAccessToken,
    graph,local,
  };
}
module.exports={createOutlookHybridService};

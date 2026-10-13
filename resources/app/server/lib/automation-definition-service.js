'use strict';
function createAutomationDefinition(deps){
const {automationRecipeStore,agentBrowserConnector,automationLanguage,aiCapabilityRegistry,aiAutomationCompatibility}=deps;
function automationNormalizeBinding(raw){
  const item=raw&&typeof raw==='object'?raw:{},mode=String(item.mode||'').trim().toLowerCase();
  return {mode:mode==='field'?'field':'fixed',field:mode==='field'?String(item.field||'').trim().slice(0,240):''};
}
function automationNormalizePayload(value, ownerId='') {
  const source=value&&typeof value==='object'?value:{};
  const recipe = automationRecipeStore.normalizeRecipe(source, ownerId);
  recipe.steps = (recipe.steps || []).map((step,index) => {
    const normalized=agentBrowserConnector.normalizeStep(step,index);
    normalized.binding=automationNormalizeBinding(step&&step.binding);
    return normalized;
  });
  if (recipe.steps.length > 250) throw Object.assign(new Error('Bir otomasyonda en fazla 250 browser adımı olabilir.'), { code:'AUTOMATION_STEP_LIMIT', statusCode:413 });
  /* v6.36 — ALICI DOĞRULAMASI KAYIT ANINDA.
     Alıcısı çözülemeyen bir otomasyon kaydedilirse hata ancak Pazartesi 09:00'da,
     e-posta gelmeyince fark edilir. Bu yüzden eksiklik kaydetme anında kesilir:
     alan kipinde alan adı zorunlu, grup kipinde grup zorunlu. */
  if (['email','mixed'].includes(recipe.purpose)) {
    const email = recipe.email || {};
    if (email.recipientMode === 'field') {
      if (!String(email.recipientField || '').trim()) throw Object.assign(new Error('Alıcıyı belirleyen alanı seçin.'), { code:'AUTOMATION_RECIPIENT_FIELD_REQUIRED', statusCode:400 });
    } else if (!String(email.groupId || '').trim()) {
      throw Object.assign(new Error('E-posta grubu seçin.'), { code:'AUTOMATION_EMAIL_GROUP_REQUIRED', statusCode:400 });
    }
  }
  if (recipe.ai && recipe.ai.origin === 'ai_import') {
    let parsed;
    try { parsed = automationLanguage.parse(recipe.ai.sourceCode); }
    catch (error) { error.statusCode = 400; error.code = error.code || 'AI_AUTOMATION_SOURCE_INVALID'; throw error; }
    const validation = automationLanguage.validate(parsed, aiCapabilityRegistry.getCapabilityModel());
    if (!validation.ok) throw Object.assign(new Error('AI otomasyon taslağı güncel capability kaydıyla doğrulanamadı.'), { code:'AI_AUTOMATION_VALIDATION_FAILED', statusCode:422, details:{validation} });
    const compatibility = aiAutomationCompatibility.check(recipe);
    if (!compatibility.compatible) throw Object.assign(new Error('AI otomasyon taslağı güncel değil; gözden geçirilmesi gerekiyor.'), { code:'AI_AUTOMATION_NEEDS_REVIEW', statusCode:409, details:compatibility });
    recipe.ai = { ...recipe.ai, status: recipe.enabled ? 'active' : 'draft', capabilityHash: validation.capabilityHash };
  }
  return recipe;
}
return {normalize:automationNormalizePayload};
}
module.exports={createAutomationDefinition};

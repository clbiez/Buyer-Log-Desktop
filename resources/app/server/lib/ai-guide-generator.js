'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }
function quote(value) { return JSON.stringify(String(value == null ? '' : value)); }
function lines(items) { return (Array.isArray(items) ? items : []).map(item => `- ${item}`).join('\n'); }

function generateGuide(model, options = {}) {
  const generatedAt = clean(options.generatedAt) || new Date().toISOString();
  const datasets = (model.datasets || []).map(dataset => `${dataset.id} — ${dataset.label && dataset.label.en || dataset.id}`).join(', ');
  const fields = (model.fields || []).map(field => `${field.id} | ${field.label && field.label.en || field.id} | ${field.type} | ${field.sources.join(', ')}`).join('\n');
  const triggers = (model.triggers || []).map(trigger => `${trigger.id}${trigger.parameters && trigger.parameters.length ? ` (${trigger.parameters.join(', ')})` : ''}`).join(', ');
  const functions = (model.functions || []).map(fn => `${fn.id}(${(fn.args || []).join(', ')}) → ${fn.returnType}`).join(', ');
  const operators = (model.operators || []).map(operator => `${operator.id} (${operator.syntax})`).join(', ');
  const actions = (model.actions || []).map(action => `${action.id} — ${action.description}${Array.isArray(action.allowedSources) && action.allowedSources.length ? ` Sources: ${action.allowedSources.join(', ')}` : ''}`).join('\n');
  return `# Buyer Log AI Automation Guide

Generated from the current Buyer Log capability registry.

- Buyer Log Version: ${model.appVersion}
- Automation Language: ${model.automationLanguageVersion}
- Capability Schema: ${model.capabilitySchemaVersion}
- Capability Hash: ${model.capabilityHash}
- Generated At: ${generatedAt}
- Status: Current

## How to use this guide

Describe the desired automation to ChatGPT, attach this guide, and ask it to return only valid Buyer Log Automation Code. Buyer Log will parse, validate, preview and ask for missing choices before anything is activated.

## Supported datasets

${datasets}

## Available fields

The first column is the stable field id. Use the stable id or the displayed label in square brackets. Never invent a field.

| Stable id | Display label | Type | Dataset |
| --- | --- | --- | --- |
${fields.split('\n').map(row => `| ${row.split(' | ').join(' | ')} |`).join('\n')}

## Supported triggers

${triggers}

## Supported operators

${operators}

## Supported functions

${functions}

## Supported actions

${actions}

## Safety rules

${lines([
    'Use only capabilities listed in this guide.',
    'Do not output PowerShell, CMD, Bash, JavaScript, Python, SQL, shell commands or operating-system commands.',
    'Do not use eval, new Function, exec, spawn, filesystem commands or arbitrary URLs.',
    'Use ASK_USER for an email group or other value that must be selected inside Buyer Log.',
    'To send each manufacturer its own rows, use RECIPIENT_FIELD [Manufacturer] instead of RECIPIENT_GROUP; Buyer Log resolves every order to its manufacturer card (licensed non-DTR orders use the Sub-Manufacturer). Never write e-mail addresses.',
    'A parsed automation is a draft until the user reviews the preview and explicitly activates it.',
    'Unknown fields and unsupported actions must be reported, never silently remapped.',
  ])}

## Output format

\`\`\`
BUYERLOG_AUTOMATION 1.0
NAME "Production Risk"
TRIGGER
  DAILY AT 09:00
END
SOURCE "orders"
WHEN
  [orderStatus] != "In Production"
END
ACTIONS
${(model.actions || []).some(action => action.id === 'SEND_EMAIL') ? `  SEND_EMAIL
    RECIPIENT_GROUP ASK_USER
    SUBJECT "Production risk"
    INCLUDE_MATCHING_ROWS TRUE
    ATTACHMENT EXCEL` : `  SHOW_REPORT
    TITLE "Production risk"`}
  END
END
\`\`\`

Return only the code block when the user asks for an automation. Use the exact language version above.
`;
}

module.exports = { generateGuide };

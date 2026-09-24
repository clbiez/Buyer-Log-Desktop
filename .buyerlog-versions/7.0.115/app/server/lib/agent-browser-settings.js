'use strict';

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');

const SETTINGS_FILE = path.join(SERVER_DATA_ROOT, 'agent-browser-settings.json');
const MAX_HOSTS = 80;

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizeHost(value) {
  let raw = clean(value).toLowerCase();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) raw = new URL(raw).hostname.toLowerCase();
  } catch (_) { return ''; }
  raw = raw.replace(/^\.+|\.+$/g, '');
  if (!raw || raw.length > 253 || !/^[a-z0-9.-]+$/.test(raw) || raw.includes('..')) return '';
  return raw;
}
function normalizeHosts(values) {
  const input = Array.isArray(values) ? values : clean(values).split(/[\n,;]+/);
  return [...new Set(input.map(normalizeHost).filter(Boolean))].slice(0, MAX_HOSTS);
}
function defaults() { return { schemaVersion: 1, allowedHosts: [], updatedAt: null, updatedBy: '' }; }
function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return defaults();
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...defaults(), ...parsed, allowedHosts: normalizeHosts(parsed && parsed.allowedHosts) };
  } catch (_) { return defaults(); }
}
function saveSettings(value, profile = null) {
  const next = {
    ...defaults(),
    allowedHosts: normalizeHosts(value && value.allowedHosts),
    updatedAt: new Date().toISOString(),
    updatedBy: clean(profile && (profile.displayName || profile.username || profile.id)).slice(0, 120),
  };
  fs.mkdirSync(SERVER_DATA_ROOT, { recursive: true });
  atomicWriteJson(SETTINGS_FILE, next);
  return next;
}
function publicSettings() { return loadSettings(); }

module.exports = { SETTINGS_FILE, normalizeHost, normalizeHosts, loadSettings, saveSettings, publicSettings };

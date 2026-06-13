"use strict";

const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
];

let _auth = null;
let _credentials = null;

function loadCredentials() {
  if (_credentials) return _credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    _credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  return _credentials;
}

function getAuth() {
  if (_auth) return _auth;
  const credentials = loadCredentials();
  _auth = new google.auth.GoogleAuth({
    scopes: SCOPES,
    ...(credentials ? { credentials } : {}), // jika tidak ada, pakai GOOGLE_APPLICATION_CREDENTIALS
  });
  return _auth;
}

function sheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

function driveClient() {
  return google.drive({ version: "v3", auth: getAuth() });
}

async function serviceAccountEmail() {
  const credentials = loadCredentials();
  if (credentials && credentials.client_email) return credentials.client_email;
  try {
    const c = await getAuth().getCredentials();
    return c.client_email || null;
  } catch {
    return null;
  }
}

module.exports = { sheetsClient, driveClient, serviceAccountEmail };

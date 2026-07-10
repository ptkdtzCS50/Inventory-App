#!/usr/bin/env node
/* =====================================================================
 * Lizenz-Generator – Gerätefuhrpark (Dietz-Engineering, intern!)
 *
 * Erzeugt Signatur-Schlüsselpaare und signierte Kundenlizenzen.
 * Der PRIVATE Schlüssel bleibt bei Dietz-Engineering und darf NIEMALS
 * ins Repository oder zum Kunden gelangen. Der öffentliche Schlüssel
 * steht in js/lizenz.js und prüft die Signatur in der App.
 *
 * Verwendung:
 *   node tools/lizenz-generator.mjs schluessel
 *     -> erzeugt ein neues Schlüsselpaar (privat + öffentlich als JWK)
 *
 *   node tools/lizenz-generator.mjs erstellen \
 *     --privat privat.jwk.json \
 *     --kunde "Avidia Pharma AG" --edition Standard \
 *     --geraete 200 --bis 2027-12-31
 *     -> gibt den signierten Lizenzschlüssel aus (in js/config.js eintragen)
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * ===================================================================== */

import { webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const { subtle } = webcrypto;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : null;
};

async function schluesselErzeugen() {
  const paar = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privat = await subtle.exportKey('jwk', paar.privateKey);
  const oeffentlich = await subtle.exportKey('jwk', paar.publicKey);
  writeFileSync('privat.jwk.json', JSON.stringify(privat, null, 2));
  writeFileSync('oeffentlich.jwk.json', JSON.stringify(oeffentlich, null, 2));
  console.log('Schlüsselpaar erzeugt:');
  console.log('  privat.jwk.json      -> SICHER VERWAHREN, nie ins Repo!');
  console.log('  oeffentlich.jwk.json -> als LIZENZ_PUBLIC_KEY in js/lizenz.js eintragen');
}

async function lizenzErstellen() {
  const privatPfad = arg('privat');
  if (!privatPfad) { console.error('Fehlt: --privat <datei>'); process.exit(1); }
  const nutzlast = {
    kunde: arg('kunde') || 'Unbenannt',
    edition: arg('edition') || 'Standard',
    maxGeraete: Number(arg('geraete') || 100),
    gueltigBis: arg('bis') || '2027-12-31',
    ausgestellt: new Date().toISOString().slice(0, 10),
  };
  const privatJwk = JSON.parse(readFileSync(privatPfad, 'utf8'));
  const key = await subtle.importKey('jwk', privatJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const daten = new TextEncoder().encode(JSON.stringify(nutzlast));
  const signatur = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, daten);
  const lizenz = `${b64url(daten)}.${b64url(signatur)}`;
  console.log('Lizenz für:', nutzlast);
  console.log('\nLIZENZ_SCHLUESSEL (in js/config.js eintragen):\n');
  console.log(lizenz);
}

const befehl = process.argv[2];
if (befehl === 'schluessel') await schluesselErzeugen();
else if (befehl === 'erstellen') await lizenzErstellen();
else console.log('Verwendung: node lizenz-generator.mjs schluessel | erstellen --privat <datei> --kunde ... --edition ... --geraete ... --bis JJJJ-MM-TT');

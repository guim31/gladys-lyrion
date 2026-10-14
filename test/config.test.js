import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHost } from '../src/config.js';

test('the server address: IP, host name, port, scheme; credentials refused', () => {
  assert.equal(normalizeConfig({ host: '192.0.2.10' }).baseUrl, 'http://192.0.2.10:9000');
  assert.equal(normalizeConfig({ host: ' lms.lan ', port: 9001 }).baseUrl, 'http://lms.lan:9001');
  assert.equal(
    normalizeConfig({ host: '192.0.2.10:9002', port: 9001 }).baseUrl,
    'http://192.0.2.10:9002',
  );
  assert.equal(
    normalizeConfig({ host: 'https://lms.example.com' }).baseUrl,
    'https://lms.example.com:9000',
  );
  assert.equal(normalizeConfig({ host: '[2001:db8::1]' }).baseUrl, 'http://[2001:db8::1]:9000');
  assert.equal(parseHost('http://user:pw@192.0.2.10'), null);
  assert.equal(parseHost('192.0.2.10/settings'), null);
  assert.equal(parseHost('ftp://192.0.2.10'), null);
  assert.equal(normalizeConfig({}).configured, false);
  assert.equal(normalizeConfig({ host: 'http://user:pw@x' }).valid, false);
});

test('ports, credentials and language', () => {
  const config = normalizeConfig({
    host: '192.0.2.10',
    port: 'abc',
    cli_port: 0,
    username: ' gladys ',
    password: ' s3cret ',
    language: 'it',
  });
  assert.equal(config.baseUrl, 'http://192.0.2.10:9000');
  assert.equal(config.cliPort, 0, '0 turns the CLI off');
  assert.equal(config.username, 'gladys');
  assert.equal(config.password, ' s3cret ', 'a password is never trimmed');
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ host: 'x', cli_port: 70000 }).cliPort, 9090);
});

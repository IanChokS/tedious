const Connection = require('../../src/connection');
const Request = require('../../src/request');
const TYPES = require('../../src/data-type').typeByName;

const fs = require('fs');
const { assert } = require('chai');

const config = JSON.parse(
  fs.readFileSync(require('os').homedir() + '/.tedious/test-connection.json', 'utf8')
).config;

config.options.debug = {
  packet: true,
  data: true,
  payload: true,
  token: true,
  log: true
};
config.options.columnEncryptionSetting = true;
const alwaysEncryptedCEK = Buffer.from([
  // decrypted column key must be 32 bytes long for AES256
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
config.options.encryptionKeyStoreProviders = [{
  key: 'TEST_KEYSTORE',
  value: {
    decryptColumnEncryptionKey: () => Promise.resolve(alwaysEncryptedCEK),
  },
}];
config.options.tdsVersion = process.env.TEDIOUS_TDS_VERSION;

describe('always encrypted', function() {
  this.timeout(100000);
  let connection;

  before(function() {
    if (config.options.tdsVersion < '7_4') {
      this.skip();
    }
  });

  const createKeys = (cb) => {
    const request = new Request(`CREATE COLUMN MASTER KEY [CMK1] WITH (
      KEY_STORE_PROVIDER_NAME = 'TEST_KEYSTORE',
      KEY_PATH = 'some-arbitrary-keypath'
    );`, (err) => {
      if (err) {
        return cb(err);
      }
      const request = new Request(`CREATE COLUMN ENCRYPTION KEY [CEK1] WITH VALUES (
        COLUMN_MASTER_KEY = [CMK1],
        ALGORITHM = 'RSA_OAEP',
        ENCRYPTED_VALUE = 0xDEADBEEF
      );`, (err) => {
        if (err) {
          return cb(err);
        }
        return cb();
      });
      connection.execSql(request);
    });
    connection.execSql(request);
  };

  const dropKeys = (cb) => {
    const request = new Request('IF OBJECT_ID(\'dbo.test_always_encrypted\', \'U\') IS NOT NULL DROP TABLE dbo.test_always_encrypted;', (err) => {
      if (err) {
        return cb(err);
      }

      const request = new Request('IF (SELECT COUNT(*) FROM sys.column_encryption_keys WHERE name=\'CEK1\') > 0 DROP COLUMN ENCRYPTION KEY [CEK1];', (err) => {
        if (err) {
          return cb(err);
        }

        const request = new Request('IF (SELECT COUNT(*) FROM sys.column_master_keys WHERE name=\'CMK1\') > 0 DROP COLUMN MASTER KEY [CMK1];', (err) => {
          if (err) {
            return cb(err);
          }

          cb();
        });
        connection.execSql(request);
      });
      connection.execSql(request);
    });
    connection.execSql(request);
  };

  beforeEach(function(done) {
    connection = new Connection(config);
    // connection.on('debug', (msg) => console.log(msg));
    connection.on('connect', () => {
      dropKeys((err) => {
        if (err) {
          return done(err);
        }
        createKeys(done);
      });
    });
  });

  afterEach(function(done) {
    if (!connection.closed) {
      dropKeys(() => {
        connection.on('end', done);
        connection.close();
      });
    } else {
      done();
    }
  });

  it('should correctly insert/select the encrypted data', function(done) {  
    const plaintext = 'nvarchar_determ_test_val123';
    const datetime_randomized_test =  new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 997));
    const datetime_deterministic_test =  new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 997));
    const datetime2_randomized_test =  new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999));
    const datetime2_deterministic_test =  new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999));
    const datetimeoffset_randomized_test = new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999));
    const datetimeoffset_deterministic_test = new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999));
    const time_randomized_test = new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999))

    const request = new Request(`CREATE TABLE test_always_encrypted (
      [plaintext]  nvarchar(50),
      [datetime_randomized_test] datetime 
      ENCRYPTED WITH (
        ENCRYPTION_TYPE = RANDOMIZED,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
        COLUMN_ENCRYPTION_KEY = [CEK1]
      ),
      [datetime_deterministic_test] datetime 
      ENCRYPTED WITH (
        ENCRYPTION_TYPE = DETERMINISTIC,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
        COLUMN_ENCRYPTION_KEY = [CEK1]
      ),
      [datetime2_randomized_test] datetime2 
      ENCRYPTED WITH (
        ENCRYPTION_TYPE = RANDOMIZED,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
        COLUMN_ENCRYPTION_KEY = [CEK1]
      ),
      [datetime2_deterministic_test] datetime2 
      ENCRYPTED WITH (
        ENCRYPTION_TYPE = DETERMINISTIC,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
        COLUMN_ENCRYPTION_KEY = [CEK1]
      ),
      [datetimeoffset_randomized_test] datetimeoffset 
      ENCRYPTED WITH (
        ENCRYPTION_TYPE = RANDOMIZED,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
        COLUMN_ENCRYPTION_KEY = [CEK1]
      ),
      [datetimeoffset_deterministic_test] datetimeoffset 
      ENCRYPTED WITH (
        ENCRYPTION_TYPE = DETERMINISTIC,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
        COLUMN_ENCRYPTION_KEY = [CEK1]
      ),
      [time_randomized_test] time 
      ENCRYPTED WITH (
        ENCRYPTION_TYPE = RANDOMIZED,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
        COLUMN_ENCRYPTION_KEY = [CEK1]
      ),
    );`, (err) => {
      if (err) {
        console.log('ERROR CREATE TABLE')
        return done(err);
      }

      const request = new Request(
        `INSERT INTO test_always_encrypted VALUES (
            @plaintext, 
            @datetime_randomized_test,
            @datetime_deterministic_test,
            @datetime2_randomized_test,
            @datetime2_deterministic_test,
            @datetimeoffset_randomized_test,
            @datetimeoffset_deterministic_test,
            @time_randomized_test
            )`, (err) => {
        if (err) {
          console.log('ERROR INSERT INTO')
          return done(err);
        }
        let values = [];
        const request = new Request(`SELECT TOP 1 * FROM test_always_encrypted`, (err) => {
          if (err) {
            console.log('ERROR SELECT TOP')
            return done(err);
          }

          try {
            assert.deepEqual(values, [
              plaintext, 
              datetime_randomized_test, 
              datetime_deterministic_test, 
              datetime2_randomized_test,
              datetime2_deterministic_test,
              datetimeoffset_randomized_test,
              datetimeoffset_deterministic_test,
              time_randomized_test
            ]);
          } catch (error) {
            return done(error);
          }

          return done();
        });

        request.on('row', function(columns) {
          values = columns.map((col) => col.value);
        });

        connection.execSql(request);
      });

      request.addParameter('plaintext', TYPES.NVarChar, plaintext);
      request.addParameter('datetime_randomized_test', TYPES.DateTime, datetime_randomized_test, {scale: 3});
      request.addParameter('datetime_deterministic_test', TYPES.DateTime, datetime_deterministic_test, {scale: 3});
      request.addParameter('datetime2_randomized_test', TYPES.DateTime2, datetime2_randomized_test, {scale: 7});
      request.addParameter('datetime2_deterministic_test', TYPES.DateTime2, datetime2_deterministic_test, {scale: 7});
      request.addParameter('datetimeoffset_randomized_test', TYPES.DateTimeOffset, datetimeoffset_randomized_test, {precision: 34, scale: 7});
      request.addParameter('datetimeoffset_deterministic_test', TYPES.DateTimeOffset, datetimeoffset_deterministic_test, {precision: 34, scale: 7});
      request.addParameter('time_randomized_test', TYPES.Time, time_randomized_test, {precision: 16, scale: 7});

      connection.execSql(request);
    });
    connection.execSql(request);
  });
});
